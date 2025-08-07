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
    
    // Check if mcp_servers table exists, create it if not
    const mcpServersExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='mcp_servers'").get();
    if (!mcpServersExists) {
      console.log('Creating mcp_servers table for user-isolated MCP configurations...');
      const MCP_SERVERS_SQL_PATH = path.join(__dirname, 'create-mcp-servers.sql');
      const mcpServersSQL = fs.readFileSync(MCP_SERVERS_SQL_PATH, 'utf8');
      db.exec(mcpServersSQL);
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

// MCP Servers database operations
const mcpServerDb = {
  // Create an MCP server configuration
  createMcpServer: (userId, name, type, config) => {
    try {
      const stmt = db.prepare(`
        INSERT INTO mcp_servers (user_id, name, type, config) 
        VALUES (?, ?, ?, ?)
      `);
      const result = stmt.run(userId, name, type, JSON.stringify(config));
      return { 
        id: result.lastInsertRowid, 
        userId, 
        name, 
        type, 
        config 
      };
    } catch (err) {
      throw err;
    }
  },

  // Get all MCP servers for a user
  getMcpServersByUser: (userId) => {
    try {
      const stmt = db.prepare(`
        SELECT id, user_id, name, type, config, created_at, updated_at, is_active 
        FROM mcp_servers 
        WHERE user_id = ? AND is_active = 1
        ORDER BY name
      `);
      const rows = stmt.all(userId);
      return rows.map(row => ({
        ...row,
        config: JSON.parse(row.config)
      }));
    } catch (err) {
      throw err;
    }
  },

  // Get a specific MCP server by ID and user
  getMcpServer: (userId, serverId) => {
    try {
      const stmt = db.prepare(`
        SELECT id, user_id, name, type, config, created_at, updated_at, is_active 
        FROM mcp_servers 
        WHERE id = ? AND user_id = ? AND is_active = 1
      `);
      const row = stmt.get(serverId, userId);
      if (row) {
        return {
          ...row,
          config: JSON.parse(row.config)
        };
      }
      return null;
    } catch (err) {
      throw err;
    }
  },

  // Get a specific MCP server by name and user
  getMcpServerByName: (userId, name) => {
    try {
      const stmt = db.prepare(`
        SELECT id, user_id, name, type, config, created_at, updated_at, is_active 
        FROM mcp_servers 
        WHERE user_id = ? AND name = ? AND is_active = 1
      `);
      const row = stmt.get(userId, name);
      if (row) {
        return {
          ...row,
          config: JSON.parse(row.config)
        };
      }
      return null;
    } catch (err) {
      throw err;
    }
  },

  // Update an MCP server configuration
  updateMcpServer: (userId, serverId, name, type, config) => {
    try {
      const stmt = db.prepare(`
        UPDATE mcp_servers 
        SET name = ?, type = ?, config = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ? AND is_active = 1
      `);
      const result = stmt.run(name, type, JSON.stringify(config), serverId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Delete an MCP server (soft delete)
  deleteMcpServer: (userId, serverId) => {
    try {
      const stmt = db.prepare(`
        UPDATE mcp_servers 
        SET is_active = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND user_id = ?
      `);
      const result = stmt.run(serverId, userId);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Delete an MCP server by name (soft delete)
  deleteMcpServerByName: (userId, name) => {
    try {
      const stmt = db.prepare(`
        UPDATE mcp_servers 
        SET is_active = 0, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ? AND name = ?
      `);
      const result = stmt.run(userId, name);
      return result.changes > 0;
    } catch (err) {
      throw err;
    }
  },

  // Check if user owns an MCP server
  userOwnsMcpServer: (userId, serverId) => {
    try {
      const stmt = db.prepare(`
        SELECT COUNT(*) as count 
        FROM mcp_servers 
        WHERE id = ? AND user_id = ? AND is_active = 1
      `);
      const result = stmt.get(serverId, userId);
      return result.count > 0;
    } catch (err) {
      throw err;
    }
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
  mcpServerDb,
  pathMappingDb,
  updateUserGithubToken,
  updateUserGiteaToken,
  getUserById
};