import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { AlertTriangle, Shield, Key, Eye, EyeOff, Check, X, Loader2, Sparkles, Plus, Trash2, ChevronDown } from 'lucide-react';

const AnthropicConfigSettings = () => {
  const [config, setConfig] = useState({
    enabled: false,
    configurations: [],
    activeConfigurationId: null
  });
  const [selectedConfigId, setSelectedConfigId] = useState(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [editingConfig, setEditingConfig] = useState(null);
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [showAuthToken, setShowAuthToken] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Load current configuration
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const token = localStorage.getItem('auth-token');
      const response = await fetch('/api/anthropic-config', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        
        // Handle migration from old single config format
        if (data.anthropicBaseUrl !== undefined || data.anthropicAuthToken !== undefined || data.anthropicApiKey !== undefined) {
          // Old format - migrate to new format
          const migratedConfig = {
            enabled: data.enabled,
            configurations: data.enabled ? [{
              id: 'default',
              name: 'Default',
              anthropicBaseUrl: data.anthropicBaseUrl || '',
              anthropicAuthToken: data.anthropicAuthToken || '',
              anthropicApiKey: data.anthropicApiKey || ''
            }] : [],
            activeConfigurationId: data.enabled ? 'default' : null
          };
          setConfig(migratedConfig);
          setSelectedConfigId(data.enabled ? 'default' : null);
          
          // Save the migrated config
          if (data.enabled) {
            await saveMigratedConfig(migratedConfig);
          }
        } else {
          // New format
          setConfig(data);
          setSelectedConfigId(data.activeConfigurationId);
        }
      } else {
        throw new Error('Failed to load configuration');
      }
    } catch (error) {
      console.error('Error loading anthropic config:', error);
      setError('Failed to load Anthropic configuration');
    } finally {
      setLoading(false);
    }
  };

  const saveMigratedConfig = async (migratedConfig) => {
    try {
      const token = localStorage.getItem('auth-token');
      await fetch('/api/anthropic-config', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(migratedConfig)
      });
    } catch (error) {
      console.error('Error saving migrated config:', error);
    }
  };

  const saveConfig = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      
      const token = localStorage.getItem('auth-token');
      
      // If disabling configuration
      if (!config.enabled) {
        const response = await fetch('/api/anthropic-config', {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        
        if (response.ok) {
          setSuccess('Anthropic configuration disabled successfully');
          setConfig({
            enabled: false,
            configurations: [],
            activeConfigurationId: null
          });
          setSelectedConfigId(null);
        } else {
          throw new Error('Failed to disable configuration');
        }
      } else {
        // Validate active configuration
        const activeConfig = config.configurations.find(c => c.id === config.activeConfigurationId);
        if (!activeConfig) {
          setError('Please select an active configuration');
          return;
        }
        
        if (!activeConfig.anthropicAuthToken && !activeConfig.anthropicApiKey) {
          setError('At least one authentication method (auth token or API key) is required for the active configuration');
          return;
        }
        
        const response = await fetch('/api/anthropic-config', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(config)
        });
        
        if (response.ok) {
          const result = await response.json();
          setSuccess('Anthropic configuration saved successfully. Changes will take effect immediately for new sessions.');
          // Reload config to get masked keys
          await loadConfig();
        } else {
          const error = await response.json();
          throw new Error(error.error || 'Failed to save configuration');
        }
      }
    } catch (error) {
      console.error('Error saving anthropic config:', error);
      setError(error.message || 'Failed to save Anthropic configuration');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      
      const activeConfig = getActiveConfig();
      if (!activeConfig) {
        setTestResult({ success: false, message: 'No active configuration selected' });
        return;
      }
      
      if (!activeConfig.anthropicAuthToken && !activeConfig.anthropicApiKey) {
        setTestResult({ success: false, message: 'Please enter at least one authentication method' });
        return;
      }
      
      if ((activeConfig.anthropicAuthToken?.startsWith('***') || !activeConfig.anthropicAuthToken) && 
          (activeConfig.anthropicApiKey?.startsWith('***') || !activeConfig.anthropicApiKey)) {
        setTestResult({ success: false, message: 'Please enter valid credentials' });
        return;
      }
      
      const token = localStorage.getItem('auth-token');
      const response = await fetch('/api/anthropic-config/test', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          anthropicBaseUrl: activeConfig.anthropicBaseUrl,
          anthropicAuthToken: activeConfig.anthropicAuthToken?.startsWith('***') ? undefined : activeConfig.anthropicAuthToken,
          anthropicApiKey: activeConfig.anthropicApiKey?.startsWith('***') ? undefined : activeConfig.anthropicApiKey
        })
      });
      
      const result = await response.json();
      setTestResult(result);
    } catch (error) {
      console.error('Error testing connection:', error);
      setTestResult({ 
        success: false, 
        message: 'Connection test failed', 
        error: error.message 
      });
    } finally {
      setTesting(false);
    }
  };

  const updateConfig = (field, value) => {
    setConfig({
      ...config,
      [field]: value
    });
    // Clear test result when config changes
    setTestResult(null);
  };

  const getActiveConfig = () => {
    return config.configurations.find(c => c.id === selectedConfigId) || 
           config.configurations.find(c => c.id === config.activeConfigurationId);
  };

  const addNewConfiguration = () => {
    const newId = `config_${Date.now()}`;
    const newConfig = {
      id: newId,
      name: `Configuration ${config.configurations.length + 1}`,
      anthropicBaseUrl: '',
      anthropicAuthToken: '',
      anthropicApiKey: ''
    };
    
    const updatedConfigurations = [...config.configurations, newConfig];
    setConfig({
      ...config,
      configurations: updatedConfigurations,
      activeConfigurationId: config.activeConfigurationId || newId
    });
    setSelectedConfigId(newId);
    setEditingConfig(newConfig);
  };

  const deleteConfiguration = (configId) => {
    if (config.configurations.length <= 1) {
      setError('Cannot delete the last configuration');
      return;
    }
    
    const updatedConfigurations = config.configurations.filter(c => c.id !== configId);
    const newActiveId = config.activeConfigurationId === configId ? updatedConfigurations[0]?.id : config.activeConfigurationId;
    
    setConfig({
      ...config,
      configurations: updatedConfigurations,
      activeConfigurationId: newActiveId
    });
    setSelectedConfigId(newActiveId);
    setTestResult(null);
  };

  const updateConfigurationField = (configId, field, value) => {
    const updatedConfigurations = config.configurations.map(c => 
      c.id === configId ? { ...c, [field]: value } : c
    );
    
    setConfig({
      ...config,
      configurations: updatedConfigurations
    });
    setTestResult(null);
  };

  const selectConfiguration = (configId) => {
    setSelectedConfigId(configId);
    setConfig({
      ...config,
      activeConfigurationId: configId
    });
    setShowDropdown(false);
    setTestResult(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
      </div>
    );
  }

  const activeConfig = getActiveConfig();

  return (
    <div className="space-y-6">
      {/* Enable/Disable Toggle */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <Sparkles className="w-5 h-5 text-blue-500" />
          <h3 className="text-lg font-medium text-foreground">
            Anthropic API Configuration
          </h3>
        </div>
        
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <label className="flex items-center justify-between">
            <div className="flex-1">
              <div className="font-medium text-blue-900 dark:text-blue-100">
                Enable Custom Anthropic Configuration
              </div>
              <div className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                Configure your own Anthropic API credentials for Claude
              </div>
            </div>
            <button
              onClick={() => updateConfig('enabled', !config.enabled)}
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                config.enabled ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
              }`}
              role="switch"
              aria-checked={config.enabled}
            >
              <span className="sr-only">Enable custom configuration</span>
              <span
                className={`${
                  config.enabled ? 'translate-x-7' : 'translate-x-1'
                } inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-200`}
              />
            </button>
          </label>
        </div>
      </div>

      {/* Configuration Management */}
      {config.enabled && (
        <>
          {/* Configuration Selector and Management */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="text-md font-medium text-foreground">Configuration Management</h4>
              <Button
                onClick={addNewConfiguration}
                variant="outline"
                size="sm"
                className="text-green-600 border-green-600 hover:bg-green-50 dark:hover:bg-green-900/20"
              >
                <Plus className="w-4 h-4 mr-2" />
                Add Configuration
              </Button>
            </div>

            {/* Configuration Dropdown */}
            {config.configurations.length > 0 && (
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  Active Configuration
                </label>
                <div className="relative">
                  <button
                    onClick={() => setShowDropdown(!showDropdown)}
                    className="w-full flex items-center justify-between px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-sm text-foreground hover:bg-gray-50 dark:hover:bg-gray-700"
                  >
                    <span>{activeConfig?.name || 'Select Configuration'}</span>
                    <ChevronDown className="w-4 h-4" />
                  </button>
                  
                  {showDropdown && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-md shadow-lg z-10">
                      {config.configurations.map((cfg) => (
                        <div key={cfg.id} className="flex items-center">
                          <button
                            onClick={() => selectConfiguration(cfg.id)}
                            className={`flex-1 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-700 ${
                              cfg.id === selectedConfigId ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                            }`}
                          >
                            {cfg.name}
                          </button>
                          {config.configurations.length > 1 && (
                            <button
                              onClick={() => deleteConfiguration(cfg.id)}
                              className="p-2 text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20"
                              title="Delete Configuration"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Configuration Form */}
          {activeConfig && (
            <>
              {/* Configuration Name */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  Configuration Name
                </label>
                <Input
                  type="text"
                  value={activeConfig.name}
                  onChange={(e) => updateConfigurationField(activeConfig.id, 'name', e.target.value)}
                  placeholder="Enter configuration name"
                />
              </div>

              {/* Base URL */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  Anthropic Base URL (Optional)
                </label>
                <Input
                  type="url"
                  value={activeConfig.anthropicBaseUrl}
                  onChange={(e) => updateConfigurationField(activeConfig.id, 'anthropicBaseUrl', e.target.value)}
                  placeholder="https://api.anthropic.com (default)"
                />
                <p className="text-xs text-muted-foreground">
                  Leave empty to use the default Anthropic API endpoint
                </p>
              </div>

              {/* Auth Token */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  Anthropic Auth Token (ANTHROPIC_AUTH_TOKEN)
                </label>
                <div className="relative">
                  <Input
                    type={showAuthToken ? 'text' : 'password'}
                    value={activeConfig.anthropicAuthToken}
                    onChange={(e) => updateConfigurationField(activeConfig.id, 'anthropicAuthToken', e.target.value)}
                    placeholder="Enter your auth token"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAuthToken(!showAuthToken)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    {showAuthToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Legacy authentication method using Bearer token
                </p>
              </div>

              {/* API Key */}
              <div className="space-y-2">
                <label className="block text-sm font-medium text-foreground">
                  Anthropic API Key (ANTHROPIC_API_KEY)
                </label>
                <div className="relative">
                  <Input
                    type={showApiKey ? 'text' : 'password'}
                    value={activeConfig.anthropicApiKey}
                    onChange={(e) => updateConfigurationField(activeConfig.id, 'anthropicApiKey', e.target.value)}
                    placeholder="sk-ant-..."
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey(!showApiKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                  >
                    {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Recommended authentication method using x-api-key header
                </p>
              </div>

              {/* Test Connection */}
              <div className="flex items-center gap-2">
                <Button
                  onClick={testConnection}
                  disabled={testing || (!activeConfig.anthropicAuthToken && !activeConfig.anthropicApiKey)}
                  variant="outline"
                  size="sm"
                  className="text-blue-600 border-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20"
                >
                  {testing ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" />
                      Testing...
                    </>
                  ) : (
                    <>
                      <Key className="w-4 h-4 mr-2" />
                      Test Connection
                    </>
                  )}
                </Button>

                {testResult && (
                  <div className={`flex items-center gap-2 text-sm ${
                    testResult.success ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                  }`}>
                    {testResult.success ? (
                      <Check className="w-4 h-4" />
                    ) : (
                      <X className="w-4 h-4" />
                    )}
                    <span>{testResult.message}</span>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Help Information */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2 flex items-center gap-2">
          <Shield className="w-4 h-4" />
          How It Works
        </h4>
        <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
          <li>• Each user can configure multiple Anthropic API credentials with custom names</li>
          <li>• Switch between configurations using the dropdown selector</li>
          <li>• When enabled, your Claude sessions will use the active configuration</li>
          <li>• You can use either AUTH_TOKEN or API_KEY for authentication</li>
          <li>• Changes take effect immediately for new sessions</li>
          <li>• Your credentials are stored securely and only the last 4 characters are shown</li>
          <li>• Add, delete, and manage multiple configurations as needed</li>
        </ul>
      </div>

      {/* Status Messages */}
      {error && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
          <div className="flex items-center gap-2 text-red-800 dark:text-red-200">
            <AlertTriangle className="w-4 h-4" />
            <span className="text-sm">{error}</span>
          </div>
        </div>
      )}

      {success && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
          <div className="flex items-center gap-2 text-green-800 dark:text-green-200">
            <Check className="w-4 h-4" />
            <span className="text-sm">{success}</span>
          </div>
        </div>
      )}

      {/* Save Button */}
      <div className="flex justify-end">
        <Button
          onClick={saveConfig}
          disabled={saving}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          {saving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Saving...
            </>
          ) : (
            'Save Configuration'
          )}
        </Button>
      </div>
    </div>
  );
};

export default AnthropicConfigSettings;