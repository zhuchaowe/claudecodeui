-- Migration to add GitHub OAuth columns to existing users table

-- Add github_token column if it doesn't exist
ALTER TABLE users ADD COLUMN github_token TEXT;

-- Add github_username column if it doesn't exist  
ALTER TABLE users ADD COLUMN github_username TEXT;