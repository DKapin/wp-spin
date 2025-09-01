import { Args, Command } from '@oclif/core';
import { createPromptModule } from 'inquirer';
import chalk from 'chalk';

export default class CleanupPrompt extends Command {
  static override description = 'Interactive cleanup prompt for wp-spin rm hook';

  static override hidden = true; // Hide from help

  static override args = {
    projectPath: Args.string({
      description: 'Path to the wp-spin project',
      required: true,
    }),
  };

  public async run(): Promise<void> {
    const { args } = await this.parse(CleanupPrompt);
    const { projectPath } = args;
    const projectName = projectPath.split('/').pop() || 'project';

    // Show cleanup options
    console.log('');
    console.log(chalk.cyan('┌─ wp-spin Cleanup Options ─────────────────────────────────┐'));
    console.log(chalk.cyan('│                                                           │'));
    console.log(chalk.cyan('│  [1] 🧹 Full cleanup (recommended)                       │'));
    console.log(chalk.cyan('│      • Stop Docker containers                            │'));
    console.log(chalk.cyan('│      • Remove Docker volumes                             │'));
    console.log(chalk.cyan('│      • Clean wp-spin configuration                       │'));
    console.log(chalk.cyan('│      • Remove directory                                  │'));
    console.log(chalk.cyan('│                                                           │'));
    console.log(chalk.cyan('│  [2] 📁 Just remove files                                │'));
    console.log(chalk.cyan('│      • Remove directory only                             │'));
    console.log(chalk.cyan('│      • Leave containers running (may cause issues)      │'));
    console.log(chalk.cyan('│                                                           │'));
    console.log(chalk.cyan('│  [3] ❌ Cancel                                           │'));
    console.log(chalk.cyan('│      • Do nothing                                        │'));
    console.log(chalk.cyan('│                                                           │'));
    console.log(chalk.cyan('└───────────────────────────────────────────────────────────┘'));
    console.log('');

    const prompt = createPromptModule();
    const { choice } = await prompt({
      type: 'list',
      name: 'choice',
      message: `How would you like to remove wp-spin project "${chalk.yellow(projectName)}"?`,
      choices: [
        {
          name: '🧹 Full cleanup (recommended) - Stop containers, remove volumes, clean config',
          value: '1',
          short: 'Full cleanup',
        },
        {
          name: '📁 Just remove files - Remove directory only, leave containers running',
          value: '2',
          short: 'Files only',
        },
        {
          name: '❌ Cancel - Do nothing',
          value: '3',
          short: 'Cancel',
        },
      ],
      default: '1',
    });

    // Output the choice for the shell script to capture
    console.log(choice);
  }
}