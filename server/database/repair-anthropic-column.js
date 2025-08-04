#!/usr/bin/env node

/**
 * Database repair script to add the anthropic_config column
 * Run this if the anthropic_config column is missing from the users table
 */

import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = path.join(__dirname, 'auth.db');

console.log('🔧 Repairing database schema...');
console.log('Database path:', DB_PATH);

try {
  const db = new Database(DB_PATH);
  
  // Check if users table exists
  const usersTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get();
  if (!usersTable) {
    console.log('❌ Users table not found. Database may not be initialized.');
    process.exit(1);
  }
  
  // Check if anthropic_config column exists
  const columns = db.prepare("PRAGMA table_info(users)").all();
  const hasAnthropicConfig = columns.some(col => col.name === 'anthropic_config');
  
  if (hasAnthropicConfig) {
    console.log('✅ anthropic_config column already exists');
  } else {
    console.log('➕ Adding anthropic_config column...');
    db.exec('ALTER TABLE users ADD COLUMN anthropic_config TEXT');
    console.log('✅ Successfully added anthropic_config column');
  }
  
  // Verify the column was added
  const updatedColumns = db.prepare("PRAGMA table_info(users)").all();
  console.log('📋 Current users table columns:');
  updatedColumns.forEach(col => {
    console.log(`  - ${col.name} (${col.type})`);
  });
  
  db.close();
  console.log('✅ Database repair completed successfully');
  
} catch (error) {
  console.error('❌ Error repairing database:', error.message);
  process.exit(1);
}