-- Create MCP servers table for user-isolated MCP server configurations
PRAGMA foreign_keys = ON;

-- MCP Servers table for user-isolated configurations
CREATE TABLE IF NOT EXISTS mcp_servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'stdio', -- stdio, http, sse
    config TEXT NOT NULL, -- JSON string containing configuration
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 1,
    
    -- Constraints
    CONSTRAINT unique_user_server_name UNIQUE (user_id, name),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_mcp_servers_user_id ON mcp_servers(user_id);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_name ON mcp_servers(name);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_type ON mcp_servers(type);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_active ON mcp_servers(is_active);

-- Trigger to update updated_at timestamp
CREATE TRIGGER IF NOT EXISTS update_mcp_servers_timestamp 
    AFTER UPDATE ON mcp_servers
BEGIN
    UPDATE mcp_servers SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;