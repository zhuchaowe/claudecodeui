-- Add anthropic_config column to users table if it doesn't exist
-- This migration adds support for user-specific Anthropic API configuration

-- Check if column exists and add it if it doesn't
-- SQLite doesn't support IF NOT EXISTS for ALTER TABLE ADD COLUMN, 
-- so we need to handle this in the application code
ALTER TABLE users ADD COLUMN anthropic_config TEXT;