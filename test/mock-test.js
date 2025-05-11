import { execSync } from "node:child_process";
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Get the current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

console.log("Testing wp-spin commands in mock mode...");

// Set environment variable to use mock
process.env.NODE_ENV = 'test';
process.env.USE_DOCKER_MOCK = 'true';

// Create a test directory name
const testDirName = 'mock-test-site';
const testDir = path.join(projectRoot, testDirName);

// Clean up any previous test directory
if (fs.existsSync(testDir)) {
  try {
    console.log(`Removing previous test directory: ${testDir}`);
    if (process.platform === 'win32') {
      execSync(`rmdir /s /q "${testDir}"`, { stdio: 'ignore' });
    } else {
      execSync(`rm -rf "${testDir}"`, { stdio: 'ignore' });
    }
  } catch (error) {
    console.error("Failed to clean up previous test directory:", error.message);
  }
}

// Run a simpler test to check that the command structure works
try {
  // Test help command only
  console.log("\n🧪 Testing help command...");
  execSync(`node ${projectRoot}/bin/run.js --help`, { 
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: 'inherit'
  });
  console.log("✅ Help command successful!");
  
  // Test init command help
  console.log("\n🧪 Testing init command help...");
  execSync(`node ${projectRoot}/bin/run.js init --help`, { 
    env: { ...process.env, NODE_ENV: 'test' },
    stdio: 'inherit'
  });
  console.log("✅ Init command help successful!");
  
  // Report success
  console.log("\n✅ Basic command tests passed!");
  
} catch (error) {
  console.error("\n❌ Tests failed:", error.message);
  throw error;
} finally {
  // Clean up test directory if it somehow got created
  if (fs.existsSync(testDir)) {
    try {
      console.log(`\nCleaning up test directory: ${testDir}`);
      if (process.platform === 'win32') {
        execSync(`rmdir /s /q "${testDir}"`, { stdio: 'ignore' });
      } else {
        execSync(`rm -rf "${testDir}"`, { stdio: 'ignore' });
      }
      
      console.log("✨ Cleanup complete");
    } catch (error) {
      console.error("Failed to clean up test directory:", error.message);
    }
  }
} 