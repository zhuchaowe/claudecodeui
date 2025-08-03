-- Add Gitea OAuth support columns to users table
-- This migration adds support for Gitea authentication

-- Add gitea_token column if it doesn't exist
-- Note: This is handled by the migration script in db.js

-- Add gitea_username column if it doesn't exist  
-- Note: This is handled by the migration script in db.js

-- Create index for gitea_username for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_gitea_username ON users(gitea_username);