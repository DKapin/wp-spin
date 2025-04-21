import { Command } from '@oclif/core';
import chalk from 'chalk';
import { arch, platform } from 'node:os';
import ora from 'ora';

import { IDockerService } from '../docker-interface.js';

/**
 * Mock implementation of DockerService for testing
 */
export class DockerService implements IDockerService {
  // Dummy property to prevent linter warning for unused command parameter
  private _unused?: Command;
  // Properties to match the real Docker service
  private architecture = arch();
  private containers = new Map();
  // Mock state properties
  private isRunning = true;
  private mockDiskSpace = true;
private mockDockerComposeInstalled = true;
  private mockDockerInstalled = true;
  private mockDockerRunning = true;
  private mockMemory = true;
  private mockPortsAvailable = true;
  private platform = platform();
  private portMappings: Record<number, number> = {};
  private projectExists = true;
  private projectPath: string;
private spinner = ora();

  constructor(projectPath: string, command?: Command) {
    this.projectPath = projectPath;
    this.spinner.stop();
    // Silence the unused parameter warning
    this._unused = command;
  }

  // Implementation of the actual methods
  async checkDiskSpace(): Promise<void> {
    this.spinner.start('Checking disk space...');
    if (!this.mockDiskSpace) {
      this.spinner.fail('Insufficient disk space');
      throw new Error('Insufficient disk space');
    }

    this.spinner.succeed('Sufficient disk space available');
    
  }

  async checkDockerComposeInstalled(): Promise<void> {
    this.spinner.start('Checking Docker Compose installation...');
    if (!this.mockDockerComposeInstalled) {
      this.spinner.fail('Docker Compose is not installed');
      throw new Error('Docker Compose is not installed');
    }

    this.spinner.succeed('Docker Compose is installed');
    
  }

  async checkDockerInstalled(): Promise<void> {
    this.spinner.start('Checking Docker installation...');
    if (!this.mockDockerInstalled) {
      this.spinner.fail('Docker is not installed');
      throw new Error('Docker is not installed');
    }

    this.spinner.succeed('Docker is installed');
    
  }

  async checkDockerRunning(): Promise<void> {
    this.spinner.start('Checking Docker...');
    if (!this.mockDockerRunning) {
      this.spinner.fail('Docker is not running');
      throw new Error('Docker is not running');
    }

    this.spinner.succeed('Docker is running');
    
  }

  async checkMemory(): Promise<void> {
    this.spinner.start('Checking system memory...');
    if (!this.mockMemory) {
      this.spinner.fail('Insufficient memory');
      throw new Error('Insufficient memory');
    }

    this.spinner.succeed('Sufficient memory available');
    
  }

  async checkPorts(): Promise<void> {
    this.spinner.start('Checking ports...');
    if (!this.mockPortsAvailable) {
      this.spinner.fail('Port conflict detected');
      throw new Error('Port conflict detected');
    }

    this.spinner.succeed('Ports are available');
    
  }

  async checkProjectExists(): Promise<boolean> {
    return this.projectExists;
  }

  getPortMappings(): Record<number, number> {
    return { ...this.portMappings };
  }

  getProjectPath(): string {
    return this.projectPath;
  }

  async logs(): Promise<void> {
    if (!this.isRunning) {
      throw new Error('Docker is not running');
    }

    console.log(chalk.blue('Mock Docker logs:'));
    console.log('WordPress_1  | [info] WordPress is running');
    console.log('MySQL_1      | [info] MySQL is running');
    
  }

  async restart(): Promise<void> {
    this.spinner.start('Restarting WordPress environment...');
    if (!this.mockDockerRunning) {
      this.spinner.fail('Docker is not running');
      throw new Error('Docker is not running');
    }

    this.isRunning = true;
    this.spinner.succeed('WordPress environment restarted');
    
  }

  setDockerRunning(running: boolean): void {
    this.mockDockerRunning = running;
  }

  setPortsAvailable(available: boolean): void {
    this.mockPortsAvailable = available;
  }

  // Configure the mock behavior
  setProjectExists(exists: boolean): void {
    this.projectExists = exists;
  }

  async shell(): Promise<void> {
    if (!this.isRunning) {
      throw new Error('Docker is not running');
    }

    console.log(chalk.blue('Mock Docker shell:'));
    console.log('root@wordpress-container:/var/www/html#');
    
  }

  async start(): Promise<void> {
    this.spinner.start('Starting WordPress environment...');
    if (!this.mockDockerRunning) {
      this.spinner.fail('Docker is not running');
      throw new Error('Docker is not running');
    }

    this.isRunning = true;
    this.spinner.succeed('WordPress environment started');
    
  }

  async status(): Promise<void> {
    console.log(chalk.blue('Mock Docker status:'));
    console.log(`WordPress container: ${this.isRunning ? 'Running' : 'Stopped'}`);
    console.log(`MySQL container: ${this.isRunning ? 'Running' : 'Stopped'}`);
    
  }

  async stop(): Promise<void> {
    this.spinner.start('Stopping WordPress environment...');
    this.isRunning = false;
    this.spinner.succeed('WordPress environment stopped');
    
  }

  async updateDockerComposePorts(originalPort: number, newPort: number): Promise<void> {
    this.portMappings[originalPort] = newPort;
    console.log(chalk.blue(`Mock: Port mapping stored: ${originalPort} -> ${newPort}`));
  }
} 