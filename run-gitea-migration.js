import Database from 'better-sqlite3';
import path from 'path';

const dbPath = path.join('./server/database/auth.db');
const db = new Database(dbPath);

console.log('Running Gitea migration...\n');

try {
  // Check and add gitea_token column
  const hasGiteaToken = db.prepare("PRAGMA table_info(users)").all()
    .some(col => col.name === 'gitea_token');
  
  if (!hasGiteaToken) {
    console.log('Adding gitea_token column...');
    db.exec('ALTER TABLE users ADD COLUMN gitea_token TEXT');
    console.log('✓ gitea_token column added');
  } else {
    console.log('✓ gitea_token column already exists');
  }

  // Check and add gitea_username column
  const hasGiteaUsername = db.prepare("PRAGMA table_info(users)").all()
    .some(col => col.name === 'gitea_username');
  
  if (!hasGiteaUsername) {
    console.log('Adding gitea_username column...');
    db.exec('ALTER TABLE users ADD COLUMN gitea_username TEXT');
    console.log('✓ gitea_username column added');
  } else {
    console.log('✓ gitea_username column already exists');
  }

  // Create index for gitea_username
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_users_gitea_username ON users(gitea_username)');
    console.log('✓ Index for gitea_username created');
  } catch (err) {
    console.log('✓ Index for gitea_username already exists');
  }

  console.log('\n✅ Gitea migration completed successfully!');
} catch (error) {
  console.error('❌ Migration failed:', error.message);
} finally {
  db.close();
}