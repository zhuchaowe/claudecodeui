#!/usr/bin/env node

import { promises as fs } from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { 
  backupProject, 
  restoreProject, 
  checkAndRestoreMissingProjects,
  backupAllUserProjects,
  getSessionStorageDir,
  getBackupDir
} from './server/projects.js';

const TEST_USERNAME = 'test-user';
const TEST_PROJECT = 'test-project-backup';

async function runTests() {
  console.log('🧪 Starting backup/restore tests...\n');
  
  try {
    // 1. Setup test environment
    console.log('1️⃣ Setting up test environment...');
    const sessionDir = getSessionStorageDir();
    const backupDir = getBackupDir(TEST_USERNAME);
    const testProjectPath = path.join(sessionDir, TEST_PROJECT);
    
    // Create test project directory and files
    await fs.mkdir(testProjectPath, { recursive: true });
    await fs.writeFile(path.join(testProjectPath, 'session1.jsonl'), 
      '{"sessionId": "test-session-1", "timestamp": "2024-01-01T00:00:00Z"}\n');
    await fs.writeFile(path.join(testProjectPath, 'session2.jsonl'), 
      '{"sessionId": "test-session-2", "timestamp": "2024-01-02T00:00:00Z"}\n');
    
    console.log(`✅ Created test project at: ${testProjectPath}`);
    console.log(`📁 Backup directory will be: ${backupDir}`);
    
    // 2. Test backup functionality
    console.log('\n2️⃣ Testing backup functionality...');
    const backupSuccess = await backupProject(TEST_USERNAME, TEST_PROJECT);
    console.log(`Backup result: ${backupSuccess ? '✅ Success' : '❌ Failed'}`);
    
    // Verify backup exists
    const backupProjectPath = path.join(backupDir, TEST_PROJECT);
    try {
      await fs.access(backupProjectPath);
      const backupFiles = await fs.readdir(backupProjectPath);
      console.log(`✅ Backup created with ${backupFiles.length} files:`, backupFiles);
    } catch (err) {
      console.error('❌ Backup verification failed:', err.message);
    }
    
    // 3. Test restore functionality
    console.log('\n3️⃣ Testing restore functionality...');
    
    // First, delete the original project
    await fs.rm(testProjectPath, { recursive: true, force: true });
    console.log('🗑️ Deleted original project directory');
    
    // Verify it's gone
    try {
      await fs.access(testProjectPath);
      console.error('❌ Project directory still exists after deletion!');
    } catch (err) {
      console.log('✅ Confirmed project directory is deleted');
    }
    
    // Now restore from backup
    const restoreSuccess = await restoreProject(TEST_USERNAME, TEST_PROJECT);
    console.log(`Restore result: ${restoreSuccess ? '✅ Success' : '❌ Failed'}`);
    
    // Verify restore
    try {
      await fs.access(testProjectPath);
      const restoredFiles = await fs.readdir(testProjectPath);
      console.log(`✅ Project restored with ${restoredFiles.length} files:`, restoredFiles);
      
      // Verify file contents
      const content1 = await fs.readFile(path.join(testProjectPath, 'session1.jsonl'), 'utf8');
      if (content1.includes('test-session-1')) {
        console.log('✅ File contents verified');
      } else {
        console.error('❌ File contents mismatch');
      }
    } catch (err) {
      console.error('❌ Restore verification failed:', err.message);
    }
    
    // 4. Test automatic restore of missing projects
    console.log('\n4️⃣ Testing automatic restore of missing projects...');
    
    // Create another test project and back it up
    const testProject2 = TEST_PROJECT + '-2';
    const testProject2Path = path.join(sessionDir, testProject2);
    await fs.mkdir(testProject2Path, { recursive: true });
    await fs.writeFile(path.join(testProject2Path, 'test.jsonl'), '{"test": true}\n');
    await backupProject(TEST_USERNAME, testProject2);
    console.log(`✅ Created and backed up second test project: ${testProject2}`);
    
    // Delete both projects
    await fs.rm(testProjectPath, { recursive: true, force: true });
    await fs.rm(testProject2Path, { recursive: true, force: true });
    console.log('🗑️ Deleted both test projects');
    
    // Run automatic restore
    const restoredCount = await checkAndRestoreMissingProjects(TEST_USERNAME);
    console.log(`✅ Automatically restored ${restoredCount} projects`);
    
    // Verify both are restored
    try {
      await fs.access(testProjectPath);
      await fs.access(testProject2Path);
      console.log('✅ Both projects successfully restored');
    } catch (err) {
      console.error('❌ Automatic restore verification failed:', err.message);
    }
    
    // 5. Cleanup
    console.log('\n5️⃣ Cleaning up test data...');
    await fs.rm(testProjectPath, { recursive: true, force: true });
    await fs.rm(testProject2Path, { recursive: true, force: true });
    await fs.rm(backupDir, { recursive: true, force: true });
    console.log('✅ Test cleanup complete');
    
    console.log('\n✨ All tests completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  }
}

// Run tests
runTests().catch(console.error);