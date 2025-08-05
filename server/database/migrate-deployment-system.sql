-- Migration for Multi-branch Deployment System
-- Run this after existing migrations

-- Deployment servers configuration table
CREATE TABLE IF NOT EXISTS deployment_servers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    host TEXT NOT NULL,
    port INTEGER DEFAULT 22,
    username TEXT NOT NULL,
    ssh_key TEXT, -- encrypted SSH private key
    ssh_password TEXT, -- encrypted password (alternative to key)
    docker_compose_path TEXT DEFAULT '/opt/deployments',
    nginx_config_path TEXT DEFAULT '/etc/nginx/sites-available',
    base_domain TEXT, -- e.g. 'dev.yoursite.com'
    port_range_start INTEGER DEFAULT 3000,
    port_range_end INTEGER DEFAULT 4999,
    max_deployments_per_user INTEGER DEFAULT 5,
    auto_cleanup_days INTEGER DEFAULT 7,
    status TEXT DEFAULT 'active', -- active, inactive, error
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Branch deployments tracking table
CREATE TABLE IF NOT EXISTS branch_deployments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER NOT NULL,
    server_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    branch TEXT NOT NULL,
    container_name TEXT NOT NULL UNIQUE,
    port INTEGER NOT NULL,
    subdomain TEXT, -- e.g. 'app-john-feature-login'
    full_url TEXT, -- complete URL to access the deployment
    status TEXT DEFAULT 'pending', -- pending, deploying, running, stopped, error, cleanup
    commit_hash TEXT,
    deploy_config TEXT, -- JSON string with deployment configuration
    resources_config TEXT, -- JSON string with container resource limits
    health_check_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_deployed DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME, -- when to auto-cleanup
    FOREIGN KEY (server_id) REFERENCES deployment_servers(id) ON DELETE CASCADE,
    UNIQUE(project_id, username, branch, server_id) -- one deployment per user per branch per server
);

-- Deployment history and logs table
CREATE TABLE IF NOT EXISTS deployment_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    deployment_id INTEGER NOT NULL,
    step TEXT NOT NULL, -- e.g. 'port_allocation', 'docker_build', 'nginx_config', 'health_check'
    status TEXT NOT NULL, -- pending, running, success, error, skipped
    output TEXT, -- command output or error message
    details TEXT, -- additional JSON details
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    completed_at DATETIME,
    FOREIGN KEY (deployment_id) REFERENCES branch_deployments(id) ON DELETE CASCADE
);

-- Port allocation tracking (to prevent conflicts)
CREATE TABLE IF NOT EXISTS port_allocations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    server_id INTEGER NOT NULL,
    port INTEGER NOT NULL,
    deployment_id INTEGER,
    reserved_until DATETIME DEFAULT (datetime('now', '+1 hour')), -- temp reservation
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (server_id) REFERENCES deployment_servers(id) ON DELETE CASCADE,
    FOREIGN KEY (deployment_id) REFERENCES branch_deployments(id) ON DELETE CASCADE,
    UNIQUE(server_id, port)
);

-- Deployment templates for different project types
CREATE TABLE IF NOT EXISTS deployment_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    project_type TEXT, -- node, python, php, etc.
    docker_compose_template TEXT NOT NULL, -- template with variables
    nginx_template TEXT, -- nginx config template
    workflow_template TEXT, -- CI/CD workflow template
    environment_variables TEXT, -- JSON string with default env vars
    health_check_config TEXT, -- JSON string with health check settings
    resource_limits TEXT, -- JSON string with default resource limits
    is_default BOOLEAN DEFAULT FALSE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Add indexes for better performance
CREATE INDEX IF NOT EXISTS idx_branch_deployments_user_project ON branch_deployments(username, project_id);
CREATE INDEX IF NOT EXISTS idx_branch_deployments_status ON branch_deployments(status);
CREATE INDEX IF NOT EXISTS idx_branch_deployments_expires ON branch_deployments(expires_at);
CREATE INDEX IF NOT EXISTS idx_deployment_logs_deployment ON deployment_logs(deployment_id);
CREATE INDEX IF NOT EXISTS idx_port_allocations_server_port ON port_allocations(server_id, port);

-- Insert default deployment server (can be updated via UI)
INSERT OR IGNORE INTO deployment_servers (
    id, name, host, username, base_domain, 
    docker_compose_path, nginx_config_path,
    port_range_start, port_range_end
) VALUES (
    1, 'Default Dev Server', 'localhost', 'deploy', 'dev.localhost',
    '/opt/deployments', '/etc/nginx/sites-available',
    3000, 4999
);

-- Insert default deployment template for Node.js projects
INSERT OR IGNORE INTO deployment_templates (
    name, description, project_type, is_default,
    docker_compose_template, nginx_template, workflow_template,
    environment_variables, health_check_config, resource_limits
) VALUES (
    'Node.js Default', 'Default template for Node.js applications', 'node', TRUE,
    '# Docker Compose template will be stored here as JSON',
    '# Nginx template will be stored here',
    '# GitHub/Gitea Actions template will be stored here',
    '{"NODE_ENV":"production","PORT":"3000"}',
    '{"path":"/health","timeout":30,"retries":3}',
    '{"memory":"512m","cpus":"0.5"}'
);

-- Add deployment-related columns to existing projects table if needed
-- Check if columns exist before adding them to avoid errors
-- Note: SQLite doesn't support IF NOT EXISTS for columns, so we'll handle this in the migration code