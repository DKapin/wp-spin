import {expect} from 'chai'
import esmock from 'esmock'
import { restore, SinonStub, stub } from 'sinon'

describe('logs', () => {
  // Define a type for our mocked command instance
  type MockedLogsInstance = {
    checkDockerEnvironment: SinonStub;
    checkFileExists: SinonStub;
    docker: {
      checkDockerInstalled: SinonStub;
      getProjectPath: SinonStub;
      logs: SinonStub;
    };
    ensureProjectDirectory: SinonStub;
    error: SinonStub;
    execa: SinonStub;
    exit: SinonStub;
    getContainerNames: () => { mysql: string; phpmyadmin: string; wordpress: string };
    log: SinonStub;
    parse: SinonStub;
    run: () => Promise<void>;
  };
  
  // Define types for our mocks
  type MockFs = {
    accessSync: SinonStub;
  };
  
  type MockPath = {
    join: (...args: string[]) => string;
  };
  
  // Mocked Command Class & Config
  let MockedLogs: { new(argv: string[], config: Record<string, unknown>): MockedLogsInstance };
  let mockConfig: Record<string, unknown>;
  let mockFs: MockFs;
  let mockPath: MockPath;
  let execaMock: SinonStub;
  
  beforeEach(async () => {
    // Mock Config
    mockConfig = { 
        bin: 'wp-spin',
        root: process.cwd(),
        runHook: stub().resolves({ successes: [] }),
        version: '1.0.0'
    }; 

    // Create mocks for filesystem operations
    mockFs = {
      accessSync: stub()
    };
    
    mockPath = {
      join: (...args: string[]) => args.join('/')
    };
    
    // Create execa mock
    execaMock = stub().callsFake(async (cmd: string, args: string[], _options: unknown) => {
      // Return different results based on the command
      if (cmd === 'docker' && args[0] === 'logs') {
        // For docker logs, use stdio: 'inherit' which doesn't return stdout
        return { stderr: '', stdout: '' };
      }
      
      return { stdout: 'test output' };
    });

    // Create a prototype for BaseCommand with required methods
    class MockCommand {
      config = { version: '1.0.0' };
      
      checkDockerEnvironment() {
        return Promise.resolve();
      }
      
      checkFileExists(_file: string) {
        return true;
      }
      
      ensureProjectDirectory() {
        return Promise.resolve();
      }
      
      error(message: string) {
        throw new Error(message);
      }
      
      exit(code: number) {
        throw new Error(`EEXIT: ${code}`);
      }
      
      getContainerNames() {
        return {
          mysql: 'test-project_mysql',
          phpmyadmin: 'test-project_phpmyadmin',
          wordpress: 'test-project_wordpress'
        };
      }
      
      log(_message: string) {
        // Intentionally empty
      }
      
      parse() {
        return Promise.resolve({
          args: {},
          flags: {}
        });
      }
    }

    // Mock DockerService
    const MockDockerService = class {
      checkDockerInstalled() {
        return Promise.resolve(true);
      }
      
      checkDockerRunning() {
        return Promise.resolve(true);
      }
      
      getProjectPath() {
        return '/test/project/path';
      }
      
      isDockerRunning() {
        return Promise.resolve(true);
      }
      
      logs() {
        return Promise.resolve();
      }
    };

    // Load Logs command with mocks using esmock
    MockedLogs = await esmock('../../src/commands/logs.js', {
      '../../src/services/docker.js': {
        DockerService: MockDockerService
      },
      '@oclif/core': {
        Command: MockCommand,
        Config: class {}
      },
      'execa': {
        execa: execaMock
      },
      'fs-extra': mockFs,
      'node:path': mockPath
    });
    
    process.env.NODE_ENV = 'test'
  });
  
  afterEach(() => {
    restore();
  });
  
  it('runs logs command successfully when project directory is valid', async () => {
    // Setup: Valid project directory with docker-compose.yml and .env
    mockFs.accessSync = stub();
    
    const cmd = new MockedLogs([], mockConfig) as MockedLogsInstance;
    
    // Override checkDockerEnvironment to prevent exit
    cmd.checkDockerEnvironment = stub().resolves();
    
    cmd.docker = { 
      checkDockerInstalled: stub().resolves(true),
      getProjectPath: stub().returns('test-project'),
      logs: stub().resolves(),
    };
    
    // Mock parse to return the expected flags
    cmd.parse = stub().resolves({
      args: {},
      flags: { container: 'wordpress' }
    });
    
    // Mock log method
    cmd.log = stub();
    
    // Run the command
    await cmd.run();
    
    // Verify execa was called with the correct arguments
    expect(execaMock.calledWith('docker', ['logs', 'test-project_wordpress'], { stdio: 'inherit' })).to.be.true;
  });
  
  it('checks for required files in the project directory', async () => {
    const cmd = new MockedLogs([], mockConfig) as MockedLogsInstance;
    
    // Spy on the checkFileExists method
    cmd.checkFileExists = stub();
    cmd.checkFileExists.onCall(0).returns(true); // docker-compose.yml exists
    cmd.checkFileExists.onCall(1).returns(true); // .env exists
    
    cmd.checkDockerEnvironment = stub().resolves();
    cmd.docker = { 
      checkDockerInstalled: stub().resolves(true),
      getProjectPath: stub().returns('/test/project/path'),
      logs: stub().resolves(),
    };
    
    await cmd.run();
    
    // Verify file checks were performed
    expect(cmd.checkFileExists.calledWith('docker-compose.yml')).to.be.true;
    expect(cmd.checkFileExists.calledWith('.env')).to.be.true;
  });
  
  it('throws error when required files are missing', async () => {
    const cmd = new MockedLogs([], mockConfig) as MockedLogsInstance;
    
    // Setup: Missing docker-compose.yml
    cmd.checkFileExists = stub();
    cmd.checkFileExists.withArgs('docker-compose.yml').returns(false);
    cmd.checkFileExists.withArgs('.env').returns(true);
    
    cmd.error = stub().throws(new Error('Not a WordPress project directory'));
    cmd.docker = { 
      checkDockerInstalled: stub().resolves(true),
      logs: stub().resolves(),
      getProjectPath: stub().returns('/test/project/path'),
    };
    
    try {
      await cmd.run();
      expect.fail('Should have thrown an error');
    } catch (error) {
      const err = error as Error;
      expect(err.message).to.include('Not a WordPress project directory');
    }
  });
  
  it('checks docker environment before showing logs', async () => {
    const cmd = new MockedLogs([], mockConfig) as MockedLogsInstance;
    
    // Setup: Valid project directory
    cmd.checkFileExists = stub().returns(true);
    
    // Setup: Mock checkDockerEnvironment
    cmd.checkDockerEnvironment = stub().resolves();
    cmd.docker = { 
      checkDockerInstalled: stub().resolves(true),
      logs: stub().resolves(),
      getProjectPath: stub().returns('/test/project/path'),
    };
    
    await cmd.run();
    
    // Verify docker environment was checked
    expect(cmd.checkDockerEnvironment.called).to.be.true;
  });
  
  it('handles errors when checking docker environment', async () => {
    const cmd = new MockedLogs([], mockConfig) as MockedLogsInstance;
    
    // Setup: Valid project directory
    cmd.checkFileExists = stub().returns(true);
    
    // Setup: Mock checkDockerEnvironment to throw error
    cmd.checkDockerEnvironment = stub().rejects(new Error('Docker not running'));
    cmd.docker = { 
      checkDockerInstalled: stub().resolves(true),
      logs: stub().resolves(),
      getProjectPath: stub().returns('/test/project/path'),
    };
    
    try {
      await cmd.run();
      expect.fail('Should have thrown an error');
    } catch (error) {
      const err = error as Error;
      expect(err.message).to.equal('Docker not running');
    }
  });
  
  it('handles errors from docker logs', async () => {
    const cmd = new MockedLogs([], mockConfig) as MockedLogsInstance;
    
    // Setup: Valid project directory
    mockFs.accessSync = stub().returns(undefined);
    
    // Setup: Mock docker logs to reject
    cmd.docker = {
      checkDockerInstalled: stub().resolves(true),
      logs: stub().rejects(new Error('Could not retrieve logs')),
      getProjectPath: stub().returns('/test/project/path'),
    };
    
    // Mock parse to return the expected flags
    cmd.parse = stub().resolves({
      args: {},
      flags: { container: 'wordpress' }
    });
    
    // Mock ensureProjectDirectory
    cmd.ensureProjectDirectory = stub().resolves();
    
    // Mock exit to throw EEXIT: 1
    cmd.exit = stub().throws(new Error('EEXIT: 1'));
    
    try {
      await cmd.run();
      expect.fail('Should have thrown an error');
    } catch (error) {
      if (error instanceof Error) {
        expect(error.message).to.equal('EEXIT: 1');
      } else {
        expect.fail('Error should be an Error instance');
      }
    }
  });
});
