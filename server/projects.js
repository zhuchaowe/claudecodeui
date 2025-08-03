import { promises as fs } from 'fs';
import fsSync from 'fs';
import path from 'path';
import readline from 'readline';
import { projectDb } from './database/db.js';
import { execSync } from 'child_process';

// Cache for extracted project directories
const projectDirectoryCache = new Map();
let cacheTimestamp = Date.now();

// Clear cache when needed (called when project files change)
function clearProjectDirectoryCache() {
  projectDirectoryCache.clear();
  cacheTimestamp = Date.now();
}

// Encoding function: Convert file path to project name
// Rules:
// 1. Replace hyphens: - -> -
// 2. Replace underscores: _ -> -
// 3. Replace slashes: / -> -
function encodeProjectPath(path) {
  // Replace hyphens, underscores and slashes with hyphens
  let encoded = path.replace(/[-_\/]/g, '-');
  return encoded;
}

// Decoding function: Convert project name back to file path
// Since -, _ and / are all encoded as -, we need to intelligently
// determine what each - should be decoded to by checking directory existence
function decodeProjectName(name) {
  // Handle edge cases
  if (!name || !name.startsWith('-')) {
    return name;
  }
  
  // Remove leading hyphen and split by hyphens
  const segments = name.substring(1).split('-');
  
  // For paths like /home/claude/projects/username/project-name
  // We know the first segments should be joined with /
  let decodedPath = '';
  let currentIndex = 0;
  
  // Build the base path (we know these are directory separators)
  if (segments[0] === 'home' && segments[1] === 'claude' && segments[2] === 'projects') {
    decodedPath = '/home/claude/projects';
    currentIndex = 3;
    
    // Add username
    if (segments.length > 3) {
      decodedPath += '/' + segments[3];
      currentIndex = 4;
    }
  } else {
    // For other paths, start with root
    decodedPath = '/' + segments.join('/');
    return decodedPath;
  }
  
  // If no more segments, return what we have
  if (currentIndex >= segments.length) {
    return decodedPath;
  }
  
  // For the final directory name, we need to try different combinations
  // because we don't know which hyphens were originally - or _
  const remainingSegments = segments.slice(currentIndex);
  
  // First, check if the directory exists with all hyphens converted to slashes
  const pathWithSlashes = decodedPath + '/' + remainingSegments.join('/');
  if (fsSync.existsSync(pathWithSlashes)) {
    return pathWithSlashes;
  }
  
  // If there's only one remaining segment, try simple variations
  if (remainingSegments.length === 1) {
    const dirName = remainingSegments[0];
    return decodedPath + '/' + dirName;
  }
  
  // For multiple remaining segments, they likely form a single directory name
  // Try different combinations of - and _
  const possibleNames = generateDirectoryVariations(remainingSegments);
  
  for (const possibleName of possibleNames) {
    const testPath = decodedPath + '/' + possibleName;
    if (fsSync.existsSync(testPath)) {
      return testPath;
    }
  }
  
  // Default: treat remaining segments as a single directory with hyphens
  return decodedPath + '/' + remainingSegments.join('-');
}

// Helper function to generate possible directory name variations
function generateDirectoryVariations(segments) {
  const variations = [];
  
  // Most common patterns first
  variations.push(segments.join('-'));           // all hyphens: my-awesome-project
  variations.push(segments.join('_'));           // all underscores: my_awesome_project
  
  // For 2 segments, try both combinations
  if (segments.length === 2) {
    variations.push(segments[0] + '_' + segments[1]);  // first_second
  }
  
  // For 3 segments, try common patterns
  if (segments.length === 3) {
    variations.push(segments[0] + '_' + segments[1] + '_' + segments[2]);  // all underscores
    variations.push(segments[0] + '-' + segments[1] + '_' + segments[2]);  // hyphen then underscore
    variations.push(segments[0] + '_' + segments[1] + '-' + segments[2]);  // underscore then hyphen
  }
  
  // For efficiency, we don't try all 2^(n-1) combinations for larger n
  // but these patterns should cover most real-world cases
  
  return variations;
}

// Get session storage directory (where claude stores session logs)
function getSessionStorageDir() {
  // Session logs are always stored in ~/.claude/projects
  return path.join(process.env.HOME, '.claude/projects');
}

// Get backup directory for user's projects
function getBackupDir(username) {
  const backupBaseDir = process.env.BACKUP_DIR || '/home/claude/projects/.claudecode_backup';
  return path.join(backupBaseDir, 'sessions', username);
}

// Get user's projects directory (for backward compatibility with multi-user mode)
function getUserProjectsDir(username) {
  // For actual project paths, check if we should use multi-user mode
  const projectsDir = process.env.PROJECTS_DIR || '/home/claude/projects';
  return path.join(projectsDir, username);
}

// Get shared config path (all users share the same config)
function getUserConfigPath(username) {
  const homeDir = process.env.HOME || '/home/claude';
  return path.join(homeDir, '.claude', 'project-config.json');
}

// Load project configuration file
async function loadProjectConfig(username) {
  const configPath = getUserConfigPath(username);
  try {
    const configData = await fs.readFile(configPath, 'utf8');
    return JSON.parse(configData);
  } catch (error) {
    // Return empty config if file doesn't exist
    return {};
  }
}

// Save project configuration file
async function saveProjectConfig(username, config) {
  const configPath = getUserConfigPath(username);
  
  // Ensure directory exists
  const configDir = path.dirname(configPath);
  await fs.mkdir(configDir, { recursive: true });
  
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}

// Generate better display name from path
async function generateDisplayName(projectName, actualProjectDir = null) {
  // Use actual project directory if provided, otherwise decode from project name
  let projectPath = actualProjectDir;
  if (!projectPath) {
    if (projectName.startsWith('-home-claude-projects-')) {
      projectPath = decodeProjectName(projectName);
    } else if (projectName.startsWith('/')) {
      projectPath = projectName;
    } else {
      projectPath = decodeProjectName(projectName);
    }
  }
  
  // Try to read package.json from the project path
  try {
    const packageJsonPath = path.join(projectPath, 'package.json');
    const packageData = await fs.readFile(packageJsonPath, 'utf8');
    const packageJson = JSON.parse(packageData);
    
    // Return the name from package.json if it exists
    if (packageJson.name) {
      return packageJson.name;
    }
  } catch (error) {
    // Fall back to path-based naming if package.json doesn't exist or can't be read
  }
  
  // If it starts with /, it's an absolute path
  if (projectPath.startsWith('/')) {
    const parts = projectPath.split('/').filter(Boolean);
    if (parts.length > 3) {
      // Show last 2 folders with ellipsis: "...projects/myapp"
      return `.../${parts.slice(-2).join('/')}`;
    } else {
      // Show full path if short: "/home/user"
      return projectPath;
    }
  }
  
  return projectPath;
}

// Extract the actual project directory from JSONL sessions (with caching)
async function extractProjectDirectory(username, projectName) {
  // Check cache first
  if (projectDirectoryCache.has(projectName)) {
    return projectDirectoryCache.get(projectName);
  }
  
  // Check if this is a local directory project (starts with dash and represents an absolute path)
  // e.g., -home-claude-claudecodeui represents /home/claude/claudecodeui
  if (projectName.startsWith('-') && !projectName.startsWith('-home-claude-projects-')) {
    // This is a local directory project, convert back to absolute path
    const absolutePath = decodeProjectName(projectName);
    projectDirectoryCache.set(projectName, absolutePath);
    return absolutePath;
  }
  
  // If projectName is a full encoded path like -home-claude-projects-username-project
  // we need to extract just the project folder name
  let projectFolderName = projectName;
  if (projectName.startsWith('-home-claude-projects-')) {
    // Extract just the project name part (e.g., 'felo-mygpt' from '-home-claude-projects-zhuchao-felo-mygpt')
    const parts = projectName.split('-');
    // Skip: '', 'home', 'claude', 'projects', 'username'
    const usernameIndex = parts.indexOf(username);
    if (usernameIndex > 0 && usernameIndex < parts.length - 1) {
      projectFolderName = parts.slice(usernameIndex + 1).join('-');
    }
  }
  
  const projectDir = path.join(getUserProjectsDir(username), projectFolderName);
  const cwdCounts = new Map();
  let latestTimestamp = 0;
  let latestCwd = null;
  let extractedPath;
  
  try {
    // For local directory projects, we might not have a project folder with sessions
    let files = [];
    let jsonlFiles = [];
    
    try {
      files = await fs.readdir(projectDir);
      jsonlFiles = files.filter(file => file.endsWith('.jsonl'));
    } catch (err) {
      // Directory doesn't exist - this is expected for local directory projects
      if (err.code !== 'ENOENT') {
        throw err;
      }
    }
    
    if (jsonlFiles.length === 0) {
      // Fall back to decoded project name if no sessions
      // Check if this is a local directory project first
      if (projectName.startsWith('-') && !projectName.startsWith('-home-claude-projects-')) {
        // Local directory project
        extractedPath = decodeProjectName(projectName);
      } else if (projectName.startsWith('-home-claude-projects-')) {
        // Remove the leading dash and convert to path
        extractedPath = decodeProjectName(projectName);
      } else if (projectName.startsWith('/')) {
        extractedPath = projectName;
      } else {
        // Construct the full path
        extractedPath = path.join(getUserProjectsDir(username), projectFolderName);
      }
    } else {
      // Process all JSONL files to collect cwd values
      for (const file of jsonlFiles) {
        const jsonlFile = path.join(projectDir, file);
        const fileStream = fsSync.createReadStream(jsonlFile);
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity
        });
        
        for await (const line of rl) {
          if (line.trim()) {
            try {
              const entry = JSON.parse(line);
              
              if (entry.cwd) {
                // Count occurrences of each cwd
                cwdCounts.set(entry.cwd, (cwdCounts.get(entry.cwd) || 0) + 1);
                
                // Track the most recent cwd
                const timestamp = new Date(entry.timestamp || 0).getTime();
                if (timestamp > latestTimestamp) {
                  latestTimestamp = timestamp;
                  latestCwd = entry.cwd;
                }
              }
            } catch (parseError) {
              // Skip malformed lines
            }
          }
        }
      }
      
      // Determine the best cwd to use
      if (cwdCounts.size === 0) {
        // No cwd found, fall back to decoded project name
        if (projectName.startsWith('-') && !projectName.startsWith('-home-claude-projects-')) {
          // Local directory project
          extractedPath = decodeProjectName(projectName);
        } else if (projectName.startsWith('-home-claude-projects-')) {
          extractedPath = decodeProjectName(projectName);
        } else if (projectName.startsWith('/')) {
          extractedPath = projectName;
        } else {
          extractedPath = path.join(getUserProjectsDir(username), projectFolderName);
        }
      } else if (cwdCounts.size === 1) {
        // Only one cwd, use it
        extractedPath = Array.from(cwdCounts.keys())[0];
      } else {
        // Multiple cwd values - prefer the most recent one if it has reasonable usage
        const mostRecentCount = cwdCounts.get(latestCwd) || 0;
        const maxCount = Math.max(...cwdCounts.values());
        
        // Use most recent if it has at least 25% of the max count
        if (mostRecentCount >= maxCount * 0.25) {
          extractedPath = latestCwd;
        } else {
          // Otherwise use the most frequently used cwd
          for (const [cwd, count] of cwdCounts.entries()) {
            if (count === maxCount) {
              extractedPath = cwd;
              break;
            }
          }
        }
        
        // Fallback (shouldn't reach here)
        if (!extractedPath) {
          if (projectName.startsWith('-') && !projectName.startsWith('-home-claude-projects-')) {
            // Local directory project
            extractedPath = latestCwd || decodeProjectName(projectName);
          } else if (projectName.startsWith('-home-claude-projects-')) {
            extractedPath = latestCwd || decodeProjectName(projectName);
          } else if (latestCwd) {
            extractedPath = latestCwd;
          } else {
            extractedPath = path.join(getUserProjectsDir(username), projectFolderName);
          }
        }
      }
    }
    
    // Cache the result
    projectDirectoryCache.set(projectName, extractedPath);
    
    return extractedPath;
    
  } catch (error) {
    console.error(`Error extracting project directory for ${projectName}:`, error);
    // Fall back to decoded project name
    if (projectName.startsWith('-') && !projectName.startsWith('-home-claude-projects-')) {
      // Local directory project
      extractedPath = '/' + projectName.substring(1).replace(/-/g, '/');
    } else if (projectName.startsWith('-home-claude-projects-')) {
      extractedPath = '/' + projectName.substring(1).replace(/-/g, '/');
    } else if (projectName.startsWith('/')) {
      extractedPath = projectName;
    } else {
      extractedPath = path.join(getUserProjectsDir(username), projectFolderName);
    }
    
    // Cache the fallback result too
    projectDirectoryCache.set(projectName, extractedPath);
    
    return extractedPath;
  }
}

async function getProjects(username) {
  // Use session storage directory for reading project sessions
  const claudeDir = getSessionStorageDir();
  console.log(`[DEBUG] Getting projects for user: ${username}, from session directory: ${claudeDir}`);
  
  // Check and restore missing projects from backup first
  const restoredCount = await checkAndRestoreMissingProjects(username);
  if (restoredCount > 0) {
    console.log(`[getProjects] Restored ${restoredCount} missing projects before loading`);
  }
  
  const config = await loadProjectConfig(username);
  const projects = [];
  const existingProjects = new Set();
  
  // Get projects owned by this user
  const ownedProjects = await projectDb.getProjectsByOwner(username);
  const ownedProjectNames = new Set(ownedProjects.map(p => p.project_name));
  
  // Get all projects this user has access to (including shared)
  const accessibleProjects = await projectDb.getProjectsWithAccess(username);
  const accessibleProjectNames = new Set(accessibleProjects.map(p => p.project_name));
  
  try {
    // Ensure directory exists
    await fs.mkdir(claudeDir, { recursive: true });
    
    // First, get existing projects from the file system
    const entries = await fs.readdir(claudeDir, { withFileTypes: true });
    console.log(`[DEBUG] Found ${entries.length} entries in ${claudeDir}`);
    
    for (const entry of entries) {
      if (entry.isDirectory()) {
        existingProjects.add(entry.name);
        
        // Check if this user has access to this project
        const projectOwner = await projectDb.getProjectOwner(entry.name);
        const hasAccess = await projectDb.hasProjectAccess(entry.name, username);
        
        if (!projectOwner) {
          // If project has no owner, assign it to the first user who accesses it
          try {
            await projectDb.createProjectOwnership(entry.name, username);
            console.log(`Assigned unowned project ${entry.name} to user ${username}`);
          } catch (err) {
            // Another user might have claimed it concurrently
            const newOwner = await projectDb.getProjectOwner(entry.name);
            if (newOwner && newOwner !== username && !hasAccess) {
              continue; // Skip if now owned by another user and no access
            }
          }
        } else if (projectOwner !== username && !hasAccess) {
          // Skip projects owned by other users that this user doesn't have access to
          continue;
        }
        
        const projectPath = path.join(claudeDir, entry.name);
        
        // Extract actual project directory from JSONL sessions
        const actualProjectDir = await extractProjectDirectory(username, entry.name);
        
        // Get display name from config or generate one
        const customName = config[entry.name]?.displayName;
        const autoDisplayName = await generateDisplayName(entry.name, actualProjectDir);
        const fullPath = actualProjectDir;
        
        const project = {
          name: entry.name,
          path: actualProjectDir,
          displayName: customName || autoDisplayName,
          fullPath: fullPath,
          isCustomName: !!customName,
          owner: projectOwner || username, // Default to current user if no owner
          isShared: projectOwner && projectOwner !== username,
          accessLevel: projectOwner === username ? 'owner' : 'user',
          sessions: []
        };
        
        // Try to get sessions for this project (just first 5 for performance)
        try {
          const sessionResult = await getSessions(username, entry.name, 5, 0);
          project.sessions = sessionResult.sessions || [];
          project.sessionMeta = {
            hasMore: sessionResult.hasMore,
            total: sessionResult.total
          };
        } catch (e) {
          console.warn(`Could not load sessions for project ${entry.name}:`, e.message);
        }
        
        projects.push(project);
      }
    }
  } catch (error) {
    console.error('Error reading projects directory:', error);
  }
  
  // Add manually configured projects that don't exist as folders yet
  for (const [projectName, projectConfig] of Object.entries(config)) {
    if (!existingProjects.has(projectName) && projectConfig.manuallyAdded) {
      // Use the original path if available, otherwise extract from potential sessions
      let actualProjectDir = projectConfig.originalPath;
      
      if (!actualProjectDir) {
        try {
          actualProjectDir = await extractProjectDirectory(username, projectName);
        } catch (error) {
          // Fall back to decoded project name
          if (projectName.startsWith('-home-claude-projects-')) {
            actualProjectDir = decodeProjectName(projectName);
          } else {
            actualProjectDir = decodeProjectName(projectName);
          }
        }
      }
      
      // Get ownership information for manually added projects
      const projectOwner = await projectDb.getProjectOwner(projectName);
      
      const project = {
          name: projectName,
          path: actualProjectDir,
          displayName: projectConfig.displayName || await generateDisplayName(projectName, actualProjectDir),
          fullPath: actualProjectDir,
          isCustomName: !!projectConfig.displayName,
          isManuallyAdded: true,
          owner: projectOwner || username,
          isShared: projectOwner && projectOwner !== username,
          accessLevel: projectOwner === username ? 'owner' : 'user',
          sessions: []
        };
      
      // Try to get sessions for manually added projects too
      try {
        const sessionResult = await getSessions(username, projectName, 5, 0);
        project.sessions = sessionResult.sessions || [];
        project.sessionMeta = {
          hasMore: sessionResult.hasMore,
          total: sessionResult.total
        };
      } catch (e) {
        console.warn(`Could not load sessions for manually added project ${projectName}:`, e.message);
      }
      
      projects.push(project);
    }
  }
  
  return projects;
}

async function getSessions(username, projectName, limit = 5, offset = 0) {
  // Use session storage directory for reading session files
  const projectDir = path.join(getSessionStorageDir(), projectName);
  console.log(`[DEBUG] getSessions: Looking for sessions in ${projectDir}`);
  
  try {
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));
    console.log(`[DEBUG] getSessions: Found ${jsonlFiles.length} JSONL files`);
    
    if (jsonlFiles.length === 0) {
      return { sessions: [], hasMore: false, total: 0 };
    }
    
    // For performance, get file stats to sort by modification time
    const filesWithStats = await Promise.all(
      jsonlFiles.map(async (file) => {
        const filePath = path.join(projectDir, file);
        const stats = await fs.stat(filePath);
        return { file, mtime: stats.mtime };
      })
    );
    
    // Sort files by modification time (newest first) for better performance
    filesWithStats.sort((a, b) => b.mtime - a.mtime);
    
    const allSessions = new Map();
    let processedCount = 0;
    
    // Process files in order of modification time
    for (const { file } of filesWithStats) {
      const jsonlFile = path.join(projectDir, file);
      const sessions = await parseJsonlSessions(jsonlFile);
      
      // Merge sessions, avoiding duplicates by session ID
      sessions.forEach(session => {
        if (!allSessions.has(session.id)) {
          allSessions.set(session.id, session);
        }
      });
      
      processedCount++;
      
      // Early exit optimization: if we have enough sessions and processed recent files
      if (allSessions.size >= (limit + offset) * 2 && processedCount >= Math.min(3, filesWithStats.length)) {
        break;
      }
    }
    
    // Convert to array and sort by last activity
    const sortedSessions = Array.from(allSessions.values()).sort((a, b) => 
      new Date(b.lastActivity) - new Date(a.lastActivity)
    );
    
    const total = sortedSessions.length;
    const paginatedSessions = sortedSessions.slice(offset, offset + limit);
    const hasMore = offset + limit < total;
    
    return {
      sessions: paginatedSessions,
      hasMore,
      total,
      offset,
      limit
    };
  } catch (error) {
    console.error(`Error reading sessions for project ${projectName}:`, error);
    return { sessions: [], hasMore: false, total: 0 };
  }
}

async function parseJsonlSessions(filePath) {
  const sessions = new Map();
  
  try {
    const fileStream = fsSync.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    
    // console.log(`[JSONL Parser] Reading file: ${filePath}`);
    let lineCount = 0;
    
    for await (const line of rl) {
      if (line.trim()) {
        lineCount++;
        try {
          const entry = JSON.parse(line);
          
          if (entry.sessionId) {
            if (!sessions.has(entry.sessionId)) {
              sessions.set(entry.sessionId, {
                id: entry.sessionId,
                summary: 'New Session',
                messageCount: 0,
                lastActivity: new Date(),
                cwd: entry.cwd || ''
              });
            }
            
            const session = sessions.get(entry.sessionId);
            
            // Update summary if this is a summary entry
            if (entry.type === 'summary' && entry.summary) {
              session.summary = entry.summary;
            } else if (entry.message?.role === 'user' && entry.message?.content && session.summary === 'New Session') {
              // Use first user message as summary if no summary entry exists
              const content = entry.message.content;
              if (typeof content === 'string' && content.length > 0) {
                // Skip command messages that start with <command-name>
                if (!content.startsWith('<command-name>')) {
                  session.summary = content.length > 50 ? content.substring(0, 50) + '...' : content;
                }
              }
            }
            
            // Count messages instead of storing them all
            session.messageCount = (session.messageCount || 0) + 1;
            
            // Update last activity
            if (entry.timestamp) {
              session.lastActivity = new Date(entry.timestamp);
            }
          }
        } catch (parseError) {
          console.warn(`[JSONL Parser] Error parsing line ${lineCount}:`, parseError.message);
        }
      }
    }
    
    // console.log(`[JSONL Parser] Processed ${lineCount} lines, found ${sessions.size} sessions`);
  } catch (error) {
    console.error('Error reading JSONL file:', error);
  }
  
  // Convert Map to Array and sort by last activity
  return Array.from(sessions.values()).sort((a, b) => 
    new Date(b.lastActivity) - new Date(a.lastActivity)
  );
}

// Get messages for a specific session
async function getSessionMessages(username, projectName, sessionId) {
  const projectDir = path.join(getSessionStorageDir(), projectName);
  
  try {
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));
    
    if (jsonlFiles.length === 0) {
      return [];
    }
    
    const messages = [];
    
    // Process all JSONL files to find messages for this session
    for (const file of jsonlFiles) {
      const jsonlFile = path.join(projectDir, file);
      const fileStream = fsSync.createReadStream(jsonlFile);
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });
      
      for await (const line of rl) {
        if (line.trim()) {
          try {
            const entry = JSON.parse(line);
            if (entry.sessionId === sessionId) {
              messages.push(entry);
            }
          } catch (parseError) {
            console.warn('Error parsing line:', parseError.message);
          }
        }
      }
    }
    
    // Sort messages by timestamp
    return messages.sort((a, b) => 
      new Date(a.timestamp || 0) - new Date(b.timestamp || 0)
    );
  } catch (error) {
    console.error(`Error reading messages for session ${sessionId}:`, error);
    return [];
  }
}

// Rename a project's display name
async function renameProject(username, projectName, newDisplayName) {
  // Check if user has access to this project
  const projectOwner = await projectDb.getProjectOwner(projectName);
  const hasAccess = await projectDb.hasProjectAccess(projectName, username);
  
  if (!projectOwner || projectOwner === username || hasAccess) {
    // User has permission to rename (owner, has access, or unowned project)
  } else {
    throw new Error('You do not have permission to rename this project');
  }
  
  const config = await loadProjectConfig(username);
  
  if (!newDisplayName || newDisplayName.trim() === '') {
    // Remove custom name if empty, will fall back to auto-generated
    delete config[projectName];
  } else {
    // Set custom display name
    config[projectName] = {
      displayName: newDisplayName.trim()
    };
  }
  
  await saveProjectConfig(username, config);
  return true;
}

// Delete a session from a project
async function deleteSession(username, projectName, sessionId) {
  // Check if user has access to this project
  const projectOwner = await projectDb.getProjectOwner(projectName);
  const hasAccess = await projectDb.hasProjectAccess(projectName, username);
  
  if (!projectOwner || projectOwner === username || hasAccess) {
    // User has permission (owner, has access, or unowned project)
  } else {
    throw new Error('You do not have permission to delete sessions from this project');
  }
  
  const projectDir = path.join(getSessionStorageDir(), projectName);
  
  try {
    const files = await fs.readdir(projectDir);
    const jsonlFiles = files.filter(file => file.endsWith('.jsonl'));
    
    if (jsonlFiles.length === 0) {
      throw new Error('No session files found for this project');
    }
    
    // Check all JSONL files to find which one contains the session
    for (const file of jsonlFiles) {
      const jsonlFile = path.join(projectDir, file);
      const content = await fs.readFile(jsonlFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      // Check if this file contains the session
      const hasSession = lines.some(line => {
        try {
          const data = JSON.parse(line);
          return data.sessionId === sessionId;
        } catch {
          return false;
        }
      });
      
      if (hasSession) {
        // Filter out all entries for this session
        const filteredLines = lines.filter(line => {
          try {
            const data = JSON.parse(line);
            return data.sessionId !== sessionId;
          } catch {
            return true; // Keep malformed lines
          }
        });
        
        // Write back the filtered content
        await fs.writeFile(jsonlFile, filteredLines.join('\n') + (filteredLines.length > 0 ? '\n' : ''));
        return true;
      }
    }
    
    throw new Error(`Session ${sessionId} not found in any files`);
  } catch (error) {
    console.error(`Error deleting session ${sessionId} from project ${projectName}:`, error);
    throw error;
  }
}

// Check if a project is empty (has no sessions)
async function isProjectEmpty(username, projectName) {
  try {
    const sessionsResult = await getSessions(username, projectName, 1, 0);
    return sessionsResult.total === 0;
  } catch (error) {
    console.error(`Error checking if project ${projectName} is empty:`, error);
    return false;
  }
}

// Remove user's access to a shared project
async function removeProjectAccess(username, projectName) {
  const projectOwner = await projectDb.getProjectOwner(projectName);
  
  if (!projectOwner) {
    throw new Error('Project not found');
  }
  
  if (projectOwner === username) {
    // Owner trying to remove their own project - use deleteProject instead
    throw new Error('Project owners cannot remove their own access. Use delete project instead.');
  }
  
  // Remove user's access from the database
  await projectDb.removeProjectAccess(projectName, username);
  
  // Remove from user's config
  const config = await loadProjectConfig(username);
  delete config[projectName];
  await saveProjectConfig(username, config);
  
  return true;
}

// Delete a project and all its sessions
async function deleteProject(username, projectName) {
  // Only project owners can delete projects
  const projectOwner = await projectDb.getProjectOwner(projectName);
  if (projectOwner && projectOwner !== username) {
    throw new Error('Only the project owner can delete this project');
  }
  
  const sessionDir = path.join(getSessionStorageDir(), projectName);
  
  try {
    // Extract the actual project directory path
    const actualProjectDir = await extractProjectDirectory(username, projectName);
    const userProjectsDir = getUserProjectsDir(username);
    const isInUserProjectsDir = actualProjectDir && actualProjectDir.startsWith(userProjectsDir);
    
    // Always remove the session directory (in ~/.claude/projects)
    // This ensures the project won't reappear after refresh
    await fs.rm(sessionDir, { recursive: true, force: true });
    console.log(`[Delete] Removed session directory for project ${projectName}`);
    
    // Always delete backup for this project
    const backupDir = path.join(getBackupDir(username), projectName);
    try {
      await fs.rm(backupDir, { recursive: true, force: true });
      console.log(`[Delete] Removed backup for project ${projectName}`);
    } catch (err) {
      console.warn(`[Delete] Could not delete backup directory ${backupDir}:`, err.message);
    }
    
    // Only delete actual project directory if the project is in user's projects directory
    if (isInUserProjectsDir) {
      // Also try to remove the actual project directory if it exists
      if (actualProjectDir && actualProjectDir !== sessionDir) {
        try {
          await fs.rm(actualProjectDir, { recursive: true, force: true });
          console.log(`[Delete] Removed actual project directory ${actualProjectDir}`);
        } catch (err) {
          // It's okay if we can't delete the actual project directory
          console.warn(`Could not delete actual project directory ${actualProjectDir}:`, err.message);
        }
      }
    } else {
      console.log(`[Delete] Project ${projectName} is outside user directory, skipping actual project directory deletion`);
    }
    
    // Always remove from project ownership database
    await projectDb.deleteProjectOwnership(projectName);
    
    // Always remove from project config
    const config = await loadProjectConfig(username);
    delete config[projectName];
    await saveProjectConfig(username, config);
    
    return true;
  } catch (error) {
    console.error(`Error deleting project ${projectName}:`, error);
    throw error;
  }
}

// Add a project manually to the config (without creating folders)
async function addProjectManually(username, projectPath, displayName = null) {
  const absolutePath = path.resolve(projectPath);
  
  try {
    // Check if the path exists
    await fs.access(absolutePath);
  } catch (error) {
    throw new Error(`Path does not exist: ${absolutePath}`);
  }
  
  // Generate project name (encode path for use as directory name)
  const projectName = encodeProjectPath(absolutePath);
  
  // Check if this user already has this project configured
  const config = await loadProjectConfig(username);
  
  if (config[projectName]) {
    // User already has this project, ensure they have access in the database
    const existingOwner = await projectDb.getProjectOwner(projectName);
    
    // If there's an owner but this user doesn't have access, add access
    if (existingOwner && existingOwner !== username) {
      const hasAccess = await projectDb.hasProjectAccess(projectName, username);
      if (!hasAccess) {
        await projectDb.addProjectAccess(projectName, username, 'user');
      }
    }
    
    return {
      name: projectName,
      path: absolutePath,
      fullPath: absolutePath,
      displayName: config[projectName].displayName || await generateDisplayName(projectName, absolutePath),
      isManuallyAdded: true,
      owner: existingOwner || username,
      isShared: !!existingOwner && existingOwner !== username,
      sessions: [],
      alreadyConfigured: true
    };
  }
  
  // Check if project directory exists (might be shared by another user)
  const projectDir = path.join(getSessionStorageDir(), projectName);
  let projectExists = false;
  
  try {
    await fs.access(projectDir);
    projectExists = true;
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
  
  // Add to config as manually added project
  config[projectName] = {
    manuallyAdded: true,
    originalPath: absolutePath
  };
  
  if (displayName) {
    config[projectName].displayName = displayName;
  }
  
  await saveProjectConfig(username, config);
  
  // Check if project ownership already exists
  const existingOwner = await projectDb.getProjectOwner(projectName);
  
  if (!existingOwner) {
    // No owner yet, assign to this user
    await projectDb.createProjectOwnership(projectName, username);
  } else {
    // Project already has an owner, add this user as a shared user
    await projectDb.addProjectAccess(projectName, username, 'user');
  }
  
  return {
    name: projectName,
    path: absolutePath,
    fullPath: absolutePath,
    displayName: displayName || await generateDisplayName(projectName, absolutePath),
    isManuallyAdded: true,
    owner: existingOwner || username,
    isShared: !!existingOwner && existingOwner !== username,
    sessions: []
  };
}

// Backup a project to the backup directory
async function backupProject(username, projectName) {
  const sourceDir = path.join(getSessionStorageDir(), projectName);
  const backupDir = path.join(getBackupDir(username), projectName);
  
  try {
    // Create backup directory if it doesn't exist
    await fs.mkdir(path.dirname(backupDir), { recursive: true });
    
    // Use rsync for efficient backup (preserves timestamps and only copies changes)
    try {
      execSync(`rsync -a --delete "${sourceDir}/" "${backupDir}/"`, { stdio: 'pipe' });
      console.log(`[Backup] Successfully backed up project ${projectName} for user ${username}`);
      return true;
    } catch (rsyncError) {
      // Fallback to cp if rsync is not available
      console.warn('[Backup] rsync not available, using cp for backup');
      execSync(`cp -r "${sourceDir}" "${backupDir}"`, { stdio: 'pipe' });
      console.log(`[Backup] Successfully backed up project ${projectName} for user ${username} using cp`);
      return true;
    }
  } catch (error) {
    console.error(`[Backup] Failed to backup project ${projectName} for user ${username}:`, error);
    return false;
  }
}

// Restore a project from backup
async function restoreProject(username, projectName) {
  const backupDir = path.join(getBackupDir(username), projectName);
  const targetDir = path.join(getSessionStorageDir(), projectName);
  
  try {
    // Check if backup exists
    await fs.access(backupDir);
    
    // Create target directory if it doesn't exist
    await fs.mkdir(path.dirname(targetDir), { recursive: true });
    
    // Use rsync for efficient restore
    try {
      execSync(`rsync -a "${backupDir}/" "${targetDir}/"`, { stdio: 'pipe' });
      console.log(`[Restore] Successfully restored project ${projectName} for user ${username}`);
      return true;
    } catch (rsyncError) {
      // Fallback to cp if rsync is not available
      console.warn('[Restore] rsync not available, using cp for restore');
      execSync(`cp -r "${backupDir}" "${targetDir}"`, { stdio: 'pipe' });
      console.log(`[Restore] Successfully restored project ${projectName} for user ${username} using cp`);
      return true;
    }
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log(`[Restore] No backup found for project ${projectName} for user ${username}`);
    } else {
      console.error(`[Restore] Failed to restore project ${projectName} for user ${username}:`, error);
    }
    return false;
  }
}

// Backup all projects for a user
async function backupAllUserProjects(username) {
  const projects = await getProjects(username);
  let successCount = 0;
  
  for (const project of projects) {
    if (await backupProject(username, project.name)) {
      successCount++;
    }
  }
  
  console.log(`[Backup] Backed up ${successCount}/${projects.length} projects for user ${username}`);
  return successCount;
}

// Check and restore missing projects from backup
async function checkAndRestoreMissingProjects(username) {
  const sessionDir = getSessionStorageDir();
  const backupUserDir = getBackupDir(username);
  let restoredCount = 0;
  
  try {
    // Get list of backed up projects
    const backedUpProjects = await fs.readdir(backupUserDir, { withFileTypes: true });
    
    for (const entry of backedUpProjects) {
      if (entry.isDirectory()) {
        const projectName = entry.name;
        const projectPath = path.join(sessionDir, projectName);
        
        try {
          // Check if project exists in session directory
          await fs.access(projectPath);
        } catch (error) {
          // Project doesn't exist, restore from backup
          console.log(`[Restore] Project ${projectName} missing, restoring from backup...`);
          if (await restoreProject(username, projectName)) {
            restoredCount++;
          }
        }
      }
    }
    
    if (restoredCount > 0) {
      console.log(`[Restore] Restored ${restoredCount} missing projects for user ${username}`);
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('[Restore] Error checking for missing projects:', error);
    }
  }
  
  return restoredCount;
}


export {
  getProjects,
  getSessions,
  getSessionMessages,
  parseJsonlSessions,
  renameProject,
  deleteSession,
  isProjectEmpty,
  deleteProject,
  removeProjectAccess,
  addProjectManually,
  loadProjectConfig,
  saveProjectConfig,
  extractProjectDirectory,
  clearProjectDirectoryCache,
  getUserProjectsDir,
  getSessionStorageDir,
  encodeProjectPath,
  decodeProjectName,
  backupProject,
  restoreProject,
  backupAllUserProjects,
  checkAndRestoreMissingProjects
};