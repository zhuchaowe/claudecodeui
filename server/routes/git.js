import express from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { promises as fs } from 'fs';
import { extractProjectDirectory } from '../projects.js';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { getUserById } from '../database/db.js';
import fetch from 'node-fetch';

// Get __dirname equivalent in ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const router = express.Router();
const execAsync = promisify(exec);

// Helper function to get the actual project path from the encoded project name
async function getActualProjectPath(projectName, username) {
  try {
    // Extract username from the session if not provided
    if (!username) {
      // Try to extract username from project name pattern
      // Project names follow pattern: -home-claude-projects-{username}-{project-path}
      const match = projectName.match(/^-home-claude-projects-([^-]+)-(.+)$/);
      if (match) {
        username = match[1];
      } else {
        throw new Error('Unable to determine username from project name');
      }
    }
    return await extractProjectDirectory(username, projectName);
  } catch (error) {
    console.error(`Error extracting project directory for ${projectName}:`, error);
    // Better fallback: reconstruct the full path
    if (projectName.startsWith('-home-claude-projects-')) {
      // Remove the leading dash and convert remaining dashes to slashes
      return projectName.substring(1).replace(/-/g, '/');
    }
    // Last resort fallback
    return projectName.replace(/-/g, '/');
  }
}

// Helper function to validate git repository
async function validateGitRepository(projectPath) {
  try {
    // Check if directory exists
    await fs.access(projectPath);
  } catch {
    throw new Error(`Project path not found: ${projectPath}`);
  }

  try {
    // Use --show-toplevel to get the root of the git repository
    const { stdout: gitRoot } = await execAsync('git rev-parse --show-toplevel', { cwd: projectPath });
    const normalizedGitRoot = path.resolve(gitRoot.trim());
    const normalizedProjectPath = path.resolve(projectPath);
    
    // Ensure the git root matches our project path (prevent using parent git repos)
    if (normalizedGitRoot !== normalizedProjectPath) {
      throw new Error(`Project directory is not a git repository. This directory is inside a git repository at ${normalizedGitRoot}, but git operations should be run from the repository root.`);
    }
  } catch (error) {
    if (error.message.includes('Project directory is not a git repository')) {
      throw error;
    }
    throw new Error('Not a git repository. This directory does not contain a .git folder. Initialize a git repository with "git init" to use source control features.');
  }
}

// Check git configuration
router.get('/check-config', async (req, res) => {
  const { project } = req.query;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.user?.username);
    
    // Check git user name and email
    let userName = '';
    let userEmail = '';
    
    try {
      const { stdout: name } = await execAsync('git config user.name', { cwd: projectPath });
      userName = name.trim();
    } catch (error) {
      // No local user.name configured
    }
    
    try {
      const { stdout: email } = await execAsync('git config user.email', { cwd: projectPath });
      userEmail = email.trim();
    } catch (error) {
      // No local user.email configured
    }
    
    // If no local config, check global
    if (!userName) {
      try {
        const { stdout: globalName } = await execAsync('git config --global user.name', { cwd: projectPath });
        userName = globalName.trim();
      } catch (error) {
        // No global user.name configured
      }
    }
    
    if (!userEmail) {
      try {
        const { stdout: globalEmail } = await execAsync('git config --global user.email', { cwd: projectPath });
        userEmail = globalEmail.trim();
      } catch (error) {
        // No global user.email configured
      }
    }
    
    res.json({
      hasConfig: !!(userName && userEmail),
      userName,
      userEmail
    });
  } catch (error) {
    console.error('Git config check error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Set git configuration
router.post('/set-config', async (req, res) => {
  const { project, userName, userEmail, scope = 'local' } = req.body;
  
  if (!project || !userName || !userEmail) {
    return res.status(400).json({ error: 'Project name, user name, and email are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.user?.username);
    
    // Validate git repository
    await validateGitRepository(projectPath);
    
    // Set git config
    const globalFlag = scope === 'global' ? '--global' : '';
    
    await execAsync(`git config ${globalFlag} user.name "${userName}"`, { cwd: projectPath });
    await execAsync(`git config ${globalFlag} user.email "${userEmail}"`, { cwd: projectPath });
    
    res.json({ 
      success: true, 
      message: `Git configuration set successfully (${scope})`,
      userName,
      userEmail
    });
  } catch (error) {
    console.error('Git set config error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get git status for a project
router.get('/status', async (req, res) => {
  const { project } = req.query;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.user?.username);
    console.log('Git status for project:', project, '-> path:', projectPath);
    
    // Validate git repository
    await validateGitRepository(projectPath);

    // Get current branch
    const { stdout: branch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath });
    
    // Get git status
    const { stdout: statusOutput } = await execAsync('git status --porcelain', { cwd: projectPath });
    
    const modified = [];
    const added = [];
    const deleted = [];
    const untracked = [];
    
    statusOutput.split('\n').forEach(line => {
      if (!line.trim()) return;
      
      const status = line.substring(0, 2);
      const file = line.substring(3);
      
      if (status === 'M ' || status === ' M' || status === 'MM') {
        modified.push(file);
      } else if (status === 'A ' || status === 'AM') {
        added.push(file);
      } else if (status === 'D ' || status === ' D') {
        deleted.push(file);
      } else if (status === '??') {
        untracked.push(file);
      }
    });
    
    res.json({
      branch: branch.trim(),
      modified,
      added,
      deleted,
      untracked
    });
  } catch (error) {
    console.error('Git status error:', error);
    res.json({ 
      error: error.message.includes('not a git repository') || error.message.includes('Project directory is not a git repository') 
        ? error.message 
        : 'Git operation failed',
      details: error.message.includes('not a git repository') || error.message.includes('Project directory is not a git repository')
        ? error.message
        : `Failed to get git status: ${error.message}`
    });
  }
});

// Get diff for a specific file
router.get('/diff', async (req, res) => {
  const { project, file } = req.query;
  
  if (!project || !file) {
    return res.status(400).json({ error: 'Project name and file path are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.user?.username);
    
    // Validate git repository
    await validateGitRepository(projectPath);
    
    // Check if file is untracked
    const { stdout: statusOutput } = await execAsync(`git status --porcelain "${file}"`, { cwd: projectPath });
    const isUntracked = statusOutput.startsWith('??');
    
    let diff;
    if (isUntracked) {
      // For untracked files, show the entire file content as additions
      const fileContent = await fs.readFile(path.join(projectPath, file), 'utf-8');
      const lines = fileContent.split('\n');
      diff = `--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n` + 
             lines.map(line => `+${line}`).join('\n');
    } else {
      // Get diff for tracked files
      const { stdout } = await execAsync(`git diff HEAD -- "${file}"`, { cwd: projectPath });
      diff = stdout || '';
      
      // If no unstaged changes, check for staged changes
      if (!diff) {
        const { stdout: stagedDiff } = await execAsync(`git diff --cached -- "${file}"`, { cwd: projectPath });
        diff = stagedDiff;
      }
    }
    
    res.json({ diff });
  } catch (error) {
    console.error('Git diff error:', error);
    res.json({ error: error.message });
  }
});

// Commit changes
router.post('/commit', async (req, res) => {
  const { project, message, files } = req.body;
  
  if (!project || !message || !files || files.length === 0) {
    return res.status(400).json({ error: 'Project name, commit message, and files are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.user?.username);
    
    // Validate git repository
    await validateGitRepository(projectPath);
    
    // Stage selected files
    for (const file of files) {
      await execAsync(`git add "${file}"`, { cwd: projectPath });
    }
    
    // Commit with message
    const { stdout } = await execAsync(`git commit -m "${message.replace(/"/g, '\\"')}"`, { cwd: projectPath });
    
    res.json({ success: true, output: stdout });
  } catch (error) {
    console.error('Git commit error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get list of branches
router.get('/branches', async (req, res) => {
  const { project } = req.query;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.user?.username);
    console.log('Git branches for project:', project, '-> path:', projectPath);
    
    // Validate git repository
    await validateGitRepository(projectPath);
    
    // Get all branches
    const { stdout } = await execAsync('git branch -a', { cwd: projectPath });
    
    // Parse branches
    const branches = stdout
      .split('\n')
      .map(branch => branch.trim())
      .filter(branch => branch && !branch.includes('->')) // Remove empty lines and HEAD pointer
      .map(branch => {
        // Remove asterisk from current branch
        if (branch.startsWith('* ')) {
          return branch.substring(2);
        }
        // Remove remotes/ prefix
        if (branch.startsWith('remotes/origin/')) {
          return branch.substring(15);
        }
        return branch;
      })
      .filter((branch, index, self) => self.indexOf(branch) === index); // Remove duplicates
    
    res.json({ branches });
  } catch (error) {
    console.error('Git branches error:', error);
    res.json({ error: error.message });
  }
});

// Checkout branch
router.post('/checkout', async (req, res) => {
  const { project, branch } = req.body;
  
  if (!project || !branch) {
    return res.status(400).json({ error: 'Project name and branch are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.user?.username);
    
    // Checkout the branch
    const { stdout } = await execAsync(`git checkout "${branch}"`, { cwd: projectPath });
    
    res.json({ success: true, output: stdout });
  } catch (error) {
    console.error('Git checkout error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create new branch
router.post('/create-branch', async (req, res) => {
  const { project, branch } = req.body;
  
  if (!project || !branch) {
    return res.status(400).json({ error: 'Project name and branch name are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.user?.username);
    
    // Create and checkout new branch
    const { stdout } = await execAsync(`git checkout -b "${branch}"`, { cwd: projectPath });
    
    res.json({ success: true, output: stdout });
  } catch (error) {
    console.error('Git create branch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get recent commits
router.get('/commits', async (req, res) => {
  const { project, limit = 10 } = req.query;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.user?.username);
    
    // Get commit log with stats
    const { stdout } = await execAsync(
      `git log --pretty=format:'%H|%an|%ae|%ad|%s' --date=relative -n ${limit}`,
      { cwd: projectPath }
    );
    
    const commits = stdout
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const [hash, author, email, date, ...messageParts] = line.split('|');
        return {
          hash,
          author,
          email,
          date,
          message: messageParts.join('|')
        };
      });
    
    // Get stats for each commit
    for (const commit of commits) {
      try {
        const { stdout: stats } = await execAsync(
          `git show --stat --format='' ${commit.hash}`,
          { cwd: projectPath }
        );
        commit.stats = stats.trim().split('\n').pop(); // Get the summary line
      } catch (error) {
        commit.stats = '';
      }
    }
    
    res.json({ commits });
  } catch (error) {
    console.error('Git commits error:', error);
    res.json({ error: error.message });
  }
});

// Get diff for a specific commit
router.get('/commit-diff', async (req, res) => {
  const { project, commit } = req.query;
  
  if (!project || !commit) {
    return res.status(400).json({ error: 'Project name and commit hash are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.user?.username);
    
    // Get diff for the commit
    const { stdout } = await execAsync(
      `git show ${commit}`,
      { cwd: projectPath }
    );
    
    res.json({ diff: stdout });
  } catch (error) {
    console.error('Git commit diff error:', error);
    res.json({ error: error.message });
  }
});

// Generate commit message based on staged changes
router.post('/generate-commit-message', async (req, res) => {
  const { project, files } = req.body;
  
  if (!project || !files || files.length === 0) {
    return res.status(400).json({ error: 'Project name and files are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.user?.username);
    
    // Get diff for selected files
    let combinedDiff = '';
    for (const file of files) {
      try {
        const { stdout } = await execAsync(
          `git diff HEAD -- "${file}"`,
          { cwd: projectPath }
        );
        if (stdout) {
          combinedDiff += `\n--- ${file} ---\n${stdout}`;
        }
      } catch (error) {
        console.error(`Error getting diff for ${file}:`, error);
      }
    }
    
    // Use AI to generate commit message (simple implementation)
    // In a real implementation, you might want to use GPT or Claude API
    const message = generateSimpleCommitMessage(files, combinedDiff);
    
    res.json({ message });
  } catch (error) {
    console.error('Generate commit message error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Simple commit message generator (can be replaced with AI)
function generateSimpleCommitMessage(files, diff) {
  const fileCount = files.length;
  const isMultipleFiles = fileCount > 1;
  
  // Analyze the diff to determine the type of change
  const additions = (diff.match(/^\+[^+]/gm) || []).length;
  const deletions = (diff.match(/^-[^-]/gm) || []).length;
  
  // Determine the primary action
  let action = 'Update';
  if (additions > 0 && deletions === 0) {
    action = 'Add';
  } else if (deletions > 0 && additions === 0) {
    action = 'Remove';
  } else if (additions > deletions * 2) {
    action = 'Enhance';
  } else if (deletions > additions * 2) {
    action = 'Refactor';
  }
  
  // Generate message based on files
  if (isMultipleFiles) {
    const components = new Set(files.map(f => {
      const parts = f.split('/');
      return parts[parts.length - 2] || parts[0];
    }));
    
    if (components.size === 1) {
      return `${action} ${[...components][0]} component`;
    } else {
      return `${action} multiple components`;
    }
  } else {
    const fileName = files[0].split('/').pop();
    const componentName = fileName.replace(/\.(jsx?|tsx?|css|scss)$/, '');
    return `${action} ${componentName}`;
  }
}

// Get remote status (ahead/behind commits with smart remote detection)
router.get('/remote-status', async (req, res) => {
  const { project } = req.query;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.user?.username);
    await validateGitRepository(projectPath);

    // Get current branch
    const { stdout: currentBranch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath });
    const branch = currentBranch.trim();

    // Check if there's a remote tracking branch (smart detection)
    let trackingBranch;
    let remoteName;
    try {
      const { stdout } = await execAsync(`git rev-parse --abbrev-ref ${branch}@{upstream}`, { cwd: projectPath });
      trackingBranch = stdout.trim();
      remoteName = trackingBranch.split('/')[0]; // Extract remote name (e.g., "origin/main" -> "origin")
    } catch (error) {
      // No upstream branch configured - but check if we have remotes
      let hasRemote = false;
      let remoteName = null;
      try {
        const { stdout } = await execAsync('git remote', { cwd: projectPath });
        const remotes = stdout.trim().split('\n').filter(r => r.trim());
        if (remotes.length > 0) {
          hasRemote = true;
          remoteName = remotes.includes('origin') ? 'origin' : remotes[0];
        }
      } catch (remoteError) {
        // No remotes configured
      }
      
      return res.json({ 
        hasRemote,
        hasUpstream: false,
        branch,
        remoteName,
        message: 'No remote tracking branch configured'
      });
    }

    // Get ahead/behind counts
    const { stdout: countOutput } = await execAsync(
      `git rev-list --count --left-right ${trackingBranch}...HEAD`,
      { cwd: projectPath }
    );
    
    const [behind, ahead] = countOutput.trim().split('\t').map(Number);

    res.json({
      hasRemote: true,
      hasUpstream: true,
      branch,
      remoteBranch: trackingBranch,
      remoteName,
      ahead: ahead || 0,
      behind: behind || 0,
      isUpToDate: ahead === 0 && behind === 0
    });
  } catch (error) {
    console.error('Git remote status error:', error);
    res.json({ error: error.message });
  }
});

// Fetch from remote (using smart remote detection)
router.post('/fetch', async (req, res) => {
  const { project } = req.body;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.user?.username);
    await validateGitRepository(projectPath);

    // Get current branch and its upstream remote
    const { stdout: currentBranch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath });
    const branch = currentBranch.trim();

    let remoteName = 'origin'; // fallback
    try {
      const { stdout } = await execAsync(`git rev-parse --abbrev-ref ${branch}@{upstream}`, { cwd: projectPath });
      remoteName = stdout.trim().split('/')[0]; // Extract remote name
    } catch (error) {
      // No upstream, try to fetch from origin anyway
      console.log('No upstream configured, using origin as fallback');
    }

    const { stdout } = await execAsync(`git fetch ${remoteName}`, { cwd: projectPath });
    
    res.json({ success: true, output: stdout || 'Fetch completed successfully', remoteName });
  } catch (error) {
    console.error('Git fetch error:', error);
    res.status(500).json({ 
      error: 'Fetch failed', 
      details: error.message.includes('Could not resolve hostname') 
        ? 'Unable to connect to remote repository. Check your internet connection.'
        : error.message.includes('fatal: \'origin\' does not appear to be a git repository')
        ? 'No remote repository configured. Add a remote with: git remote add origin <url>'
        : error.message
    });
  }
});

// Pull from remote (fetch + merge using smart remote detection)
router.post('/pull', async (req, res) => {
  const { project, credentials } = req.body;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.user?.username);
    await validateGitRepository(projectPath);

    // Get current branch and its upstream remote
    const { stdout: currentBranch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath });
    const branch = currentBranch.trim();

    let remoteName = 'origin'; // fallback
    let remoteBranch = branch; // fallback
    try {
      const { stdout } = await execAsync(`git rev-parse --abbrev-ref ${branch}@{upstream}`, { cwd: projectPath });
      const tracking = stdout.trim();
      remoteName = tracking.split('/')[0]; // Extract remote name
      remoteBranch = tracking.split('/').slice(1).join('/'); // Extract branch name
    } catch (error) {
      // No upstream, use fallback
      console.log('No upstream configured, using origin/branch as fallback');
    }

    // Check if we should setup credential helper store
    let setupCredentialHelper = false;
    let autoCredentials = null;
    
    // Get remote URL to determine if we need credentials
    let remoteUrl = '';
    try {
      const { stdout: urlOutput } = await execAsync(`git remote get-url ${remoteName}`, { cwd: projectPath });
      remoteUrl = urlOutput.trim();
    } catch (error) {
      console.error('Failed to get remote URL:', error);
    }

    // Check if we should try to use GitHub OAuth token
    if (!credentials && req.user?.id && remoteUrl.includes('github.com')) {
      try {
        const user = await getUserById(req.user.id);
        if (user.github_token && user.github_username) {
          // Extract repository owner from remote URL
          let repoOwner = null;
          
          if (remoteUrl.includes('github.com/')) {
            const match = remoteUrl.match(/github\.com\/([^\/]+)\//);
            if (match) repoOwner = match[1];
          } else if (remoteUrl.includes('git@github.com:')) {
            const match = remoteUrl.match(/git@github\.com:([^\/]+)\//);
            if (match) repoOwner = match[1];
          }
          
          if (repoOwner && repoOwner.toLowerCase() === user.github_username.toLowerCase()) {
            autoCredentials = {
              username: user.github_username,
              token: user.github_token
            };
            setupCredentialHelper = true;
          }
        }
      } catch (error) {
        console.error('Error checking GitHub OAuth token:', error);
      }
    }

    // Use provided credentials or auto credentials for setup
    const finalCredentials = credentials || autoCredentials;
    
    if (finalCredentials && setupCredentialHelper && remoteUrl.includes('https://')) {
      console.log('Setting up git credential helper store for future operations...');
      
      try {
        // Set up credential helper store
        await execAsync('git config credential.helper store', { cwd: projectPath });
        
        // Create credentials for the specific URL
        const homeDir = process.env.HOME || process.env.USERPROFILE;
        const credentialsFile = path.join(homeDir, '.git-credentials');
        
        // Parse the URL to create credential entry
        const urlParts = remoteUrl.match(/https:\/\/(.+)/);
        if (urlParts) {
          const credentialEntry = `https://${finalCredentials.username}:${finalCredentials.token}@${urlParts[1]}\n`;
          
          // Append to git-credentials file (create if doesn't exist)
          try {
            // Read existing credentials to avoid duplicates
            let existingCredentials = '';
            try {
              existingCredentials = await fs.readFile(credentialsFile, 'utf-8');
            } catch (error) {
              // File doesn't exist, that's fine
            }
            
            // Check if credential already exists
            if (!existingCredentials.includes(urlParts[1])) {
              await fs.appendFile(credentialsFile, credentialEntry, { mode: 0o600 });
              console.log('Credentials stored in git credential helper');
            } else {
              console.log('Credentials already exist in git credential helper');
            }
          } catch (error) {
            console.error('Failed to store credentials:', error);
            // Continue without storing, pull might still work
          }
        }
      } catch (error) {
        console.error('Failed to setup credential helper:', error);
        // Continue without credential helper
      }
    }

    let pullOutput;
    try {
      const { stdout } = await execAsync(`git pull ${remoteName} ${remoteBranch}`, { cwd: projectPath });
      pullOutput = stdout;
    } catch (pullError) {
      // Check if the error is about divergent branches
      if (pullError.message.includes('divergent branches') || 
          pullError.message.includes('need to specify how to reconcile them')) {
        console.log('Detected divergent branches, auto-configuring pull strategy...');
        
        try {
          // Auto-configure git to use merge strategy for pulls
          await execAsync('git config pull.rebase false', { cwd: projectPath });
          console.log('Successfully configured git pull.rebase = false');
          
          // Retry the pull operation
          const { stdout } = await execAsync(`git pull ${remoteName} ${remoteBranch}`, { cwd: projectPath });
          pullOutput = stdout;
        } catch (retryError) {
          // If retry also fails, throw the retry error
          throw retryError;
        }
      } else {
        // If it's not a divergent branches error, throw the original error
        throw pullError;
      }
    }
    
    res.json({ 
      success: true, 
      output: pullOutput || 'Pull completed successfully', 
      remoteName,
      remoteBranch,
      credentialHelperConfigured: setupCredentialHelper
    });
  } catch (error) {
    console.error('Git pull error:', error);
    
    // Enhanced error handling for common pull scenarios
    let errorMessage = 'Pull failed';
    let details = error.message;
    
    if (error.message.includes('CONFLICT')) {
      errorMessage = 'Merge conflicts detected';
      details = 'Pull created merge conflicts. Please resolve conflicts manually in the editor, then commit the changes.';
    } else if (error.message.includes('Please commit your changes or stash them')) {
      errorMessage = 'Uncommitted changes detected';  
      details = 'Please commit or stash your local changes before pulling.';
    } else if (error.message.includes('Could not resolve hostname')) {
      errorMessage = 'Network error';
      details = 'Unable to connect to remote repository. Check your internet connection.';
    } else if (error.message.includes('fatal: \'origin\' does not appear to be a git repository')) {
      errorMessage = 'Remote not configured';
      details = 'No remote repository configured. Add a remote with: git remote add origin <url>';
    } else if (error.message.includes('diverged')) {
      errorMessage = 'Branches have diverged';
      details = 'Your local branch and remote branch have diverged. Consider fetching first to review changes.';
    } else if (error.message.includes('Authentication failed') || 
               error.message.includes('could not read Username') ||
               error.message.includes('could not read Password')) {
      errorMessage = 'Authentication required';
      details = 'Authentication is required to pull from this repository.';
      
      // Try to determine the remote type
      let remoteType = 'generic';
      if (remoteUrl.includes('github.com')) {
        remoteType = 'github';
        details = 'GitHub requires authentication. Please provide your credentials.';
      } else if (remoteUrl.includes('gitlab.com')) {
        remoteType = 'gitlab';
      } else if (remoteUrl.includes('bitbucket.org')) {
        remoteType = 'bitbucket';
      }
      
      res.status(401).json({ 
        error: errorMessage, 
        details: details,
        requiresAuth: true,
        remoteType: remoteType
      });
      return;
    }
    
    res.status(500).json({ 
      error: errorMessage, 
      details: details
    });
  }
});

// Push commits to remote repository
router.post('/push', async (req, res) => {
  const { project, credentials } = req.body;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.user?.username);
    await validateGitRepository(projectPath);

    // Get current branch and its upstream remote
    const { stdout: currentBranch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath });
    const branch = currentBranch.trim();

    let remoteName = 'origin'; // fallback
    let remoteBranch = branch; // fallback
    try {
      const { stdout } = await execAsync(`git rev-parse --abbrev-ref ${branch}@{upstream}`, { cwd: projectPath });
      const tracking = stdout.trim();
      remoteName = tracking.split('/')[0]; // Extract remote name
      remoteBranch = tracking.split('/').slice(1).join('/'); // Extract branch name
    } catch (error) {
      // No upstream, use fallback
      console.log('No upstream configured, using origin/branch as fallback');
    }

    // Get remote URL to determine if we need credentials
    let remoteUrl = '';
    try {
      const { stdout: urlOutput } = await execAsync(`git remote get-url ${remoteName}`, { cwd: projectPath });
      remoteUrl = urlOutput.trim();
    } catch (error) {
      console.error('Failed to get remote URL:', error);
    }

    // Check if we should try to use GitHub OAuth token
    let autoCredentials = null;
    console.log('Checking for auto OAuth credentials...');
    
    if (!credentials && req.user?.id && remoteUrl.includes('github.com')) {
      try {
        // Get user's GitHub token from database
        const user = await getUserById(req.user.id);
        
        if (user.github_token && user.github_username) {
          // Extract repository owner from remote URL
          let repoOwner = null;
          
          // Handle both HTTPS and SSH URLs
          if (remoteUrl.includes('github.com/')) {
            // HTTPS: https://github.com/owner/repo.git
            const match = remoteUrl.match(/github\.com\/([^\/]+)\//);
            if (match) repoOwner = match[1];
          } else if (remoteUrl.includes('git@github.com:')) {
            // SSH: git@github.com:owner/repo.git
            const match = remoteUrl.match(/git@github\.com:([^\/]+)\//);
            if (match) repoOwner = match[1];
          }
          
          // Check if the repository belongs to the authenticated user
          if (repoOwner && repoOwner.toLowerCase() === user.github_username.toLowerCase()) {
            console.log('Repository belongs to authenticated user, using OAuth token');
            autoCredentials = {
              username: user.github_username,
              token: user.github_token
            };
          }
        }
      } catch (error) {
        console.error('Error checking GitHub OAuth token:', error);
      }
    }

    // Use provided credentials or auto credentials
    const finalCredentials = credentials || autoCredentials;
    
    // If we have credentials and it's an HTTPS repository, set up credential helper
    if (finalCredentials && remoteUrl.includes('https://')) {
      console.log('Setting up credentials for push...');
      
      try {
        // Set up credential helper store temporarily
        await execAsync('git config credential.helper store', { cwd: projectPath });
        
        // Create credentials for the specific URL
        const homeDir = process.env.HOME || process.env.USERPROFILE;
        const credentialsFile = path.join(homeDir, '.git-credentials');
        
        // Parse the URL to create credential entry
        const urlParts = remoteUrl.match(/https:\/\/(.+)/);
        if (urlParts) {
          const credentialEntry = `https://${finalCredentials.username}:${finalCredentials.token || finalCredentials.password}@${urlParts[1]}\n`;
          
          // Append to git-credentials file (create if doesn't exist)
          try {
            // Read existing credentials to avoid duplicates
            let existingCredentials = '';
            try {
              existingCredentials = await fs.readFile(credentialsFile, 'utf-8');
            } catch (error) {
              // File doesn't exist, that's fine
            }
            
            // Check if credential already exists for this host
            const hostMatch = urlParts[1].split('/')[0];
            if (!existingCredentials.includes(hostMatch)) {
              await fs.appendFile(credentialsFile, credentialEntry, { mode: 0o600 });
              console.log('Credentials stored in git credential helper');
            } else {
              console.log('Credentials already exist in git credential helper');
            }
          } catch (error) {
            console.error('Failed to store credentials:', error);
            // Continue without storing, push might still work
          }
        }
      } catch (error) {
        console.error('Failed to setup credential helper:', error);
        // Continue without credential helper
      }
    }

    // Try to push using the credential helper
    const { stdout } = await execAsync(`git push ${remoteName} ${remoteBranch}`, { 
      cwd: projectPath,
      timeout: 30000, // 30 second timeout
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0' // Disable terminal prompts
      }
    });
    
    res.json({ 
      success: true, 
      output: stdout || 'Push completed successfully', 
      remoteName,
      remoteBranch
    });
  } catch (error) {
    console.error('Git push error:', error.message);
    
    // Enhanced error handling for common push scenarios
    let errorMessage = 'Push failed';
    let details = error.message;
    let remoteName = 'origin';
    
    if (error.message.includes('rejected')) {
      errorMessage = 'Push rejected';
      details = 'The remote has newer commits. Pull first to merge changes before pushing.';
    } else if (error.message.includes('non-fast-forward')) {
      errorMessage = 'Non-fast-forward push';
      details = 'Your branch is behind the remote. Pull the latest changes first.';
    } else if (error.message.includes('Could not resolve hostname')) {
      errorMessage = 'Network error';
      details = 'Unable to connect to remote repository. Check your internet connection.';
    } else if (error.message.includes('fatal: \'origin\' does not appear to be a git repository')) {
      errorMessage = 'Remote not configured';
      details = 'No remote repository configured. Add a remote with: git remote add origin <url>';
    } else if (error.message.includes('Permission denied') || 
               error.message.includes('Authentication failed') ||
               error.message.includes('could not read Username') ||
               error.message.includes('could not read Password') ||
               error.message.includes('terminal prompts disabled') ||
               error.message.includes('fatal: Authentication failed') ||
               error.message.includes('remote: Invalid username or password') ||
               error.message.includes('fatal: unable to access')) {
      errorMessage = 'Authentication required';
      details = 'Authentication is required to push to this repository.';
      
      // Try to determine the remote type from the URL
      let remoteType = 'generic';
      try {
        const projectPath = await getActualProjectPath(project, req.user?.username);
        const { stdout: urlOutput } = await execAsync(`git remote get-url ${remoteName}`, { cwd: projectPath });
        const remoteUrl = urlOutput.trim();
        
        if (remoteUrl.includes('github.com')) {
          remoteType = 'github';
          details = 'GitHub requires a Personal Access Token for authentication. Username should be your GitHub username, and password should be your Personal Access Token.';
        } else if (remoteUrl.includes('gitlab.com')) {
          remoteType = 'gitlab';
          details = 'GitLab requires a Personal Access Token or password for authentication.';
        } else if (remoteUrl.includes('bitbucket.org')) {
          remoteType = 'bitbucket';
          details = 'Bitbucket requires an App Password for authentication.';
        }
      } catch (urlError) {
        // Ignore URL detection errors
      }
      
      res.status(401).json({ 
        error: errorMessage, 
        details: details,
        requiresAuth: true,
        remoteType: remoteType
      });
      return;
    } else if (error.message.includes('no upstream branch')) {
      errorMessage = 'No upstream branch';
      details = 'No upstream branch configured. Use: git push --set-upstream origin <branch>';
    }
    
    res.status(500).json({ 
      error: errorMessage, 
      details: details
    });
  }
});

// Publish branch to remote (set upstream and push)
router.post('/publish', async (req, res) => {
  const { project, branch } = req.body;
  
  if (!project || !branch) {
    return res.status(400).json({ error: 'Project name and branch are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.user?.username);
    await validateGitRepository(projectPath);

    // Get current branch to verify it matches the requested branch
    const { stdout: currentBranch } = await execAsync('git rev-parse --abbrev-ref HEAD', { cwd: projectPath });
    const currentBranchName = currentBranch.trim();
    
    if (currentBranchName !== branch) {
      return res.status(400).json({ 
        error: `Branch mismatch. Current branch is ${currentBranchName}, but trying to publish ${branch}` 
      });
    }

    // Check if remote exists
    let remoteName = 'origin';
    try {
      const { stdout } = await execAsync('git remote', { cwd: projectPath });
      const remotes = stdout.trim().split('\n').filter(r => r.trim());
      if (remotes.length === 0) {
        return res.status(400).json({ 
          error: 'No remote repository configured. Add a remote with: git remote add origin <url>' 
        });
      }
      remoteName = remotes.includes('origin') ? 'origin' : remotes[0];
    } catch (error) {
      return res.status(400).json({ 
        error: 'No remote repository configured. Add a remote with: git remote add origin <url>' 
      });
    }

    // Publish the branch (set upstream and push)
    const { stdout } = await execAsync(`git push --set-upstream ${remoteName} ${branch}`, { cwd: projectPath });
    
    res.json({ 
      success: true, 
      output: stdout || 'Branch published successfully', 
      remoteName,
      branch
    });
  } catch (error) {
    console.error('Git publish error:', error);
    
    // Enhanced error handling for common publish scenarios
    let errorMessage = 'Publish failed';
    let details = error.message;
    
    if (error.message.includes('rejected')) {
      errorMessage = 'Publish rejected';
      details = 'The remote branch already exists and has different commits. Use push instead.';
    } else if (error.message.includes('Could not resolve hostname')) {
      errorMessage = 'Network error';
      details = 'Unable to connect to remote repository. Check your internet connection.';
    } else if (error.message.includes('Permission denied')) {
      errorMessage = 'Authentication failed';
      details = 'Permission denied. Check your credentials or SSH keys.';
    } else if (error.message.includes('fatal:') && error.message.includes('does not appear to be a git repository')) {
      errorMessage = 'Remote not configured';
      details = 'Remote repository not properly configured. Check your remote URL.';
    }
    
    res.status(500).json({ 
      error: errorMessage, 
      details: details
    });
  }
});

// Discard changes for a specific file
router.post('/discard', async (req, res) => {
  const { project, file } = req.body;
  
  if (!project || !file) {
    return res.status(400).json({ error: 'Project name and file path are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.user?.username);
    await validateGitRepository(projectPath);

    // Check file status to determine correct discard command
    const { stdout: statusOutput } = await execAsync(`git status --porcelain "${file}"`, { cwd: projectPath });
    
    if (!statusOutput.trim()) {
      return res.status(400).json({ error: 'No changes to discard for this file' });
    }

    const status = statusOutput.substring(0, 2);
    
    if (status === '??') {
      // Untracked file - delete it
      await fs.unlink(path.join(projectPath, file));
    } else if (status.includes('M') || status.includes('D')) {
      // Modified or deleted file - restore from HEAD
      await execAsync(`git restore "${file}"`, { cwd: projectPath });
    } else if (status.includes('A')) {
      // Added file - unstage it
      await execAsync(`git reset HEAD "${file}"`, { cwd: projectPath });
    }
    
    res.json({ success: true, message: `Changes discarded for ${file}` });
  } catch (error) {
    console.error('Git discard error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete untracked file
router.post('/delete-untracked', async (req, res) => {
  const { project, file } = req.body;
  
  if (!project || !file) {
    return res.status(400).json({ error: 'Project name and file path are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.user?.username);
    await validateGitRepository(projectPath);

    // Check if file is actually untracked
    const { stdout: statusOutput } = await execAsync(`git status --porcelain "${file}"`, { cwd: projectPath });
    
    if (!statusOutput.trim()) {
      return res.status(400).json({ error: 'File is not untracked or does not exist' });
    }

    const status = statusOutput.substring(0, 2);
    
    if (status !== '??') {
      return res.status(400).json({ error: 'File is not untracked. Use discard for tracked files.' });
    }

    // Delete the untracked file
    await fs.unlink(path.join(projectPath, file));
    
    res.json({ success: true, message: `Untracked file ${file} deleted successfully` });
  } catch (error) {
    console.error('Git delete untracked error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get list of tags
router.get('/tags', async (req, res) => {
  const { project } = req.query;
  
  if (!project) {
    return res.status(400).json({ error: 'Project name is required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.user?.username);
    console.log('Git tags for project:', project, '-> path:', projectPath);
    
    // Validate git repository
    await validateGitRepository(projectPath);
    
    // Get all tags with their commit info
    const { stdout: tagOutput } = await execAsync('git tag -l --sort=-version:refname', { cwd: projectPath });
    
    const tags = [];
    if (tagOutput.trim()) {
      const tagNames = tagOutput.trim().split('\n');
      
      // Get additional info for each tag
      for (const tagName of tagNames) {
        try {
          // Get tag commit hash and date
          const { stdout: tagInfo } = await execAsync(
            `git log -1 --format="%H|%an|%ae|%ad|%s" --date=relative ${tagName}`,
            { cwd: projectPath }
          );
          
          if (tagInfo.trim()) {
            const [hash, author, email, date, ...messageParts] = tagInfo.trim().split('|');
            tags.push({
              name: tagName,
              hash,
              author,
              email,
              date,
              message: messageParts.join('|')
            });
          }
        } catch (error) {
          console.error(`Error getting info for tag ${tagName}:`, error);
          // Add basic tag info if detailed info fails
          tags.push({
            name: tagName,
            hash: '',
            author: '',
            email: '',
            date: '',
            message: ''
          });
        }
      }
    }
    
    res.json({ tags });
  } catch (error) {
    console.error('Git tags error:', error);
    res.json({ error: error.message });
  }
});

// Create new tag
router.post('/create-tag', async (req, res) => {
  const { project, tagName, message, commitHash } = req.body;
  
  if (!project || !tagName) {
    return res.status(400).json({ error: 'Project name and tag name are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.user?.username);
    
    // Validate git repository
    await validateGitRepository(projectPath);
    
    // Create tag command
    let tagCommand;
    if (message) {
      // Annotated tag with message
      const target = commitHash || 'HEAD';
      tagCommand = `git tag -a "${tagName}" -m "${message.replace(/"/g, '\\"')}" ${target}`;
    } else {
      // Lightweight tag
      const target = commitHash || 'HEAD';
      tagCommand = `git tag "${tagName}" ${target}`;
    }
    
    const { stdout } = await execAsync(tagCommand, { cwd: projectPath });
    
    res.json({ success: true, output: stdout || 'Tag created successfully', tagName });
  } catch (error) {
    console.error('Git create tag error:', error);
    
    let errorMessage = 'Tag creation failed';
    let details = error.message;
    
    if (error.message.includes('already exists')) {
      errorMessage = 'Tag already exists';
      details = `A tag named "${tagName}" already exists. Choose a different name.`;
    } else if (error.message.includes('not a valid object name')) {
      errorMessage = 'Invalid commit';
      details = 'The specified commit hash is not valid.';
    }
    
    res.status(500).json({ 
      error: errorMessage, 
      details: details
    });
  }
});

// Delete tag
router.post('/delete-tag', async (req, res) => {
  const { project, tagName } = req.body;
  
  if (!project || !tagName) {
    return res.status(400).json({ error: 'Project name and tag name are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.user?.username);
    
    // Validate git repository
    await validateGitRepository(projectPath);
    
    // Delete tag
    const { stdout } = await execAsync(`git tag -d "${tagName}"`, { cwd: projectPath });
    
    res.json({ success: true, output: stdout || 'Tag deleted successfully', tagName });
  } catch (error) {
    console.error('Git delete tag error:', error);
    
    let errorMessage = 'Tag deletion failed';
    let details = error.message;
    
    if (error.message.includes('not found')) {
      errorMessage = 'Tag not found';
      details = `Tag "${tagName}" does not exist.`;
    }
    
    res.status(500).json({ 
      error: errorMessage, 
      details: details
    });
  }
});

// Checkout tag
router.post('/checkout-tag', async (req, res) => {
  const { project, tagName } = req.body;
  
  if (!project || !tagName) {
    return res.status(400).json({ error: 'Project name and tag name are required' });
  }

  try {
    const projectPath = await getActualProjectPath(project, req.user?.username);
    
    // Validate git repository
    await validateGitRepository(projectPath);
    
    // Checkout the tag (this will put the repository in detached HEAD state)
    const { stdout } = await execAsync(`git checkout "${tagName}"`, { cwd: projectPath });
    
    res.json({ success: true, output: stdout || 'Tag checked out successfully', tagName });
  } catch (error) {
    console.error('Git checkout tag error:', error);
    
    let errorMessage = 'Tag checkout failed';
    let details = error.message;
    
    if (error.message.includes('did not match any file(s) known to git')) {
      errorMessage = 'Tag not found';
      details = `Tag "${tagName}" does not exist.`;
    } else if (error.message.includes('Please commit your changes or stash them')) {
      errorMessage = 'Uncommitted changes detected';
      details = 'Please commit or stash your local changes before checking out the tag.';
    }
    
    res.status(500).json({ 
      error: errorMessage, 
      details: details
    });
  }
});

export default router;