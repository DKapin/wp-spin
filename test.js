import { execSync } from "node:child_process";
import fs from 'node:fs';

console.log("Testing wp-spin project structure...");

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
  if (!fs.existsSync(file)) {
    missingFiles.push(file);
  }
}

if (missingFiles.length > 0) {
  console.error("Missing required files:", missingFiles.join(", "));
  throw new Error(`Project missing required files: ${missingFiles.join(", ")}`);
}

// Check if the project builds
try {
  execSync("npm run build", {stdio: "inherit"});
  console.log("Build successful!");
} catch (error) {
  console.error("Build failed:", error.message);
  throw new Error(`Build failed: ${error.message}`);
}

// Check help commands to ensure basic functionality works
try {
  execSync("node bin/run.js --help", {stdio: "inherit"});
  console.log("Help command works!");
} catch (error) {
  console.error("Help command failed:", error.message);
  throw new Error(`Help command failed: ${error.message}`);
}

console.log("All tests passed!");
