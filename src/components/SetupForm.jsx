import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ClaudeLogo from './ClaudeLogo';
import { Github, GitBranch } from 'lucide-react';

const SetupForm = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [giteaConfigured, setGiteaConfigured] = useState(false);
  const [githubConfigured, setGithubConfigured] = useState(false);
  
  const { register } = useAuth();

  // Check for OAuth callback (GitHub or Gitea)
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const githubLogin = urlParams.get('github_login');
    const giteaLogin = urlParams.get('gitea_login');
    const errorParam = urlParams.get('error');
    
    if (token && (githubLogin === 'true' || giteaLogin === 'true')) {
      // Handle successful OAuth login
      localStorage.setItem('auth-token', token);
      window.history.replaceState({}, document.title, window.location.pathname);
      window.location.reload(); // Reload to trigger auth state update
    }
    
    if (errorParam) {
      setError('Setup failed. Please try again.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Check if GitHub and Gitea are configured
  useEffect(() => {
    const fetchAuthConfig = async () => {
      try {
        // Check GitHub configuration
        const githubResponse = await fetch('/api/github/config-status');
        if (githubResponse.ok) {
          const githubData = await githubResponse.json();
          setGithubConfigured(githubData.isConfigured);
        }
        
        // Check Gitea configuration
        const giteaResponse = await fetch('/api/gitea/config-status');
        if (giteaResponse.ok) {
          const giteaData = await giteaResponse.json();
          setGiteaConfigured(giteaData.isConfigured);
        }
      } catch (error) {
        console.error('Failed to fetch auth configuration:', error);
      }
    };
    
    fetchAuthConfig();
  }, []);

  const handleGithubSetup = async () => {
    setError('');
    setIsLoading(true);
    
    try {
      const response = await fetch('/api/github/oauth/login-url');
      if (response.ok) {
        const data = await response.json();
        window.location.href = data.url;
      } else {
        const error = await response.json();
        setError(error.error || 'Failed to initiate GitHub setup');
        setIsLoading(false);
      }
    } catch (error) {
      console.error('GitHub setup error:', error);
      setError('Failed to connect to GitHub. Please try again.');
      setIsLoading(false);
    }
  };

  const handleGiteaSetup = async () => {
    setError('');
    setIsLoading(true);
    
    try {
      const response = await fetch('/api/gitea/oauth/login-url');
      if (response.ok) {
        const data = await response.json();
        window.location.href = data.url;
      } else {
        const error = await response.json();
        setError(error.error || 'Failed to initiate Gitea setup');
        setIsLoading(false);
      }
    } catch (error) {
      console.error('Gitea setup error:', error);
      setError('Failed to connect to Gitea. Please try again.');
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-card rounded-lg shadow-lg border border-border p-8 space-y-6">
          {/* Logo and Title */}
          <div className="text-center">
            <div className="flex justify-center mb-4">
              <ClaudeLogo size={64} />
            </div>
            <h1 className="text-2xl font-bold text-foreground">Welcome to Claude Code UI</h1>
            <p className="text-muted-foreground mt-2">
              Set up your account to get started
            </p>
          </div>

          {error && (
            <div className="p-3 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-md">
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* Setup Buttons - Show only configured provider */}
          <div className="space-y-3">
            {/* GitHub Setup Button - Only show if GitHub is configured */}
            {githubConfigured && !giteaConfigured && (
              <button
                onClick={handleGithubSetup}
                disabled={isLoading}
                className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-gray-800 dark:hover:bg-gray-700 disabled:bg-gray-600 text-white font-medium py-3 px-4 rounded-md transition-colors duration-200 flex items-center justify-center gap-3"
              >
                <Github className="w-5 h-5" />
                {isLoading ? 'Redirecting to GitHub...' : 'Set up with GitHub'}
              </button>
            )}

            {/* Gitea Setup Button - Only show if Gitea is configured */}
            {giteaConfigured && !githubConfigured && (
              <button
                onClick={handleGiteaSetup}
                disabled={isLoading}
                className="w-full bg-green-700 hover:bg-green-600 dark:bg-green-800 dark:hover:bg-green-700 disabled:bg-gray-600 text-white font-medium py-3 px-4 rounded-md transition-colors duration-200 flex items-center justify-center gap-3"
              >
                <GitBranch className="w-5 h-5" />
                {isLoading ? 'Redirecting to Gitea...' : 'Set up with Gitea'}
              </button>
            )}

            {/* If both are configured, prefer Gitea */}
            {githubConfigured && giteaConfigured && (
              <button
                onClick={handleGiteaSetup}
                disabled={isLoading}
                className="w-full bg-green-700 hover:bg-green-600 dark:bg-green-800 dark:hover:bg-green-700 disabled:bg-gray-600 text-white font-medium py-3 px-4 rounded-md transition-colors duration-200 flex items-center justify-center gap-3"
              >
                <GitBranch className="w-5 h-5" />
                {isLoading ? 'Redirecting to Gitea...' : 'Set up with Gitea'}
              </button>
            )}

            {/* If neither is configured, show error message */}
            {!githubConfigured && !giteaConfigured && (
              <div className="text-center p-4 bg-yellow-100 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-800 rounded-md">
                <p className="text-sm text-yellow-700 dark:text-yellow-400">
                  No authentication provider is configured. Please configure either GitHub or Gitea in your .env file.
                </p>
              </div>
            )}
          </div>

          <div className="text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              Claude Code UI uses OAuth for authentication and project management.
            </p>
            <p className="text-xs text-muted-foreground">
              By continuing, you agree to authenticate using your account.
            </p>
          </div>
        </div>

        {/* Info Section */}
        <div className="mt-6 text-center">
          <p className="text-sm text-muted-foreground">
            Your account will be used to securely manage your Claude sessions and projects.
          </p>
        </div>
      </div>
    </div>
  );
};

export default SetupForm;