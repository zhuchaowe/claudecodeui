-- Projects ownership tracking
-- This table tracks which user created which project in the shared directory

CREATE TABLE IF NOT EXISTS project_ownership (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_name TEXT NOT NULL UNIQUE,
    owner_username TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (owner_username) REFERENCES users(username)
);

-- Index for faster queries
CREATE INDEX IF NOT EXISTS idx_project_owner ON project_ownership(owner_username);
CREATE INDEX IF NOT EXISTS idx_project_name ON project_ownership(project_name);