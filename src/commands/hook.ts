import { Args, Command, Flags } from '@oclif/core';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export default class Hook extends Command {
  static args = {
    action: Args.string({
      description: 'Action to perform',
      options: ['install', 'uninstall', 'status', 'reset-preferences'],
      required: true,
    }),
  };
static description = 'Manage shell hook for automatic wp-spin cleanup (installed by default)';
static examples = [
    '$ wp-spin hook install',
    '$ wp-spin hook uninstall',
    '$ wp-spin hook status',
  ];
static hidden = true;
static flags = {
    force: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Force installation even if already installed',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Hook);
    const { action } = args;

    switch (action) {
      case 'install': {
        await this.installHook(flags.force);
        break;
      }

      case 'reset-preferences': {
        await this.resetPreferences();
        break;
      }

      case 'status': {
        await this.showStatus();
        break;
      }

      case 'uninstall': {
        await this.uninstallHook();
        break;
      }

      default: {
        this.error(`Unknown action: ${action}`);
      }
    }
  }

  private detectShell(): { shellName: string; shellRc: string; } {
    const shell = process.env.SHELL || '';
    
    if (shell.includes('zsh') || process.env.ZSH_VERSION) {
      return {
        shellName: 'zsh',
        shellRc: join(os.homedir(), '.zshrc')
      };
    }

 if (shell.includes('bash') || process.env.BASH_VERSION) {
      return {
        shellName: 'bash',
        shellRc: join(os.homedir(), '.bashrc')
      };
    }

 if (shell.includes('fish')) {
      return {
        shellName: 'fish',
        shellRc: join(os.homedir(), '.config', 'fish', 'config.fish')
      };
    }
 
      // Default to bash
      return {
        shellName: 'bash',
        shellRc: join(os.homedir(), '.bashrc')
      };
    
  }

  private getHookScriptPath(): string {
    // Get the script path relative to the wp-spin installation
    const currentFile = fileURLToPath(import.meta.url);
    const currentDir = dirname(currentFile);
    const scriptPath = join(currentDir, '..', '..', 'scripts', 'wp-spin-rm-hook.sh');
    return scriptPath;
  }

  private getPreferencesInfo(): { exists: boolean; preference: null | string } {
    const preferencesFile = join(os.homedir(), '.wp-spin', 'cleanup-preferences.json');
    
    if (!fs.existsSync(preferencesFile)) {
      return { exists: false, preference: null };
    }
    
    try {
      const content = fs.readFileSync(preferencesFile, 'utf8');
      const prefs = JSON.parse(content);
      return { 
        exists: true, 
        preference: prefs.default_action || null 
      };
    } catch {
      return { exists: false, preference: null };
    }
  }

  private async installHook(force: boolean): Promise<void> {
    const { shellName, shellRc } = this.detectShell();
    const hookScript = this.getHookScriptPath();
    
    if (!fs.existsSync(hookScript)) {
      this.error(`Hook script not found at: ${hookScript}`);
    }

    // Check if already installed
    if (!force && this.isHookInstalled()) {
      this.log('✅ wp-spin rm hook is already installed!');
      this.log(`🔄 To reload: source ${shellRc}`);
      this.log('💡 The hook was installed automatically when wp-spin was installed.');
      this.log('   This allows "rm -rf" to automatically cleanup wp-spin projects.');
      return;
    }

    // Add hook to shell RC
    const hookLine = `source '${hookScript}'`;
    const hookComment = '# wp-spin rm hook - automatically cleanup wp-spin projects on rm -rf';
    
    try {
      fs.appendFileSync(shellRc, `\n${hookComment}\n${hookLine}\n`);
      
      this.log(`✅ wp-spin rm hook installed successfully for ${shellName}!`);
      this.log(`🔄 To activate: source ${shellRc}`);
      this.log('Or restart your terminal.');
      this.log('');
      this.log('📖 Usage:');
      this.log('  rm -rf my-wordpress-site/  # Will automatically run wp-spin cleanup');
      this.log('  rm file.txt               # Regular rm behavior unchanged');
      
    } catch (error) {
      this.error(`Failed to install hook: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private isHookInstalled(): boolean {
    const { shellRc } = this.detectShell();
    
    if (!fs.existsSync(shellRc)) {
      return false;
    }
    
    try {
      const content = fs.readFileSync(shellRc, 'utf8');
      return content.includes('wp-spin-rm-hook.sh');
    } catch {
      return false;
    }
  }

  private async resetPreferences(): Promise<void> {
    const preferencesFile = join(os.homedir(), '.wp-spin', 'cleanup-preferences.json');
    
    try {
      if (fs.existsSync(preferencesFile)) {
        fs.unlinkSync(preferencesFile);
        this.log('✅ Cleanup preferences reset successfully!');
        this.log('   rm -rf on wp-spin projects will now prompt for cleanup options.');
      } else {
        this.log('ℹ️  No saved preferences found - nothing to reset.');
      }
    } catch (error) {
      this.error(`Failed to reset preferences: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async showStatus(): Promise<void> {
    const { shellName, shellRc } = this.detectShell();
    const hookScript = this.getHookScriptPath();
    
    this.log(`🔍 Shell: ${shellName}`);
    this.log(`📁 Shell RC: ${shellRc}`);
    this.log(`📜 Hook Script: ${hookScript}`);
    this.log(`📦 Hook Script Exists: ${fs.existsSync(hookScript) ? '✅' : '❌'}`);
    this.log(`🔗 Hook Installed: ${this.isHookInstalled() ? '✅' : '❌'}`);
    
    if (this.isHookInstalled()) {
      this.log('');
      this.log('✅ wp-spin rm hook is active!');
      this.log('   Installed automatically when wp-spin was installed.');
      this.log('   Now "rm -rf [wp-spin-directory]" will auto-cleanup containers!');
      this.log('');
      this.log('📖 Usage:');
      this.log('   rm -rf my-wordpress-site/  # Auto-cleanup');
      this.log('   rm file.txt               # Normal rm behavior');
    } else {
      this.log('');
      this.log('💡 To install: wp-spin hook install');
    }
  }

  private async uninstallHook(): Promise<void> {
    const { shellRc } = this.detectShell();
    
    if (!this.isHookInstalled()) {
      this.log('ℹ️  wp-spin rm hook is not installed');
      return;
    }

    try {
      const content = fs.readFileSync(shellRc, 'utf8');
      const lines = content.split('\n');
      
      // Remove hook-related lines
      const filteredLines = lines.filter(line => 
        !line.includes('wp-spin-rm-hook.sh') && 
        !line.includes('wp-spin rm hook')
      );
      
      fs.writeFileSync(shellRc, filteredLines.join('\n'));
      
      this.log('✅ wp-spin rm hook uninstalled successfully!');
      this.log(`🔄 To deactivate: source ${shellRc}`);
      this.log('Or restart your terminal.');
      
    } catch (error) {
      this.error(`Failed to uninstall hook: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}