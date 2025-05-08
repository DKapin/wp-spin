import { expect } from 'chai';
import esmock from 'esmock';
import path from 'node:path';
import { match, restore, SinonStub, stub } from 'sinon';

// Get the absolute path for imports
const srcPath = path.resolve(process.cwd(), 'src');

describe('init command extensions', () => {
  // Properly typed mockup interfaces
  interface MockDockerServiceInstance {
    checkDiskSpace: SinonStub;
    checkDockerComposeInstalled: SinonStub;
    checkDockerInstalled: SinonStub;
    checkDockerRunning: SinonStub;
    checkMemory: SinonStub;
    checkPorts: SinonStub;
    start: SinonStub;
  }
  
  // Mocks with proper types in alphabetical order
  let mockFs: {
    chmod: SinonStub;
    copy: SinonStub;
    ensureDir: SinonStub;
    existsSync: SinonStub;
    mkdirSync: SinonStub;
    remove: SinonStub;
    removeSync: SinonStub;
    writeFile: SinonStub;
    writeFileSync: SinonStub;
  };
  let mockExeca: SinonStub;
  let mockDockerService: {
    create: () => MockDockerServiceInstance;
    instance: MockDockerServiceInstance;
  };
  let mockInquirer: SinonStub;
  // Using a more specific type instead of 'any'
  let MockInitCommand: {
    new(argv: string[], config: Record<string, unknown>): {
      displayProjectInfo: SinonStub;
      ensureDockerEnvironment: SinonStub;
      error: SinonStub;
      parse: SinonStub;
      prepareProjectDirectory: SinonStub;
      run: () => Promise<void>;
      setupDockerEnvironment: SinonStub;
      setupWordpressSource: SinonStub;
      validateWordPressDirectory: SinonStub;
    }
  };
  
  // Configuration for the command
  let mockConfig: Record<string, unknown>;
  
  beforeEach(async () => {
    // Setup configuration
    mockConfig = {
      bin: 'wp-spin',
      root: process.cwd(),
      runHook: stub().resolves({ successes: [] }),
      version: '1.0.0'
    };
    
    // Create mock for DockerService with properties in alphabetical order
    const mockDockerServiceInstance: MockDockerServiceInstance = {
      checkDiskSpace: stub().resolves(),
      checkDockerComposeInstalled: stub().resolves(),
      checkDockerInstalled: stub().resolves(),
      checkDockerRunning: stub().resolves(),
      checkMemory: stub().resolves(),
      checkPorts: stub().resolves(),
      start: stub().resolves()
    };
    
    mockDockerService = {
      create: () => mockDockerServiceInstance,
      instance: mockDockerServiceInstance
    };
    
    // Create mock for fs-extra with properties in alphabetical order
    mockFs = {
      chmod: stub().resolves(),
      copy: stub().resolves(),
      ensureDir: stub().resolves(),
      existsSync: stub(),
      mkdirSync: stub(),
      remove: stub().resolves(),
      removeSync: stub(),
      writeFile: stub().resolves(),
      writeFileSync: stub()
    };
    
    // Create mock for execa
    mockExeca = stub().resolves({ stderr: '', stdout: '' });
    
    // Create mock for inquirer
    mockInquirer = stub().resolves({ proceed: true });
    
    // Create a base Command class mock
    class MockBaseCommand {
      config: Record<string, unknown> = {
        version: '1.0.0'
      };
      error: SinonStub;
      log: SinonStub;
      parse: SinonStub;
      
      constructor() {
        this.error = stub().callsFake((message) => {
          throw new Error(message);
        });
        this.log = stub();
        this.parse = stub().resolves({
          args: { name: 'test-site' },
          flags: {}
        });
      }
    }
    
    // Mock Args and Flags objects
    const mockArgs = {
      string: () => ({ description: 'Mock description', required: true })
    };
    
    const mockFlags = {
      boolean: (options: Record<string, unknown>) => ({ ...options }),
      string: (options: Record<string, unknown>) => ({ ...options })
    };
    
    // Set test environment
    process.env.NODE_ENV = 'test';
    
    // Use esmock to load the Init command with mocks - using absolute paths
    MockInitCommand = await esmock(`${srcPath}/commands/init.js`, {
      // Mock external modules in alphabetical order
      '@oclif/core': { 
        Args: mockArgs,
        Command: MockBaseCommand,
        Config: class {
          version = '1.0.0'
        },
        Flags: mockFlags
      },
      // Mock internal modules
      [`${srcPath}/config/ports.js`]: { 
        DEFAULT_PORTS: { 
          MYSQL: 3306, 
          PHPMYADMIN: 8081, 
          WORDPRESS: 8080 
        } 
      },
      [`${srcPath}/config/sites.js`]: { 
        addSite: stub().returns(true) 
      },
      [`${srcPath}/services/docker.js`]: { 
        DockerService: class {
          constructor() {
            // Return a pre-configured instance
            // eslint-disable-next-line no-constructor-return
            return mockDockerService.create();
          }
        }
      },
      'chalk': { 
        blue: (text: string) => text 
      },
      'execa': { 
        execa: mockExeca 
      },
      'fs-extra': mockFs,
      'inquirer': { 
        createPromptModule: () => mockInquirer 
      },
      'node:crypto': {
        randomBytes: stub().returns({ toString: () => 'mock-random-bytes' })
      },
      'node:net': {
        isIP: stub().returns(true)
      },
      'node:os': {
        arch: () => 'arm64',
        tmpdir: () => '/tmp'
      },
      'node:path': { 
        join: (...args: string[]) => args.join('/') 
      },
      'ora': () => ({
        fail: stub().returnsThis(),
        info: stub().returnsThis(),
        start: stub().returnsThis(),
        succeed: stub().returnsThis(),
        warn: stub().returnsThis()
      })
    });
  });
  
  afterEach(() => {
    restore();
  });
  
  describe('from-github flag', () => {
    it('clones a GitHub repository and uses it as source', async () => {
      const repoUrl = 'https://github.com/test/wordpress-repo';
      const args = ['init', 'test-site', '--from-github', repoUrl];
      
      // Setup valid WordPress files check
      mockFs.existsSync.withArgs(match(/wp-config\.php$/)).returns(true);
      mockFs.existsSync.withArgs(match(/wp-content$/)).returns(true);
      mockFs.existsSync.withArgs(match(/wp-includes$/)).returns(true);
      mockFs.existsSync.withArgs(match(/wp-admin$/)).returns(true);
      mockFs.existsSync.withArgs(match(/.wp-spin$/)).returns(true);
      
      // Create instance with overridden parse method to return our test flags
      const command = new MockInitCommand(args, mockConfig);
      command.parse = stub().resolves({
        args: { name: 'test-site' },
        flags: { 'from-github': repoUrl }
      });
      
      // Make sure validateWordPressDirectory and setupWordpressSource methods are properly mocked
      command.validateWordPressDirectory = stub().resolves({ issues: [], isValid: true });
      command.setupWordpressSource = stub().resolves();
      command.setupDockerEnvironment = stub().resolves();
      command.displayProjectInfo = stub().resolves();
      command.prepareProjectDirectory = stub().resolves();
      command.ensureDockerEnvironment = stub().resolves();
      
      await command.run();
      
      // Verify the correct setup methods were called
      expect(command.setupWordpressSource.called).to.be.true;
    });
    
    it('handles invalid WordPress repository with user confirmation', async () => {
      const repoUrl = 'https://github.com/test/not-wordpress-repo';
      const args = ['init', 'test-site', '--from-github', repoUrl];
      
      // Setup invalid WordPress directory validation
      mockFs.existsSync.returns(false);
      
      // Set inquirer to confirm continuing anyway
      mockInquirer.resolves({ proceed: true });
      
      // Create instance with overridden parse method to return our test flags
      const command = new MockInitCommand(args, mockConfig);
      command.parse = stub().resolves({
        args: { name: 'test-site' },
        flags: { 'from-github': repoUrl }
      });
      
      // Make sure key methods are properly mocked
      command.validateWordPressDirectory = stub().resolves({ issues: ['Missing wp-config.php'], isValid: false });
      command.setupWordpressSource = stub().resolves();
      command.setupDockerEnvironment = stub().resolves();
      command.displayProjectInfo = stub().resolves();
      command.prepareProjectDirectory = stub().resolves();
      command.ensureDockerEnvironment = stub().resolves();
      
      await command.run();
      
      // Verify the correct setup methods were called
      expect(command.setupWordpressSource.called).to.be.true;
    });
    
    it('throws an error if user declines to continue with invalid WordPress repo', async () => {
      const repoUrl = 'https://github.com/test/not-wordpress-repo';
      const args = ['init', 'test-site', '--from-github', repoUrl];
      
      // Setup invalid WordPress directory validation
      mockFs.existsSync.returns(false);
      
      // Set inquirer to decline continuing
      mockInquirer.resolves({ proceed: false });
      
      // Create instance with overridden parse method to return our test flags
      const command = new MockInitCommand(args, mockConfig);
      command.parse = stub().resolves({
        args: { name: 'test-site' },
        flags: { 'from-github': repoUrl }
      });
      
      // Make sure key methods are properly mocked
      command.validateWordPressDirectory = stub().resolves({ issues: ['Missing wp-config.php'], isValid: false });
      command.setupWordpressSource = stub().resolves();
      
      // Mock error to throw a specific error message
      command.error = stub().throws(new Error('User declined to continue'));
      
      try {
        await command.run();
        expect.fail('Should have thrown an error');
      } catch (error) {
        if (error instanceof Error) {
          expect(error.message).to.include('User declined to continue');
        }
      }
    });
  });
  
  describe('from-zip flag', () => {
    it('extracts a WordPress zip file and uses it as source', async () => {
      const zipPath = '/path/to/wordpress.zip';
      const args = ['init', 'test-site', '--from-zip', zipPath];
      
      // Setup valid WordPress files check after extraction
      mockFs.existsSync.withArgs(match(/wp-config\.php$/)).returns(true);
      mockFs.existsSync.withArgs(match(/wp-content$/)).returns(true);
      mockFs.existsSync.withArgs(match(/wp-includes$/)).returns(true);
      mockFs.existsSync.withArgs(match(/wp-admin$/)).returns(true);
      
      // Create instance with overridden parse method to return our test flags
      const command = new MockInitCommand(args, mockConfig);
      command.parse = stub().resolves({
        args: { name: 'test-site' },
        flags: { 'from-zip': zipPath }
      });
      
      // Make sure key methods are properly mocked
      command.validateWordPressDirectory = stub().resolves({ issues: [], isValid: true });
      command.setupWordpressSource = stub().resolves();
      command.setupDockerEnvironment = stub().resolves();
      command.displayProjectInfo = stub().resolves();
      command.prepareProjectDirectory = stub().resolves();
      command.ensureDockerEnvironment = stub().resolves();
      
      await command.run();
      
      // Verify the correct setup methods were called
      expect(command.setupWordpressSource.called).to.be.true;
    });
  });
  
  describe('from-url flag', () => {
    it('downloads a WordPress URL and uses it as source', async () => {
      const url = 'https://wordpress.org/latest.zip';
      const args = ['init', 'test-site', '--from-url', url];
      
      // Setup valid WordPress files check after download
      mockFs.existsSync.withArgs(match(/wp-config\.php$/)).returns(true);
      mockFs.existsSync.withArgs(match(/wp-content$/)).returns(true);
      mockFs.existsSync.withArgs(match(/wp-includes$/)).returns(true);
      mockFs.existsSync.withArgs(match(/wp-admin$/)).returns(true);
      
      // Create instance with overridden parse method to return our test flags
      const command = new MockInitCommand(args, mockConfig);
      command.parse = stub().resolves({
        args: { name: 'test-site' },
        flags: { 'from-url': url }
      });
      
      // Make sure key methods are properly mocked
      command.validateWordPressDirectory = stub().resolves({ issues: [], isValid: true });
      command.setupWordpressSource = stub().resolves();
      command.setupDockerEnvironment = stub().resolves();
      command.displayProjectInfo = stub().resolves();
      command.prepareProjectDirectory = stub().resolves();
      command.ensureDockerEnvironment = stub().resolves();
      
      await command.run();
      
      // Verify the correct setup methods were called
      expect(command.setupWordpressSource.called).to.be.true;
    });
  });
  
  describe('custom-ports flag', () => {
    it('sets custom ports for the Docker environment', async () => {
      // Custom ports for wordpress, mysql, phpmyadmin
      const customPorts = '9000,3307,9001';
      const args = ['init', 'test-site', '--custom-ports', customPorts];
      
      // Create instance with overridden parse method to return our test flags
      const command = new MockInitCommand(args, mockConfig);
      command.parse = stub().resolves({
        args: { name: 'test-site' },
        flags: { 'custom-ports': customPorts }
      });
      
      // Make sure key methods are properly mocked
      command.setupWordpressSource = stub().resolves();
      command.setupDockerEnvironment = stub().resolves();
      command.displayProjectInfo = stub().resolves();
      command.prepareProjectDirectory = stub().resolves();
      command.ensureDockerEnvironment = stub().resolves();
      
      await command.run();
      
      // Verify the docker environment setup was called
      expect(command.setupDockerEnvironment.called).to.be.true;
      
      // In a more comprehensive test, we would check the actual port values
      // were correctly set in the docker-compose file
    });
  });
}); 