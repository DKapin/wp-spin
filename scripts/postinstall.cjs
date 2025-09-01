#!/usr/bin/env node
// Post-install script to automatically set up wp-spin rm hook

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class PostInstallHookSetup {
  constructor() {
    this.isGlobalInstall = this.detectGlobalInstall();
    this.skipOnDev =
      process.env.NODE_ENV !== 'production' && process.cwd().includes('wp-spin');
  }

  detectGlobalInstall() {
    // Check if this is a global npm install
    return (
      process.env.npm_config_global === 'true' ||
      (process.env.npm_prefix && process.argv[0].includes(process.env.npm_prefix))
    );
  }

  detectShell() {
    const shell = process.env.SHELL || '';

    if (shell.includes('zsh') || process.env.ZSH_VERSION) {
      return { shellRc: path.join(os.homedir(), '.zshrc') };
    }

    if (shell.includes('bash') || process.env.BASH_VERSION) {
      return { shellRc: path.join(os.homedir(), '.bashrc') };
    }

    if (shell.includes('fish')) {
      return { shellRc: path.join(os.homedir(), '.config', 'fish', 'config.fish') };
    }

    // Default to bash
    return { shellRc: path.join(os.homedir(), '.bashrc') };
  }

  getHookScriptPath() {
    // For global installs, the hook script should be in the npm global location
    if (this.isGlobalInstall) {
      try {
        const globalPath = execSync('npm root -g', { encoding: 'utf8' }).trim();
        const hookPath = path.join(globalPath, 'wp-spin', 'scripts', 'wp-spin-rm-hook.sh');
        if (fs.existsSync(hookPath)) return hookPath;
      } catch {
        // Fallback to relative path
      }
    }
    
    // For local installs or fallback
    return path.resolve(__dirname, 'wp-spin-rm-hook.sh');
  }

  installHookSilently() {
    try {
      // Skip in development or if not a global install during development
      if (this.skipOnDev) {
        console.log('🔧 wp-spin development mode - skipping automatic hook installation');
        console.log('   Run "wpspin hook install" manually to test hook functionality');
        return;
      }

      const { shellRc } = this.detectShell();
      const hookScript = this.getHookScriptPath();

      // Check if hook script exists
      if (!fs.existsSync(hookScript)) {
        console.log(`⚠️  Hook script not found at: ${hookScript}`);
        return;
      }

      // Check if already installed
      if (this.isHookAlreadyInstalled(shellRc)) {
        return; // Silently skip if already installed
      }

      // Add hook to shell RC
      const hookLine = `source '${hookScript}'`;
      const hookComment =
        '# wp-spin rm hook - automatically cleanup wp-spin projects on rm -rf';

      fs.appendFileSync(shellRc, `\n${hookComment}\n${hookLine}\n`);

      console.log('✅ wp-spin rm hook installed automatically!');
      console.log(`   Restart your terminal or run: source ${shellRc}`);
      console.log('   Now "rm -rf" on wp-spin projects will prompt for cleanup options!');
      console.log('');
      console.log('📖 Interactive prompts will offer:');
      console.log('   • Full cleanup (Docker containers + volumes)');
      console.log('   • Files only (leave containers running)');
      console.log('   • Cancel operation');
      console.log('   • Remember choice for future');
      console.log('');
      console.log('   To disable: wpspin hook uninstall');
    } catch {
      // Silently fail - don't break installation if hook setup fails
      console.log('⚠️  Could not automatically install wp-spin rm hook');
      console.log('   You can install it manually later with: wpspin hook install');
    }
  }

  isHookAlreadyInstalled(shellRc) {
    if (!fs.existsSync(shellRc)) return false;
    try {
      const content = fs.readFileSync(shellRc, 'utf8');
      return content.includes('wp-spin-rm-hook.sh');
    } catch {
      return false;
    }
  }

  run() {
    // Only install hook for global installs or in production
    if (this.isGlobalInstall || process.env.NODE_ENV === 'production') {
      this.installHookSilently();
    }
  }
}

// Run only if executed directly (ESM-friendly equivalent of `require.main === module`)
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  new PostInstallHookSetup().run();
}
