// Load environment variables from .env file
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

try {
  const envPath = path.join(__dirname, '../.env');
  const envFile = fs.readFileSync(envPath, 'utf8');
  envFile.split('\n').forEach(line => {
    const trimmedLine = line.trim();
    if (trimmedLine && !trimmedLine.startsWith('#')) {
      const [key, ...valueParts] = trimmedLine.split('=');
      if (key && valueParts.length > 0 && !process.env[key]) {
        process.env[key] = valueParts.join('=').trim();
      }
    }
  });
} catch (e) {
  console.log('No .env file found or error reading it:', e.message);
}

console.log('PORT from env:', process.env.UI_PORT || process.env.PORT);
console.log('GITHUB_CLIENT_ID from env:', process.env.GITHUB_CLIENT_ID ? 'Set' : 'Not set');
console.log('SMTP_HOST from env:', process.env.SMTP_HOST ? 'Set' : 'Not set');
console.log('SMTP_USER from env:', process.env.SMTP_USER ? 'Set' : 'Not set');
console.log('SMTP_PASS from env:', process.env.SMTP_PASS ? 'Set' : 'Not set');

import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import cors from 'cors';
import { promises as fsPromises } from 'fs';
import { spawn, exec } from 'child_process';
import os from 'os';
import pty from 'node-pty';
import crypto from 'crypto';
import fetch from 'node-fetch';
import mime from 'mime-types';

import { getProjects, getSessions, getSessionMessages, renameProject, deleteSession, deleteProject, removeProjectAccess, addProjectManually, extractProjectDirectory, clearProjectDirectoryCache, getUserProjectsDir, encodeProjectPath, backupProject, restoreProject, backupAllUserProjects, checkAndRestoreMissingProjects } from './projects.js';
import { projectDb } from './database/db.js';
import { spawnClaude, abortClaudeSession } from './claude-cli.js';
import gitRoutes from './routes/git.js';
import authRoutes from './routes/auth.js';
import mcpRoutes from './routes/mcp.js';
import githubRoutes from './routes/github.js';
import giteaRoutes from './routes/gitea.js';
import emailRoutes from './routes/email.js';
import emailService from './services/emailService.js';
import { initializeDatabase } from './database/db.js';
import { validateApiKey, authenticateToken, authenticateWebSocket } from './middleware/auth.js';

// File system watchers for projects folders (one per user)
const projectsWatchers = new Map(); // username -> watcher
const connectedClients = new Map(); // ws -> { username, ... }

// Setup file system watcher for Claude projects folder using chokidar
async function setupProjectsWatcher(username) {
  const chokidar = (await import('chokidar')).default;
  const claudeProjectsPath = getUserProjectsDir(username);
  
  // Close existing watcher for this user if any
  if (projectsWatchers.has(username)) {
    projectsWatchers.get(username).close();
  }
  
  try {
    // Initialize chokidar watcher with optimized settings
    const watcher = chokidar.watch(claudeProjectsPath, {
      ignored: [
        '**/node_modules/**',
        '**/.git/**',
        '**/dist/**',
        '**/build/**',
        '**/*.tmp',
        '**/*.swp',
        '**/.DS_Store'
      ],
      persistent: true,
      ignoreInitial: true, // Don't fire events for existing files on startup
      followSymlinks: false,
      depth: 10, // Reasonable depth limit
      awaitWriteFinish: {
        stabilityThreshold: 100, // Wait 100ms for file to stabilize
        pollInterval: 50
      }
    });
    
    // Debounce function to prevent excessive notifications
    let debounceTimer;
    const debouncedUpdate = async (eventType, filePath) => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        try {
          
          // Clear project directory cache when files change
          clearProjectDirectoryCache();
          
          // Get updated projects list for this user
          const updatedProjects = await getProjects(username);
          
          // Notify all connected clients about the project changes
          const updateMessage = JSON.stringify({
            type: 'projects_updated',
            projects: updatedProjects,
            timestamp: new Date().toISOString(),
            changeType: eventType,
            changedFile: path.relative(claudeProjectsPath, filePath)
          });
          
          // Notify only connected clients belonging to this user
          connectedClients.forEach((clientInfo, ws) => {
            if (clientInfo.username === username && ws.readyState === ws.OPEN) {
              ws.send(updateMessage);
            }
          });
          
        } catch (error) {
          console.error('❌ Error handling project changes:', error);
        }
      }, 300); // 300ms debounce (slightly faster than before)
    };
    
    // Set up event listeners
    watcher
      .on('add', (filePath) => debouncedUpdate('add', filePath))
      .on('change', (filePath) => debouncedUpdate('change', filePath))
      .on('unlink', (filePath) => debouncedUpdate('unlink', filePath))
      .on('addDir', (dirPath) => debouncedUpdate('addDir', dirPath))
      .on('unlinkDir', (dirPath) => debouncedUpdate('unlinkDir', dirPath))
      .on('error', (error) => {
        console.error('❌ Chokidar watcher error:', error);
      })
      .on('ready', () => {
      });
    
    // Store the watcher for this user
    projectsWatchers.set(username, watcher);
    
  } catch (error) {
    console.error(`❌ Failed to setup projects watcher for user ${username}:`, error);
  }
}


// Helper function to clean up old backup files
async function cleanupOldBackups(backupDir, filePrefix) {
  try {
    const files = await fsPromises.readdir(backupDir);
    const backupFiles = files
      .filter(f => f.startsWith(filePrefix + '.backup.'))
      .map(f => ({
        name: f,
        path: path.join(backupDir, f),
        timestamp: parseInt(f.split('.').pop())
      }))
      .sort((a, b) => b.timestamp - a.timestamp);
    
    // Keep only the last 10 backups
    const filesToDelete = backupFiles.slice(10);
    
    // Also delete backups older than 7 days
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    for (const file of backupFiles.slice(0, 10)) {
      if (file.timestamp < sevenDaysAgo) {
        filesToDelete.push(file);
      }
    }
    
    // Delete old backup files
    for (const file of filesToDelete) {
      await fsPromises.unlink(file.path);
      console.log('🗑️ Deleted old backup:', file.name);
    }
  } catch (error) {
    console.warn('Error cleaning up backups:', error.message);
  }
}

const app = express();
const server = http.createServer(app);

// Single WebSocket server that handles both paths
const wss = new WebSocketServer({ 
  server,
  verifyClient: (info) => {
    console.log('🔌 WebSocket connection attempt:', {
      url: info.req.url,
      headers: Object.keys(info.req.headers),
      origin: info.origin
    });
    
    // Extract token from query parameters or headers
    const url = new URL(info.req.url, 'http://localhost');
    const token = url.searchParams.get('token') || 
                  info.req.headers.authorization?.split(' ')[1];
    
    console.log('🔑 Token extraction:', {
      hasToken: !!token,
      tokenLength: token?.length,
      source: url.searchParams.get('token') ? 'query' : 'header'
    });
    
    // Verify token
    const user = authenticateWebSocket(token);
    if (!user) {
      console.log('❌ WebSocket authentication failed:', {
        tokenProvided: !!token,
        tokenLength: token?.length
      });
      return false;
    }
    
    // Store user info in the request for later use
    info.req.user = user;
    console.log('✅ WebSocket authenticated:', {
      username: user.username,
      userId: user.id,
      path: info.req.url
    });
    return true;
  }
});

app.use(cors());
app.use(express.json());

// Optional API key validation (if configured)
app.use('/api', validateApiKey);

// Authentication routes (public)
app.use('/api/auth', authRoutes);

// Git API Routes (protected)
app.use('/api/git', authenticateToken, gitRoutes);

// MCP API Routes (protected)
app.use('/api/mcp', authenticateToken, mcpRoutes);

// GitHub API Routes (protected and public callbacks)
app.use('/api/github', githubRoutes);
console.log('GitHub routes configured. GITHUB_CLIENT_ID:', process.env.GITHUB_CLIENT_ID ? 'Set' : 'Not set');

// Gitea API Routes (protected and public callbacks)
app.use('/api/gitea', giteaRoutes);
console.log('Gitea routes configured. GITEA_CLIENT_ID:', process.env.GITEA_CLIENT_ID ? 'Set' : 'Not set');

// Email API Routes (protected)
app.use('/api/email', emailRoutes);

// Anthropic Configuration API Routes (protected)
app.get('/api/anthropic-config', authenticateToken, async (req, res) => {
  try {
    // Get user's anthropic configuration from database
    const user = projectDb.prepare('SELECT anthropic_config FROM users WHERE id = ?').get(req.user.id);
    
    if (!user || !user.anthropic_config) {
      // Return default config if not set
      return res.json({
        enabled: false,
        anthropicBaseUrl: '',
        anthropicAuthToken: '',
        anthropicApiKey: ''
      });
    }
    
    const config = JSON.parse(user.anthropic_config);
    
    // Mask API keys for security
    if (config.anthropicAuthToken) {
      config.anthropicAuthToken = '***' + config.anthropicAuthToken.slice(-4);
    }
    if (config.anthropicApiKey) {
      config.anthropicApiKey = '***' + config.anthropicApiKey.slice(-4);
    }
    
    res.json(config);
  } catch (error) {
    console.error('Error getting anthropic config:', error);
    res.status(500).json({ error: 'Failed to get anthropic configuration' });
  }
});

app.post('/api/anthropic-config', authenticateToken, async (req, res) => {
  try {
    const { anthropicBaseUrl, anthropicAuthToken, anthropicApiKey } = req.body;
    
    // Validate required fields
    if (!anthropicAuthToken && !anthropicApiKey) {
      return res.status(400).json({ error: 'At least one authentication method (auth token or API key) is required' });
    }
    
    // Create anthropic config object
    const anthropicConfig = {
      enabled: true,
      anthropicBaseUrl: anthropicBaseUrl || '',
      anthropicAuthToken: anthropicAuthToken || '',
      anthropicApiKey: anthropicApiKey || ''
    };
    
    // Save to database
    projectDb.prepare('UPDATE users SET anthropic_config = ? WHERE id = ?')
      .run(JSON.stringify(anthropicConfig), req.user.id);
    
    // Return masked config
    res.json({ 
      success: true, 
      message: 'Anthropic configuration saved successfully',
      config: {
        enabled: true,
        anthropicBaseUrl: anthropicConfig.anthropicBaseUrl,
        anthropicAuthToken: anthropicConfig.anthropicAuthToken ? '***' + anthropicConfig.anthropicAuthToken.slice(-4) : '',
        anthropicApiKey: anthropicConfig.anthropicApiKey ? '***' + anthropicConfig.anthropicApiKey.slice(-4) : ''
      }
    });
  } catch (error) {
    console.error('Error saving anthropic config:', error);
    res.status(500).json({ error: 'Failed to save anthropic configuration' });
  }
});

app.delete('/api/anthropic-config', authenticateToken, async (req, res) => {
  try {
    // Clear user's anthropic configuration
    const disabledConfig = {
      enabled: false,
      anthropicBaseUrl: '',
      anthropicAuthToken: '',
      anthropicApiKey: ''
    };
    
    projectDb.prepare('UPDATE users SET anthropic_config = ? WHERE id = ?')
      .run(JSON.stringify(disabledConfig), req.user.id);
    
    res.json({ 
      success: true, 
      message: 'Anthropic configuration disabled successfully' 
    });
  } catch (error) {
    console.error('Error disabling anthropic config:', error);
    res.status(500).json({ error: 'Failed to disable anthropic configuration' });
  }
});

// Test anthropic connection endpoint
app.post('/api/anthropic-config/test', authenticateToken, async (req, res) => {
  try {
    const { anthropicBaseUrl, anthropicAuthToken, anthropicApiKey } = req.body;
    
    if ((!anthropicAuthToken && !anthropicApiKey)) {
      return res.status(400).json({ error: 'At least one authentication method is required for testing' });
    }
    
    // Use provided base URL or default Anthropic API
    const baseUrl = anthropicBaseUrl || 'https://api.anthropic.com';
    const testUrl = baseUrl.replace(/\/$/, '') + '/v1/messages';
    
    // Prepare headers based on available auth method
    const headers = {
      'Content-Type': 'application/json',
      'anthropic-version': '2023-06-01'
    };
    
    if (anthropicApiKey) {
      headers['x-api-key'] = anthropicApiKey;
    } else if (anthropicAuthToken) {
      headers['Authorization'] = `Bearer ${anthropicAuthToken}`;
    }
    
    // Simple test request
    const response = await fetch(testUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-3-opus-20240229',
        max_tokens: 10,
        messages: [{ role: 'user', content: 'Hi' }]
      })
    });
    
    if (response.ok || response.status === 400) { // 400 might mean auth works but request format issue
      res.json({ 
        success: true, 
        message: 'Connection successful',
        status: response.status
      });
    } else {
      const errorText = await response.text();
      res.json({ 
        success: false, 
        message: `Connection failed: ${response.status} ${response.statusText}`,
        error: errorText
      });
    }
  } catch (error) {
    console.error('Error testing anthropic connection:', error);
    res.json({ 
      success: false, 
      message: 'Connection test failed',
      error: error.message 
    });
  }
});

// Static files served after API routes
app.use(express.static(path.join(__dirname, '../dist')));

// API Routes (protected)
app.get('/api/config', authenticateToken, (req, res) => {
  const host = req.headers.host || `${req.hostname}:${PORT}`;
  const protocol = process.env.FORCE_WSS === 'true' ? 'wss' : 
                  (req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'wss' : 'ws');
  
  console.log('Config API called - Returning host:', host, 'Protocol:', protocol);
  
  res.json({
    serverPort: PORT,
    wsUrl: `${protocol}://${host}`
  });
});

app.get('/api/projects', authenticateToken, async (req, res) => {
  try {
    const projects = await getProjects(req.user.username);
    res.json(projects);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/projects/:projectName/sessions', authenticateToken, async (req, res) => {
  try {
    const { limit = 5, offset = 0 } = req.query;
    const result = await getSessions(req.user.username, req.params.projectName, parseInt(limit), parseInt(offset));
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get messages for a specific session
app.get('/api/projects/:projectName/sessions/:sessionId/messages', authenticateToken, async (req, res) => {
  try {
    const { projectName, sessionId } = req.params;
    const messages = await getSessionMessages(req.user.username, projectName, sessionId);
    res.json({ messages });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Rename project endpoint
app.put('/api/projects/:projectName/rename', authenticateToken, async (req, res) => {
  try {
    const { displayName } = req.body;
    await renameProject(req.user.username, req.params.projectName, displayName);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete session endpoint
app.delete('/api/projects/:projectName/sessions/:sessionId', authenticateToken, async (req, res) => {
  try {
    const { projectName, sessionId } = req.params;
    await deleteSession(req.user.username, projectName, sessionId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete project endpoint (or remove access for shared projects)
app.delete('/api/projects/:projectName', authenticateToken, async (req, res) => {
  try {
    const { projectName } = req.params;
    const username = req.user.username;
    
    // Check if user is the owner
    const projectOwner = await projectDb.getProjectOwner(projectName);
    
    if (projectOwner === username || !projectOwner) {
      // User is the owner or project has no owner - delete the project
      await deleteProject(username, projectName);
      res.json({ success: true, action: 'deleted' });
    } else {
      // User is not the owner - just remove their access
      await removeProjectAccess(username, projectName);
      res.json({ success: true, action: 'access_removed' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Backup all projects endpoint
app.post('/api/projects/backup', authenticateToken, async (req, res) => {
  try {
    const username = req.user.username;
    console.log(`[API] Manual backup requested by user ${username}`);
    
    // First restore any missing projects
    const restoredCount = await checkAndRestoreMissingProjects(username);
    
    // Then backup all projects
    const backupCount = await backupAllUserProjects(username);
    
    res.json({ 
      success: true, 
      backedUp: backupCount,
      restored: restoredCount,
      message: `Backed up ${backupCount} projects, restored ${restoredCount} missing projects`
    });
  } catch (error) {
    console.error('[API] Backup error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create project endpoint
app.post('/api/projects/create', authenticateToken, async (req, res) => {
  try {
    const { path: projectPath } = req.body;
    
    if (!projectPath || !projectPath.trim()) {
      return res.status(400).json({ error: 'Project path is required' });
    }
    
    const project = await addProjectManually(req.user.username, projectPath.trim());
    res.json({ success: true, project });
  } catch (error) {
    console.error('Error creating project:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create git project endpoint
app.post('/api/projects/create-git', authenticateToken, async (req, res) => {
  try {
    const { gitUrl, gitUsername, gitPassword, folderName, useOAuth, repoFullName, provider } = req.body;
    
    // Validate inputs
    if (!gitUrl || !gitUrl.trim()) {
      return res.status(400).json({ error: 'Git repository URL is required' });
    }
    if (!folderName || !folderName.trim()) {
      return res.status(400).json({ error: 'Folder name is required' });
    }
    
    // Import necessary modules
    const { getUserById } = await import('./database/db.js');
    
    let gitUrlWithAuth;
    
    if (useOAuth) {
      const user = await getUserById(req.user.id);
      
      if (provider === 'gitea') {
        // Handle Gitea OAuth
        if (!user.gitea_token) {
          return res.status(401).json({ error: 'Gitea not connected. Please connect your Gitea account first.' });
        }
        
        // Extract the Gitea instance URL from the git URL
        const giteaInstanceUrl = gitUrl.match(/^(https?:\/\/[^\/]+)/)?.[1];
        if (giteaInstanceUrl) {
          gitUrlWithAuth = gitUrl.replace(giteaInstanceUrl, `${giteaInstanceUrl.replace(/^https?:\/\//, `https://${user.gitea_token}@`)}`);
        } else {
          return res.status(400).json({ error: 'Invalid Gitea repository URL' });
        }
      } else {
        // Default to GitHub OAuth
        if (!user.github_token) {
          return res.status(401).json({ error: 'GitHub not connected. Please connect your GitHub account first.' });
        }
        
        // Use OAuth token for authentication
        gitUrlWithAuth = gitUrl.replace(/^https:\/\/github.com\//, `https://${user.github_token}@github.com/`);
      }
    } else {
      // Legacy username/password authentication
      if (!gitUsername || !gitUsername.trim()) {
        return res.status(400).json({ error: 'Git username is required' });
      }
      if (!gitPassword || !gitPassword.trim()) {
        return res.status(400).json({ error: 'Git password is required' });
      }
      // Support both http and https URLs
      gitUrlWithAuth = gitUrl.replace(/^(https?):\/\//, `$1://${encodeURIComponent(gitUsername)}:${encodeURIComponent(gitPassword)}@`);
    }
    
    // Create projects directory structure
    // Use the actual projects directory for cloning, not session storage
    const projectsBaseDir = process.env.PROJECTS_DIR || '/home/claude/projects';
    const userProjectsDir = path.join(projectsBaseDir, req.user.username);
    const targetDir = path.join(userProjectsDir, folderName.trim());
    
    // Check if target directory already exists
    try {
      await fsPromises.access(targetDir);
      return res.status(400).json({ error: `Folder ${folderName} already exists` });
    } catch (error) {
      // Directory doesn't exist, which is what we want
    }
    
    // Create the projects directory structure
    await fsPromises.mkdir(userProjectsDir, { recursive: true });
    
    console.log(`Cloning git repository to ${targetDir}...`);
    
    // Use spawn to run git clone with progress tracking
    const { spawn } = await import('child_process');
    
    // Create a unique session ID for this clone operation
    const cloneSessionId = `clone_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Send progress updates to all connected WebSocket clients for this user
    const sendCloneProgress = (data) => {
      const progressMessage = JSON.stringify({
        type: 'clone-progress',
        sessionId: cloneSessionId,
        projectName: folderName.trim(),
        ...data
      });
      
      console.log(`[Git Clone ${cloneSessionId}] Sending progress to WebSocket clients:`, {
        connectedClientsCount: connectedClients.size,
        messageType: data.status,
        username: req.user.username
      });
      
      let sentCount = 0;
      connectedClients.forEach((clientInfo, ws) => {
        if (clientInfo.username === req.user.username && ws.readyState === ws.OPEN) {
          ws.send(progressMessage);
          sentCount++;
        }
      });
      
      console.log(`[Git Clone ${cloneSessionId}] Sent to ${sentCount} clients`);
    };
    
    // Send initial status
    sendCloneProgress({
      status: 'starting',
      message: 'Initializing git clone...',
      gitUrl: gitUrl, // Send original URL without auth
      targetDir: targetDir
    });
    
    console.log(`[Git Clone] Starting clone operation:`, {
      sessionId: cloneSessionId,
      user: req.user.username,
      gitUrl: gitUrl,
      targetDir: targetDir,
      provider: provider || 'github',
      useOAuth: useOAuth
    });
    
    // Create a promise to handle the spawn process
    const clonePromise = new Promise((resolve, reject) => {
      // Use spawn with progress option
      const gitProcess = spawn('git', ['clone', '--progress', gitUrlWithAuth, targetDir], {
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }, // Disable git prompts
        stdio: ['ignore', 'pipe', 'pipe'] // ignore stdin, pipe stdout and stderr
      });
      
      let stdoutData = '';
      let stderrData = '';
      let lastProgressUpdate = Date.now();
      
      // Handle stdout (usually empty for git clone)
      gitProcess.stdout.on('data', (data) => {
        stdoutData += data.toString();
        console.log(`[Git Clone ${cloneSessionId}] stdout:`, data.toString());
      });
      
      // Handle stderr (git clone sends progress here)
      gitProcess.stderr.on('data', (data) => {
        const output = data.toString();
        stderrData += output;
        
        // Log all stderr output for debugging
        console.log(`[Git Clone ${cloneSessionId}] stderr:`, output);
        
        // Parse git progress messages
        const progressMatch = output.match(/(?:Counting objects|Compressing objects|Receiving objects|Resolving deltas):\s*(\d+)%/);
        if (progressMatch) {
          const progress = parseInt(progressMatch[1]);
          const now = Date.now();
          
          // Throttle progress updates to every 500ms
          if (now - lastProgressUpdate > 500) {
            lastProgressUpdate = now;
            sendCloneProgress({
              status: 'progress',
              progress: progress,
              message: output.trim()
            });
          }
        } else if (output.includes('Cloning into')) {
          sendCloneProgress({
            status: 'cloning',
            message: 'Starting clone operation...'
          });
        } else if (output.includes('remote: Enumerating objects')) {
          sendCloneProgress({
            status: 'enumerating',
            message: 'Enumerating objects...'
          });
        }
      });
      
      // Handle process exit
      gitProcess.on('close', async (code) => {
        console.log(`[Git Clone ${cloneSessionId}] Process exited with code:`, code);
        console.log(`[Git Clone ${cloneSessionId}] Final stdout:`, stdoutData);
        console.log(`[Git Clone ${cloneSessionId}] Final stderr:`, stderrData);
        
        if (code === 0) {
          console.log(`[Git Clone ${cloneSessionId}] Successfully cloned repository to ${targetDir}`);
          
          sendCloneProgress({
            status: 'finalizing',
            progress: 100,
            message: 'Finalizing project setup...'
          });
          
          try {
            // Configure git credential helper for the cloned repository
            console.log(`[Git Clone ${cloneSessionId}] Setting up git credential helper...`);
            try {
              // Set credential.helper to store for this repository
              await new Promise((resolve, reject) => {
                exec('git config credential.helper store', { cwd: targetDir }, (error, stdout, stderr) => {
                  if (error) {
                    console.error(`[Git Clone ${cloneSessionId}] Failed to set credential helper:`, error);
                    // Don't fail the whole clone operation if this fails
                    resolve();
                  } else {
                    console.log(`[Git Clone ${cloneSessionId}] Successfully configured credential.helper store`);
                    resolve();
                  }
                });
              });
              
              // If we have authentication credentials, store them
              if (gitUrlWithAuth !== gitUrl && gitUrlWithAuth.includes('@')) {
                console.log(`[Git Clone ${cloneSessionId}] Storing credentials for future use...`);
                
                // Extract credentials from the authenticated URL
                const urlMatch = gitUrlWithAuth.match(/https:\/\/([^:]+):([^@]+)@(.+)/);
                if (urlMatch) {
                  const [, username, password, hostAndPath] = urlMatch;
                  const homeDir = process.env.HOME || process.env.USERPROFILE;
                  const credentialsFile = path.join(homeDir, '.git-credentials');
                  
                  // Create credential entry
                  const credentialEntry = `https://${username}:${password}@${hostAndPath}\n`;
                  
                  // Append to git-credentials file
                  try {
                    // Check if credentials already exist to avoid duplicates
                    let existingCredentials = '';
                    try {
                      existingCredentials = await fsPromises.readFile(credentialsFile, 'utf-8');
                    } catch (error) {
                      // File doesn't exist, that's fine
                    }
                    
                    // Extract just the host for comparison
                    const host = hostAndPath.split('/')[0];
                    if (!existingCredentials.includes(host)) {
                      await fsPromises.appendFile(credentialsFile, credentialEntry, { mode: 0o600 });
                      console.log(`[Git Clone ${cloneSessionId}] Credentials stored for ${host}`);
                    } else {
                      console.log(`[Git Clone ${cloneSessionId}] Credentials already exist for ${host}`);
                    }
                  } catch (error) {
                    console.error(`[Git Clone ${cloneSessionId}] Failed to store credentials:`, error);
                    // Don't fail the whole operation
                  }
                }
              }
            } catch (credentialError) {
              console.error(`[Git Clone ${cloneSessionId}] Error setting up credentials:`, credentialError);
              // Don't fail the whole clone operation
            }
            
            // Create project ownership
            const encodedProjectName = encodeProjectPath(targetDir, req.user.username);
            
            const existingOwner = await projectDb.getProjectOwner(encodedProjectName);
            if (!existingOwner) {
              await projectDb.createProjectOwnership(encodedProjectName, req.user.username);
            } else if (existingOwner !== req.user.username) {
              await projectDb.addProjectAccess(encodedProjectName, req.user.username, 'user');
            }
            
            // Return project info
            const project = {
              name: encodedProjectName,
              path: targetDir,
              fullPath: targetDir,
              displayName: folderName,
              owner: req.user.username,
              isShared: false,
              sessions: []
            };
            
            sendCloneProgress({
              status: 'completed',
              progress: 100,
              message: 'Repository cloned successfully!',
              project: project
            });
            
            resolve({ success: true, project });
          } catch (postCloneError) {
            console.error(`[Git Clone ${cloneSessionId}] Post-clone error:`, postCloneError);
            reject(postCloneError);
          }
        } else {
          // Clone failed
          const errorInfo = {
            code: code,
            stdout: stdoutData,
            stderr: stderrData,
            gitUrl: gitUrl, // Log original URL without auth
            provider: provider || 'github'
          };
          
          console.error(`[Git Clone ${cloneSessionId}] Clone failed:`, errorInfo);
          
          // Parse error message
          let errorMessage = 'Failed to clone repository';
          let errorDetails = stderrData;
          
          if (stderrData.includes('Authentication failed') || stderrData.includes('Invalid username or password')) {
            errorMessage = useOAuth 
              ? `Authentication failed. Your ${provider || 'GitHub'} token may have expired. Please reconnect your account.`
              : 'Authentication failed. Please check your username and password.';
            errorDetails = 'Authentication credentials were rejected by the server.';
          } else if (stderrData.includes('Repository not found') || stderrData.includes('does not exist')) {
            errorMessage = 'Repository not found. Please check the URL.';
            errorDetails = 'The specified repository does not exist or you do not have access to it.';
          } else if (stderrData.includes('Could not resolve host')) {
            errorMessage = 'Network error. Could not connect to the server.';
            errorDetails = 'DNS resolution failed. Please check your network connection.';
          } else if (stderrData.includes('Connection timed out') || stderrData.includes('Operation timed out')) {
            errorMessage = 'Connection timed out. The server may be unreachable.';
            errorDetails = 'Network timeout occurred while trying to connect to the server.';
          } else if (stderrData.includes('SSL certificate problem')) {
            errorMessage = 'SSL certificate error. The server certificate may be invalid.';
            errorDetails = stderrData;
          } else if (stderrData.includes('fatal:')) {
            // Extract the fatal error message
            const fatalMatch = stderrData.match(/fatal:\s*(.+)/);
            if (fatalMatch) {
              errorDetails = fatalMatch[1];
            }
          }
          
          sendCloneProgress({
            status: 'error',
            error: errorMessage,
            errorDetails: errorDetails
          });
          
          reject(new Error(errorMessage));
        }
      });
      
      // Handle process errors
      gitProcess.on('error', (error) => {
        console.error(`[Git Clone ${cloneSessionId}] Process error:`, error);
        
        let errorMessage = 'Failed to start git process';
        let errorDetails = error.message;
        
        if (error.code === 'ENOENT') {
          errorMessage = 'Git is not installed or not in PATH';
          errorDetails = 'Please ensure git is installed and accessible from the command line.';
        }
        
        sendCloneProgress({
          status: 'error',
          error: errorMessage,
          errorDetails: errorDetails
        });
        reject(error);
      });
      
      // Set a timeout for the clone operation (5 minutes)
      const timeout = setTimeout(() => {
        console.error(`[Git Clone ${cloneSessionId}] Clone operation timed out after 5 minutes`);
        gitProcess.kill('SIGTERM');
        sendCloneProgress({
          status: 'error',
          error: 'Clone operation timed out',
          errorDetails: 'The operation took too long. The repository may be too large or the network connection is slow.'
        });
        reject(new Error('Clone operation timed out after 5 minutes'));
      }, 300000); // 5 minutes
      
      // Clear timeout if process completes
      gitProcess.on('exit', () => {
        clearTimeout(timeout);
      });
    });
    
    try {
      const result = await clonePromise;
      res.json(result);
    } catch (error) {
      // Clean up partial clone
      try {
        await fsPromises.rm(targetDir, { recursive: true, force: true });
        console.log(`[Git Clone ${cloneSessionId}] Cleaned up failed clone directory:`, targetDir);
      } catch (cleanupError) {
        console.error(`[Git Clone ${cloneSessionId}] Error cleaning up failed clone directory:`, cleanupError);
      }
      
      return res.status(400).json({ error: error.message });
    }
    
  } catch (error) {
    console.error('Error creating git project:', error);
    res.status(500).json({ error: error.message });
  }
});

// Read file content endpoint
app.get('/api/projects/:projectName/file', authenticateToken, async (req, res) => {
  try {
    const { projectName } = req.params;
    const { filePath } = req.query;
    
    console.log('📄 File read request:', projectName, filePath);
    
    // Using fsPromises from import
    
    // Security check - ensure the path is safe and absolute
    if (!filePath || !path.isAbsolute(filePath)) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    
    const content = await fsPromises.readFile(filePath, 'utf8');
    res.json({ content, path: filePath });
  } catch (error) {
    console.error('Error reading file:', error);
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'File not found' });
    } else if (error.code === 'EACCES') {
      res.status(403).json({ error: 'Permission denied' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

// Serve binary file content endpoint (for images, etc.)
app.get('/api/projects/:projectName/files/content', authenticateToken, async (req, res) => {
  try {
    const { projectName } = req.params;
    const { path: filePath } = req.query;
    
    console.log('🖼️ Binary file serve request:', projectName, filePath);
    
    // Using fs from import
    // Using mime from import
    
    // Security check - ensure the path is safe and absolute
    if (!filePath || !path.isAbsolute(filePath)) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    
    // Check if file exists
    try {
      await fsPromises.access(filePath);
    } catch (error) {
      return res.status(404).json({ error: 'File not found' });
    }
    
    // Get file extension and set appropriate content type
    const mimeType = mime.lookup(filePath) || 'application/octet-stream';
    res.setHeader('Content-Type', mimeType);
    
    // Stream the file
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
    
    fileStream.on('error', (error) => {
      console.error('Error streaming file:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Error reading file' });
      }
    });
    
  } catch (error) {
    console.error('Error serving binary file:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// Save file content endpoint
app.put('/api/projects/:projectName/file', authenticateToken, async (req, res) => {
  try {
    const { projectName } = req.params;
    const { filePath, content } = req.body;
    
    console.log('💾 File save request:', projectName, filePath);
    
    // Using fsPromises from import
    
    // Security check - ensure the path is safe and absolute
    if (!filePath || !path.isAbsolute(filePath)) {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    
    if (content === undefined) {
      return res.status(400).json({ error: 'Content is required' });
    }
    
    // Create backup of original file in external directory
    try {
      // Check if file exists before backing up
      await fsPromises.access(filePath);
      
      // Use configured backup directory or default
      const backupBaseDir = process.env.BACKUP_DIR || path.join(process.env.HOME || '/tmp', '.claudecode_backups');
      const backupDir = path.join(backupBaseDir, 'files');
      await fsPromises.mkdir(backupDir, { recursive: true });
      
      // Create backup filename with original path info
      const fileHash = crypto.createHash('md5').update(filePath).digest('hex').substring(0, 8);
      const originalFileName = path.basename(filePath);
      const backupPrefix = `${fileHash}_${originalFileName}`;
      const backupFileName = `${backupPrefix}.backup.${Date.now()}`;
      const backupPath = path.join(backupDir, backupFileName);
      
      await fsPromises.copyFile(filePath, backupPath);
      console.log('📋 Created backup:', backupPath);
      
      // Store original path info in a metadata file
      const metadataPath = path.join(backupDir, `${fileHash}.metadata.json`);
      const metadata = {
        originalPath: filePath,
        projectName: projectName,
        lastBackup: Date.now()
      };
      await fsPromises.writeFile(metadataPath, JSON.stringify(metadata, null, 2));
      
      // Clean up old backups
      await cleanupOldBackups(backupDir, backupPrefix);
    } catch (backupError) {
      if (backupError.code !== 'ENOENT') {
        console.warn('Could not create backup:', backupError.message);
      }
    }
    
    // Write the new content
    await fsPromises.writeFile(filePath, content, 'utf8');
    
    res.json({ 
      success: true, 
      path: filePath,
      message: 'File saved successfully' 
    });
  } catch (error) {
    console.error('Error saving file:', error);
    if (error.code === 'ENOENT') {
      res.status(404).json({ error: 'File or directory not found' });
    } else if (error.code === 'EACCES') {
      res.status(403).json({ error: 'Permission denied' });
    } else {
      res.status(500).json({ error: error.message });
    }
  }
});

app.get('/api/projects/:projectName/files', authenticateToken, async (req, res) => {
  try {
    
    // Using fsPromises from import
    
    // Use extractProjectDirectory to get the actual project path
    let actualPath;
    try {
      actualPath = await extractProjectDirectory(req.user.username, req.params.projectName);
    } catch (error) {
      console.error('Error extracting project directory:', error);
      // Fallback to simple dash replacement
      actualPath = req.params.projectName.replace(/-/g, '/');
    }
    
    // Check if path exists
    try {
      await fsPromises.access(actualPath);
    } catch (e) {
      return res.status(404).json({ error: `Project path not found: ${actualPath}` });
    }
    
    const files = await getFileTree(actualPath, 3, 0, true);
    const hiddenFiles = files.filter(f => f.name.startsWith('.'));
    res.json(files);
  } catch (error) {
    console.error('❌ File tree error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// WebSocket connection handler that routes based on URL path
wss.on('connection', (ws, request) => {
  const url = request.url;
  console.log('🔗 WebSocket connection established:', {
    url: url,
    userAgent: request.headers['user-agent'],
    origin: request.headers.origin,
    hasUser: !!request.user
  });
  
  // Get user info from request (set by verifyClient)
  const user = request.user;
  if (!user) {
    console.error('❌ No user info on WebSocket connection!');
    ws.close();
    return;
  }
  
  ws.user = user; // Store user info on the WebSocket object
  
  // Parse URL to get pathname without query parameters
  const urlObj = new URL(url, 'http://localhost');
  const pathname = urlObj.pathname;
  
  console.log('🚦 Routing WebSocket to handler:', {
    pathname,
    username: user.username
  });
  
  if (pathname === '/shell') {
    handleShellConnection(ws);
  } else if (pathname === '/ws') {
    handleChatConnection(ws);
  } else {
    console.log('❌ Unknown WebSocket path:', pathname);
    ws.close();
  }
});

// Handle chat WebSocket connections
function handleChatConnection(ws) {
  console.log('💬 Chat WebSocket connected for user:', ws.user.username);
  
  // Add to connected clients with user info for project updates
  connectedClients.set(ws, { username: ws.user.username });
  
  // Setup projects watcher for this user if not already setup
  if (!projectsWatchers.has(ws.user.username)) {
    setupProjectsWatcher(ws.user.username);
  }
  
  // Perform backup and restore check when user connects (page refresh)
  (async () => {
    try {
      console.log(`[WebSocket] User ${ws.user.username} connected, checking for missing projects...`);
      
      // First restore any missing projects from backup
      const restoredCount = await checkAndRestoreMissingProjects(ws.user.username);
      if (restoredCount > 0) {
        console.log(`[WebSocket] Restored ${restoredCount} missing projects for user ${ws.user.username}`);
      }
      
      // Then backup all current projects
      const backupCount = await backupAllUserProjects(ws.user.username);
      console.log(`[WebSocket] Backed up ${backupCount} projects for user ${ws.user.username}`);
      
    } catch (error) {
      console.error(`[WebSocket] Error during backup/restore for user ${ws.user.username}:`, error);
    }
  })();
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      
      if (data.type === 'claude-command') {
        console.log('💬 User message:', data.command || '[Continue/Resume]');
        console.log('📁 Project:', data.options?.projectPath || 'Unknown');
        console.log('🔄 Session:', data.options?.sessionId ? 'Resume' : 'New');
        
        // Pass username for project ownership tracking
        const optionsWithUser = {
          ...data.options,
          username: ws.user.username
        };
        
        await spawnClaude(data.command, optionsWithUser, ws);
      } else if (data.type === 'abort-session') {
        console.log('🛑 Abort session request:', data.sessionId);
        const success = abortClaudeSession(data.sessionId);
        ws.send(JSON.stringify({
          type: 'session-aborted',
          sessionId: data.sessionId,
          success
        }));
      }
    } catch (error) {
      console.error('❌ Chat WebSocket error:', error.message);
      ws.send(JSON.stringify({
        type: 'error',
        error: error.message
      }));
    }
  });
  
  ws.on('close', () => {
    console.log('🔌 Chat client disconnected for user:', ws.user?.username);
    // Remove from connected clients
    connectedClients.delete(ws);
    
    // Check if this was the last connection for this user
    let hasOtherConnections = false;
    connectedClients.forEach((clientInfo) => {
      if (clientInfo.username === ws.user?.username) {
        hasOtherConnections = true;
      }
    });
    
    // If no other connections for this user, stop their watcher
    if (!hasOtherConnections && ws.user?.username && projectsWatchers.has(ws.user.username)) {
      projectsWatchers.get(ws.user.username).close();
      projectsWatchers.delete(ws.user.username);
      console.log(`🛑 Stopped projects watcher for user: ${ws.user.username}`);
    }
  });
}

// Handle shell WebSocket connections
function handleShellConnection(ws) {
  console.log('🐚 Shell client connected:', {
    username: ws.user?.username,
    readyState: ws.readyState
  });
  let shellProcess = null;
  
  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message);
      console.log('📨 Shell message received:', {
        type: data.type,
        username: ws.user?.username,
        dataKeys: Object.keys(data)
      });
      
      if (data.type === 'init') {
        // Initialize shell with project path and session info
        const projectPath = data.projectPath || process.cwd();
        const sessionId = data.sessionId;
        const hasSession = data.hasSession;
        
        console.log('🚀 Starting shell:', {
          projectPath,
          sessionId,
          hasSession,
          cols: data.cols,
          rows: data.rows,
          username: ws.user?.username
        });
        
        // First send a welcome message
        const welcomeMsg = hasSession ? 
          `\x1b[36mResuming Claude session ${sessionId} in: ${projectPath}\x1b[0m\r\n` :
          `\x1b[36mStarting new Claude session in: ${projectPath}\x1b[0m\r\n`;
        
        ws.send(JSON.stringify({
          type: 'output',
          data: welcomeMsg
        }));
        
        try {
          // Build shell command that changes to project directory first, then runs claude
          let claudeCommand = 'claude';
          
          if (hasSession && sessionId) {
            // Try to resume session, but with fallback to new session if it fails
            claudeCommand = `claude --resume ${sessionId} || claude`;
          }
          
          // Create shell command that cds to the project directory first
          // Using bash -l to ensure login shell loads .bashrc/.bash_profile for NVM paths
          const shellCommand = `cd "${projectPath}" && ${claudeCommand}`;
          
          console.log('🔧 Executing shell command:', shellCommand);
          
          // First check if claude command exists
          const checkCommand = 'which claude || echo "CLAUDE_NOT_FOUND"';
          
          console.log('🔍 Checking for Claude CLI...');
          console.log('🖥️  Spawning PTY with command:', `bash -l -c "${checkCommand} && ${shellCommand}"`);
          
          // Start shell using PTY for proper terminal emulation
          // Use bash -l (login shell) to ensure .bashrc/.bash_profile are loaded
          shellProcess = pty.spawn('bash', ['-l', '-c', `${checkCommand} && ${shellCommand}`], {
            name: 'xterm-256color',
            cols: 80,
            rows: 24,
            cwd: process.env.HOME || '/', // Start from home directory
            env: { 
              ...process.env,
              TERM: 'xterm-256color',
              COLORTERM: 'truecolor',
              FORCE_COLOR: '3',
              // Override browser opening commands to echo URL for detection
              BROWSER: 'echo "OPEN_URL:"'
            }
          });
          
          console.log('🟢 Shell process started:', {
            pid: shellProcess.pid,
            cols: data.cols || 80,
            rows: data.rows || 24,
            command: shellCommand
          });
          
          // Track if we've seen the claude command check
          let claudeCheckDone = false;
          
          // Handle data output
          shellProcess.onData((data) => {
            if (ws.readyState === ws.OPEN) {
              let outputData = data;
              
              // Check for claude not found error
              if (!claudeCheckDone && data.includes('CLAUDE_NOT_FOUND')) {
                claudeCheckDone = true;
                console.error('❌ Claude command not found in PATH');
                ws.send(JSON.stringify({
                  type: 'output',
                  data: '\r\n\x1b[31mError: Claude CLI not found. Please ensure Claude CLI is installed and in your PATH.\x1b[0m\r\n'
                }));
                shellProcess.kill();
                return;
              }
              
              // Skip the "which claude" output
              if (!claudeCheckDone && data.includes('/claude')) {
                claudeCheckDone = true;
                return; // Don't send the which output to client
              }
              
              // Check for various URL opening patterns
              const patterns = [
                // Direct browser opening commands
                /(?:xdg-open|open|start)\s+(https?:\/\/[^\s\x1b\x07]+)/g,
                // BROWSER environment variable override
                /OPEN_URL:\s*(https?:\/\/[^\s\x1b\x07]+)/g,
                // Git and other tools opening URLs
                /Opening\s+(https?:\/\/[^\s\x1b\x07]+)/gi,
                // General URL patterns that might be opened
                /Visit:\s*(https?:\/\/[^\s\x1b\x07]+)/gi,
                /View at:\s*(https?:\/\/[^\s\x1b\x07]+)/gi,
                /Browse to:\s*(https?:\/\/[^\s\x1b\x07]+)/gi
              ];
              
              patterns.forEach(pattern => {
                let match;
                while ((match = pattern.exec(data)) !== null) {
                  const url = match[1];
                  console.log('🔗 Detected URL for opening:', url);
                  
                  // Send URL opening message to client
                  ws.send(JSON.stringify({
                    type: 'url_open',
                    url: url
                  }));
                  
                  // Replace the OPEN_URL pattern with a user-friendly message
                  if (pattern.source.includes('OPEN_URL')) {
                    outputData = outputData.replace(match[0], `🌐 Opening in browser: ${url}`);
                  }
                }
              });
              
              // Send regular output
              ws.send(JSON.stringify({
                type: 'output',
                data: outputData
              }));
            }
          });
          
          // Handle process exit
          shellProcess.onExit((exitCode) => {
            console.log('🔚 Shell process exited with code:', exitCode.exitCode, 'signal:', exitCode.signal);
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({
                type: 'output',
                data: `\r\n\x1b[33mProcess exited with code ${exitCode.exitCode}${exitCode.signal ? ` (${exitCode.signal})` : ''}\x1b[0m\r\n`
              }));
            }
            shellProcess = null;
          });
          
        } catch (spawnError) {
          console.error('❌ Error spawning process:', {
            error: spawnError.message,
            stack: spawnError.stack,
            username: ws.user?.username
          });
          ws.send(JSON.stringify({
            type: 'output',
            data: `\r\n\x1b[31mError: ${spawnError.message}\x1b[0m\r\n`
          }));
        }
        
      } else if (data.type === 'input') {
        // Send input to shell process
        if (shellProcess && shellProcess.write) {
          try {
            shellProcess.write(data.data);
          } catch (error) {
            console.error('Error writing to shell:', error);
          }
        } else {
          console.warn('No active shell process to send input to');
        }
      } else if (data.type === 'resize') {
        // Handle terminal resize
        if (shellProcess && shellProcess.resize) {
          console.log('Terminal resize requested:', data.cols, 'x', data.rows);
          shellProcess.resize(data.cols, data.rows);
        }
      }
    } catch (error) {
      console.error('❌ Shell WebSocket error:', error.message);
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({
          type: 'output',
          data: `\r\n\x1b[31mError: ${error.message}\x1b[0m\r\n`
        }));
      }
    }
  });
  
  ws.on('close', () => {
    console.log('🔌 Shell client disconnected:', {
      username: ws.user?.username,
      hadProcess: !!shellProcess
    });
    if (shellProcess && shellProcess.kill) {
      console.log('🔴 Killing shell process:', shellProcess.pid);
      shellProcess.kill();
    }
  });
  
  ws.on('error', (error) => {
    console.error('❌ Shell WebSocket error:', {
      error: error.message,
      username: ws.user?.username,
      code: error.code
    });
  });
}
// Audio transcription endpoint
app.post('/api/transcribe', authenticateToken, async (req, res) => {
  try {
    const multer = (await import('multer')).default;
    const upload = multer({ storage: multer.memoryStorage() });
    
    // Handle multipart form data
    upload.single('audio')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: 'Failed to process audio file' });
      }
      
      if (!req.file) {
        return res.status(400).json({ error: 'No audio file provided' });
      }
      
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: 'OpenAI API key not configured. Please set OPENAI_API_KEY in server environment.' });
      }
      
      try {
        // Create form data for OpenAI
        const FormData = (await import('form-data')).default;
        const formData = new FormData();
        formData.append('file', req.file.buffer, {
          filename: req.file.originalname,
          contentType: req.file.mimetype
        });
        formData.append('model', 'whisper-1');
        formData.append('response_format', 'json');
        formData.append('language', 'en');
        
        // Make request to OpenAI
        const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            ...formData.getHeaders()
          },
          body: formData
        });
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error?.message || `Whisper API error: ${response.status}`);
        }
        
        const data = await response.json();
        let transcribedText = data.text || '';
        
        // Check if enhancement mode is enabled
        const mode = req.body.mode || 'default';
        
        // If no transcribed text, return empty
        if (!transcribedText) {
          return res.json({ text: '' });
        }
        
        // If default mode, return transcribed text without enhancement
        if (mode === 'default') {
          return res.json({ text: transcribedText });
        }
        
        // Handle different enhancement modes
        try {
          const OpenAI = (await import('openai')).default;
          const openai = new OpenAI({ apiKey });
          
          let prompt, systemMessage, temperature = 0.7, maxTokens = 800;
          
          switch (mode) {
            case 'prompt':
              systemMessage = 'You are an expert prompt engineer who creates clear, detailed, and effective prompts.';
              prompt = `You are an expert prompt engineer. Transform the following rough instruction into a clear, detailed, and context-aware AI prompt.

Your enhanced prompt should:
1. Be specific and unambiguous
2. Include relevant context and constraints
3. Specify the desired output format
4. Use clear, actionable language
5. Include examples where helpful
6. Consider edge cases and potential ambiguities

Transform this rough instruction into a well-crafted prompt:
"${transcribedText}"

Enhanced prompt:`;
              break;
              
            case 'vibe':
            case 'instructions':
            case 'architect':
              systemMessage = 'You are a helpful assistant that formats ideas into clear, actionable instructions for AI agents.';
              temperature = 0.5; // Lower temperature for more controlled output
              prompt = `Transform the following idea into clear, well-structured instructions that an AI agent can easily understand and execute.

IMPORTANT RULES:
- Format as clear, step-by-step instructions
- Add reasonable implementation details based on common patterns
- Only include details directly related to what was asked
- Do NOT add features or functionality not mentioned
- Keep the original intent and scope intact
- Use clear, actionable language an agent can follow

Transform this idea into agent-friendly instructions:
"${transcribedText}"

Agent instructions:`;
              break;
              
            default:
              // No enhancement needed
              break;
          }
          
          // Only make GPT call if we have a prompt
          if (prompt) {
            const completion = await openai.chat.completions.create({
              model: 'gpt-4o-mini',
              messages: [
                { role: 'system', content: systemMessage },
                { role: 'user', content: prompt }
              ],
              temperature: temperature,
              max_tokens: maxTokens
            });
            
            transcribedText = completion.choices[0].message.content || transcribedText;
          }
          
        } catch (gptError) {
          console.error('GPT processing error:', gptError);
          // Fall back to original transcription if GPT fails
        }
        
        res.json({ text: transcribedText });
        
      } catch (error) {
        console.error('Transcription error:', error);
        res.status(500).json({ error: error.message });
      }
    });
  } catch (error) {
    console.error('Endpoint error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Image upload endpoint
app.post('/api/projects/:projectName/upload-images', authenticateToken, async (req, res) => {
  try {
    const multer = (await import('multer')).default;
    const path = (await import('path')).default;
    const fs = (await import('fs')).promises;
    const os = (await import('os')).default;
    
    // Configure multer for image uploads
    const storage = multer.diskStorage({
      destination: async (req, file, cb) => {
        const uploadDir = path.join(os.tmpdir(), 'claude-ui-uploads', req.user.username);
        await fs.mkdir(uploadDir, { recursive: true });
        cb(null, uploadDir);
      },
      filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, '_');
        cb(null, uniqueSuffix + '-' + sanitizedName);
      }
    });
    
    const fileFilter = (req, file, cb) => {
      const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new Error('Invalid file type. Only JPEG, PNG, GIF, WebP, and SVG are allowed.'));
      }
    };
    
    const upload = multer({
      storage,
      fileFilter,
      limits: {
        fileSize: 5 * 1024 * 1024, // 5MB
        files: 5
      }
    });
    
    // Handle multipart form data
    upload.array('images', 5)(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: err.message });
      }
      
      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No image files provided' });
      }
      
      try {
        // Process uploaded images
        const processedImages = await Promise.all(
          req.files.map(async (file) => {
            // Read file and convert to base64
            const buffer = await fs.readFile(file.path);
            const base64 = buffer.toString('base64');
            const mimeType = file.mimetype;
            
            // Clean up temp file immediately
            await fs.unlink(file.path);
            
            return {
              name: file.originalname,
              data: `data:${mimeType};base64,${base64}`,
              size: file.size,
              mimeType: mimeType
            };
          })
        );
        
        res.json({ images: processedImages });
      } catch (error) {
        console.error('Error processing images:', error);
        // Clean up any remaining files
        await Promise.all(req.files.map(f => fs.unlink(f.path).catch(() => {})));
        res.status(500).json({ error: 'Failed to process images' });
      }
    });
  } catch (error) {
    console.error('Error in image upload endpoint:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Serve React app for all other routes
app.get('*', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    res.sendFile(path.join(__dirname, '../dist/index.html'));
  } else {
    // In development, redirect to Vite dev server
    res.redirect(`http://localhost:${process.env.VITE_PORT || 3001}`);
  }
});

// Helper function to convert permissions to rwx format
function permToRwx(perm) {
  const r = perm & 4 ? 'r' : '-';
  const w = perm & 2 ? 'w' : '-';
  const x = perm & 1 ? 'x' : '-';
  return r + w + x;
}

async function getFileTree(dirPath, maxDepth = 3, currentDepth = 0, showHidden = true) {
  // Using fsPromises from import
  const items = [];
  
  try {
    const entries = await fsPromises.readdir(dirPath, { withFileTypes: true });
    
    for (const entry of entries) {
      // Debug: log all entries including hidden files
   
      
      // Skip only heavy build directories
      if (entry.name === 'node_modules' || 
          entry.name === 'dist' || 
          entry.name === 'build') continue;
      
      const itemPath = path.join(dirPath, entry.name);
      const item = {
        name: entry.name,
        path: itemPath,
        type: entry.isDirectory() ? 'directory' : 'file'
      };
      
      // Get file stats for additional metadata
      try {
        const stats = await fsPromises.stat(itemPath);
        item.size = stats.size;
        item.modified = stats.mtime.toISOString();
        
        // Convert permissions to rwx format
        const mode = stats.mode;
        const ownerPerm = (mode >> 6) & 7;
        const groupPerm = (mode >> 3) & 7;
        const otherPerm = mode & 7;
        item.permissions = ((mode >> 6) & 7).toString() + ((mode >> 3) & 7).toString() + (mode & 7).toString();
        item.permissionsRwx = permToRwx(ownerPerm) + permToRwx(groupPerm) + permToRwx(otherPerm);
      } catch (statError) {
        // If stat fails, provide default values
        item.size = 0;
        item.modified = null;
        item.permissions = '000';
        item.permissionsRwx = '---------';
      }
      
      if (entry.isDirectory() && currentDepth < maxDepth) {
        // Recursively get subdirectories but limit depth
        try {
          // Check if we can access the directory before trying to read it
          await fsPromises.access(item.path, fs.constants.R_OK);
          item.children = await getFileTree(item.path, maxDepth, currentDepth + 1, showHidden);
        } catch (e) {
          // Silently skip directories we can't access (permission denied, etc.)
          item.children = [];
        }
      }
      
      items.push(item);
    }
  } catch (error) {
    // Only log non-permission errors to avoid spam
    if (error.code !== 'EACCES' && error.code !== 'EPERM') {
      console.error('Error reading directory:', error);
    }
  }
  
  return items.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

const PORT = process.env.UI_PORT || process.env.PORT || 3000;

// Initialize database and start server
async function startServer() {
  try {
    // Initialize authentication database
    await initializeDatabase();
    console.log('✅ Database initialization skipped (testing)');
    
    server.listen(PORT, '0.0.0.0', async () => {
      console.log(`Claude Code UI server running on http://0.0.0.0:${PORT}`);
      
      // Initialize email service after server starts
      console.log('Initializing email service...');
      emailService.initializeTransporter();
      
      // Projects watchers are now setup per-user when they connect
      console.log('👀 Projects watchers will be setup per-user on connection');
      
      // Perform initial backup for all users
      try {
        const users = await projectDb.getAllUsers();
        console.log(`[Backup] Starting initial backup for ${users.length} users...`);
        
        for (const user of users) {
          const restoredCount = await checkAndRestoreMissingProjects(user.username);
          if (restoredCount > 0) {
            console.log(`[Startup] Restored ${restoredCount} missing projects for user ${user.username}`);
          }
          
          const backupCount = await backupAllUserProjects(user.username);
          console.log(`[Startup] Backed up ${backupCount} projects for user ${user.username}`);
        }
        
        console.log('[Backup] Initial backup completed for all users');
      } catch (error) {
        console.error('[Backup] Error during initial backup:', error);
      }
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
