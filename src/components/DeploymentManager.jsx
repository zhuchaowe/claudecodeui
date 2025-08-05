import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import notificationService from '../utils/notificationService';
import DeploymentServerManager from './DeploymentServerManager';
import { Settings, GitBranch, Clock, Activity, AlertCircle, CheckCircle, XCircle, Loader, Server, Globe, Database } from 'lucide-react';

const DeploymentManager = ({ project, onClose }) => {
  const [deployments, setDeployments] = useState([]);
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [selectedServer, setSelectedServer] = useState(null);
  const [deploymentLogs, setDeploymentLogs] = useState({});
  const [showLogs, setShowLogs] = useState({});
  const [showServerManager, setShowServerManager] = useState(false);
  const [selectedTab, setSelectedTab] = useState('deploy'); // deploy, history, monitoring
  const [gitBranches, setGitBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [deploymentConfig, setDeploymentConfig] = useState({
    resourceLimits: { memory: '512m', cpus: '0.5' },
    environmentVars: {},
    autoCleanup: true,
    healthCheck: { enabled: true, path: '/health' }
  });
  const [serverStats, setServerStats] = useState({});
  const [realTimeProgress, setRealTimeProgress] = useState({});

  // WebSocket for real-time updates
  const [ws, setWs] = useState(null);
  const [activeDeployments, setActiveDeployments] = useState(new Set());

  useEffect(() => {
    loadData();
    loadGitBranches();
    setupWebSocket();
    
    const statsInterval = setInterval(loadServerStats, 30000); // Update stats every 30s
    
    return () => {
      if (ws) {
        ws.close();
      }
      clearInterval(statsInterval);
    };
  }, []);

  useEffect(() => {
    if (selectedServer) {
      loadServerStats();
    }
  }, [selectedServer]);

  const setupWebSocket = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${localStorage.getItem('auth-token')}`;
    
    const websocket = new WebSocket(wsUrl);
    
    websocket.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'deployment-progress') {
        handleDeploymentProgress(data);
      } else if (data.type === 'deployment-complete') {
        handleDeploymentComplete(data);
      } else if (data.type === 'deployment-error') {
        handleDeploymentError(data);
      }
    };
    
    websocket.onopen = () => {
      console.log('WebSocket connected for deployment updates');
    };
    
    websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    setWs(websocket);
  };

  const loadData = async () => {
    try {
      const [deploymentsRes, serversRes] = await Promise.all([
        fetch('/api/deployment/deployments', {
          headers: { Authorization: `Bearer ${localStorage.getItem('auth-token')}` }
        }),
        fetch('/api/deployment/servers', {
          headers: { Authorization: `Bearer ${localStorage.getItem('auth-token')}` }
        })
      ]);

      const deploymentsData = await deploymentsRes.json();
      const serversData = await serversRes.json();

      setDeployments(deploymentsData);
      setServers(serversData);
      setSelectedServer(serversData[0]?.id);
      
      // Track active deployments
      const active = new Set(deploymentsData.filter(d => d.status === 'deploying' || d.status === 'running').map(d => d.id));
      setActiveDeployments(active);
    } catch (error) {
      console.error('Error loading deployment data:', error);
      notificationService.showToast('Failed to load deployment data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const loadGitBranches = async () => {
    if (!project.gitUrl) return;
    
    try {
      const response = await fetch(`/api/deployment/branch-info?gitUrl=${encodeURIComponent(project.gitUrl)}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('auth-token')}` }
      });
      
      if (response.ok) {
        const data = await response.json();
        if (data.supported && data.repository) {
          // For now, provide common branches - this would be enhanced to fetch actual branches
          setGitBranches(['main', 'develop', 'staging', 'feature/*', 'bugfix/*']);
        }
      }
    } catch (error) {
      console.error('Error loading Git branches:', error);
    }
  };

  const loadServerStats = async () => {
    if (!selectedServer) return;
    
    try {
      const response = await fetch(`/api/deployment/servers/${selectedServer}/stats`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('auth-token')}` }
      });
      
      if (response.ok) {
        const stats = await response.json();
        setServerStats(prev => ({ ...prev, [selectedServer]: stats }));
      }
    } catch (error) {
      console.error('Error loading server stats:', error);
    }
  };

  const handleDeploymentProgress = (data) => {
    const { deploymentId, step, status, message, progress } = data;
    
    // Update real-time progress
    setRealTimeProgress(prev => ({
      ...prev,
      [deploymentId]: {
        currentStep: step,
        status: status,
        progress: progress || 0,
        message: message,
        timestamp: new Date().toISOString()
      }
    }));
    
    // Update deployment logs
    setDeploymentLogs(prev => ({
      ...prev,
      [deploymentId]: [
        ...(prev[deploymentId] || []),
        { step, status, message, timestamp: new Date().toISOString() }
      ]
    }));
    
    // Update active deployments set
    if (status === 'running' || status === 'deploying') {
      setActiveDeployments(prev => new Set([...prev, deploymentId]));
    } else if (status === 'completed' || status === 'error') {
      setActiveDeployments(prev => {
        const newSet = new Set(prev);
        newSet.delete(deploymentId);
        return newSet;
      });
    }
  };

  const handleDeploymentComplete = (data) => {
    notificationService.showToast(`Deployment completed: ${data.url}`, 'success');
    setDeploying(false);
    loadData(); // Refresh deployments list
  };

  const handleDeploymentError = (data) => {
    notificationService.showToast(`Deployment failed: ${data.error}`, 'error');
    setDeploying(false);
  };

  const deployBranch = async (branch, customConfig = {}) => {
    if (!selectedServer) {
      notificationService.showToast('Please select a deployment server', 'error');
      return;
    }

    if (!branch) {
      notificationService.showToast('Please select or enter a branch name', 'error');
      return;
    }

    setDeploying(true);
    
    try {
      const deployRequest = {
        branch: branch,
        projectName: project.name,
        gitUrl: project.gitUrl || `https://github.com/user/${project.name}.git`,
        serverId: selectedServer,
        commitHash: 'latest',
        deploymentConfig: {
          ...deploymentConfig,
          ...customConfig,
          environmentVars: {
            NODE_ENV: 'production',
            PORT: '3000',
            ...deploymentConfig.environmentVars
          }
        }
      };

      console.log('🚀 Starting deployment with config:', deployRequest);

      const response = await fetch('/api/deployment/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth-token')}`
        },
        body: JSON.stringify(deployRequest)
      });

      const result = await response.json();
      
      if (result.success) {
        notificationService.showToast('Deployment started successfully', 'success');
        // Switch to monitoring tab to show progress
        setSelectedTab('monitoring');
      } else {
        throw new Error(result.error || 'Deployment failed');
      }
    } catch (error) {
      console.error('Error starting deployment:', error);
      notificationService.showToast(`Failed to start deployment: ${error.message}`, 'error');
      setDeploying(false);
    }
  };

  const stopDeployment = async (deploymentId) => {
    try {
      const response = await fetch(`/api/deployment/deployments/${deploymentId}/stop`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth-token')}`
        }
      });

      const result = await response.json();
      
      if (result.success) {
        notificationService.showToast('Deployment stop initiated', 'success');
        loadData();
      } else {
        throw new Error(result.error || 'Failed to stop deployment');
      }
    } catch (error) {
      console.error('Error stopping deployment:', error);
      notificationService.showToast(`Failed to stop deployment: ${error.message}`, 'error');
    }
  };

  const restartDeployment = async (deploymentId) => {
    try {
      const response = await fetch(`/api/deployment/deployments/${deploymentId}/restart`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${localStorage.getItem('auth-token')}`
        }
      });

      const result = await response.json();
      
      if (result.success) {
        notificationService.showToast('Deployment restart initiated', 'success');
        loadData();
      } else {
        throw new Error(result.error || 'Failed to restart deployment');
      }
    } catch (error) {
      console.error('Error restarting deployment:', error);
      notificationService.showToast(`Failed to restart deployment: ${error.message}`, 'error');
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'running': return 'bg-green-500';
      case 'deploying': return 'bg-blue-500';
      case 'stopped': return 'bg-gray-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-yellow-500';
    }
  };

  const toggleLogs = (deploymentId) => {
    setShowLogs(prev => ({
      ...prev,
      [deploymentId]: !prev[deploymentId]
    }));
  };

  const getProgressIcon = (status) => {
    switch (status) {
      case 'running':
      case 'deploying':
        return <Loader className="w-4 h-4 animate-spin text-blue-500" />;
      case 'completed':
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'error':
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-500" />;
      case 'warning':
        return <AlertCircle className="w-4 h-4 text-yellow-500" />;
      default:
        return <Clock className="w-4 h-4 text-gray-500" />;
    }
  };

  const getDeploymentSteps = () => [
    { key: 'validation', label: 'Validation', icon: CheckCircle },
    { key: 'port_allocation', label: 'Port Allocation', icon: Server },
    { key: 'workflow_generation', label: 'Workflow Generation', icon: GitBranch },
    { key: 'cicd_trigger', label: 'CI/CD Trigger', icon: Activity },
    { key: 'deployment_monitoring', label: 'Deployment', icon: Database },
    { key: 'nginx_configuration', label: 'Nginx Config', icon: Globe },
    { key: 'health_check', label: 'Health Check', icon: Activity },
    { key: 'finalization', label: 'Finalization', icon: CheckCircle }
  ];

  const renderProgressBar = (deploymentId) => {
    const progress = realTimeProgress[deploymentId];
    if (!progress) return null;

    const steps = getDeploymentSteps();
    const currentStepIndex = steps.findIndex(step => step.key === progress.currentStep);
    const progressPercentage = ((currentStepIndex + 1) / steps.length) * 100;

    return (
      <div className="mt-3 p-3 bg-muted rounded border border-border">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-foreground">Deployment Progress</span>
          <span className="text-xs text-muted-foreground">{Math.round(progressPercentage)}%</span>
        </div>
        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2 mb-3">
          <div 
            className="bg-primary h-2 rounded-full transition-all duration-300" 
            style={{ width: `${progressPercentage}%` }}
          ></div>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {steps.map((step, index) => {
            const isActive = index === currentStepIndex;
            const isCompleted = index < currentStepIndex;
            const Icon = step.icon;
            
            return (
              <div key={step.key} className={`flex items-center gap-1 text-xs ${
                isActive ? 'text-primary font-medium' :
                isCompleted ? 'text-green-600 dark:text-green-400' :
                'text-muted-foreground'
              }`}>
                <Icon className="w-3 h-3" />
                <span className="truncate">{step.label}</span>
              </div>
            );
          })}
        </div>
        {progress.message && (
          <div className="mt-2 text-xs text-muted-foreground flex items-center gap-1">
            {getProgressIcon(progress.status)} {progress.message}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-card border border-border rounded-lg p-6 max-w-md w-full m-4">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <span className="ml-2 text-foreground">Loading deployment data...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-card border border-border rounded-lg shadow-xl max-w-4xl w-full h-3/4 flex flex-col m-4">
          {/* Header */}
          <div className="flex justify-between items-center p-6 border-b border-border bg-card rounded-t-lg">
            <h2 className="text-2xl font-bold text-foreground">Branch Deployments - {project.displayName || project.name}</h2>
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setShowServerManager(true)}
              >
                <Settings className="w-4 h-4 mr-2" />
                Manage Servers
              </Button>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="border-b border-border bg-card">
            <div className="flex space-x-8 px-6">
              {[
                { key: 'deploy', label: 'Deploy', icon: GitBranch },
                { key: 'history', label: 'Deployments', icon: Activity },
                { key: 'monitoring', label: 'Monitoring', icon: Activity }
              ].map(tab => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setSelectedTab(tab.key)}
                    className={`flex items-center gap-2 py-4 px-2 border-b-2 text-sm font-medium transition-colors ${
                      selectedTab === tab.key
                        ? 'border-primary text-primary'
                        : 'border-transparent text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    {tab.label}
                    {tab.key === 'monitoring' && activeDeployments.size > 0 && (
                      <Badge className="bg-blue-500 text-white text-xs">
                        {activeDeployments.size}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-hidden bg-card">
            {selectedTab === 'deploy' && (
              <div className="flex h-full">
                {/* Left Panel - Deploy Controls */}
                <div className="w-1/2 p-6 border-r border-border overflow-y-auto">
                  <h3 className="text-lg font-semibold mb-4 text-foreground">Deploy New Branch</h3>
                  
                  {/* Server Selection */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium mb-2 text-foreground">Deployment Server</label>
                    <select
                      className="w-full p-2 border border-border rounded-md bg-background text-foreground"
                      value={selectedServer || ''}
                      onChange={(e) => setSelectedServer(parseInt(e.target.value))}
                    >
                      <option value="">Select a server</option>
                      {servers.map(server => (
                        <option key={server.id} value={server.id}>
                          {server.name} ({server.host})
                        </option>
                      ))}
                    </select>
                    
                    {/* Server Stats */}
                    {selectedServer && serverStats[selectedServer] && (
                      <div className="mt-2 p-3 bg-muted rounded border border-border">
                        <div className="grid grid-cols-2 gap-4 text-xs">
                          <div>
                            <span className="text-muted-foreground">Port Usage:</span>
                            <div className="text-foreground font-medium">
                              {serverStats[selectedServer].portUsage?.allocated || 0} / {serverStats[selectedServer].portUsage?.total || 0}
                            </div>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Active Deployments:</span>
                            <div className="text-foreground font-medium">
                              {serverStats[selectedServer].deployments?.running || 0}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Branch Selection */}
                  <div className="mb-4">
                    <label className="block text-sm font-medium mb-2 text-foreground">Branch Name</label>
                    <div className="space-y-2">
                      {gitBranches.length > 0 && (
                        <select
                          className="w-full p-2 border border-border rounded-md bg-background text-foreground"
                          value={selectedBranch}
                          onChange={(e) => setSelectedBranch(e.target.value)}
                        >
                          <option value="">Select a branch</option>
                          {gitBranches.map(branch => (
                            <option key={branch} value={branch}>{branch}</option>
                          ))}
                        </select>
                      )}
                      <div className="flex gap-2">
                        <Input
                          placeholder="Or enter custom branch name"
                          value={selectedBranch}
                          onChange={(e) => setSelectedBranch(e.target.value)}
                          className="bg-background"
                        />
                        <Button
                          onClick={() => deployBranch(selectedBranch)}
                          disabled={deploying || !selectedBranch}
                          className="px-6"
                        >
                          {deploying ? (
                            <>
                              <Loader className="w-4 h-4 mr-2 animate-spin" />
                              Deploying...
                            </>
                          ) : (
                            'Deploy'
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* Quick Deploy Buttons */}
                  <div className="mb-6">
                    <h4 className="text-sm font-medium mb-2 text-foreground">Quick Deploy</h4>
                    <div className="grid grid-cols-2 gap-2">
                      {['main', 'develop', 'staging', 'beta'].map(branch => (
                        <Button
                          key={branch}
                          variant="outline"
                          size="sm"
                          onClick={() => deployBranch(branch)}
                          disabled={deploying}
                          className="justify-start"
                        >
                          <GitBranch className="w-3 h-3 mr-2" />
                          {branch}
                        </Button>
                      ))}
                    </div>
                  </div>

                  {/* Deployment Configuration */}
                  <div className="space-y-4">
                    <h4 className="text-sm font-medium text-foreground">Deployment Configuration</h4>
                    
                    <div className="p-4 bg-muted rounded border border-border space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block text-xs font-medium mb-1 text-foreground">Memory Limit</label>
                          <Input
                            value={deploymentConfig.resourceLimits.memory}
                            onChange={(e) => setDeploymentConfig(prev => ({
                              ...prev,
                              resourceLimits: { ...prev.resourceLimits, memory: e.target.value }
                            }))}
                            placeholder="512m"
                            className="text-xs h-8"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium mb-1 text-foreground">CPU Limit</label>
                          <Input
                            value={deploymentConfig.resourceLimits.cpus}
                            onChange={(e) => setDeploymentConfig(prev => ({
                              ...prev,
                              resourceLimits: { ...prev.resourceLimits, cpus: e.target.value }
                            }))}
                            placeholder="0.5"
                            className="text-xs h-8"
                          />
                        </div>
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="autoCleanup"
                          checked={deploymentConfig.autoCleanup}
                          onChange={(e) => setDeploymentConfig(prev => ({
                            ...prev,
                            autoCleanup: e.target.checked
                          }))}
                          className="rounded"
                        />
                        <label htmlFor="autoCleanup" className="text-xs text-foreground">
                          Auto cleanup after 7 days
                        </label>
                      </div>
                      
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          id="healthCheck"
                          checked={deploymentConfig.healthCheck.enabled}
                          onChange={(e) => setDeploymentConfig(prev => ({
                            ...prev,
                            healthCheck: { ...prev.healthCheck, enabled: e.target.checked }
                          }))}
                          className="rounded"
                        />
                        <label htmlFor="healthCheck" className="text-xs text-foreground">
                          Enable health checks
                        </label>
                      </div>
                    </div>
                  </div>
                </div>
                
                {/* Right Panel - Recent Deployments */}
                <div className="w-1/2 p-6 overflow-y-auto">
                  <h3 className="text-lg font-semibold mb-4 text-foreground">Recent Deployments</h3>
                  {deployments.slice(0, 5).map(deployment => (
                    <div key={deployment.id} className="mb-3 p-3 border border-border rounded-lg bg-card">
                      <div className="flex justify-between items-start">
                        <div>
                          <div className="flex items-center gap-2">
                            <h5 className="font-medium text-foreground">{deployment.branch}</h5>
                            <Badge className={`${getStatusColor(deployment.status)} text-white text-xs`}>
                              {deployment.status}
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground mt-1">
                            {new Date(deployment.last_deployed).toLocaleString()}
                          </p>
                        </div>
                        {deployment.full_url && (
                          <a
                            href={deployment.full_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-primary hover:underline"
                          >
                            <Globe className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                      {renderProgressBar(deployment.id)}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedTab === 'history' && (
              <div className="p-6 overflow-y-auto">
                <h3 className="text-lg font-semibold mb-4 text-foreground">Deployment History</h3>
                
                {deployments.length === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    <Activity className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No deployments found</p>
                    <p className="text-sm">Deploy a branch to get started</p>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {deployments.map(deployment => (
                      <div key={deployment.id} className="border border-border rounded-lg p-4 bg-card">
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <h4 className="font-medium text-foreground">{deployment.branch}</h4>
                              <Badge className={`${getStatusColor(deployment.status)} text-white text-xs`}>
                                {deployment.status}
                              </Badge>
                              {activeDeployments.has(deployment.id) && (
                                <Badge className="bg-blue-500 text-white text-xs animate-pulse">
                                  Live
                                </Badge>
                              )}
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4 text-xs text-muted-foreground mb-2">
                              <div>
                                <span className="font-medium">Container:</span> {deployment.container_name}
                              </div>
                              <div>
                                <span className="font-medium">Server:</span> {deployment.server_name}
                              </div>
                              <div>
                                <span className="font-medium">Port:</span> {deployment.port}
                              </div>
                              <div>
                                <span className="font-medium">Last deployed:</span> {new Date(deployment.last_deployed).toLocaleString()}
                              </div>
                            </div>
                            
                            {deployment.full_url && (
                              <a
                                href={deployment.full_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                              >
                                <Globe className="w-3 h-3" />
                                {deployment.full_url}
                              </a>
                            )}
                          </div>
                          
                          <div className="flex gap-2">
                            {deployment.status === 'running' && (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => restartDeployment(deployment.id)}
                                >
                                  Restart
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  onClick={() => stopDeployment(deployment.id)}
                                  className="text-destructive"
                                >
                                  Stop
                                </Button>
                              </>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => toggleLogs(deployment.id)}
                            >
                              {showLogs[deployment.id] ? 'Hide Logs' : 'Show Logs'}
                            </Button>
                          </div>
                        </div>

                        {/* Real-time Progress */}
                        {renderProgressBar(deployment.id)}

                        {/* Deployment Logs */}
                        {showLogs[deployment.id] && (
                          <div className="mt-4 p-3 bg-muted rounded border border-border max-h-40 overflow-y-auto">
                            <h5 className="text-sm font-medium mb-2 text-foreground">Deployment Logs:</h5>
                            {deploymentLogs[deployment.id] ? (
                              <div className="space-y-1">
                                {deploymentLogs[deployment.id].map((log, index) => (
                                  <div key={index} className="text-xs flex items-start gap-2">
                                    <span className="text-muted-foreground shrink-0">
                                      {new Date(log.timestamp).toLocaleTimeString()}
                                    </span>
                                    <div className="flex items-center gap-1">
                                      {getProgressIcon(log.status)}
                                      <span className="font-medium text-foreground">
                                        [{log.step}]
                                      </span>
                                    </div>
                                    <span className="text-foreground">{log.message}</span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground">No logs available</p>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {selectedTab === 'monitoring' && (
              <div className="p-6 overflow-y-auto">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg font-semibold text-foreground">Live Monitoring</h3>
                  <Badge className="bg-green-500 text-white">
                    {activeDeployments.size} Active
                  </Badge>
                </div>
                
                {activeDeployments.size === 0 ? (
                  <div className="text-center text-muted-foreground py-8">
                    <Activity className="w-12 h-12 mx-auto mb-4 opacity-50" />
                    <p>No active deployments to monitor</p>
                    <p className="text-sm">Deploy a branch to see real-time progress</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {/* Server Overview */}
                    {selectedServer && serverStats[selectedServer] && (
                      <div className="p-4 bg-muted rounded-lg border border-border">
                        <h4 className="font-medium text-foreground mb-3">Server Overview</h4>
                        <div className="grid grid-cols-4 gap-4">
                          <div className="text-center">
                            <div className="flex items-center justify-center gap-1 text-blue-500 mb-1">
                              <Server className="w-4 h-4" />
                              <span className="text-xs font-medium">Ports</span>
                            </div>
                            <div className="text-sm text-foreground font-medium">
                              {serverStats[selectedServer].portUsage?.allocated || 0} / {serverStats[selectedServer].portUsage?.total || 0}
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="flex items-center justify-center gap-1 text-green-500 mb-1">
                              <Activity className="w-4 h-4" />
                              <span className="text-xs font-medium">Running</span>
                            </div>
                            <div className="text-sm text-foreground font-medium">
                              {serverStats[selectedServer].deployments?.running || 0}
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="flex items-center justify-center gap-1 text-yellow-500 mb-1">
                              <Clock className="w-4 h-4" />
                              <span className="text-xs font-medium">Stopped</span>
                            </div>
                            <div className="text-sm text-foreground font-medium">
                              {serverStats[selectedServer].deployments?.stopped || 0}
                            </div>
                          </div>
                          <div className="text-center">
                            <div className="flex items-center justify-center gap-1 text-red-500 mb-1">
                              <XCircle className="w-4 h-4" />
                              <span className="text-xs font-medium">Errors</span>
                            </div>
                            <div className="text-sm text-foreground font-medium">
                              {serverStats[selectedServer].deployments?.error || 0}
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    
                    {/* Active Deployments */}
                    <div className="space-y-4">
                      {deployments.filter(d => activeDeployments.has(d.id)).map(deployment => (
                        <div key={deployment.id} className="border border-border rounded-lg p-4 bg-card">
                          <div className="flex justify-between items-start mb-3">
                            <div>
                              <div className="flex items-center gap-2 mb-1">
                                <h4 className="font-medium text-foreground">{deployment.branch}</h4>
                                <Badge className={`${getStatusColor(deployment.status)} text-white text-xs animate-pulse`}>
                                  {deployment.status}
                                </Badge>
                              </div>
                              <p className="text-xs text-muted-foreground">
                                {deployment.server_name} • Port {deployment.port}
                              </p>
                            </div>
                            
                            {deployment.full_url && (
                              <a
                                href={deployment.full_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:text-primary/80"
                              >
                                <Globe className="w-4 h-4" />
                              </a>
                            )}
                          </div>
                          
                          {renderProgressBar(deployment.id)}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Server Manager Modal */}
      {showServerManager && (
        <DeploymentServerManager
          onClose={() => {
            setShowServerManager(false);
            loadData(); // Refresh servers list when server manager closes
          }}
        />
      )}
    </>
  );
};

export default DeploymentManager;