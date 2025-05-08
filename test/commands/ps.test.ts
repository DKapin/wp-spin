import { expect } from 'chai'
import esmock from 'esmock'
import { join } from 'node:path'
import { restore, SinonStub, stub } from 'sinon'

describe('ps', () => {
  const TEST_PROJECT_NAME = 'test-project'
  const TEST_PROJECT_PATH = join(process.cwd(), TEST_PROJECT_NAME)
  
  // Define a type for our mocked command instance
  type MockedPsInstance = {
    checkDockerEnvironment: SinonStub;
    config: { version: string };
    error: SinonStub;
    findProjectRoot: SinonStub;
    parse: SinonStub;
    run: () => Promise<void>;
  };
  
  // Stubs
  let dockerServiceStub: Record<string, SinonStub>
  let execSyncStub: SinonStub
  let consoleLogStub: SinonStub

  // Mocked Command Class & Config
  let MockedPs: { new(argv: string[], config: Record<string, unknown>): MockedPsInstance };
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
      getProjectPath: stub().returns(TEST_PROJECT_PATH)
    };

    // Stub execSync to return container data
    execSyncStub = stub().returns(`${TEST_PROJECT_NAME}_wordpress_1,Up 3 hours,0.0.0.0:8080->80/tcp
${TEST_PROJECT_NAME}_db_1,Up 3 hours,3306/tcp
${TEST_PROJECT_NAME}_phpmyadmin_1,Up 3 hours,0.0.0.0:8081->80/tcp`);

    // Console log stub
    consoleLogStub = stub(console, 'log');

    // Create a DockerService constructor stub that returns our dockerServiceStub
    const DockerServiceStub = stub().returns(dockerServiceStub);

    // Create a prototype for Command with required methods
    class MockCommand {
      config = { version: '1.0.0' };
      
      checkDockerEnvironment() {
        return Promise.resolve();
      }
      
      error(message: string) {
        throw new Error(message);
      }
      
      findProjectRoot() {
        return TEST_PROJECT_PATH;
      }
      
      parse() {
        return Promise.resolve({
          args: {},
          flags: {}
        });
      }
    }

    // Load Ps command with mocks using esmock
    MockedPs = await esmock('../../src/commands/ps.js', {
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
      'node:child_process': {
        execSync: execSyncStub
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
    });
    
    process.env.NODE_ENV = 'test'
  })
  
  afterEach(() => {
    restore()
  })
  
  it('runs ps cmd successfully with containers', async () => {
    const cmd = new MockedPs([], mockConfig) as MockedPsInstance;
    
    // Override parse method for this specific test
    cmd.parse = stub().resolves({
      args: {},
      flags: {}
    });
    
    // Override findProjectRoot to return test path
    cmd.findProjectRoot = stub().returns(TEST_PROJECT_PATH);
    
    // Override checkDockerEnvironment to not do anything
    cmd.checkDockerEnvironment = stub().resolves();
    
    await cmd.run();
    
    // Verify that execSync was called to get container status
    expect(execSyncStub.called).to.be.true;
    // Verify console.log was called to display container info
    expect(consoleLogStub.called).to.be.true;
  })
  
  it('handles no containers found scenario', async () => {
    // Make execSync throw an error to simulate no containers
    execSyncStub.throws(new Error('Command failed'));
    
    const cmd = new MockedPs([], mockConfig) as MockedPsInstance;
    
    // Override parse method
    cmd.parse = stub().resolves({
      args: {},
      flags: {}
    });
    
    // Override findProjectRoot to return test path
    cmd.findProjectRoot = stub().returns(TEST_PROJECT_PATH);
    
    // Override checkDockerEnvironment to not do anything
    cmd.checkDockerEnvironment = stub().resolves();
    
    await cmd.run();
    
    // Verify command handled the error
    expect(execSyncStub.called).to.be.true;
  })
  
  it('throws error when project root not found', async () => {
    const cmd = new MockedPs([], mockConfig) as MockedPsInstance;
    
    // Override parse method
    cmd.parse = stub().resolves({
      args: {},
      flags: {}
    });
    
    // Override findProjectRoot to return null (no project found)
    cmd.findProjectRoot = stub().returns(null);
    
    // Override error to throw with specific message
    cmd.error = stub().throws(new Error('No WordPress project found'));
    
    try {
      await cmd.run();
      expect.fail('Command should have thrown an error');
    } catch (error: unknown) {
      const err = error as Error;
      expect(err.message).to.equal('No WordPress project found');
    }
  })
}) 