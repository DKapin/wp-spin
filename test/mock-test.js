import { execSync } from "node:child_process";
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Get the current directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');

console.log("Testing wp-spin commands with Docker service mock...");

// Set environment variable to use mock
process.env.NODE_ENV = 'test';
process.env.USE_DOCKER_MOCK = 'true';

// Check for critical files
const requiredFiles = [
  "package.json",
  "src/index.ts",
  "src/commands/init.ts",
  "src/commands/start.ts",
  "src/commands/stop.ts",
  "bin/run.js"
];

const missingFiles = [];
for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(projectRoot, file))) {
    missingFiles.push(file);
  }
}

if (missingFiles.length > 0) {
  console.error("Missing required files:", missingFiles.join(", "));
  throw new Error(`Project missing required files: ${missingFiles.join(", ")}`);
}

// Create a test directory
const testDir = path.join(projectRoot, 'mock-test-site');

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

// Test commands in sequence
try {
  // Test init command
  console.log("\n🧪 Testing init command...");
  execSync(`node ${projectRoot}/bin/run.js init ${testDir}`, { 
    stdio: 'inherit',
    env: { ...process.env, USE_DOCKER_MOCK: 'true', NODE_ENV: 'test' }
  });
  console.log("✅ Init command successful!");

  // Verify files were created
  const requiredProjectFiles = [
    "docker-compose.yml",
    ".env"
  ];
  
  for (const file of requiredProjectFiles) {
    const filePath = path.join(testDir, file);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Init command failed: ${file} was not created`);
    }
  }

  // Test start command
  console.log("\n🧪 Testing start command...");
  execSync(`cd "${testDir}" && node ${projectRoot}/bin/run.js start`, { 
    stdio: 'inherit',
    env: { ...process.env, USE_DOCKER_MOCK: 'true', NODE_ENV: 'test' }
  });
  console.log("✅ Start command successful!");
  
  // Test status command
  console.log("\n🧪 Testing status command...");
  execSync(`cd "${testDir}" && node ${projectRoot}/bin/run.js status`, { 
    stdio: 'inherit',
    env: { ...process.env, USE_DOCKER_MOCK: 'true', NODE_ENV: 'test' }
  });
  console.log("✅ Status command successful!");
  
  // Test stop command
  console.log("\n🧪 Testing stop command...");
  execSync(`cd "${testDir}" && node ${projectRoot}/bin/run.js stop`, { 
    stdio: 'inherit',
    env: { ...process.env, USE_DOCKER_MOCK: 'true', NODE_ENV: 'test' }
  });
  console.log("✅ Stop command successful!");
  
  // Test restart command
  console.log("\n🧪 Testing restart command...");
  execSync(`cd "${testDir}" && node ${projectRoot}/bin/run.js restart`, { 
    stdio: 'inherit',
    env: { ...process.env, USE_DOCKER_MOCK: 'true', NODE_ENV: 'test' }
  });
  console.log("✅ Restart command successful!");
  
  // Test logs command
  console.log("\n🧪 Testing logs command...");
  execSync(`cd "${testDir}" && node ${projectRoot}/bin/run.js logs`, { 
    stdio: 'inherit',
    env: { ...process.env, USE_DOCKER_MOCK: 'true', NODE_ENV: 'test' }
  });
  console.log("✅ Logs command successful!");
  
  // Test negative scenarios
  console.log("\n🧪 Testing error handling...");
  
  // Temporarily mock Docker as not running
  const mockFile = path.join(projectRoot, 'src/services/__mocks__/docker.ts');
  let mockContent = fs.readFileSync(mockFile, 'utf8');
  mockContent = mockContent.replace('mockDockerRunning = true;', 'mockDockerRunning = false;');
  fs.writeFileSync(mockFile, mockContent);
  
  let errorCaught = false;
  try {
    // This should fail because Docker is "not running"
    execSync(`cd "${testDir}" && node ${projectRoot}/bin/run.js start`, { 
      stdio: 'ignore',
      env: { ...process.env, USE_DOCKER_MOCK: 'true', NODE_ENV: 'test' }
    });
  } catch (error) {
    errorCaught = true;
    console.log("✅ Error handling test passed - Docker not running error caught correctly");
  }
  
  if (!errorCaught) {
    throw new Error("Error handling test failed - should have caught Docker not running error");
  }
  
  // Reset the mock
  mockContent = mockContent.replace('mockDockerRunning = false;', 'mockDockerRunning = true;');
  fs.writeFileSync(mockFile, mockContent);
  
  console.log("\n✅ All tests passed!");
} catch (error) {
  console.error("\n❌ Tests failed:", error.message);
  throw error;
} finally {
  // Clean up test directory
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