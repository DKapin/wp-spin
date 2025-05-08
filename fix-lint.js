#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'node:fs/promises';

// Files to fix
const filesToFix = [
  'src/services/docker.ts',
  'src/commands/init.ts'
];

async function main() {
  console.log('🧹 Fixing common lint issues...');
  
  const processFiles = filesToFix.map(async (file) => {
    console.log(`Processing ${file}...`);
    
    try {
      // Read the file
      let content = await fs.readFile(file, 'utf8');
      
      // Remove unused imports and variables
      if (file === 'src/services/docker.ts') {
        // Fix imports
        content = content.replace(/import type \{ Stats \} from 'node:fs';/, '');
        content = content.replace(/import \{ constants \} from 'node:fs';/, '');
        content = content.replace(/import \{ access, chmod, mkdir, readFile, unlink, writeFile \} from 'node:fs\/promises';/, '');
        content = content.replace(/import \* as path from 'node:path';/, '');
        
        // Fix unused variables
        content = content.replace(/const isArm = this.architecture === 'arm64';/, '// ARM detection');
        content = content.replace(/const mysqlPort = this.portMappings\[DEFAULT_PORTS.MYSQL\] \|\| DEFAULT_PORTS.MYSQL;/, '// Using MySQL port mapping');
        content = content.replace(/const mysqlContainer = `\${projectName}_mysql`;/, '// MySQL container name');
      }
      
      // Write the file back
      await fs.writeFile(file, content);
      
      console.log(`✅ Fixed ${file}`);
    } catch {
      console.error(`❌ Error fixing ${file}`);
    }
  });
  
  // Wait for all files to be processed
  await Promise.all(processFiles);
  
  // Run ESLint with fix
  try {
    console.log('\nRunning ESLint with --fix...');
    execSync('npx eslint --fix "src/**/*.ts" "test/**/*.ts"', { stdio: 'inherit' });
  } catch {
    console.log('\n⚠️ ESLint found some issues that could not be automatically fixed.');
  }
  
  console.log('\n✅ Linting fixes applied! Some manual fixes may still be needed.');
}

// Use top-level await instead of promise chain
await main(); 