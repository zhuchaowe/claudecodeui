import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = path.join(__dirname, 'data', 'auth.db');
const INIT_SQL_PATH = path.join(__dirname, 'init.sql');
const PROJECTS_SQL_PATH = path.join(__dirname, 'projects-ownership.sql');
const SHARED_PROJECTS_SQL_PATH = path.join(__dirname, 'migrate-shared-projects.sql');
const PATH_MAPPINGS_SQL_PATH = path.join(__dirname, 'path-mappings.sql');
const DEPLOYMENT_SYSTEM_SQL_PATH = path.join(__dirname, 'migrate-deployment-system.sql');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// Create database connection
const db = new Database(DB_PATH);
console.log('Connected to SQLite database');

// Run migrations immediately on database connection
// This ensures existing databases get updated columns
try {
  // Only run if users table exists (database already initialized)
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (tableExists) {
    // We'll run the migration function after it's defined
    console.log('Checking for required database migrations...');
  }
} catch (error) {
  console.log('Database not yet initialized');
}

// Check if column exists in table
const columnExists = (tableName, columnName) => {
  const result = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return result.some(col => col.name === columnName);
};

// Run migrations
const runMigrations = () => {
  try {
    // Check and add GitHub OAuth columns if they don't exist
    if (!columnExists('users', 'github_token')) {
      console.log('Adding github_token column to users table...');
      db.exec('ALTER TABLE users ADD COLUMN github_token TEXT');
    }
    
    if (!columnExists('users', 'github_username')) {
      console.log('Adding github_username column to users table...');
      db.exec('ALTER TABLE users ADD COLUMN github_username TEXT');
    }
    
    if (!columnExists('users', 'gitea_token')) {
      console.log('Adding gitea_token column to users table...');
      db.exec('ALTER TABLE users ADD COLUMN gitea_token TEXT');
    }
    
    if (!columnExists('users', 'gitea_username')) {
      console.log('Adding gitea_username column to users table...');
      db.exec('ALTER TABLE users ADD COLUMN gitea_username TEXT');
    }
    
    if (!columnExists('users', 'anthropic_config')) {
      console.log('Adding anthropic_config column to users table...');
      try {
        db.exec('ALTER TABLE users ADD COLUMN anthropic_config TEXT');
        console.log('Successfully added anthropic_config column');
      } catch (error) {
        if (error.message.includes('duplicate column name')) {
          console.log('anthropic_config column already exists');
        } else {
          console.error('Error adding anthropic_config column:', error.message);
          throw error;
        }
      }
    }
    
    // Check if project_access table exists, create it if not
    const projectAccessExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='project_access'").get();
    if (!projectAccessExists) {
      console.log('Creating project_access table for shared projects...');
      const sharedProjectsSQL = fs.readFileSync(SHARED_PROJECTS_SQL_PATH, 'utf8');
      db.exec(sharedProjectsSQL);
    }
    
    console.log('Migrations completed successfully');
  } catch (error) {
    console.error('Error running migrations:', error.message);
    throw error;
  }
};

// Initialize database with schema
const initializeDatabase = async () => {
  try {
    const initSQL = fs.readFileSync(INIT_SQL_PATH, 'utf8');
    db.exec(initSQL);
    
    // Initialize projects ownership table
    const projectsSQL = fs.readFileSync(PROJECTS_SQL_PATH, 'utf8');
    db.exec(projectsSQL);
    
    // Initialize shared projects table
    const sharedProjectsSQL = fs.readFileSync(SHARED_PROJECTS_SQL_PATH, 'utf8');
    db.exec(sharedProjectsSQL);
    
    // Initialize path mappings table
    const pathMappingsSQL = fs.readFileSync(PATH_MAPPINGS_SQL_PATH, 'utf8');
    db.exec(pathMappingsSQL);
    
    // Initialize deployment system tables
    const deploymentSystemSQL = fs.readFileSync(DEPLOYMENT_SYSTEM_SQL_PATH, 'utf8');
    db.exec(deploymentSystemSQL);
    
    // Run any necessary migrations
    runMigrations();
    
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error.message);
    throw error;
  }
};

// User database operations
const userDb = {
  // Check if any users exist
  hasUsers: () => {
    try {
      const row = db.prepare('SELECT COUNT(*) as count FROM users').get();
      return row.count > 0;
    } catch (err) {
      throw err;
    }
  },

  // Create a new user
  createUser: (username, passwordHash) => {
    try {
      const stmt = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)');
      const result = stmt.run(username, passwordHash);
      return { id: result.lastInsertRowid, username };
    } catch (err) {
      throw err;
    }
  },

  // Get user by username
  getUserByUsername: (username) => {
    try {
      const row = db.prepare('SELECT * FROM users WHERE username = ? AND is_active = 1').get(username);
      return row;
    } catch (err) {
      throw err;
    }
  },

  // Get user by GitHub username
  getUserByGithubUsername: (githubUsername) => {
    try {
      const row = db.prepare('SELECT * FROM users WHERE github_username = ? AND is_active = 1').get(githubUsername);
      return row;
    } catch (err) {
      throw err;
    }
  },

  // Create a new user with GitHub OAuth
  createUserWithGithub: (username, displayName, email, githubToken, githubUsername) => {
    try {
      // No password hash needed for OAuth users
      const stmt = db.prepare(`
        INSERT INTO users (username, password_hash, github_token, github_username) 
        VALUES (?, '', ?, ?)
      `);
      const result = stmt.run(username, githubToken, githubUsername);
      return { id: result.lastInsertRowid, username, github_username: githubUsername };
    } catch (err) {
      throw err;
    }
  },

  // Get user by Gitea username
  getUserByGiteaUsername: (giteaUsername) => {
    try {
      const row = db.prepare('SELECT * FROM users WHERE gitea_username = ? AND is_active = 1').get(giteaUsername);
      return row;
    } catch (err) {
      throw err;
    }
  },

  // Create a new user with Gitea OAuth
  createUserWithGitea: (username, displayName, email, giteaToken, giteaUsername) => {
    try {
      // No password hash needed for OAuth users
      const stmt = db.prepare(`
        INSERT INTO users (username, password_hash, gitea_token, gitea_username) 
        VALUES (?, '', ?, ?)
      `);
      const result = stmt.run(username, giteaToken, giteaUsername);
      return { id: result.lastInsertRowid, username, gitea_username: giteaUsername };
    } catch (err) {
      throw err;
    }
  },

  // Update last login time
  updateLastLogin: (userId) => {
    try {
      db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(userId);
    } catch (err) {
      throw err;
    }
  },

  // Get user by ID
  getUserById: (userId) => {
    try {
      const row = db.prepare('SELECT id, username, created_at, last_login, anthropic_config FROM users WHERE id = ? AND is_active = 1').get(userId);
      return row;
    } catch (err) {
      throw err;
    }
  }
};

// Project ownership database operations
const projectDb = {
  // Create a project ownership record
  createProjectOwnership: (projectName, ownerUsername) => {
    try {
      const stmt = db.prepare('INSERT INTO project_ownership (project_name, owner_username) VALUES (?, ?)');
      const result = stmt.run(projectName, ownerUsername);
      
      // Also add to project_access table as owner
      const accessStmt = db.prepare('INSERT OR IGNORE INTO project_access (project_name, username, access_level) VALUES (?, ?, ?)');
      accessStmt.run(projectName, ownerUsername, 'owner');
      
      return { id: result.lastInsertRowid, projectName, ownerUsername };
    } catch (err) {
      throw err;
    }
  },

  // Get projects by owner
  getProjectsByOwner: (ownerUsername) => {
    try {
      const rows = db.prepare('SELECT * FROM project_ownership WHERE owner_username = ?').all(ownerUsername);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  // Get project owner
  getProjectOwner: (projectName) => {
    try {
      const row = db.prepare('SELECT owner_username FROM project_ownership WHERE project_name = ?').get(projectName);
      return row?.owner_username;
    } catch (err) {
      throw err;
    }
  },

  // Delete project ownership record
  deleteProjectOwnership: (projectName) => {
    try {
      db.prepare('DELETE FROM project_ownership WHERE project_name = ?').run(projectName);
      // Also delete from project_access
      db.prepare('DELETE FROM project_access WHERE project_name = ?').run(projectName);
    } catch (err) {
      throw err;
    }
  },

  // Update project name (for rename)
  updateProjectName: (oldName, newName) => {
    try {
      db.prepare('UPDATE project_ownership SET project_name = ? WHERE project_name = ?').run(newName, oldName);
      // Also update in project_access
      db.prepare('UPDATE project_access SET project_name = ? WHERE project_name = ?').run(newName, oldName);
    } catch (err) {
      throw err;
    }
  },

  // Add user access to a project
  addProjectAccess: (projectName, username, accessLevel = 'user') => {
    try {
      const stmt = db.prepare('INSERT OR REPLACE INTO project_access (project_name, username, access_level) VALUES (?, ?, ?)');
      const result = stmt.run(projectName, username, accessLevel);
      return { id: result.lastInsertRowid, projectName, username, accessLevel };
    } catch (err) {
      throw err;
    }
  },

  // Get all projects a user has access to
  getProjectsWithAccess: (username) => {
    try {
      const rows = db.prepare('SELECT * FROM project_access WHERE username = ?').all(username);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  // Check if user has access to project
  hasProjectAccess: (projectName, username) => {
    try {
      const row = db.prepare('SELECT * FROM project_access WHERE project_name = ? AND username = ?').get(projectName, username);
      return !!row;
    } catch (err) {
      throw err;
    }
  },

  // Get all users with access to a project
  getProjectUsers: (projectName) => {
    try {
      const rows = db.prepare('SELECT * FROM project_access WHERE project_name = ?').all(projectName);
      return rows;
    } catch (err) {
      throw err;
    }
  },

  // Remove user's access to a project
  removeProjectAccess: (projectName, username) => {
    try {
      db.prepare('DELETE FROM project_access WHERE project_name = ? AND username = ?').run(projectName, username);
      return true;
    } catch (err) {
      throw err;
    }
  },
  
  // Get all users (for backup purposes)
  getAllUsers: () => {
    try {
      const rows = db.prepare('SELECT DISTINCT username FROM users WHERE is_active = 1').all();
      return rows;
    } catch (err) {
      throw err;
    }
  }
};

// Update user's GitHub token
const updateUserGithubToken = (userId, githubToken, githubUsername) => {
  try {
    const stmt = db.prepare('UPDATE users SET github_token = ?, github_username = ? WHERE id = ?');
    stmt.run(githubToken, githubUsername, userId);
  } catch (err) {
    throw err;
  }
};

// Update user's Gitea token
const updateUserGiteaToken = (userId, giteaToken, giteaUsername) => {
  try {
    const stmt = db.prepare('UPDATE users SET gitea_token = ?, gitea_username = ? WHERE id = ?');
    stmt.run(giteaToken, giteaUsername, userId);
  } catch (err) {
    throw err;
  }
};

// Get user by ID with GitHub and Gitea info
const getUserById = (userId) => {
  try {
    const stmt = db.prepare('SELECT id, username, created_at, last_login, github_token, github_username, gitea_token, gitea_username, anthropic_config FROM users WHERE id = ? AND is_active = 1');
    return stmt.get(userId);
  } catch (err) {
    throw err;
  }
};

// Path mapping database operations
const pathMappingDb = {
  // Save a path mapping
  saveMapping: (encodedPath, originalPath, username) => {
    try {
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO project_path_mappings 
        (encoded_path, original_path, username, last_accessed) 
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      `);
      const result = stmt.run(encodedPath, originalPath, username);
      return { id: result.lastInsertRowid, encodedPath, originalPath };
    } catch (err) {
      console.error('Error saving path mapping:', err);
      throw err;
    }
  },

  // Get original path from encoded path
  getOriginalPath: (encodedPath) => {
    try {
      const stmt = db.prepare(`
        SELECT original_path 
        FROM project_path_mappings 
        WHERE encoded_path = ?
      `);
      const row = stmt.get(encodedPath);
      
      // Update last accessed time if found
      if (row) {
        db.prepare(`
          UPDATE project_path_mappings 
          SET last_accessed = CURRENT_TIMESTAMP 
          WHERE encoded_path = ?
        `).run(encodedPath);
      }
      
      return row ? row.original_path : null;
    } catch (err) {
      console.error('Error getting original path:', err);
      throw err;
    }
  },

  // Get encoded path from original path
  getEncodedPath: (originalPath, username) => {
    try {
      const stmt = db.prepare(`
        SELECT encoded_path 
        FROM project_path_mappings 
        WHERE original_path = ? AND username = ?
      `);
      const row = stmt.get(originalPath, username);
      return row ? row.encoded_path : null;
    } catch (err) {
      console.error('Error getting encoded path:', err);
      throw err;
    }
  },

  // Delete old mappings (cleanup)
  deleteOldMappings: (daysOld = 30) => {
    try {
      const stmt = db.prepare(`
        DELETE FROM project_path_mappings 
        WHERE last_accessed < datetime('now', '-' || ? || ' days')
      `);
      const result = stmt.run(daysOld);
      return result.changes;
    } catch (err) {
      console.error('Error deleting old mappings:', err);
      throw err;
    }
  }
};

// Deployment system database operations
const deploymentDb = {
  // Deployment servers management
  createServer: (serverConfig) => {
    try {
      const stmt = db.prepare(`
        INSERT INTO deployment_servers 
        (name, host, port, username, ssh_key, ssh_password, docker_compose_path, nginx_config_path, base_domain, port_range_start, port_range_end, max_deployments_per_user, auto_cleanup_days)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(
        serverConfig.name, serverConfig.host, serverConfig.port || 22, serverConfig.username,
        serverConfig.ssh_key, serverConfig.ssh_password, serverConfig.docker_compose_path || '/opt/deployments',
        serverConfig.nginx_config_path || '/etc/nginx/sites-available', serverConfig.base_domain,
        serverConfig.port_range_start || 3000, serverConfig.port_range_end || 4999,
        serverConfig.max_deployments_per_user || 5, serverConfig.auto_cleanup_days || 7
      );
      return { id: result.lastInsertRowid, ...serverConfig };
    } catch (err) {
      throw err;
    }
  },

  getServers: () => {
    try {
      return db.prepare('SELECT * FROM deployment_servers WHERE status = "active" ORDER BY name').all();
    } catch (err) {
      throw err;
    }
  },

  getServerById: (serverId) => {
    try {
      return db.prepare('SELECT * FROM deployment_servers WHERE id = ?').get(serverId);
    } catch (err) {
      throw err;
    }
  },

  // Branch deployments management
  createDeployment: (deploymentConfig) => {
    try {
      const stmt = db.prepare(`
        INSERT INTO branch_deployments 
        (project_id, server_id, username, branch, container_name, port, subdomain, full_url, commit_hash, deploy_config, resources_config, health_check_url, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const result = stmt.run(
        deploymentConfig.project_id, deploymentConfig.server_id, deploymentConfig.username,
        deploymentConfig.branch, deploymentConfig.container_name, deploymentConfig.port,
        deploymentConfig.subdomain, deploymentConfig.full_url, deploymentConfig.commit_hash,
        JSON.stringify(deploymentConfig.deploy_config || {}), JSON.stringify(deploymentConfig.resources_config || {}),
        deploymentConfig.health_check_url, deploymentConfig.expires_at
      );
      return { id: result.lastInsertRowid, ...deploymentConfig };
    } catch (err) {
      throw err;
    }
  },

  getDeploymentsByUser: (username) => {
    try {
      return db.prepare(`
        SELECT bd.*, ds.name as server_name, ds.host as server_host 
        FROM branch_deployments bd 
        JOIN deployment_servers ds ON bd.server_id = ds.id 
        WHERE bd.username = ? 
        ORDER BY bd.last_deployed DESC
      `).all(username);
    } catch (err) {
      throw err;
    }
  },

  getDeploymentsByProject: (projectId) => {
    try {
      return db.prepare(`
        SELECT bd.*, ds.name as server_name, ds.host as server_host 
        FROM branch_deployments bd 
        JOIN deployment_servers ds ON bd.server_id = ds.id 
        WHERE bd.project_id = ? 
        ORDER BY bd.last_deployed DESC
      `).all(projectId);
    } catch (err) {
      throw err;
    }
  },

  getDeployment: (deploymentId) => {
    try {
      return db.prepare(`
        SELECT bd.*, ds.name as server_name, ds.host as server_host, ds.docker_compose_path, ds.nginx_config_path
        FROM branch_deployments bd 
        JOIN deployment_servers ds ON bd.server_id = ds.id 
        WHERE bd.id = ?
      `).get(deploymentId);
    } catch (err) {
      throw err;
    }
  },

  updateDeploymentStatus: (deploymentId, status, commitHash = null) => {
    try {
      const stmt = db.prepare(`
        UPDATE branch_deployments 
        SET status = ?, last_deployed = CURRENT_TIMESTAMP, commit_hash = COALESCE(?, commit_hash)
        WHERE id = ?
      `);
      stmt.run(status, commitHash, deploymentId);
      return true;
    } catch (err) {
      throw err;
    }
  },

  deleteDeployment: (deploymentId) => {
    try {
      db.prepare('DELETE FROM branch_deployments WHERE id = ?').run(deploymentId);
      return true;
    } catch (err) {
      throw err;
    }
  },

  // Port management
  allocatePort: (serverId, deploymentId = null) => {
    try {
      const server = db.prepare('SELECT port_range_start, port_range_end FROM deployment_servers WHERE id = ?').get(serverId);
      if (!server) throw new Error('Server not found');

      // Find an available port
      const allocatedPorts = db.prepare('SELECT port FROM port_allocations WHERE server_id = ?').all(serverId);
      const usedPorts = new Set(allocatedPorts.map(p => p.port));

      for (let port = server.port_range_start; port <= server.port_range_end; port++) {
        if (!usedPorts.has(port)) {
          // Reserve the port
          const stmt = db.prepare('INSERT INTO port_allocations (server_id, port, deployment_id) VALUES (?, ?, ?)');
          stmt.run(serverId, port, deploymentId);
          return port;
        }
      }
      throw new Error('No available ports in range');
    } catch (err) {
      throw err;
    }
  },

  releasePort: (serverId, port) => {
    try {
      db.prepare('DELETE FROM port_allocations WHERE server_id = ? AND port = ?').run(serverId, port);
      return true;
    } catch (err) {
      throw err;
    }
  },

  // Deployment logs
  addDeploymentLog: (deploymentId, step, status, output = '', details = '') => {
    try {
      const stmt = db.prepare(`
        INSERT INTO deployment_logs (deployment_id, step, status, output, details)
        VALUES (?, ?, ?, ?, ?)
      `);
      const result = stmt.run(deploymentId, step, status, output, details);
      return result.lastInsertRowid;
    } catch (err) {
      throw err;
    }
  },

  updateDeploymentLog: (logId, status, output = '', completedAt = null) => {
    try {
      const stmt = db.prepare(`
        UPDATE deployment_logs 
        SET status = ?, output = ?, completed_at = COALESCE(?, CURRENT_TIMESTAMP)
        WHERE id = ?
      `);
      stmt.run(status, output, completedAt, logId);
      return true;
    } catch (err) {
      throw err;
    }
  },

  getDeploymentLogs: (deploymentId) => {
    try {
      return db.prepare('SELECT * FROM deployment_logs WHERE deployment_id = ? ORDER BY started_at ASC').all(deploymentId);
    } catch (err) {
      throw err;
    }
  },

  // Cleanup expired deployments
  getExpiredDeployments: () => {
    try {
      return db.prepare(`
        SELECT * FROM branch_deployments 
        WHERE expires_at < CURRENT_TIMESTAMP AND status != 'cleanup'
        ORDER BY expires_at ASC
      `).all();
    } catch (err) {
      throw err;
    }
  }
};

// Run migrations on existing databases immediately
try {
  const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (tableExists) {
    runMigrations();
  }
} catch (error) {
  console.log('Migration check error:', error.message);
}

export {
  db,
  initializeDatabase,
  userDb,
  projectDb,
  pathMappingDb,
  deploymentDb,
  updateUserGithubToken,
  updateUserGiteaToken,
  getUserById
};