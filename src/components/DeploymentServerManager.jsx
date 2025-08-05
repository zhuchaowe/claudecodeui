import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import notificationService from '../utils/notificationService';
import { Plus, Server, Edit, Trash2, Check, X, TestTube } from 'lucide-react';

const DeploymentServerManager = ({ onClose }) => {
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editingServer, setEditingServer] = useState(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [testingConnection, setTestingConnection] = useState({});
  
  // Form state
  const [formData, setFormData] = useState({
    name: '',
    host: '',
    port: 22,
    username: '',
    ssh_key: '',
    ssh_password: '',
    docker_compose_path: '/opt/deployments',
    nginx_config_path: '/etc/nginx/sites-available',
    base_domain: '',
    port_range_start: 3000,
    port_range_end: 4999,
    max_deployments_per_user: 5,
    auto_cleanup_days: 7
  });

  useEffect(() => {
    loadServers();
  }, []);

  const loadServers = async () => {
    try {
      const response = await fetch('/api/deployment/servers', {
        headers: { Authorization: `Bearer ${localStorage.getItem('auth-token')}` }
      });

      if (response.ok) {
        const data = await response.json();
        setServers(data);
      } else {
        throw new Error('Failed to load servers');
      }
    } catch (error) {
      console.error('Error loading servers:', error);
      notificationService.showToast('Failed to load deployment servers', 'error');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setFormData({
      name: '',
      host: '',
      port: 22,
      username: '',
      ssh_key: '',
      ssh_password: '',
      docker_compose_path: '/opt/deployments',
      nginx_config_path: '/etc/nginx/sites-available',
      base_domain: '',
      port_range_start: 3000,
      port_range_end: 4999,
      max_deployments_per_user: 5,
      auto_cleanup_days: 7
    });
  };

  const handleInputChange = (field, value) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };

  const startEditing = (server) => {
    setEditingServer(server.id);
    setFormData({
      name: server.name,
      host: server.host,
      port: server.port,
      username: server.username,
      ssh_key: server.ssh_key || '',
      ssh_password: server.ssh_password || '',
      docker_compose_path: server.docker_compose_path,
      nginx_config_path: server.nginx_config_path,
      base_domain: server.base_domain || '',
      port_range_start: server.port_range_start,
      port_range_end: server.port_range_end,
      max_deployments_per_user: server.max_deployments_per_user,
      auto_cleanup_days: server.auto_cleanup_days
    });
    setShowAddForm(true);
  };

  const cancelEdit = () => {
    setEditingServer(null);
    setShowAddForm(false);
    resetForm();
  };

  const saveServer = async () => {
    try {
      const url = editingServer 
        ? `/api/deployment/servers/${editingServer}` 
        : '/api/deployment/servers';
      
      const method = editingServer ? 'PUT' : 'POST';

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth-token')}`
        },
        body: JSON.stringify(formData)
      });

      if (response.ok) {
        notificationService.showToast(
          editingServer ? 'Server updated successfully' : 'Server created successfully', 
          'success'
        );
        cancelEdit();
        loadServers();
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save server');
      }
    } catch (error) {
      console.error('Error saving server:', error);
      notificationService.showToast(`Failed to save server: ${error.message}`, 'error');
    }
  };

  const deleteServer = async (serverId) => {
    if (!confirm('Are you sure you want to delete this deployment server? This action cannot be undone.')) {
      return;
    }

    try {
      const response = await fetch(`/api/deployment/servers/${serverId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('auth-token')}` }
      });

      if (response.ok) {
        notificationService.showToast('Server deleted successfully', 'success');
        loadServers();
      } else {
        throw new Error('Failed to delete server');
      }
    } catch (error) {
      console.error('Error deleting server:', error);
      notificationService.showToast('Failed to delete server', 'error');
    }
  };

  const testConnection = async (serverId) => {
    setTestingConnection(prev => ({ ...prev, [serverId]: true }));
    
    try {
      const response = await fetch('/api/deployment/test-connection', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth-token')}`
        },
        body: JSON.stringify({ serverId })
      });

      const result = await response.json();
      
      if (result.success) {
        notificationService.showToast('Connection test successful', 'success');
      } else {
        notificationService.showToast(`Connection test failed: ${result.message}`, 'error');
      }
    } catch (error) {
      console.error('Error testing connection:', error);
      notificationService.showToast('Connection test failed', 'error');
    } finally {
      setTestingConnection(prev => ({ ...prev, [serverId]: false }));
    }
  };

  const getStatusColor = (status) => {
    switch (status) {
      case 'active': return 'bg-green-500';
      case 'inactive': return 'bg-gray-500';
      case 'error': return 'bg-red-500';
      default: return 'bg-yellow-500';
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
        <div className="bg-card border border-border rounded-lg p-6 max-w-md w-full m-4">
          <div className="flex items-center justify-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <span className="ml-2 text-foreground">Loading deployment servers...</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-card border border-border rounded-lg shadow-xl max-w-5xl w-full h-4/5 flex flex-col m-4">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-border bg-card rounded-t-lg">
          <h2 className="text-2xl font-bold text-foreground">Deployment Server Management</h2>
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setShowAddForm(true);
                resetForm();
              }}
              className="bg-primary hover:bg-primary/90"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add Server
            </Button>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden flex bg-card">
          {/* Server List */}
          <div className="flex-1 p-6 overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4 text-foreground">Deployment Servers</h3>
            
            {servers.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                <Server className="w-12 h-12 mx-auto mb-4 opacity-50" />
                <p>No deployment servers configured</p>
                <p className="text-sm">Add a server to get started</p>
              </div>
            ) : (
              <div className="space-y-4">
                {servers.map(server => (
                  <div key={server.id} className="border border-border rounded-lg p-4 bg-card">
                    <div className="flex justify-between items-start mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <h4 className="font-medium text-foreground">{server.name}</h4>
                          <Badge className={`${getStatusColor(server.status)} text-white`}>
                            {server.status}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 gap-4 text-sm text-muted-foreground">
                          <div>
                            <span className="font-medium">Host:</span> {server.host}:{server.port}
                          </div>
                          <div>
                            <span className="font-medium">Username:</span> {server.username}
                          </div>
                          <div>
                            <span className="font-medium">Domain:</span> {server.base_domain || 'Not set'}
                          </div>
                          <div>
                            <span className="font-medium">Port Range:</span> {server.port_range_start}-{server.port_range_end}
                          </div>
                          <div>
                            <span className="font-medium">Max Deployments:</span> {server.max_deployments_per_user}
                          </div>
                          <div>
                            <span className="font-medium">Auto Cleanup:</span> {server.auto_cleanup_days} days
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => testConnection(server.id)}
                          disabled={testingConnection[server.id]}
                        >
                          {testingConnection[server.id] ? (
                            <div className="w-4 h-4 animate-spin rounded-full border border-current border-t-transparent mr-2" />
                          ) : (
                            <TestTube className="w-4 h-4 mr-2" />
                          )}
                          Test
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => startEditing(server)}
                        >
                          <Edit className="w-4 h-4 mr-2" />
                          Edit
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => deleteServer(server.id)}
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add/Edit Form */}
          {showAddForm && (
            <div className="w-1/2 p-6 border-l border-border bg-card overflow-y-auto">
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-lg font-semibold text-foreground">
                  {editingServer ? 'Edit Server' : 'Add New Server'}
                </h3>
                <Button variant="ghost" size="sm" onClick={cancelEdit}>
                  <X className="w-4 h-4" />
                </Button>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium mb-2 text-foreground">Server Name</label>
                  <Input
                    value={formData.name}
                    onChange={(e) => handleInputChange('name', e.target.value)}
                    placeholder="Production Server"
                    className="bg-background"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2 text-foreground">Host</label>
                    <Input
                      value={formData.host}
                      onChange={(e) => handleInputChange('host', e.target.value)}
                      placeholder="192.168.1.100"
                      className="bg-background"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2 text-foreground">SSH Port</label>
                    <Input
                      type="number"
                      value={formData.port}
                      onChange={(e) => handleInputChange('port', parseInt(e.target.value))}
                      className="bg-background"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2 text-foreground">Username</label>
                  <Input
                    value={formData.username}
                    onChange={(e) => handleInputChange('username', e.target.value)}
                    placeholder="deploy"
                    className="bg-background"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2 text-foreground">SSH Private Key</label>
                  <textarea
                    value={formData.ssh_key}
                    onChange={(e) => handleInputChange('ssh_key', e.target.value)}
                    placeholder="-----BEGIN PRIVATE KEY-----"
                    className="w-full p-2 border border-border rounded-md bg-background text-foreground h-20 resize-none"
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Optional: Leave empty to use password authentication
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2 text-foreground">SSH Password</label>
                  <Input
                    type="password"
                    value={formData.ssh_password}
                    onChange={(e) => handleInputChange('ssh_password', e.target.value)}
                    placeholder="Only if not using SSH key"
                    className="bg-background"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2 text-foreground">Base Domain</label>
                  <Input
                    value={formData.base_domain}
                    onChange={(e) => handleInputChange('base_domain', e.target.value)}
                    placeholder="dev.yoursite.com"
                    className="bg-background"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2 text-foreground">Port Range Start</label>
                    <Input
                      type="number"
                      value={formData.port_range_start}
                      onChange={(e) => handleInputChange('port_range_start', parseInt(e.target.value))}
                      className="bg-background"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2 text-foreground">Port Range End</label>
                    <Input
                      type="number"
                      value={formData.port_range_end}
                      onChange={(e) => handleInputChange('port_range_end', parseInt(e.target.value))}
                      className="bg-background"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2 text-foreground">Docker Compose Path</label>
                  <Input
                    value={formData.docker_compose_path}
                    onChange={(e) => handleInputChange('docker_compose_path', e.target.value)}
                    className="bg-background"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium mb-2 text-foreground">Nginx Config Path</label>
                  <Input
                    value={formData.nginx_config_path}
                    onChange={(e) => handleInputChange('nginx_config_path', e.target.value)}
                    className="bg-background"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium mb-2 text-foreground">Max Deployments per User</label>
                    <Input
                      type="number"
                      value={formData.max_deployments_per_user}
                      onChange={(e) => handleInputChange('max_deployments_per_user', parseInt(e.target.value))}
                      className="bg-background"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-2 text-foreground">Auto Cleanup (days)</label>
                    <Input
                      type="number"
                      value={formData.auto_cleanup_days}
                      onChange={(e) => handleInputChange('auto_cleanup_days', parseInt(e.target.value))}
                      className="bg-background"
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-4">
                  <Button
                    onClick={saveServer}
                    className="flex-1 bg-primary hover:bg-primary/90"
                  >
                    <Check className="w-4 h-4 mr-2" />
                    {editingServer ? 'Update Server' : 'Create Server'}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={cancelEdit}
                    className="flex-1"
                  >
                    <X className="w-4 h-4 mr-2" />
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DeploymentServerManager;