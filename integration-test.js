// #!/usr/bin/env node
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log("Running integration tests for wp-spin commands with code coverage...");

// Set proper environment variables for testing and coverage
process.env.NODE_ENV = 'test';
process.env.USE_DOCKER_MOCK = 'true';

// Create a temp directory for testing init command
const tempDir = path.join(__dirname, 'temp', 'test-project-' + Date.now());
if (!fs.existsSync(path.join(__dirname, 'temp'))) {
  fs.mkdirSync(path.join(__dirname, 'temp'));
}

try {
  // Test init command with --yes flag to skip prompts
  console.log("\n🧪 Testing init command...");
  execSync(`node --experimental-vm-modules bin/run.js init ${tempDir} --yes`, { 
    env: { 
      ...process.env, 
      NODE_ENV: 'test', 
      USE_DOCKER_MOCK: 'true' 
    },
    stdio: "inherit"
  });

  // Test status command (should work even without a running site)
  console.log("\n🧪 Testing status command...");
  execSync(`node --experimental-vm-modules bin/run.js status --dir=${tempDir}`, { 
    env: { 
      ...process.env, 
      NODE_ENV: 'test', 
      USE_DOCKER_MOCK: 'true' 
    },
    stdio: "inherit"
  });

  // Test start command - using force flag to skip checks
  console.log("\n🧪 Testing start command...");
  execSync(`node --experimental-vm-modules bin/run.js start --dir=${tempDir} --force`, { 
    env: { 
      ...process.env, 
      NODE_ENV: 'test', 
      USE_DOCKER_MOCK: 'true' 
    },
    stdio: "inherit"
  });

  // Test logs command
  console.log("\n🧪 Testing logs command...");
  execSync(`node --experimental-vm-modules bin/run.js logs --dir=${tempDir}`, { 
    env: { 
      ...process.env, 
      NODE_ENV: 'test', 
      USE_DOCKER_MOCK: 'true' 
    },
    stdio: "inherit"
  });

  // Test stop command
  console.log("\n🧪 Testing stop command...");
  execSync(`node --experimental-vm-modules bin/run.js stop --dir=${tempDir}`, { 
    env: { 
      ...process.env, 
      NODE_ENV: 'test', 
      USE_DOCKER_MOCK: 'true' 
    },
    stdio: "inherit"
  });

  // Test restart command
  console.log("\n🧪 Testing restart command...");
  execSync(`node --experimental-vm-modules bin/run.js restart --dir=${tempDir}`, { 
    env: { 
      ...process.env, 
      NODE_ENV: 'test', 
      USE_DOCKER_MOCK: 'true' 
    },
    stdio: "inherit"
  });

  // Test share command with force flag (no project needed)
  console.log("\n🧪 Testing share command...");
  execSync("node --experimental-vm-modules bin/run.js share --debug --force", { 
    env: { 
      ...process.env, 
      NODE_ENV: 'test', 
      USE_DOCKER_MOCK: 'true' 
    },
    stdio: "inherit"
  });

  // Test unshare command
  console.log("\n🧪 Testing unshare command...");
  execSync("node --experimental-vm-modules bin/run.js unshare --force", { 
    env: { 
      ...process.env, 
      NODE_ENV: 'test', 
      USE_DOCKER_MOCK: 'true' 
    },
    stdio: "inherit"
  });

  // Test deploy command with dry-run flag (prevents any actual deployment)
  console.log("\n🧪 Testing deploy command with dry-run...");
  execSync("node --experimental-vm-modules bin/run.js deploy --dry-run", { 
    env: { 
      ...process.env, 
      NODE_ENV: 'test', 
      USE_DOCKER_MOCK: 'true' 
    },
    stdio: "inherit"
  });

  console.log("\n✅ All integration tests completed successfully!");
} catch (error) {
  console.error("\n❌ Integration tests failed:", error instanceof Error ? error.message : String(error));
  throw new Error(`Integration test failed: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  // Clean up temp directory
  if (fs.existsSync(tempDir)) {
    try {
      console.log(`\nCleaning up test directory: ${tempDir}`);
      fs.rmSync(tempDir, { force: true, recursive: true });
    } catch (cleanupError) {
      console.warn("Cleanup warning:", cleanupError instanceof Error ? cleanupError.message : String(cleanupError));
    }
  }
}
