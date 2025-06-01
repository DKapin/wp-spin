import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import sinonChai from 'sinon-chai';

// Add chai plugins
chai.use(chaiAsPromised);
chai.use(sinonChai);

// Set up common test environment variables
process.env.NODE_ENV = 'test';

// Add assertions to make tests more readable
// Note: No longer using sinon.assert.expose since we're using named imports
// If this causes issues in tests, we can import assert separately

describe('global cleanup', () => {
  after(async () => {
    // Clean up temp directory (used by integration tests)
    const tempDir = path.join(process.cwd(), 'temp');
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { force: true, recursive: true });
        console.log('✨ Cleaned up temp directory');
      } catch {
        console.warn('Warning: Failed to clean up temp directory');
      }
    }

    // Clean up mock test site directory
    const mockTestDir = path.join(process.cwd(), 'test', 'mock-test-site');
    if (fs.existsSync(mockTestDir)) {
      try {
        fs.rmSync(mockTestDir, { force: true, recursive: true });
        console.log('✨ Cleaned up mock-test-site directory');
      } catch {
        console.warn('Warning: Failed to clean up mock-test-site directory');
      }
    }

    // Clean up test project directories (e.g., test-project, test-project*)
    const testProjectPattern = /^test-project/;
    const testDir = process.cwd();
    for (const file of fs.readdirSync(testDir)) {
      if (testProjectPattern.test(file)) {
        const fullPath = path.join(testDir, file);
        if (fs.lstatSync(fullPath).isDirectory()) {
          try {
            fs.rmSync(fullPath, { force: true, recursive: true });
            console.log(`✨ Cleaned up ${file} directory`);
          } catch {
            console.warn(`Warning: Failed to clean up ${file} directory`);
          }
        }
      }
    }

    // Optionally: Clean up test Docker containers (named test-project*)
    try {
      execSync('docker rm -f $(docker ps -aq --filter "name=test-project")', { stdio: 'ignore' });
      console.log('✨ Cleaned up test Docker containers');
    } catch {
      // Ignore errors if no containers exist
    }
  });
});