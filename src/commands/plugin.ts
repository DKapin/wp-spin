import {Flags} from '@oclif/core'

import { BaseCommand } from './base.js'

export default class Plugin extends BaseCommand {
  static description = 'Manage WordPress plugins'
static examples = [
    '<%= config.bin %> plugin --add woocommerce',
    '<%= config.bin %> plugin --add woocommerce --version 8.0.0',
    '<%= config.bin %> plugin --remove woocommerce',
  ]
static flags = {
    add: Flags.string({
      char: 'a',
      description: 'Name of the plugin to install',
      exclusive: ['remove'],
    }),
    force: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Force operation even if plugin exists/does not exist',
    }),
    remove: Flags.string({
      char: 'r',
      description: 'Name of the plugin to remove',
      exclusive: ['add'],
    }),
    version: Flags.string({
      char: 'v',
      dependsOn: ['add'],
      description: 'Plugin version to install (only used with --add)',
    }),
  }

  public async run(): Promise<void> {
    const {flags} = await this.parse(Plugin)
    const {add, force, remove, version} = flags

    try {
      // Check Docker environment
      await this.checkDockerEnvironment()
      await this.checkWordPressContainer()

      if (add) {
        // Install plugin using wp-cli in Docker container
        const versionFlag = version ? `--version=${version}` : ''
        const command = `wp plugin install ${add} ${versionFlag} --force=${force}`
        
        this.log(`Installing plugin ${add}${version ? ` version ${version}` : ''}...`)
        this.runWpCli(command)
        
        this.log(`Plugin ${add} installed successfully!`)
      } else if (remove) {
        // Remove plugin using wp-cli in Docker container
        const command = `wp plugin delete ${remove}`
        
        this.log(`Removing plugin ${remove}...`)
        this.runWpCli(command)
        
        this.log(`Plugin ${remove} removed successfully!`)
      } else {
        // If no action flag is provided, list installed plugins
        this.log('Installed plugins:')
        this.runWpCli('wp plugin list')
      }
    } catch (error) {
      this.error(`Operation failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
