// Utility function for authenticated API calls
export const authenticatedFetch = (url, options = {}) => {
  const token = localStorage.getItem('auth-token');
  
  const defaultHeaders = {
    'Content-Type': 'application/json',
  };
  
  if (token) {
    defaultHeaders['Authorization'] = `Bearer ${token}`;
  }
  
  return fetch(url, {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  });
};

// API endpoints
export const api = {
  // Auth endpoints (no token required)
  auth: {
    status: () => fetch('/api/auth/status'),
    login: (username, password) => fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    register: (username, password) => fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    }),
    user: () => authenticatedFetch('/api/auth/user'),
    logout: () => authenticatedFetch('/api/auth/logout', { method: 'POST' }),
  },
  
  // Protected endpoints
  config: () => authenticatedFetch('/api/config'),
  projects: () => authenticatedFetch('/api/projects'),
  sessions: (projectName, limit = 5, offset = 0) => 
    authenticatedFetch(`/api/projects/${projectName}/sessions?limit=${limit}&offset=${offset}`),
  sessionMessages: (projectName, sessionId) =>
    authenticatedFetch(`/api/projects/${projectName}/sessions/${sessionId}/messages`),
  renameProject: (projectName, displayName) =>
    authenticatedFetch(`/api/projects/${projectName}/rename`, {
      method: 'PUT',
      body: JSON.stringify({ displayName }),
    }),
  deleteSession: (projectName, sessionId) =>
    authenticatedFetch(`/api/projects/${projectName}/sessions/${sessionId}`, {
      method: 'DELETE',
    }),
  deleteProject: (projectName) =>
    authenticatedFetch(`/api/projects/${projectName}`, {
      method: 'DELETE',
    }),
  createProject: (path) =>
    authenticatedFetch('/api/projects/create', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),
  createGitProject: (data) =>
    authenticatedFetch('/api/projects/create-git', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  readFile: (projectName, filePath) =>
    authenticatedFetch(`/api/projects/${projectName}/file?filePath=${encodeURIComponent(filePath)}`),
  saveFile: (projectName, filePath, content) =>
    authenticatedFetch(`/api/projects/${projectName}/file`, {
      method: 'PUT',
      body: JSON.stringify({ filePath, content }),
    }),
  getFiles: (projectName) =>
    authenticatedFetch(`/api/projects/${projectName}/files`),
  transcribe: (formData) =>
    authenticatedFetch('/api/transcribe', {
      method: 'POST',
      body: formData,
      headers: {}, // Let browser set Content-Type for FormData
    }),
  
  // GitHub OAuth endpoints
  github: {
    getOAuthUrl: () => authenticatedFetch('/api/github/oauth/url'),
    status: () => authenticatedFetch('/api/github/status'),
    disconnect: () => authenticatedFetch('/api/github/disconnect', { method: 'POST' }),
    repos: (page = 1, perPage = 30) => 
      authenticatedFetch(`/api/github/repos?page=${page}&per_page=${perPage}`),
  },
  
  // Gitea OAuth endpoints
  gitea: {
    getOAuthUrl: () => authenticatedFetch('/api/gitea/oauth/url'),
    status: () => authenticatedFetch('/api/gitea/status'),
    disconnect: () => authenticatedFetch('/api/gitea/disconnect', { method: 'POST' }),
    repos: (page = 1, limit = 30) => 
      authenticatedFetch(`/api/gitea/repos?page=${page}&limit=${limit}`),
  },
  
  // Proxy configuration endpoints
  proxyConfig: {
    get: () => authenticatedFetch('/api/proxy-config'),
    save: (config) => authenticatedFetch('/api/proxy-config', {
      method: 'POST',
      body: JSON.stringify(config),
    }),
    disable: () => authenticatedFetch('/api/proxy-config', {
      method: 'DELETE',
    }),
    test: (config) => authenticatedFetch('/api/proxy-config/test', {
      method: 'POST',
      body: JSON.stringify(config),
    }),
  }
};