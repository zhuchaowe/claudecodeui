// Fix for claude-cli.js spawn issue in Docker
// Add this code before the spawn call around line 258

// Ensure working directory exists
import { mkdirSync, existsSync } from 'fs';

// Before line 258 where spawn is called, add:
if (workingDir && !existsSync(workingDir)) {
  console.log(`Creating missing working directory: ${workingDir}`);
  try {
    mkdirSync(workingDir, { recursive: true });
  } catch (err) {
    console.error(`Failed to create working directory: ${err.message}`);
    // Fall back to /app directory which should exist
    workingDir = '/app';
  }
}

// Also modify the spawn call to handle the case where cwd doesn't exist:
const spawnOptions = {
  stdio: ['pipe', 'pipe', 'pipe'],
  env: { ...process.env }
};

// Only add cwd if it exists
if (workingDir && existsSync(workingDir)) {
  spawnOptions.cwd = workingDir;
} else {
  console.warn(`Working directory ${workingDir} does not exist, using default`);
  spawnOptions.cwd = '/app'; // Use a safe default
}

const claudeProcess = spawn(cliCommand, args, spawnOptions);