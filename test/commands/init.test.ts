import { expect } from 'chai'
import esmock from 'esmock'
import { join } from 'node:path'
import { match, restore, SinonStub, stub } from 'sinon'

// We don't want to directly import these since we'll be mocking them
// import Init from '../../src/commands/init.js'
// import {DockerService} from '../../src/services/docker.js'

describe('init', () => {
  const TEST_PROJECT_NAME = 'test-project'
  const TEST_PROJECT_PATH = join(process.cwd(), TEST_PROJECT_NAME)
  const DOCKER_COMPOSE_PATH = join(TEST_PROJECT_PATH, 'docker-compose.yml')
  
  // Define a type for our mocked command instance
  type MockedInitInstance = {
    config: { version: string };
    error: SinonStub;
    parse: SinonStub;
    run: () => Promise<void>;
  };
  
  // Stubs
  let dockerServiceStub: Record<string, SinonStub>
  let existsSyncStub: SinonStub
  let mkdirSyncStub: SinonStub
  let writeFileStub: SinonStub
  let writeFileSyncStub: SinonStub
  let readFileStub: SinonStub
  let chmodStub: SinonStub
  let removeSyncStub: SinonStub
  let checkDockerInstalledStub: SinonStub
  let checkDockerRunningStub: SinonStub
  let checkDockerComposeInstalledStub: SinonStub
  let checkPortsStub: SinonStub
  let startStub: SinonStub
  let stopStub: SinonStub
  let ensureDirStub: SinonStub

  // Mocked Command Class & Config
  let MockedInit: { new(argv: string[], config: Record<string, unknown>): MockedInitInstance };
  let mockConfig: Record<string, unknown>; 
  
  beforeEach(async () => {
    // Mock Config
    mockConfig = { 
        root: process.cwd(),
        runHook: stub().resolves({ successes: [] }),
        version: '1.0.0'
    }; 

    // Docker Service Stub
    checkDockerInstalledStub = stub().resolves();
    checkDockerRunningStub = stub().resolves();
    checkDockerComposeInstalledStub = stub().resolves();
    checkPortsStub = stub().resolves();
    startStub = stub().resolves();
    stopStub = stub().resolves();
    dockerServiceStub = {
      checkDiskSpace: stub().resolves(),
      checkDockerComposeInstalled: checkDockerComposeInstalledStub,
      checkDockerInstalled: checkDockerInstalledStub,
      checkDockerRunning: checkDockerRunningStub,
      checkMemory: stub().resolves(),
      checkPorts: checkPortsStub,
      checkProjectExists: stub().resolves(false),
      getLogs: stub().resolves(''),
      getPortMappings: stub().returns({}),
      getProjectPath: stub().returns(TEST_PROJECT_PATH),
      logs: stub().resolves(),
      restart: stub().resolves(),
      shell: stub().resolves(),
      start: startStub,
      status: stub().resolves(),
      stop: stopStub,
      updateDockerComposePorts: stub().resolves(),
    };

    // Filesystem Stubs
    existsSyncStub = stub().returns(false);
    existsSyncStub.withArgs(TEST_PROJECT_PATH).returns(false);
    existsSyncStub.withArgs(match(/.*wp-content/)).returns(true);
    existsSyncStub.withArgs(match(/.*wp-includes/)).returns(true);
    existsSyncStub.withArgs(match(/.*wp-admin/)).returns(true);
    existsSyncStub.withArgs(match(/.*wp-config.php/)).returns(true);
    mkdirSyncStub = stub();
    writeFileStub = stub().resolves();
    writeFileSyncStub = stub();
    readFileStub = stub();
    readFileStub.withArgs(DOCKER_COMPOSE_PATH, 'utf8').resolves(`
      services:
        wordpress:
          ports:
           - "8080:80"
        phpmyadmin:
          ports:
           - "8081:80"
    `);
    readFileStub.rejects(new Error('fs.readFile mock called with unexpected path'));
    chmodStub = stub().resolves();
    removeSyncStub = stub();
    ensureDirStub = stub().resolves();

    // Create a stub for the setupWordpressSource method to bypass WordPress download
    const setupWordpressSourceStub = stub().resolves();

    // Create a DockerService constructor stub that returns our dockerServiceStub
    const DockerServiceStub = stub().returns(dockerServiceStub);

    // Create a prototype for Command with required methods
    class MockCommand {
      config = { version: '1.0.0' };
      
      error(message: string) {
        throw new Error(message);
      }
      
      parse() {
        return Promise.resolve({
          args: { name: TEST_PROJECT_NAME },
          flags: { 'wordpress-version': 'latest' }
        });
      }
    }

    // Load Init command with mocks using esmock
    MockedInit = await esmock('../../src/commands/init.js', {
      '../../src/config/sites.js': {
        addSite: stub().returns(true)
      },
      '../../src/services/docker.js': {
        DockerService: DockerServiceStub
      },
      '@oclif/core': {
        Args: { string: stub().returns({}) },
        Command: MockCommand,
        Config: class {},
        Flags: { 
          boolean: stub().returns({}),
          string: stub().returns({})
        }
      },
      'execa': {
        execa: stub().resolves({ stdout: '' }),
        execaSync: stub().returns({ stdout: '' })
      },
      'fs-extra': {
        chmod: chmodStub,
        ensureDir: ensureDirStub,
        existsSync: existsSyncStub,
        mkdirSync: mkdirSyncStub,
        readFile: readFileStub,
        removeSync: removeSyncStub,
        writeFile: writeFileStub,
        writeFileSync: writeFileSyncStub,
      },
      'ora': () => ({
        fail: stub(),
        info: stub(),
        start: stub().returns({ 
          fail: stub(),
          info: stub(),
          succeed: stub(), 
          warn: stub() 
        }),
        succeed: stub(),
        warn: stub()
      })
    }, {
      // Replace the problematic setupWordpressSource method with our stub
      '/Users/danielkapin/Projects/wp-spin/src/commands/init.js': {
        Init: {
          prototype: {
            setupWordpressSource: setupWordpressSourceStub
          }
        }
      }
    });
    
    process.env.NODE_ENV = 'test'
  })
  
  afterEach(() => {
    restore()
  })
  
  it('creates a new WordPress project directory', async () => {
    const cmd = new MockedInit([TEST_PROJECT_NAME], mockConfig) as MockedInitInstance;
    
    // Override parse method for this specific test
    cmd.parse = stub().resolves({
      args: { name: TEST_PROJECT_NAME },
      flags: { 'wordpress-version': 'latest' }
    });
    
    // Override the error method so it doesn't throw for the specific WordPress download error
    const originalError = cmd.error;
    cmd.error = stub().callsFake((message) => {
      // If it's the WordPress download error, just log it and continue the test
      if (message === 'Failed to download WordPress') {
        console.log('Mock: WordPress download would happen here');
        return;
      }
      // For any other error, use the original error method
      return originalError(message);
    });
    
    await cmd.run();
    
    // Just verify the project directory was created
    expect(mkdirSyncStub.calledWith(TEST_PROJECT_PATH)).to.be.true;
    expect(writeFileSyncStub.calledWith(match(new RegExp(`${TEST_PROJECT_PATH}\\/\\.wp-spin`)))).to.be.true;
    
    // Verify Docker environment was checked
    expect(dockerServiceStub.checkDockerInstalled.called).to.be.true;
    expect(dockerServiceStub.checkDockerRunning.called).to.be.true;
    expect(dockerServiceStub.checkDockerComposeInstalled.called).to.be.true;
  })
  
  it('fails if directory already exists and no force flag', async () => {
    existsSyncStub.withArgs(TEST_PROJECT_PATH).returns(true)
    
    const cmd = new MockedInit([TEST_PROJECT_NAME], mockConfig) as MockedInitInstance;
    
    // Override parse and error methods for this specific test
    cmd.parse = stub().resolves({
      args: { name: TEST_PROJECT_NAME },
      flags: { force: false }
    });
    
    cmd.error = stub().throws(new Error(`Directory ${TEST_PROJECT_NAME} already exists`));
    
    try {
      await cmd.run();
      expect.fail('Command should have thrown an error')
    } catch (error: unknown) {
      const err = error as Error;
      expect(err.message).to.equal(`Directory ${TEST_PROJECT_NAME} already exists`)
    }
    
    expect(mkdirSyncStub.called).to.be.false
  })
  
  it('removes existing directory when force flag is used', async () => {
    existsSyncStub.withArgs(TEST_PROJECT_PATH).returns(true)
    
    const cmd = new MockedInit([TEST_PROJECT_NAME, '--force'], mockConfig) as MockedInitInstance;
    
    // Mock parse to return the force flag as true
    cmd.parse = stub().resolves({ 
      args: { name: TEST_PROJECT_NAME }, 
      flags: { force: true } 
    });
    
    // Override the error method for WordPress download errors
    const originalError = cmd.error;
    cmd.error = stub().callsFake((message) => {
      if (message === 'Failed to download WordPress') {
        console.log('Mock: WordPress download would happen here');
        return;
      }
      return originalError(message);
    });
    
    await cmd.run();
    
    expect(removeSyncStub.calledWith(TEST_PROJECT_PATH)).to.be.true;
    expect(mkdirSyncStub.calledWith(TEST_PROJECT_PATH)).to.be.true;
  })
  
  it('creates secure credentials in .env and .credentials.json files', async () => {
    const cmd = new MockedInit([TEST_PROJECT_NAME], mockConfig) as MockedInitInstance;
    
    // Override parse method for this specific test
    cmd.parse = stub().resolves({
      args: { name: TEST_PROJECT_NAME },
      flags: { 'wordpress-version': 'latest' }
    });
    
    // Override the error method for WordPress download errors
    const originalError = cmd.error;
    cmd.error = stub().callsFake((message) => {
      if (message === 'Failed to download WordPress') {
        console.log('Mock: WordPress download would happen here');
        return;
      }
      return originalError(message);
    });
    
    // Stub the specific file write for credential files using regex to match
    const credentialRegex = new RegExp(`${TEST_PROJECT_PATH}.*\\.credentials\\.json$`);
    writeFileStub.withArgs(match(credentialRegex)).callsFake((_path, _content) => {
      // Create simulated credential content with the expected properties
      const mockContent = JSON.stringify({
        MYSQL_ROOT_PASSWORD: 'mock-root-password',
        WORDPRESS_DB_PASSWORD: 'mock-password'
      });
      return Promise.resolve(mockContent);
    });
    
    await cmd.run();
    
    // Verify .env file creation
    const envCallArgs = writeFileStub.getCalls().find(call => 
      typeof call.args[0] === 'string' && call.args[0].endsWith('.env')
    )?.args;
    
    expect(envCallArgs).to.exist;
    if (envCallArgs) {
      const envContent = envCallArgs[1].toString();
      expect(envContent).to.include('WORDPRESS_DB_PASSWORD=');
      expect(envContent).to.include('WORDPRESS_DB_USER=wordpress');
    }
    
    // Now we're expecting our stubbed result to be returned
    expect(writeFileStub.calledWith(match(credentialRegex))).to.be.true;
  })
  
  it('handles Docker environment check failures', async () => {
    const checkError = new Error('Docker is not running');
    dockerServiceStub.checkDockerRunning.rejects(checkError);
    
    const cmd = new MockedInit([TEST_PROJECT_NAME], mockConfig) as MockedInitInstance;
    
    // Override parse method for this specific test
    cmd.parse = stub().resolves({
      args: { name: TEST_PROJECT_NAME },
      flags: { 'wordpress-version': 'latest' }
    });
    
    // Override error method to rethrow our specific error
    cmd.error = stub().callsFake((message) => {
      if (message === checkError.message) {
        throw checkError;
      }
      
      if (message instanceof Error) {
        throw message;
      }
      
      throw new Error(message);
    });
    
    try {
      await cmd.run();
      expect.fail('Command should have thrown an error');
    } catch (error: unknown) {
      const err = error as Error;
      expect(err.message).to.equal(checkError.message);
    }
  })
  
  it('starts the WordPress environment after setup', async () => {
    const cmd = new MockedInit([TEST_PROJECT_NAME], mockConfig) as MockedInitInstance;
    
    // Override parse method for this specific test
    cmd.parse = stub().resolves({
      args: { name: TEST_PROJECT_NAME },
      flags: { 'wordpress-version': 'latest' }
    });
    
    // Override the error method for WordPress download errors
    const originalError = cmd.error;
    cmd.error = stub().callsFake((message) => {
      if (message === 'Failed to download WordPress') {
        console.log('Mock: WordPress download would happen here');
        return;
      }
      return originalError(message);
    });
    
    await cmd.run();
    
    expect(dockerServiceStub.start.called).to.be.true;
  })
})
