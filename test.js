import { execSync } from "node:child_process";
import fs from 'node:fs';

console.log("Testing wp-spin help commands...");

// Set environment variable to indicate test mode
process.env.NODE_ENV = 'test';

// Check for critical files
const requiredFiles = [
  "package.json",
  "dist/index.js",
  "dist/commands/init.js",
  "dist/commands/start.js",
  "dist/commands/stop.js",
  "bin/run.js"
];

const missingFiles = [];
for (const file of requiredFiles) {
  if (!fs.existsSync(file)) {
    missingFiles.push(file);
  }
}

if (missingFiles.length > 0) {
  console.error("Missing required files:", missingFiles.join(", "));
  throw new Error(`Project missing required files: ${missingFiles.join(", ")}`);
}

// Check help commands to ensure basic functionality works
try {
  execSync("node bin/run.js --help", {stdio: "inherit"});
  console.log("Help command works!");
} catch (error) {
  console.error("Help command failed:", error.message);
  throw new Error(`Help command failed: ${error.message}`);
}

// Check specific commands help
try {
  execSync("node bin/run.js init --help", {stdio: "inherit"});
  execSync("node bin/run.js start --help", {stdio: "inherit"});
  execSync("node bin/run.js stop --help", {stdio: "inherit"});
  console.log("Command help pages work!");
} catch (error) {
  console.error("Command help failed:", error.message);
  throw new Error(`Command help failed: ${error.message}`);
}

console.log("\nAll tests passed!");

// Set USE_DOCKER_MOCK to true if you want to run the mock tests
// example: NODE_ENV=test USE_DOCKER_MOCK=true npm test
if (process.env.USE_DOCKER_MOCK === 'true') {
  console.log("\n🧪 Would run mock tests here if Docker service mocking was fully implemented");
  console.log("To implement full command testing with mocks:");
  console.log("1. Complete the DockerService mock implementation");
  console.log("2. Update the BaseCommand class to use the mock in test mode");
  console.log("3. Use environment variables to control mock behavior");
}
