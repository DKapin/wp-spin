#!/usr/bin/env node

/**
 * This script verifies that wp-spin is installed correctly
 * and that all commands are registered properly.
 */

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Colors for terminal output
const colors = {
  blue: '\u001B[34m',
  green: '\u001B[32m',
  red: '\u001B[31m',
  reset: '\u001B[0m',
  yellow: '\u001B[33m'
};

// Get the project root directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, '..');

console.log(`${colors.blue}Validating wp-spin installation...${colors.reset}`);

// Function to handle errors
function handleError(message, suggestion) {
  console.error(`${colors.red}Error: ${message}${colors.reset}`);
  if (suggestion) {
    console.log(`${colors.yellow}${suggestion}${colors.reset}`);
  }
  throw new Error(message);
}

// Check if oclif.manifest.json exists
const manifestPath = join(projectRoot, 'oclif.manifest.json');
if (!fs.existsSync(manifestPath)) {
  handleError(
    'oclif.manifest.json not found.',
    "Please run 'npm run manifest' to generate it."
  );
}

// Check manifest content
try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const commandCount = Object.keys(manifest.commands).length;
  
  if (commandCount === 0) {
    handleError(
      'No commands found in oclif.manifest.json',
      "Please rebuild the project with 'npm run build && npm run manifest'"
    );
  }
  
  console.log(`${colors.green}✓ Manifest file contains ${commandCount} commands${colors.reset}`);
} catch (error) {
  handleError(`Parsing manifest file: ${error.message}`);
}

// Check dist directory
const distPath = join(projectRoot, 'dist');
if (!fs.existsSync(distPath)) {
  handleError(
    'dist directory not found',
    "Please run 'npm run build' to compile the project"
  );
}

// Check commands directory
const commandsPath = join(distPath, 'commands');
if (!fs.existsSync(commandsPath)) {
  handleError(
    'commands directory not found in dist',
    "Please run 'npm run build' to compile the project"
  );
}

// Count command files
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));
if (commandFiles.length === 0) {
  handleError(
    'No command files found in dist/commands',
    "Please run 'npm run build' to compile the project"
  );
}

console.log(`${colors.green}✓ Found ${commandFiles.length} command files${colors.reset}`);

// Test wp-spin --help
try {
  const helpOutput = execSync('wp-spin --help', { encoding: 'utf8' });
  if (helpOutput.includes('COMMANDS') && helpOutput.includes('init')) {
    console.log(`${colors.green}✓ wp-spin CLI is working correctly${colors.reset}`);
  } else {
    handleError(
      'wp-spin --help did not show expected output',
      "Please reinstall the package with 'npm uninstall -g wp-spin && npm install -g .'"
    );
  }
} catch (error) {
  handleError(
    `Running wp-spin --help: ${error.message}`,
    "Please ensure wp-spin is installed globally with 'npm install -g .'"
  );
}

console.log(`${colors.green}Validation complete! wp-spin is properly installed and configured.${colors.reset}`);

// Display some helpful commands
console.log(`${colors.yellow}Common Commands:${colors.reset}`);
console.log('  wp-spin init my-site     - Create a new WordPress site');
console.log('  wp-spin start            - Start a WordPress environment');
console.log('  wp-spin stop             - Stop a WordPress environment');
console.log('  wp-spin logs             - View logs from WordPress containers'); 