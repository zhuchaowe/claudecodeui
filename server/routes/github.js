import express from 'express';
import fetch from 'node-fetch';
import crypto from 'crypto';
import { getUserById, updateUserGithubToken, userDb } from '../database/db.js';
import { authenticateToken, generateToken } from '../middleware/auth.js';

const router = express.Router();

// GitHub OAuth configuration - read from env when needed
const getGithubConfig = () => ({
  GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET,
  GITHUB_REDIRECT_URI: process.env.GITHUB_REDIRECT_URI || 'http://localhost:3008/api/github/callback',
  GITHUB_ALLOWED_ORGS: process.env.GITHUB_ALLOWED_ORGS?.trim() 
    ? process.env.GITHUB_ALLOWED_ORGS.split(',').map(org => org.trim()).filter(org => org.length > 0)
    : [],
  GITHUB_REQUIRED_STAR_REPO: process.env.GITHUB_REQUIRED_STAR_REPO
});

// Store state temporarily (in production, use Redis or similar)
const oauthStates = new Map();

// Check GitHub configuration status
router.get('/config-status', (req, res) => {
  const { GITHUB_CLIENT_ID } = getGithubConfig();
  res.json({
    isConfigured: !!(GITHUB_CLIENT_ID),
    provider: 'github'
  });
});

// Check if user belongs to allowed organizations
const checkUserOrganization = async (accessToken, allowedOrgs) => {
  if (!allowedOrgs || allowedOrgs.length === 0) {
    return true; // No organization restrictions
  }

  try {
    const response = await fetch('https://api.github.com/user/orgs', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!response.ok) {
      console.error('Failed to fetch user organizations');
      return false;
    }

    const orgs = await response.json();
    const userOrgs = orgs.map(org => org.login.toLowerCase());
    
    // Check if user belongs to any allowed organization
    return allowedOrgs.some(allowedOrg => 
      userOrgs.includes(allowedOrg.toLowerCase())
    );
  } catch (error) {
    console.error('Error checking user organization:', error);
    return false;
  }
};

// Check if user has starred the required repository
const checkUserStarredRepo = async (accessToken, requiredRepo) => {
  if (!requiredRepo) {
    return true; // No star requirement
  }

  try {
    const response = await fetch(`https://api.github.com/user/starred/${requiredRepo}`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    // 204 means user has starred the repo, 404 means not starred
    return response.status === 204;
  } catch (error) {
    console.error('Error checking user starred repository:', error);
    return false;
  }
};

// Get allowed organizations configuration
router.get('/allowed-orgs', (req, res) => {
  const { GITHUB_ALLOWED_ORGS } = getGithubConfig();
  // Filter out empty strings to handle case when env var is empty
  const validOrgs = GITHUB_ALLOWED_ORGS.filter(org => org.length > 0);
  res.json({ 
    hasRestrictions: validOrgs.length > 0,
    organizations: validOrgs 
  });
});

// Get star requirements configuration
router.get('/star-requirements', (req, res) => {
  const { GITHUB_REQUIRED_STAR_REPO } = getGithubConfig();
  res.json({ 
    hasStarRequirement: !!GITHUB_REQUIRED_STAR_REPO,
    repository: GITHUB_REQUIRED_STAR_REPO 
  });
});

// Generate OAuth URL for login (no auth required)
router.get('/oauth/login-url', (req, res) => {
  const { GITHUB_CLIENT_ID, GITHUB_REDIRECT_URI } = getGithubConfig();
  console.log('GitHub OAuth login URL endpoint called');
  console.log('GITHUB_CLIENT_ID:', GITHUB_CLIENT_ID ? 'Set' : 'Not set');
  
  if (!GITHUB_CLIENT_ID) {
    console.error('GitHub OAuth not configured - GITHUB_CLIENT_ID is missing');
    return res.status(500).json({ error: 'GitHub OAuth not configured. Please set GITHUB_CLIENT_ID in .env file.' });
  }

  // Generate a random state for CSRF protection
  const state = crypto.randomBytes(16).toString('hex');
  
  // Store state temporarily (expires after 10 minutes)
  oauthStates.set(state, {
    isLogin: true,
    timestamp: Date.now()
  });
  
  // Clean up old states
  for (const [key, value] of oauthStates.entries()) {
    if (Date.now() - value.timestamp > 600000) { // 10 minutes
      oauthStates.delete(key);
    }
  }

  const authUrl = `https://github.com/login/oauth/authorize?` +
    `client_id=${GITHUB_CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(GITHUB_REDIRECT_URI)}&` +
    `scope=user:email%20repo%20read:org&` +
    `state=${state}&` +
    `prompt=consent`;

  res.json({ url: authUrl });
});

// Generate OAuth URL for connecting GitHub to existing account
router.get('/oauth/url', authenticateToken, (req, res) => {
  const { GITHUB_CLIENT_ID, GITHUB_REDIRECT_URI } = getGithubConfig();
  console.log('GitHub OAuth URL endpoint called');
  console.log('GITHUB_CLIENT_ID:', GITHUB_CLIENT_ID ? 'Set' : 'Not set');
  console.log('User:', req.user);
  
  if (!GITHUB_CLIENT_ID) {
    console.error('GitHub OAuth not configured - GITHUB_CLIENT_ID is missing');
    return res.status(500).json({ error: 'GitHub OAuth not configured. Please set GITHUB_CLIENT_ID in .env file.' });
  }

  // Generate a random state for CSRF protection
  const state = crypto.randomBytes(16).toString('hex');
  const userId = req.user?.id || req.query.userId;
  
  // Store state temporarily (expires after 10 minutes)
  oauthStates.set(state, {
    userId,
    timestamp: Date.now()
  });
  
  // Clean up old states
  for (const [key, value] of oauthStates.entries()) {
    if (Date.now() - value.timestamp > 600000) { // 10 minutes
      oauthStates.delete(key);
    }
  }

  const authUrl = `https://github.com/login/oauth/authorize?` +
    `client_id=${GITHUB_CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(GITHUB_REDIRECT_URI)}&` +
    `scope=repo&` +
    `state=${state}&` +
    `prompt=consent`;

  res.json({ url: authUrl });
});

// OAuth callback
router.get('/callback', async (req, res) => {
  const { code, state } = req.query;

  const frontendUrl = process.env.FRONTEND_URL || (process.env.VITE_PORT ? `http://localhost:${process.env.VITE_PORT}` : 'http://localhost:8080');
  
  if (!code || !state) {
    return res.redirect(`${frontendUrl}/?error=missing_parameters`);
  }

  // Verify state
  const stateData = oauthStates.get(state);
  if (!stateData) {
    return res.redirect(`${frontendUrl}/?error=invalid_state`);
  }

  oauthStates.delete(state);

  try {
    const { GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_REDIRECT_URI } = getGithubConfig();
    // Exchange code for access token
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: GITHUB_CLIENT_ID,
        client_secret: GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: GITHUB_REDIRECT_URI
      })
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error) {
      console.error('GitHub OAuth error:', tokenData);
      return res.redirect(`${frontendUrl}/?error=oauth_failed`);
    }

    const accessToken = tokenData.access_token;

    // Get user info to verify token
    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    const githubUser = await userResponse.json();

    // Get user email
    const emailResponse = await fetch('https://api.github.com/user/emails', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });
    const emails = await emailResponse.json();
    const primaryEmail = emails.find(e => e.primary)?.email || githubUser.email;

    // Check if this is a login flow
    if (stateData.isLogin) {
      const { GITHUB_ALLOWED_ORGS, GITHUB_REQUIRED_STAR_REPO } = getGithubConfig();
      
      // Check organization membership if restrictions are configured
      const hasOrgAccess = await checkUserOrganization(accessToken, GITHUB_ALLOWED_ORGS);
      
      if (!hasOrgAccess) {
        console.log(`User ${githubUser.login} does not belong to allowed organizations:`, GITHUB_ALLOWED_ORGS);
        return res.redirect(`${frontendUrl}/?error=org_access_denied`);
      }
      
      // Check if user has starred the required repository
      const hasStarredRepo = await checkUserStarredRepo(accessToken, GITHUB_REQUIRED_STAR_REPO);
      
      if (!hasStarredRepo) {
        console.log(`User ${githubUser.login} has not starred the required repository:`, GITHUB_REQUIRED_STAR_REPO);
        return res.redirect(`${frontendUrl}/?error=star_required&repo=${encodeURIComponent(GITHUB_REQUIRED_STAR_REPO || '')}`);
      }
      
      // Try to find existing user by GitHub username
      let user = userDb.getUserByGithubUsername(githubUser.login);
      
      if (!user) {
        // Create new user with GitHub OAuth
        user = userDb.createUserWithGithub(
          githubUser.login,
          githubUser.name || githubUser.login,
          primaryEmail,
          accessToken,
          githubUser.login
        );
      } else {
        // Update existing user's GitHub token
        await updateUserGithubToken(user.id, accessToken, githubUser.login);
      }
      
      // Generate JWT token
      const token = generateToken(user);
      
      // Update last login
      userDb.updateLastLogin(user.id);
      
      // Redirect with token
      const frontendUrl = process.env.FRONTEND_URL || (process.env.VITE_PORT ? `http://localhost:${process.env.VITE_PORT}` : 'http://localhost:8080');
      res.redirect(`${frontendUrl}/?token=${encodeURIComponent(token)}&github_login=true`);
    } else {
      // This is connecting GitHub to existing account
      if (stateData.userId) {
        await updateUserGithubToken(stateData.userId, accessToken, githubUser.login);
      }
      
      // Redirect back to the frontend app with success
      const frontendUrl = process.env.FRONTEND_URL || (process.env.VITE_PORT ? `http://localhost:${process.env.VITE_PORT}` : 'http://localhost:8080');
      res.redirect(`${frontendUrl}/?github_connected=true`);
    }
  } catch (error) {
    console.error('OAuth callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || (process.env.VITE_PORT ? `http://localhost:${process.env.VITE_PORT}` : 'http://localhost:8080');
    res.redirect(`${frontendUrl}/?error=oauth_error`);
  }
});

// Check GitHub connection status
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    
    if (!user.github_token) {
      return res.json({ connected: false });
    }

    // Verify token is still valid
    const response = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${user.github_token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (response.ok) {
      const githubUser = await response.json();
      res.json({
        connected: true,
        username: githubUser.login,
        avatar_url: githubUser.avatar_url
      });
    } else {
      // Token is invalid, clear it
      await updateUserGithubToken(req.user.id, null, null);
      res.json({ connected: false });
    }
  } catch (error) {
    console.error('GitHub status check error:', error);
    res.status(500).json({ error: 'Failed to check GitHub status' });
  }
});

// Disconnect GitHub
router.post('/disconnect', authenticateToken, async (req, res) => {
  try {
    await updateUserGithubToken(req.user.id, null, null);
    res.json({ success: true });
  } catch (error) {
    console.error('GitHub disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect GitHub' });
  }
});

// List user's GitHub repositories
router.get('/repos', authenticateToken, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    
    if (!user.github_token) {
      return res.status(401).json({ error: 'GitHub not connected' });
    }

    const { page = 1, per_page = 30, sort = 'updated' } = req.query;

    const response = await fetch(`https://api.github.com/user/repos?page=${page}&per_page=${per_page}&sort=${sort}`, {
      headers: {
        'Authorization': `Bearer ${user.github_token}`,
        'Accept': 'application/vnd.github.v3+json'
      }
    });

    if (!response.ok) {
      throw new Error('Failed to fetch repositories');
    }

    const repos = await response.json();
    
    // Extract useful information
    const repoList = repos.map(repo => ({
      id: repo.id,
      name: repo.name,
      full_name: repo.full_name,
      description: repo.description,
      html_url: repo.html_url,
      clone_url: repo.clone_url,
      private: repo.private,
      updated_at: repo.updated_at,
      language: repo.language,
      stargazers_count: repo.stargazers_count,
      default_branch: repo.default_branch
    }));

    res.json({
      repos: repoList,
      page: parseInt(page),
      per_page: parseInt(per_page)
    });
  } catch (error) {
    console.error('GitHub repos error:', error);
    res.status(500).json({ error: 'Failed to fetch repositories' });
  }
});

export default router;