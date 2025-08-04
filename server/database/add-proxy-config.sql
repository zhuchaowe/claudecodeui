-- Add proxy configuration columns to users table
ALTER TABLE users ADD COLUMN proxy_config TEXT;

-- Proxy config will be stored as JSON string containing:
-- {
--   "enabled": boolean,
--   "openaiApiKey": string,
--   "openaiBaseUrl": string,
--   "bigModel": string,
--   "smallModel": string
-- }