import React, { useState, useEffect, useCallback } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import notificationService from '../utils/notificationService';

const DeploymentManager = ({ project, onClose }) => {
  const [deployments, setDeployments] = useState([]);
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [selectedServer, setSelectedServer] = useState(null);
  const [deploymentLogs, setDeploymentLogs] = useState({});
  const [showLogs, setShowLogs] = useState({});

  // WebSocket for real-time updates
  const [ws, setWs] = useState(null);

  useEffect(() => {
    loadData();
    setupWebSocket();
    
    return () => {
      if (ws) {
        ws.close();
      }
    };
  }, []);

  const setupWebSocket = () => {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws?token=${localStorage.getItem('token')}`;
    
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
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        }),
        fetch('/api/deployment/servers', {
          headers: { Authorization: `Bearer ${localStorage.getItem('token')}` }
        })
      ]);

      const deploymentsData = await deploymentsRes.json();
      const serversData = await serversRes.json();

      setDeployments(deploymentsData);
      setServers(serversData);
      setSelectedServer(serversData[0]?.id);
    } catch (error) {
      console.error('Error loading deployment data:', error);
      notificationService.showToast('Failed to load deployment data', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeploymentProgress = (data) => {
    const { deploymentId, step, status, message } = data;
    
    setDeploymentLogs(prev => ({
      ...prev,
      [deploymentId]: [
        ...(prev[deploymentId] || []),
        { step, status, message, timestamp: new Date().toISOString() }
      ]
    }));
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

  const deployBranch = async (branch) => {
    if (!selectedServer) {
      notificationService.showToast('Please select a deployment server', 'error');
      return;
    }

    setDeploying(true);
    
    try {
      const response = await fetch('/api/deployment/deploy', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          branch: branch,
          projectName: project.name,
          gitUrl: project.gitUrl || `https://github.com/user/${project.name}.git`, // Fallback
          serverId: selectedServer,
          commitHash: 'latest' // This would come from git info in a real implementation
        })
      });

      const result = await response.json();
      
      if (result.success) {
        notificationService.showToast('Deployment started successfully', 'success');
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
          Authorization: `Bearer ${localStorage.getItem('token')}`
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
          Authorization: `Bearer ${localStorage.getItem('token')}`
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

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            <span className="ml-2">Loading deployment data...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full h-3/4 flex flex-col">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b">
          <h2 className="text-2xl font-bold">Branch Deployments - {project.name}</h2>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex">
          {/* Left Panel - Deploy Controls */}
          <div className="w-1/3 p-6 border-r">
            <h3 className="text-lg font-semibold mb-4">Deploy New Branch</h3>
            
            {/* Server Selection */}
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Deployment Server</label>
              <select
                className="w-full p-2 border rounded-md"
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
            </div>

            {/* Branch Input */}
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2">Branch Name</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g., main, develop, feature/login"
                  className="flex-1 p-2 border rounded-md"
                  id="branchInput"
                />
                <Button
                  onClick={() => {
                    const branch = document.getElementById('branchInput').value.trim();
                    if (branch) {
                      deployBranch(branch);
                    } else {
                      notificationService.showToast('Please enter a branch name', 'error');
                    }
                  }}
                  disabled={deploying}
                  className="px-4"
                >
                  {deploying ? 'Deploying...' : 'Deploy'}
                </Button>
              </div>
            </div>

            {/* Quick Deploy Buttons */}
            <div className="space-y-2">
              <h4 className="text-sm font-medium">Quick Deploy</h4>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => deployBranch('main')}
                  disabled={deploying}
                >
                  main
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => deployBranch('develop')}
                  disabled={deploying}
                >
                  develop
                </Button>
              </div>
            </div>
          </div>

          {/* Right Panel - Deployments List */}
          <div className="flex-1 p-6 overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Active Deployments</h3>
            
            {deployments.length === 0 ? (
              <div className="text-center text-gray-500 py-8">
                <p>No deployments found</p>
                <p className="text-sm">Deploy a branch to get started</p>
              </div>
            ) : (
              <div className="space-y-4">
                {deployments.map(deployment => (
                  <div key={deployment.id} className="border rounded-lg p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="font-medium">{deployment.branch}</h4>
                          <Badge className={`${getStatusColor(deployment.status)} text-white`}>
                            {deployment.status}
                          </Badge>
                        </div>
                        <p className="text-sm text-gray-600 mt-1">
                          Container: {deployment.container_name}
                        </p>
                        {deployment.full_url && (
                          <a
                            href={deployment.full_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 hover:underline"
                          >
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
                    
                    <div className="text-xs text-gray-500">
                      <p>Server: {deployment.server_name}</p>
                      <p>Port: {deployment.port}</p>
                      <p>Last deployed: {new Date(deployment.last_deployed).toLocaleString()}</p>
                    </div>

                    {/* Deployment Logs */}
                    {showLogs[deployment.id] && (
                      <div className="mt-4 p-3 bg-gray-100 rounded border max-h-40 overflow-y-auto">
                        <h5 className="text-sm font-medium mb-2">Deployment Logs:</h5>
                        {deploymentLogs[deployment.id] ? (
                          <div className="space-y-1">
                            {deploymentLogs[deployment.id].map((log, index) => (
                              <div key={index} className="text-xs">
                                <span className="text-gray-500">
                                  {new Date(log.timestamp).toLocaleTimeString()}
                                </span>
                                <span className={`ml-2 font-medium ${
                                  log.status === 'success' ? 'text-green-600' :
                                  log.status === 'error' ? 'text-red-600' :
                                  log.status === 'warning' ? 'text-yellow-600' :
                                  'text-blue-600'
                                }`}>
                                  [{log.step}]
                                </span>
                                <span className="ml-2">{log.message}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-500">No logs available</p>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default DeploymentManager;