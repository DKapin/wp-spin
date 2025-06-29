import {Flags} from '@oclif/core'

import { BaseCommand } from './base.js'

export default class Theme extends BaseCommand {
  static description = 'Manage WordPress themes'
  static examples = ['<%= config.bin %> theme --add twentytwentyfour', '<%= config.bin %> theme --add twentytwentyfour --version 1.0.0', '<%= config.bin %> theme --remove twentytwentyfour']
  static flags = {
    add: Flags.string({
      char: 'a',
      description: 'Name of the theme to install',
      exclusive: ['remove'],
    }),
    force: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Force operation even if theme exists/does not exist',
    }),
    remove: Flags.string({
      char: 'r',
      description: 'Name of the theme to remove',
      exclusive: ['add'],
    }),
    version: Flags.string({
      char: 'v',
      dependsOn: ['add'],
      description: 'Theme version to install (only used with --add)',
    }),
  }
  static hidden = false

  public async run(): Promise<void> {
    const {flags} = await this.parse(Theme)
    const {add, force, remove, version} = flags

    try {
      // Check Docker environment
      await this.checkDockerEnvironment()
      await this.checkWordPressContainer()

      if (add) {
        // Install theme using wp-cli in Docker container
        const versionFlag = version ? `--version=${version}` : ''
        const command = `wp theme install ${add} ${versionFlag} --force=${force}`
        
        this.log(`Installing theme ${add}${version ? ` version ${version}` : ''}...`)
        this.runWpCli(command)
        
        this.log(`Theme ${add} installed successfully!`)
      } else if (remove) {
        // Remove theme using wp-cli in Docker container
        const command = `wp theme delete ${remove}`
        
        this.log(`Removing theme ${remove}...`)
        this.runWpCli(command)
        
        this.log(`Theme ${remove} removed successfully!`)
      } else {
        // If no action flag is provided, list installed themes
        this.log('Installed themes:')
        this.runWpCli('wp theme list')
      }
    } catch (error) {
      this.error(`Operation failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Check if WordPress container is running
   */
  private async checkWordPressContainer(): Promise<void> {
    await this.isWordPressRunning();
  }

  /**
   * Run WP-CLI command
   */
  private async runWpCli(command: string): Promise<string> {
    return this.execWpCommand(command);
  }
}
