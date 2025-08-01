#!/usr/bin/env node

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

async function checkBackupFunction() {
  console.log('🔍 Checking file backup implementation...\n');
  
  // Check default backup directory
  const backupBaseDir = process.env.BACKUP_DIR || path.join(process.env.HOME || '/tmp', '.claudecode_backups');
  const backupDir = path.join(backupBaseDir, 'files');
  console.log(`📁 Backup directory would be: ${backupDir}`);
  
  // Check if backup directory exists
  try {
    await fs.access(backupDir);
    const files = await fs.readdir(backupDir);
    console.log(`✅ Backup directory exists with ${files.length} files`);
    
    if (files.length > 0) {
      console.log('\n📋 Recent backup files:');
      // Show last 5 files
      files.slice(-5).forEach(file => {
        console.log(`  - ${file}`);
      });
      
      // Check for metadata files
      const metadataFiles = files.filter(f => f.endsWith('.metadata.json'));
      if (metadataFiles.length > 0) {
        console.log(`\n📊 Found ${metadataFiles.length} metadata files`);
        
        // Read one metadata file as example
        const sampleMetadata = await fs.readFile(
          path.join(backupDir, metadataFiles[0]), 
          'utf8'
        );
        console.log('\n📄 Sample metadata:');
        console.log(JSON.stringify(JSON.parse(sampleMetadata), null, 2));
      }
    }
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('❌ Backup directory does not exist yet');
      console.log('   It will be created when the first file is edited');
    } else {
      console.error('❌ Error accessing backup directory:', err.message);
    }
  }
  
  // Demonstrate how file hash is calculated
  console.log('\n🔧 Example file hash calculation:');
  const examplePath = '/home/user/project/test.js';
  const fileHash = crypto.createHash('md5').update(examplePath).digest('hex').substring(0, 8);
  console.log(`  Path: ${examplePath}`);
  console.log(`  Hash: ${fileHash}`);
  console.log(`  Backup prefix: ${fileHash}_test.js`);
}

checkBackupFunction().catch(console.error);