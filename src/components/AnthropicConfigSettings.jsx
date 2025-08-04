import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { AlertTriangle, Shield, Key, Eye, EyeOff, Check, X, Loader2, Sparkles } from 'lucide-react';

const AnthropicConfigSettings = () => {
  const [config, setConfig] = useState({
    enabled: false,
    anthropicBaseUrl: '',
    anthropicAuthToken: '',
    anthropicApiKey: ''
  });
  
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
        setConfig({
          enabled: data.enabled,
          anthropicBaseUrl: data.anthropicBaseUrl,
          anthropicAuthToken: data.anthropicAuthToken,
          anthropicApiKey: data.anthropicApiKey
        });
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
            anthropicBaseUrl: '',
            anthropicAuthToken: '',
            anthropicApiKey: ''
          });
        } else {
          throw new Error('Failed to disable configuration');
        }
      } else {
        // Validate fields
        if (!config.anthropicAuthToken && !config.anthropicApiKey) {
          setError('At least one authentication method (auth token or API key) is required');
          return;
        }
        
        const response = await fetch('/api/anthropic-config', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            anthropicBaseUrl: config.anthropicBaseUrl,
            anthropicAuthToken: config.anthropicAuthToken.startsWith('***') ? undefined : config.anthropicAuthToken,
            anthropicApiKey: config.anthropicApiKey.startsWith('***') ? undefined : config.anthropicApiKey
          })
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
      
      if (!config.anthropicAuthToken && !config.anthropicApiKey) {
        setTestResult({ success: false, message: 'Please enter at least one authentication method' });
        return;
      }
      
      if ((config.anthropicAuthToken?.startsWith('***') || !config.anthropicAuthToken) && 
          (config.anthropicApiKey?.startsWith('***') || !config.anthropicApiKey)) {
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
          anthropicBaseUrl: config.anthropicBaseUrl,
          anthropicAuthToken: config.anthropicAuthToken.startsWith('***') ? undefined : config.anthropicAuthToken,
          anthropicApiKey: config.anthropicApiKey.startsWith('***') ? undefined : config.anthropicApiKey
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

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="w-6 h-6 animate-spin text-gray-500" />
      </div>
    );
  }

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

      {/* Configuration Form */}
      {config.enabled && (
        <>
          {/* Base URL */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">
              Anthropic Base URL (Optional)
            </label>
            <Input
              type="url"
              value={config.anthropicBaseUrl}
              onChange={(e) => updateConfig('anthropicBaseUrl', e.target.value)}
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
                value={config.anthropicAuthToken}
                onChange={(e) => updateConfig('anthropicAuthToken', e.target.value)}
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
                value={config.anthropicApiKey}
                onChange={(e) => updateConfig('anthropicApiKey', e.target.value)}
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
              disabled={testing || (!config.anthropicAuthToken && !config.anthropicApiKey)}
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

      {/* Help Information */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2 flex items-center gap-2">
          <Shield className="w-4 h-4" />
          How It Works
        </h4>
        <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
          <li>• Each user can configure their own Anthropic API credentials</li>
          <li>• When enabled, your Claude sessions will use your API keys</li>
          <li>• You can use either AUTH_TOKEN or API_KEY for authentication</li>
          <li>• Changes take effect immediately for new sessions</li>
          <li>• Your credentials are stored securely and only the last 4 characters are shown</li>
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