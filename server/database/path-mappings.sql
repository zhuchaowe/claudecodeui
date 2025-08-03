-- SQL script for creating project path mappings table
-- Maps encoded session paths to original file paths

CREATE TABLE IF NOT EXISTS project_path_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    encoded_path TEXT NOT NULL UNIQUE,
    original_path TEXT NOT NULL,
    username TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (username) REFERENCES users(username)
);

-- Create indexes for efficient lookup
CREATE INDEX IF NOT EXISTS idx_encoded_path ON project_path_mappings(encoded_path);
CREATE INDEX IF NOT EXISTS idx_original_path ON project_path_mappings(original_path);
CREATE INDEX IF NOT EXISTS idx_username_path ON project_path_mappings(username, encoded_path);