import React, { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { AlertTriangle, Globe, Server, Settings, Shield, Zap, Eye, EyeOff, Check, X, Loader2 } from 'lucide-react';
import { api } from '../utils/api';

const ProxyConfigSettings = () => {
  const [config, setConfig] = useState({
    enabled: false,
    openaiApiKey: '',
    openaiBaseUrl: '',
    bigModel: '',
    smallModel: ''
  });
  
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [showApiKey, setShowApiKey] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  // Preset configurations for popular providers
  const presets = [
    {
      name: 'DeepSeek',
      config: {
        openaiBaseUrl: 'https://api.deepseek.com/v1',
        bigModel: 'deepseek-coder',
        smallModel: 'deepseek-coder'
      }
    },
    {
      name: 'Kimi (Moonshot)',
      config: {
        openaiBaseUrl: 'https://api.moonshot.cn/v1',
        bigModel: 'kimi-k2-0711-preview',
        smallModel: 'kimi-k2-0711-preview'
      }
    },
    {
      name: 'OpenAI',
      config: {
        openaiBaseUrl: 'https://api.openai.com/v1',
        bigModel: 'gpt-4',
        smallModel: 'gpt-3.5-turbo'
      }
    },
    {
      name: 'Local (Ollama)',
      config: {
        openaiBaseUrl: 'http://localhost:11434/v1',
        bigModel: 'codellama:34b',
        smallModel: 'codellama:7b'
      }
    }
  ];

  // Load current configuration
  useEffect(() => {
    loadConfig();
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      const response = await api.proxyConfig.get();
      
      if (response.ok) {
        const data = await response.json();
        setConfig({
          enabled: data.enabled,
          openaiApiKey: data.openaiApiKey,
          openaiBaseUrl: data.openaiBaseUrl,
          bigModel: data.bigModel,
          smallModel: data.smallModel
        });
      } else {
        throw new Error('Failed to load configuration');
      }
    } catch (error) {
      console.error('Error loading proxy config:', error);
      setError('Failed to load proxy configuration');
    } finally {
      setLoading(false);
    }
  };

  const saveConfig = async () => {
    try {
      setSaving(true);
      setError(null);
      setSuccess(null);
      
      // If disabling proxy mode
      if (!config.enabled) {
        const response = await api.proxyConfig.disable();
        
        if (response.ok) {
          setSuccess('Proxy mode disabled successfully');
          setConfig({
            enabled: false,
            openaiApiKey: '',
            openaiBaseUrl: '',
            bigModel: '',
            smallModel: ''
          });
        } else {
          throw new Error('Failed to disable proxy mode');
        }
      } else {
        // Validate fields
        if (!config.openaiApiKey) {
          setError('API key is required');
          return;
        }
        
        const response = await api.proxyConfig.save({
          openaiApiKey: config.openaiApiKey.startsWith('***') ? undefined : config.openaiApiKey,
          openaiBaseUrl: config.openaiBaseUrl || 'https://api.openai.com/v1',
          bigModel: config.bigModel || 'gpt-4',
          smallModel: config.smallModel || 'gpt-3.5-turbo'
        });
        
        if (response.ok) {
          const result = await response.json();
          setSuccess('Proxy configuration saved successfully. Changes will take effect immediately for new sessions.');
          // Reload config to get masked API key
          await loadConfig();
        } else {
          const error = await response.json();
          throw new Error(error.error || 'Failed to save configuration');
        }
      }
    } catch (error) {
      console.error('Error saving proxy config:', error);
      setError(error.message || 'Failed to save proxy configuration');
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    try {
      setTesting(true);
      setTestResult(null);
      
      if (!config.openaiApiKey || config.openaiApiKey.startsWith('***')) {
        setTestResult({ success: false, message: 'Please enter a valid API key' });
        return;
      }
      
      const response = await api.proxyConfig.test({
        openaiApiKey: config.openaiApiKey,
        openaiBaseUrl: config.openaiBaseUrl || 'https://api.openai.com/v1',
        bigModel: config.bigModel || 'gpt-4'
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

  const applyPreset = (preset) => {
    setConfig({
      ...config,
      ...preset.config
    });
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
          <Zap className="w-5 h-5 text-purple-500" />
          <h3 className="text-lg font-medium text-foreground">
            Proxy Mode
          </h3>
        </div>
        
        <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg p-4">
          <label className="flex items-center justify-between">
            <div className="flex-1">
              <div className="font-medium text-purple-900 dark:text-purple-100">
                Enable Claude Code Proxy
              </div>
              <div className="text-sm text-purple-700 dark:text-purple-300 mt-1">
                Use alternative AI providers (DeepSeek, Kimi, OpenAI, etc.) instead of Anthropic's Claude API
              </div>
            </div>
            <button
              onClick={() => updateConfig('enabled', !config.enabled)}
              className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2 dark:focus:ring-offset-gray-900 ${
                config.enabled ? 'bg-purple-600' : 'bg-gray-200 dark:bg-gray-700'
              }`}
              role="switch"
              aria-checked={config.enabled}
            >
              <span className="sr-only">Enable proxy mode</span>
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
          {/* Preset Configurations */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-foreground">
              Quick Presets
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {presets.map((preset) => (
                <Button
                  key={preset.name}
                  variant="outline"
                  size="sm"
                  onClick={() => applyPreset(preset)}
                  className="h-auto py-2 px-3 flex flex-col items-center gap-1"
                >
                  <Globe className="w-4 h-4" />
                  <span className="text-xs">{preset.name}</span>
                </Button>
              ))}
            </div>
          </div>

          {/* API Key */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">
              API Key *
            </label>
            <div className="relative">
              <Input
                type={showApiKey ? 'text' : 'password'}
                value={config.openaiApiKey}
                onChange={(e) => updateConfig('openaiApiKey', e.target.value)}
                placeholder="sk-..."
                className="pr-10"
                required
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
              Your API key from the selected provider
            </p>
          </div>

          {/* Base URL */}
          <div className="space-y-2">
            <label className="block text-sm font-medium text-foreground">
              API Base URL
            </label>
            <Input
              type="url"
              value={config.openaiBaseUrl}
              onChange={(e) => updateConfig('openaiBaseUrl', e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
            <p className="text-xs text-muted-foreground">
              The base URL for the API endpoint
            </p>
          </div>

          {/* Model Configuration */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-foreground">
                Big Model
              </label>
              <Input
                value={config.bigModel}
                onChange={(e) => updateConfig('bigModel', e.target.value)}
                placeholder="gpt-4"
              />
              <p className="text-xs text-muted-foreground">
                Model for complex tasks
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-sm font-medium text-foreground">
                Small Model
              </label>
              <Input
                value={config.smallModel}
                onChange={(e) => updateConfig('smallModel', e.target.value)}
                placeholder="gpt-3.5-turbo"
              />
              <p className="text-xs text-muted-foreground">
                Model for simple tasks
              </p>
            </div>
          </div>

          {/* Test Connection */}
          <div className="flex items-center gap-2">
            <Button
              onClick={testConnection}
              disabled={testing || !config.openaiApiKey || config.openaiApiKey.startsWith('***')}
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
                  <Settings className="w-4 h-4 mr-2" />
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

          {/* Test Result Details */}
          {testResult && testResult.success && testResult.availableModels && (
            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-3">
              <div className="text-sm text-green-800 dark:text-green-200">
                <div className="font-medium mb-1">Available Models:</div>
                <div className="text-xs space-y-0.5 max-h-32 overflow-y-auto">
                  {testResult.availableModels.map((model, i) => (
                    <div key={i} className="flex items-center gap-1">
                      <span className="text-green-600 dark:text-green-400">•</span>
                      <code className="bg-green-100 dark:bg-green-800 px-1 rounded">{model}</code>
                      {model === config.bigModel && <Badge variant="outline" className="text-xs">Big Model</Badge>}
                      {model === config.smallModel && <Badge variant="outline" className="text-xs">Small Model</Badge>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {/* Help Information */}
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
        <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-2 flex items-center gap-2">
          <Shield className="w-4 h-4" />
          How Proxy Mode Works
        </h4>
        <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
          <li>• Each user can configure their own API key and provider</li>
          <li>• When enabled, your Claude sessions will use your chosen AI provider</li>
          <li>• The proxy translates requests to your provider's format</li>
          <li>• Changes take effect immediately for new sessions</li>
          <li>• Your API key is stored securely and only the last 4 characters are shown</li>
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
          className="bg-purple-600 hover:bg-purple-700 text-white"
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

export default ProxyConfigSettings;