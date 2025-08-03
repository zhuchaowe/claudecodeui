import express from 'express';
import fetch from 'node-fetch';
import crypto from 'crypto';
import { getUserById, updateUserGiteaToken, userDb } from '../database/db.js';
import { authenticateToken, generateToken } from '../middleware/auth.js';

const router = express.Router();

// Gitea OAuth configuration - read from env when needed
const getGiteaConfig = () => ({
  GITEA_INSTANCE_URL: process.env.GITEA_INSTANCE_URL,
  GITEA_CLIENT_ID: process.env.GITEA_CLIENT_ID,
  GITEA_CLIENT_SECRET: process.env.GITEA_CLIENT_SECRET,
  GITEA_REDIRECT_URI: process.env.GITEA_REDIRECT_URI || 'http://localhost:3008/api/gitea/callback'
});

// Store state temporarily (in production, use Redis or similar)
const oauthStates = new Map();

// Get OAuth configuration status
router.get('/config-status', (req, res) => {
  const { GITEA_INSTANCE_URL, GITEA_CLIENT_ID } = getGiteaConfig();
  res.json({ 
    isConfigured: !!(GITEA_INSTANCE_URL && GITEA_CLIENT_ID),
    instanceUrl: GITEA_INSTANCE_URL
  });
});

// Generate OAuth URL for login (no auth required)
router.get('/oauth/login-url', (req, res) => {
  const { GITEA_INSTANCE_URL, GITEA_CLIENT_ID, GITEA_REDIRECT_URI } = getGiteaConfig();
  console.log('Gitea OAuth login URL endpoint called');
  console.log('GITEA_CLIENT_ID:', GITEA_CLIENT_ID ? 'Set' : 'Not set');
  console.log('GITEA_INSTANCE_URL:', GITEA_INSTANCE_URL);
  
  if (!GITEA_CLIENT_ID || !GITEA_INSTANCE_URL) {
    console.error('Gitea OAuth not configured - missing CLIENT_ID or INSTANCE_URL');
    return res.status(500).json({ error: 'Gitea OAuth not configured. Please set GITEA_INSTANCE_URL and GITEA_CLIENT_ID in .env file.' });
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

  // Gitea OAuth URL format
  const authUrl = `${GITEA_INSTANCE_URL}/login/oauth/authorize?` +
    `client_id=${GITEA_CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(GITEA_REDIRECT_URI)}&` +
    `response_type=code&` +
    `state=${state}`;

  res.json({ url: authUrl });
});

// Generate OAuth URL for connecting Gitea to existing account
router.get('/oauth/url', authenticateToken, (req, res) => {
  const { GITEA_INSTANCE_URL, GITEA_CLIENT_ID, GITEA_REDIRECT_URI } = getGiteaConfig();
  console.log('Gitea OAuth URL endpoint called');
  console.log('GITEA_CLIENT_ID:', GITEA_CLIENT_ID ? 'Set' : 'Not set');
  console.log('User:', req.user);
  
  if (!GITEA_CLIENT_ID || !GITEA_INSTANCE_URL) {
    console.error('Gitea OAuth not configured');
    return res.status(500).json({ error: 'Gitea OAuth not configured. Please set GITEA_INSTANCE_URL and GITEA_CLIENT_ID in .env file.' });
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

  const authUrl = `${GITEA_INSTANCE_URL}/login/oauth/authorize?` +
    `client_id=${GITEA_CLIENT_ID}&` +
    `redirect_uri=${encodeURIComponent(GITEA_REDIRECT_URI)}&` +
    `response_type=code&` +
    `state=${state}`;

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
    const { GITEA_INSTANCE_URL, GITEA_CLIENT_ID, GITEA_CLIENT_SECRET, GITEA_REDIRECT_URI } = getGiteaConfig();
    
    // Exchange code for access token
    const tokenResponse = await fetch(`${GITEA_INSTANCE_URL}/login/oauth/access_token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        client_id: GITEA_CLIENT_ID,
        client_secret: GITEA_CLIENT_SECRET,
        code,
        redirect_uri: GITEA_REDIRECT_URI,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenResponse.json();

    if (tokenData.error || !tokenData.access_token) {
      console.error('Gitea OAuth error:', tokenData);
      return res.redirect(`${frontendUrl}/?error=oauth_failed`);
    }

    const accessToken = tokenData.access_token;

    // Get user info to verify token
    const userResponse = await fetch(`${GITEA_INSTANCE_URL}/api/v1/user`, {
      headers: {
        'Authorization': `token ${accessToken}`,
        'Accept': 'application/json'
      }
    });

    const giteaUser = await userResponse.json();

    // Check if this is a login flow
    if (stateData.isLogin) {
      // Try to find existing user by Gitea username
      let user = userDb.getUserByGiteaUsername(giteaUser.login);
      
      if (!user) {
        // Create new user with Gitea OAuth
        user = userDb.createUserWithGitea(
          giteaUser.login,
          giteaUser.full_name || giteaUser.login,
          giteaUser.email,
          accessToken,
          giteaUser.login
        );
      } else {
        // Update existing user's Gitea token
        await updateUserGiteaToken(user.id, accessToken, giteaUser.login);
      }
      
      // Generate JWT token
      const token = generateToken(user);
      
      // Update last login
      userDb.updateLastLogin(user.id);
      
      // Redirect with token
      res.redirect(`${frontendUrl}/?token=${encodeURIComponent(token)}&gitea_login=true`);
    } else {
      // This is connecting Gitea to existing account
      if (stateData.userId) {
        await updateUserGiteaToken(stateData.userId, accessToken, giteaUser.login);
      }
      
      // Redirect back to the frontend app with success
      res.redirect(`${frontendUrl}/?gitea_connected=true`);
    }
  } catch (error) {
    console.error('OAuth callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || (process.env.VITE_PORT ? `http://localhost:${process.env.VITE_PORT}` : 'http://localhost:8080');
    res.redirect(`${frontendUrl}/?error=oauth_error`);
  }
});

// Check Gitea connection status
router.get('/status', authenticateToken, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    const { GITEA_INSTANCE_URL } = getGiteaConfig();
    
    if (!user.gitea_token || !GITEA_INSTANCE_URL) {
      return res.json({ connected: false });
    }

    // Verify token is still valid
    const response = await fetch(`${GITEA_INSTANCE_URL}/api/v1/user`, {
      headers: {
        'Authorization': `token ${user.gitea_token}`,
        'Accept': 'application/json'
      }
    });

    if (response.ok) {
      const giteaUser = await response.json();
      res.json({
        connected: true,
        username: giteaUser.login,
        avatar_url: giteaUser.avatar_url
      });
    } else {
      // Token is invalid, clear it
      await updateUserGiteaToken(req.user.id, null, null);
      res.json({ connected: false });
    }
  } catch (error) {
    console.error('Gitea status check error:', error);
    res.status(500).json({ error: 'Failed to check Gitea status' });
  }
});

// Disconnect Gitea
router.post('/disconnect', authenticateToken, async (req, res) => {
  try {
    await updateUserGiteaToken(req.user.id, null, null);
    res.json({ success: true });
  } catch (error) {
    console.error('Gitea disconnect error:', error);
    res.status(500).json({ error: 'Failed to disconnect Gitea' });
  }
});

// List user's Gitea repositories
router.get('/repos', authenticateToken, async (req, res) => {
  try {
    const user = await getUserById(req.user.id);
    const { GITEA_INSTANCE_URL } = getGiteaConfig();
    
    if (!user.gitea_token || !GITEA_INSTANCE_URL) {
      return res.status(401).json({ error: 'Gitea not connected' });
    }

    const { page = 1, limit = 30 } = req.query;

    const response = await fetch(`${GITEA_INSTANCE_URL}/api/v1/user/repos?page=${page}&limit=${limit}`, {
      headers: {
        'Authorization': `token ${user.gitea_token}`,
        'Accept': 'application/json'
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
      ssh_url: repo.ssh_url,
      private: repo.private,
      updated_at: repo.updated_at,
      language: repo.language,
      stars_count: repo.stars_count,
      default_branch: repo.default_branch
    }));

    res.json({
      repos: repoList,
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (error) {
    console.error('Gitea repos error:', error);
    res.status(500).json({ error: 'Failed to fetch repositories' });
  }
});

export default router;