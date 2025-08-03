-- Migration to support shared projects between multiple users
-- This creates a new table that allows many-to-many relationships between users and projects

-- Create new table for shared project access
CREATE TABLE IF NOT EXISTS project_access (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_name TEXT NOT NULL,
    username TEXT NOT NULL,
    access_level TEXT DEFAULT 'user', -- 'owner' or 'user'
    added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (username) REFERENCES users(username),
    UNIQUE(project_name, username)
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_project_access_username ON project_access(username);
CREATE INDEX IF NOT EXISTS idx_project_access_project ON project_access(project_name);

-- Migrate existing ownership data to the new structure
-- First, insert all existing ownership records as 'owner' access level
INSERT OR IGNORE INTO project_access (project_name, username, access_level)
SELECT project_name, owner_username, 'owner'
FROM project_ownership;