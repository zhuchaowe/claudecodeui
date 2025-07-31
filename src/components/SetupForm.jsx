import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import ClaudeLogo from './ClaudeLogo';
import { Github } from 'lucide-react';

const SetupForm = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  
  const { register } = useAuth();

  // Check for GitHub OAuth callback
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const githubLogin = urlParams.get('github_login');
    const errorParam = urlParams.get('error');
    
    if (token && githubLogin === 'true') {
      // Handle successful GitHub login
      localStorage.setItem('auth-token', token);
      window.history.replaceState({}, document.title, window.location.pathname);
      window.location.reload(); // Reload to trigger auth state update
    }
    
    if (errorParam) {
      setError('GitHub setup failed. Please try again.');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
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
              Set up your account with GitHub to get started
            </p>
          </div>

          {error && (
            <div className="p-3 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-md">
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          {/* GitHub Setup Button */}
          <button
            onClick={handleGithubSetup}
            disabled={isLoading}
            className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-gray-800 dark:hover:bg-gray-700 disabled:bg-gray-600 text-white font-medium py-3 px-4 rounded-md transition-colors duration-200 flex items-center justify-center gap-3"
          >
            <Github className="w-5 h-5" />
            {isLoading ? 'Redirecting to GitHub...' : 'Set up with GitHub'}
          </button>

          <div className="text-center space-y-2">
            <p className="text-sm text-muted-foreground">
              Claude Code UI uses GitHub for authentication and project management.
            </p>
            <p className="text-xs text-muted-foreground">
              By continuing, you agree to authenticate using your GitHub account.
            </p>
          </div>
        </div>

        {/* Info Section */}
        <div className="mt-6 text-center">
          <p className="text-sm text-muted-foreground">
            Your GitHub account will be used to securely manage your Claude sessions and projects.
          </p>
        </div>
      </div>
    </div>
  );
};

export default SetupForm;