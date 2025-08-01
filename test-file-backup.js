#!/usr/bin/env node

import fetch from 'node-fetch';
import fs from 'fs/promises';
import path from 'path';

async function testFileBackup() {
  console.log('🧪 Testing file backup functionality...\n');
  
  const API_URL = 'http://localhost:3008';
  const TEST_FILE = '/tmp/test-backup-file.txt';
  const TOKEN = process.env.TEST_TOKEN || 'test-token'; // You might need to get a real token
  
  try {
    // 1. Create a test file
    console.log('1️⃣ Creating test file...');
    await fs.writeFile(TEST_FILE, 'Original content\n');
    console.log(`✅ Created test file: ${TEST_FILE}`);
    
    // 2. Simulate file edit through API
    console.log('\n2️⃣ Editing file through API...');
    const response = await fetch(`${API_URL}/api/projects/test-project/file`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${TOKEN}`
      },
      body: JSON.stringify({
        filePath: TEST_FILE,
        content: 'Modified content\n'
      })
    });
    
    if (!response.ok) {
      const error = await response.text();
      console.error('❌ API request failed:', error);
      console.log('\n💡 Note: You may need to provide a valid auth token');
      return;
    }
    
    const result = await response.json();
    console.log('✅ File edited successfully:', result);
    
    // 3. Check backup directory
    console.log('\n3️⃣ Checking backup directory...');
    const backupBaseDir = process.env.BACKUP_DIR || path.join(process.env.HOME || '/tmp', '.claudecode_backups');
    const backupDir = path.join(backupBaseDir, 'files');
    console.log(`📁 Backup directory: ${backupDir}`);
    
    try {
      const files = await fs.readdir(backupDir);
      console.log(`📋 Found ${files.length} files in backup directory:`);
      
      // Find our backup
      const testFileBackups = files.filter(f => f.includes('test-backup-file.txt'));
      if (testFileBackups.length > 0) {
        console.log('✅ Found backup files:', testFileBackups);
        
        // Check backup content
        const latestBackup = testFileBackups.sort().pop();
        const backupContent = await fs.readFile(path.join(backupDir, latestBackup), 'utf8');
        console.log(`📄 Backup content: "${backupContent.trim()}"`);
        
        if (backupContent.trim() === 'Original content') {
          console.log('✅ Backup contains original content as expected!');
        } else {
          console.log('❌ Backup content doesn\'t match expected original content');
        }
      } else {
        console.log('❌ No backup files found for test file');
      }
    } catch (err) {
      console.error('❌ Could not access backup directory:', err.message);
    }
    
    // 4. Clean up
    console.log('\n4️⃣ Cleaning up...');
    await fs.unlink(TEST_FILE);
    console.log('✅ Test file removed');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run test
console.log('🚀 File Backup Feature Test\n');
console.log('This test will verify that file edits create backups outside the project directory.\n');

testFileBackup().catch(console.error);