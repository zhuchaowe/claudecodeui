import React, { useState, useEffect } from 'react';
import { X, Info, ExternalLink, Eye, EyeOff } from 'lucide-react';

function GitCredentialModal({ isOpen, onClose, onSubmit, remoteType = 'generic', errorMessage = '' }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      // Reset form when modal closes
      setUsername('');
      setPassword('');
      setShowPassword(false);
      setIsSubmitting(false);
    } else {
      // Auto-fill credentials from localStorage when modal opens
      const cacheKey = `git_credentials_${remoteType}`;
      const cachedCredentials = localStorage.getItem(cacheKey);
      if (cachedCredentials) {
        try {
          const { username: cachedUsername, password: cachedPassword } = JSON.parse(cachedCredentials);
          setUsername(cachedUsername || '');
          setPassword(cachedPassword || '');
        } catch (error) {
          console.error('Error loading cached credentials:', error);
        }
      }
    }
  }, [isOpen, remoteType]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password) return;
    
    setIsSubmitting(true);
    try {
      // Cache credentials in localStorage
      const cacheKey = `git_credentials_${remoteType}`;
      localStorage.setItem(cacheKey, JSON.stringify({ username, password }));
      
      await onSubmit({ username, token: password });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const getHelperText = () => {
    switch (remoteType) {
      case 'github':
        return {
          title: 'GitHub Authentication',
          usernameLabel: 'GitHub Username',
          passwordLabel: 'Personal Access Token',
          helpText: 'GitHub no longer accepts passwords for Git operations. You need to use a Personal Access Token.',
          helpLink: 'https://github.com/settings/tokens/new',
          helpLinkText: 'Create a Personal Access Token',
          instructions: [
            'Click the link above to create a new token',
            'Give it a descriptive name (e.g., "Claude Code UI")',
            'Select "repo" scope for full repository access',
            'Copy the generated token and paste it as the password'
          ]
        };
      case 'gitlab':
        return {
          title: 'GitLab Authentication',
          usernameLabel: 'GitLab Username',
          passwordLabel: 'Personal Access Token or Password',
          helpText: 'GitLab recommends using Personal Access Tokens for Git operations.',
          helpLink: 'https://gitlab.com/-/profile/personal_access_tokens',
          helpLinkText: 'Create a Personal Access Token',
          instructions: [
            'You can use either your GitLab password or a Personal Access Token',
            'For better security, create a token with "write_repository" scope',
            'Tokens can be revoked anytime from your GitLab settings'
          ]
        };
      case 'bitbucket':
        return {
          title: 'Bitbucket Authentication',
          usernameLabel: 'Bitbucket Username',
          passwordLabel: 'App Password',
          helpText: 'Bitbucket requires App Passwords for Git operations over HTTPS.',
          helpLink: 'https://bitbucket.org/account/settings/app-passwords/new',
          helpLinkText: 'Create an App Password',
          instructions: [
            'Click the link above to create a new App Password',
            'Give it a label (e.g., "Claude Code UI")',
            'Select "Repositories: Write" permission',
            'Copy the generated password and paste it here'
          ]
        };
      default:
        return {
          title: 'Git Authentication',
          usernameLabel: 'Username',
          passwordLabel: 'Password / Token',
          helpText: 'Enter your Git credentials to push to the remote repository.',
          helpLink: null,
          helpLinkText: null,
          instructions: [
            'Enter your username and password for the Git remote',
            'Some services may require a Personal Access Token instead of a password',
            'Check your Git service documentation for authentication requirements'
          ]
        };
    }
  };

  const helperInfo = getHelperText();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={onClose} />
      <div className="relative bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold">{helperInfo.title}</h3>
            <button
              onClick={onClose}
              className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6">
          {errorMessage && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md">
              <p className="text-sm text-red-700 dark:text-red-300">{errorMessage}</p>
            </div>
          )}

          <div className="mb-4 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-md">
            <div className="flex items-start gap-2">
              <Info className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm text-blue-700 dark:text-blue-300 mb-2">{helperInfo.helpText}</p>
                {helperInfo.helpLink && (
                  <a
                    href={helperInfo.helpLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" />
                    {helperInfo.helpLinkText}
                  </a>
                )}
              </div>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {helperInfo.usernameLabel}
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Enter your username"
              autoFocus
              required
            />
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              {helperInfo.passwordLabel}
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 pr-10 border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={remoteType === 'github' ? 'ghp_xxxxxxxxxxxx' : 'Enter your password or token'}
                required
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-1 hover:bg-gray-100 dark:hover:bg-gray-600 rounded"
              >
                {showPassword ? (
                  <EyeOff className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                ) : (
                  <Eye className="w-4 h-4 text-gray-500 dark:text-gray-400" />
                )}
              </button>
            </div>
          </div>

          {helperInfo.instructions && (
            <div className="mb-6 p-3 bg-gray-50 dark:bg-gray-900 rounded-md">
              <p className="text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">Instructions:</p>
              <ul className="text-xs text-gray-600 dark:text-gray-400 space-y-1">
                {helperInfo.instructions.map((instruction, index) => (
                  <li key={index} className="flex items-start">
                    <span className="mr-2">•</span>
                    <span>{instruction}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
              disabled={isSubmitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!username || !password || isSubmitting}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Authenticating...' : 'Authenticate & Push'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default GitCredentialModal;