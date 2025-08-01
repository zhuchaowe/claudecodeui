#!/usr/bin/env node

// Git askpass helper script
// This script is invoked by git when it needs credentials
// It reads the prompt from command line args and returns the credential via stdout

const fs = require('fs');
const path = require('path');

// Get the prompt from git
const prompt = process.argv[2] || '';

// Get session ID from environment variable
const sessionId = process.env.GIT_CREDENTIAL_SESSION_ID;
const credentialType = process.env.GIT_CREDENTIAL_TYPE;

if (!sessionId) {
  console.error('No session ID provided');
  process.exit(1);
}

// Path to credential cache file
const cacheDir = path.join(__dirname, '.git-credentials-cache');
const cacheFile = path.join(cacheDir, `${sessionId}.json`);

try {
  // Ensure cache directory exists
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true, mode: 0o700 });
  }

  // Read cached credentials
  if (fs.existsSync(cacheFile)) {
    const credentials = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    
    // Check if credentials are expired (1 hour timeout)
    const now = Date.now();
    if (credentials.timestamp && (now - credentials.timestamp) > 3600000) {
      fs.unlinkSync(cacheFile);
      console.error('Credentials expired');
      process.exit(1);
    }
    
    // Determine which credential to return based on the prompt
    if (prompt.toLowerCase().includes('username')) {
      console.log(credentials.username || '');
    } else if (prompt.toLowerCase().includes('password')) {
      console.log(credentials.password || '');
    } else if (prompt.toLowerCase().includes('token')) {
      console.log(credentials.token || credentials.password || '');
    } else {
      // Default to password for unknown prompts
      console.log(credentials.password || '');
    }
    
    process.exit(0);
  } else {
    console.error('No cached credentials found');
    process.exit(1);
  }
} catch (error) {
  console.error('Error reading credentials:', error.message);
  process.exit(1);
}