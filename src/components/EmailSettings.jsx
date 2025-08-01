import React, { useState, useEffect } from 'react';
import { Mail, Send, Shield, Bell, BellOff, X, Check, CheckCircle, AlertCircle } from 'lucide-react';
import { authenticatedFetch } from '../utils/api';

const EmailSettings = ({ isOpen, onClose }) => {
  const [settings, setSettings] = useState({
    email: '',
    enabled: true,
    onComplete: true,
    onError: true,
    onLongRunning: false,
    longRunningThreshold: 300
  });
  const [serviceStatus, setServiceStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState(null);

  // 加载邮件设置
  useEffect(() => {
    if (isOpen) {
      loadSettings();
    }
  }, [isOpen]);

  const loadSettings = async () => {
    setIsLoading(true);
    try {
      const response = await authenticatedFetch('/api/email/settings');
      const data = await response.json();
      
      if (data.settings) {
        setSettings({
          email: data.settings.email,
          enabled: data.settings.enabled === 1,
          onComplete: data.settings.on_complete === 1,
          onError: data.settings.on_error === 1,
          onLongRunning: data.settings.on_long_running === 1,
          longRunningThreshold: data.settings.long_running_threshold
        });
      }
      
      setServiceStatus(data.serviceStatus);
    } catch (error) {
      console.error('Failed to load email settings:', error);
      setMessage({ type: 'error', text: 'Failed to load email settings' });
    } finally {
      setIsLoading(false);
    }
  };

  const saveSettings = async () => {
    setIsSaving(true);
    setMessage(null);
    
    try {
      const response = await authenticatedFetch('/api/email/settings', {
        method: 'POST',
        body: JSON.stringify({
          email: settings.email,
          enabled: settings.enabled,
          onComplete: settings.onComplete,
          onError: settings.onError,
          onLongRunning: settings.onLongRunning,
          longRunningThreshold: settings.longRunningThreshold
        })
      });
      
      if (response.ok) {
        setMessage({ type: 'success', text: 'Email settings saved successfully' });
        
        // 更新localStorage中的邮件启用状态
        localStorage.setItem('emailEnabled', JSON.stringify(settings.enabled));
        
        // 2秒后关闭成功消息
        setTimeout(() => setMessage(null), 2000);
      }
    } catch (error) {
      console.error('Failed to save email settings:', error);
      setMessage({ type: 'error', text: 'Failed to save email settings' });
    } finally {
      setIsSaving(false);
    }
  };

  const sendTestEmail = async () => {
    setMessage(null);
    
    try {
      const response = await authenticatedFetch('/api/email/test', {
        method: 'POST'
      });
      const result = await response.json();
      
      if (result.success) {
        setMessage({ type: 'success', text: 'Test email sent successfully. Please check your inbox' });
      } else {
        setMessage({ type: 'error', text: result.error || 'Failed to send test email' });
      }
    } catch (error) {
      console.error('Failed to send test email:', error);
      setMessage({ type: 'error', text: 'Failed to send test email' });
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* 背景遮罩 */}
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* 模态框 */}
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 w-full max-w-2xl mx-4 max-h-[90vh] overflow-hidden">
        {/* 头部 */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <Mail className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Email Notification Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-md hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 内容 */}
        <div className="p-6 overflow-y-auto max-h-[calc(90vh-180px)]">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* 服务状态 */}
              {serviceStatus && !serviceStatus.isConfigured && (
                <div className="p-4 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                    <div className="text-sm text-yellow-800 dark:text-yellow-200">
                      <p className="font-medium mb-1">Email Service Not Configured</p>
                      <p>The server has not configured SMTP settings. Please contact the administrator to configure email service.</p>
                    </div>
                  </div>
                </div>
              )}

              {/* 邮箱地址 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  value={settings.email}
                  onChange={(e) => setSettings({ ...settings, email: e.target.value })}
                  placeholder="your@email.com"
                  className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                />
              </div>

              {/* 主开关 */}
              <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                <div>
                  <h3 className="font-medium text-gray-900 dark:text-white">Enable Email Notifications</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    When enabled, email notifications will be sent in specified situations
                  </p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer">
                  <input
                    type="checkbox"
                    checked={settings.enabled}
                    onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
                    className="sr-only peer"
                  />
                  <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                </label>
              </div>

              {/* 通知类型 */}
              {settings.enabled && (
                <div className="space-y-3">
                  <h3 className="font-medium text-gray-900 dark:text-white">Notification Types</h3>
                  
                  <label className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700">
                    <input
                      type="checkbox"
                      checked={settings.onComplete}
                      onChange={(e) => setSettings({ ...settings, onComplete: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-green-600" />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">Task Completed</span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Send notification when Claude successfully completes a task
                      </p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700">
                    <input
                      type="checkbox"
                      checked={settings.onError}
                      onChange={(e) => setSettings({ ...settings, onError: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <AlertCircle className="w-4 h-4 text-red-600" />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">Task Error</span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Send notification when Claude encounters an error
                      </p>
                    </div>
                  </label>

                  <label className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700">
                    <input
                      type="checkbox"
                      checked={settings.onLongRunning}
                      onChange={(e) => setSettings({ ...settings, onLongRunning: e.target.checked })}
                      className="h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <Bell className="w-4 h-4 text-yellow-600" />
                        <span className="text-sm font-medium text-gray-900 dark:text-white">Long Running Task</span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Send notification when task runs longer than specified time
                      </p>
                    </div>
                  </label>

                  {settings.onLongRunning && (
                    <div className="ml-7 mt-2">
                      <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                        Timeout Threshold (seconds)
                      </label>
                      <input
                        type="number"
                        value={settings.longRunningThreshold}
                        onChange={(e) => setSettings({ ...settings, longRunningThreshold: parseInt(e.target.value) || 300 })}
                        min="60"
                        max="3600"
                        className="w-32 px-3 py-1 text-sm border border-gray-300 dark:border-gray-600 rounded focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                      />
                    </div>
                  )}
                </div>
              )}

              {/* 消息提示 */}
              {message && (
                <div className={`p-3 rounded-lg flex items-center gap-2 ${
                  message.type === 'success' 
                    ? 'bg-green-50 dark:bg-green-900/20 text-green-800 dark:text-green-200' 
                    : 'bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200'
                }`}>
                  {message.type === 'success' ? (
                    <CheckCircle className="w-4 h-4" />
                  ) : (
                    <AlertCircle className="w-4 h-4" />
                  )}
                  <span className="text-sm">{message.text}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-between p-6 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={sendTestEmail}
            disabled={!settings.email || !settings.enabled || isLoading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Send className="w-4 h-4" />
            Send Test Email
          </button>
          
          <div className="flex gap-3">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={saveSettings}
              disabled={!settings.email || isLoading || isSaving}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving && (
                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>
              )}
              Save Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmailSettings;