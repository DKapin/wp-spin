import { expect } from 'chai'
import esmock from 'esmock'
import { join } from 'node:path'
import { restore, SinonStub, stub } from 'sinon'

describe('restart', () => {
  const TEST_PROJECT_PATH = join(process.cwd(), 'test-project')
  
  // Define a type for our mocked command instance
  type MockedRestartInstance = {
    checkDockerEnvironment: SinonStub;
    config: { version: string };
    docker: Record<string, SinonStub>;
    error: SinonStub;
    parse: SinonStub;
    run: () => Promise<void>;
  };
  
  // Stubs
  let dockerServiceStub: Record<string, SinonStub>
  let fsStub: { existsSync: SinonStub }
  let oraStub: SinonStub

  // Mocked Command Class & Config
  let MockedRestart: { new(argv: string[], config: Record<string, unknown>): MockedRestartInstance };
  let mockConfig: Record<string, unknown>; 
  
  beforeEach(async () => {
    // Mock Config
    mockConfig = { 
        root: process.cwd(),
        runHook: stub().resolves({ successes: [] }),
        version: '1.0.0'
    }; 

    // Docker Service Stub
    dockerServiceStub = {
      checkDockerComposeInstalled: stub().resolves(),
      checkDockerInstalled: stub().resolves(),
      checkDockerRunning: stub().resolves(),
      getProjectPath: stub().returns(TEST_PROJECT_PATH),
      restart: stub().resolves()
    };

    // File system stubs
    fsStub = {
      existsSync: stub().returns(true)
    };

    // Create ora spinner stub
    const spinnerStub = {
      fail: stub(),
      info: stub(),
      start: stub().returnsThis(),
      succeed: stub(),
      warn: stub()
    };
    oraStub = stub().returns(spinnerStub);

    // Create a DockerService constructor stub that returns our dockerServiceStub
    const DockerServiceStub = stub().returns(dockerServiceStub);

    // Create a prototype for Command with required methods
    class MockCommand {
      config = { version: '1.0.0' };
      docker = dockerServiceStub;
      
      checkDockerEnvironment() {
        return Promise.resolve();
      }
      
      error(message: string) {
        throw new Error(message);
      }
      
      parse() {
        return Promise.resolve({
          args: {},
          flags: {}
        });
      }
    }

    // Load Restart command with mocks using esmock
    MockedRestart = await esmock('../../src/commands/restart.js', {
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
      'node:fs': fsStub,
      'ora': oraStub
    });
    
    process.env.NODE_ENV = 'test'
  })
  
  afterEach(() => {
    restore()
  })
  
  it('restarts wordpress environment successfully', async () => {
    // Set up docker-compose.yml check to return true
    fsStub.existsSync.returns(true);
    
    const cmd = new MockedRestart([], mockConfig) as MockedRestartInstance;
    
    // Override parse method for this specific test
    cmd.parse = stub().resolves({
      args: {},
      flags: {}
    });
    
    // Set docker property to our stub
    cmd.docker = dockerServiceStub;
    
    // Override checkDockerEnvironment to not do anything
    cmd.checkDockerEnvironment = stub().resolves();
    
    await cmd.run();
    
    // Verify that docker.restart was called
    expect(dockerServiceStub.restart.called).to.be.true;
  })
  
  it('throws error when project does not exist', async () => {
    // Set up docker-compose.yml check to return false
    fsStub.existsSync.returns(false);
    
    const cmd = new MockedRestart([], mockConfig) as MockedRestartInstance;
    
    // Override parse method
    cmd.parse = stub().resolves({
      args: {},
      flags: {}
    });
    
    // Set docker property to our stub
    cmd.docker = dockerServiceStub;
    
    // Mock error throw
    cmd.error = stub().throws(new Error('No WordPress project found in current directory'));
    
    try {
      await cmd.run();
      expect.fail('Command should have thrown an error');
    } catch (error: unknown) {
      const err = error as Error;
      expect(err.message).to.equal('No WordPress project found in current directory');
    }
    
    // Verify that docker.restart was not called
    expect(dockerServiceStub.restart.called).to.be.false;
  })
  
  it('handles docker restart errors', async () => {
    // Set up docker-compose.yml check to return true
    fsStub.existsSync.returns(true);
    
    // Make docker.restart throw an error
    dockerServiceStub.restart.rejects(new Error('Docker restart failed'));
    
    const cmd = new MockedRestart([], mockConfig) as MockedRestartInstance;
    
    // Override parse method
    cmd.parse = stub().resolves({
      args: {},
      flags: {}
    });
    
    // Set docker property to our stub
    cmd.docker = dockerServiceStub;
    
    // Override checkDockerEnvironment to not do anything
    cmd.checkDockerEnvironment = stub().resolves();
    
    try {
      await cmd.run();
      expect.fail('Command should have thrown an error');
    } catch (error: unknown) {
      const err = error as Error;
      expect(err.message).to.equal('Docker restart failed');
    }
    
    // Verify that docker.restart was called
    expect(dockerServiceStub.restart.called).to.be.true;
  })
});
