import { Args, Command } from '@oclif/core';
import chalk from 'chalk';
import { createPromptModule } from 'inquirer';

export default class CleanupPrompt extends Command {
  static override args = {
    projectPath: Args.string({
      description: 'Path to the wp-spin project',
      required: true,
    }),
  };
static override description = 'Interactive cleanup prompt for wp-spin rm hook';
static override hidden = true; // Hide from help

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
      choices: [
        {
          name: '🧹 Full cleanup (recommended) - Stop containers, remove volumes, clean config',
          short: 'Full cleanup',
          value: '1',
        },
        {
          name: '📁 Just remove files - Remove directory only, leave containers running',
          short: 'Files only',
          value: '2',
        },
        {
          name: '❌ Cancel - Do nothing',
          short: 'Cancel',
          value: '3',
        },
      ],
      default: '1',
      message: `How would you like to remove wp-spin project "${chalk.yellow(projectName)}"?`,
      name: 'choice',
      type: 'list',
    });

    // Output the choice for the shell script to capture
    console.log(choice);
  }
}