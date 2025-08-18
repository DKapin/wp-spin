import { Flags } from '@oclif/core';
import { execa } from 'execa';

import { BaseCommand } from './base.js';

export default class Logs extends BaseCommand {
  static description = 'View logs from a specific container (wordpress, mysql, or phpmyadmin)';
  static examples = [
    '$ wp-spin logs',
    '$ wp-spin logs --container=mysql',
    '$ wp-spin logs --container=phpmyadmin',
    '$ wp-spin logs --container=wordpress',
    '$ wp-spin logs --container=mysql --site=my-wp-site',
  ];
  static flags = {
    ...BaseCommand.flags,
    container: Flags.string({
      char: 'c',
      default: 'wordpress',
      description: 'Container to target (wordpress, mysql, phpmyadmin)',
      options: ['wordpress', 'mysql', 'phpmyadmin'],
    }),
  };
  static hidden = false;

  public async run(): Promise<void> {
    const { flags } = await this.parse(Logs);
    
    // Use BaseCommand's standard project validation and Docker service initialization
    await this.checkDockerEnvironment();
    
    const containerType = flags.container || 'wordpress';
    const containerNames = this.getContainerNames();
    let containerName = containerNames.wordpress;
    if (containerType === 'mysql') containerName = containerNames.mysql;
    if (containerType === 'phpmyadmin') containerName = containerNames.phpmyadmin;

    // Show logs from the selected container
    await execa('docker', ['logs', containerName], { stdio: 'inherit' });
  }
}
