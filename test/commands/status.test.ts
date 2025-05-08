import { expect } from 'chai'
import esmock from 'esmock'
import { join } from 'node:path'
import { restore, SinonStub, stub } from 'sinon'

describe('status', () => {
  const TEST_PROJECT_NAME = 'test-project'
  const TEST_PROJECT_PATH = join(process.cwd(), TEST_PROJECT_NAME)
  
  // Define a type for our mocked command instance
  type MockedStatusInstance = {
    checkDockerEnvironment: SinonStub;
    config: { version: string };
    docker: Record<string, SinonStub>;
    error: SinonStub;
    parse: SinonStub;
    run: () => Promise<void>;
  };
  
  // Stubs
  let dockerServiceStub: Record<string, SinonStub>
  let execSyncStub: SinonStub
  let consoleLogStub: SinonStub
  let oraStub: SinonStub

  // Mocked Command Class & Config
  let MockedStatus: { new(argv: string[], config: Record<string, unknown>): MockedStatusInstance };
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
    execSyncStub = stub().returns(`${TEST_PROJECT_NAME}_wordpress_1|Up 3 hours|0.0.0.0:8080->80/tcp
${TEST_PROJECT_NAME}_db_1|Up 3 hours|3306/tcp
${TEST_PROJECT_NAME}_phpmyadmin_1|Up 3 hours|0.0.0.0:8081->80/tcp`);

    // Console log stub
    consoleLogStub = stub(console, 'log');

    // Create ora spinner stub
    const spinnerStub = {
      fail: stub(),
      info: stub(),
      start: stub().returnsThis(),
      succeed: stub()
    };
    oraStub = stub().returns(spinnerStub);

    // Create a prototype for BaseCommand with required methods
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

    // Load Status command with mocks using esmock
    MockedStatus = await esmock('../../src/commands/status.js', {
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
      'ora': oraStub
    });
    
    process.env.NODE_ENV = 'test'
  })
  
  afterEach(() => {
    restore()
  })
  
  it('runs status cmd successfully with running containers', async () => {
    const cmd = new MockedStatus([], mockConfig) as MockedStatusInstance;
    
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
    
    // Verify that execSync was called to get container status
    expect(execSyncStub.called).to.be.true;
    // Verify console.log was called to display container info
    expect(consoleLogStub.called).to.be.true;
  })
  
  it('handles no running containers scenario', async () => {
    // Return data for stopped containers
    execSyncStub.returns(`${TEST_PROJECT_NAME}_wordpress_1|Exited (1) 2 hours ago|
${TEST_PROJECT_NAME}_db_1|Exited (0) 2 hours ago|
${TEST_PROJECT_NAME}_phpmyadmin_1|Exited (0) 2 hours ago|`);
    
    const cmd = new MockedStatus([], mockConfig) as MockedStatusInstance;
    
    // Override parse method
    cmd.parse = stub().resolves({
      args: {},
      flags: {}
    });
    
    // Set docker property to our stub
    cmd.docker = dockerServiceStub;
    
    // Override checkDockerEnvironment to not do anything
    cmd.checkDockerEnvironment = stub().resolves();
    
    await cmd.run();
    
    // Verify command displayed the "not running" message
    expect(execSyncStub.called).to.be.true;
    // Look for the specific log about environment not running
    const notRunningCall = consoleLogStub.getCalls().find(call => 
      call.args[0] && typeof call.args[0] === 'string' && 
      call.args[0].includes('not running')
    );
    expect(notRunningCall).to.exist;
  })
  
  it('handles error when checking container status', async () => {
    // Make execSync throw an error to simulate a failure
    execSyncStub.throws(new Error('Command failed'));
    
    const cmd = new MockedStatus([], mockConfig) as MockedStatusInstance;
    
    // Override parse method
    cmd.parse = stub().resolves({
      args: {},
      flags: {}
    });
    
    // Set docker property to our stub
    cmd.docker = dockerServiceStub;
    
    // Override checkDockerEnvironment to not do anything
    cmd.checkDockerEnvironment = stub().resolves();
    
    // Run the command - it should NOT throw an error because the implementation
    // catches errors in getContainerStatus and returns a default response
    await cmd.run();
    
    // Verify execSync was called
    expect(execSyncStub.called).to.be.true;
    
    // Look for the "not running" message, which should be displayed when
    // an error occurs and getContainerStatus returns { running: false }
    const notRunningCall = consoleLogStub.getCalls().find(call => 
      call.args[0] && typeof call.args[0] === 'string' && 
      call.args[0].includes('not running')
    );
    expect(notRunningCall).to.exist;
  })
})
