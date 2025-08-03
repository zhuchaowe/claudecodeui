import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { MessageSquare, Github, GitBranch } from 'lucide-react';

const LoginForm = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [allowedOrgs, setAllowedOrgs] = useState(null);
  const [starRequirement, setStarRequirement] = useState(null);
  const [giteaConfigured, setGiteaConfigured] = useState(false);
  
  const { login } = useAuth();

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
      const repoParam = urlParams.get('repo');
      let errorMessage = 'GitHub login failed. Please try again.';
      
      if (errorParam === 'org_access_denied') {
        errorMessage = 'Access denied. You must be a member of an allowed organization to login.';
      } else if (errorParam === 'star_required') {
        errorMessage = repoParam 
          ? `Access denied. You must star the repository "${repoParam}" to login.`
          : 'Access denied. You must star the required repository to login.';
      }
      
      setError(errorMessage);
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, []);

  // Fetch allowed organizations and star requirements on component mount
  useEffect(() => {
    const fetchAllowedOrgs = async () => {
      try {
        const response = await fetch('/api/github/allowed-orgs');
        if (response.ok) {
          const data = await response.json();
          setAllowedOrgs(data);
        }
      } catch (error) {
        console.error('Failed to fetch allowed organizations:', error);
      }
    };

    const fetchStarRequirement = async () => {
      try {
        const response = await fetch('/api/github/star-requirements');
        if (response.ok) {
          const data = await response.json();
          setStarRequirement(data);
        }
      } catch (error) {
        console.error('Failed to fetch star requirements:', error);
      }
    };
    
    const fetchGiteaConfig = async () => {
      try {
        const response = await fetch('/api/gitea/config-status');
        if (response.ok) {
          const data = await response.json();
          setGiteaConfigured(data.isConfigured);
        }
      } catch (error) {
        console.error('Failed to fetch Gitea configuration:', error);
      }
    };

    fetchAllowedOrgs();
    fetchStarRequirement();
    fetchGiteaConfig();
  }, []);

  const handleGithubLogin = async () => {
    setError('');
    setIsLoading(true);
    
    try {
      const response = await fetch('/api/github/oauth/login-url');
      if (response.ok) {
        const data = await response.json();
        window.location.href = data.url;
      } else {
        const error = await response.json();
        setError(error.error || 'Failed to initiate GitHub login');
        setIsLoading(false);
      }
    } catch (error) {
      console.error('GitHub login error:', error);
      setError('Failed to connect to GitHub. Please try again.');
      setIsLoading(false);
    }
  };

  const handleGiteaLogin = async () => {
    setError('');
    setIsLoading(true);
    
    try {
      const response = await fetch('/api/gitea/oauth/login-url');
      if (response.ok) {
        const data = await response.json();
        window.location.href = data.url;
      } else {
        const error = await response.json();
        setError(error.error || 'Failed to initiate Gitea login');
        setIsLoading(false);
      }
    } catch (error) {
      console.error('Gitea login error:', error);
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
              <div className="w-16 h-16 bg-primary rounded-lg flex items-center justify-center shadow-sm">
                <MessageSquare className="w-8 h-8 text-primary-foreground" />
              </div>
            </div>
            <h1 className="text-2xl font-bold text-foreground">
              Welcome to Claude Code UI
            </h1>
            <p className="text-muted-foreground mt-2">
              Sign in with your account to continue
            </p>
          </div>

          {error && (
            <div className="p-3 bg-red-100 dark:bg-red-900/20 border border-red-300 dark:border-red-800 rounded-md">
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}

          {allowedOrgs?.hasRestrictions && (
            <div className="p-3 bg-blue-100 dark:bg-blue-900/20 border border-blue-300 dark:border-blue-800 rounded-md">
              <p className="text-sm text-blue-700 dark:text-blue-400">
                <strong>Note:</strong> Access is restricted to members of the following GitHub organization{allowedOrgs.organizations.length > 1 ? 's' : ''}: <strong>{allowedOrgs.organizations.join(', ')}</strong>
              </p>
              <p className="text-xs text-blue-600 dark:text-blue-500 mt-1">
                You must be a member of {allowedOrgs.organizations.length > 1 ? 'one of these organizations' : 'this organization'} to login.
              </p>
            </div>
          )}

          {starRequirement?.hasStarRequirement && (
            <div className="p-3 bg-yellow-100 dark:bg-yellow-900/20 border border-yellow-300 dark:border-yellow-800 rounded-md">
              <p className="text-sm text-yellow-700 dark:text-yellow-400">
                <strong>Required:</strong> You must star the repository <strong>{starRequirement.repository}</strong> to access this application.
              </p>
              <p className="text-xs text-yellow-600 dark:text-yellow-500 mt-1">
                <a 
                  href={`https://github.com/${starRequirement.repository}`} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="underline hover:no-underline"
                >
                  Visit the repository → 
                </a> and click the "Star" button before logging in.
              </p>
            </div>
          )}

          {/* Login Buttons */}
          <div className="space-y-3">
            {/* GitHub Login Button */}
            <button
              onClick={handleGithubLogin}
              disabled={isLoading}
              className="w-full bg-gray-900 hover:bg-gray-800 dark:bg-gray-800 dark:hover:bg-gray-700 disabled:bg-gray-600 text-white font-medium py-3 px-4 rounded-md transition-colors duration-200 flex items-center justify-center gap-3"
            >
              <Github className="w-5 h-5" />
              {isLoading ? 'Redirecting to GitHub...' : 'Continue with GitHub'}
            </button>

            {/* Gitea Login Button - Only show if configured */}
            {giteaConfigured && (
              <button
                onClick={handleGiteaLogin}
                disabled={isLoading}
                className="w-full bg-green-700 hover:bg-green-600 dark:bg-green-800 dark:hover:bg-green-700 disabled:bg-gray-600 text-white font-medium py-3 px-4 rounded-md transition-colors duration-200 flex items-center justify-center gap-3"
              >
                <GitBranch className="w-5 h-5" />
                {isLoading ? 'Redirecting to Gitea...' : 'Continue with Gitea'}
              </button>
            )}
          </div>

          <div className="text-center">
            <p className="text-xs text-muted-foreground">
              By signing in, you agree to authenticate using your account.
              We'll use this to manage your projects and sessions.
            </p>
          </div>
        </div>

        {/* Info Section */}
        <div className="mt-6 text-center">
          <p className="text-sm text-muted-foreground">
            Claude Code UI uses OAuth for secure authentication.
            No passwords are stored locally.
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginForm;