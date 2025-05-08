import {expect} from 'chai'
import esmock from 'esmock'
import { match, restore, SinonStub, stub } from 'sinon'

describe('share', () => {
  // For capturing output
  let consoleOutput: string[] = []
  const originalConsoleLog = console.log
  
  // Stubs for dependencies
  let dockerServiceStub: Record<string, SinonStub>
  let execaStub: { execa: SinonStub }
  let fsStub: Record<string, SinonStub>
  
  // Define a type for the ShareCommand class
  interface ShareCommandType {
    checkDockerEnvironment: SinonStub;
    docker: Record<string, SinonStub>;
    ensureNgrokInstalled: SinonStub;
    error: SinonStub;
    getContainerNames: SinonStub;
    getWordPressPort: SinonStub;
    parse: SinonStub;
    run: () => Promise<void>;
    startNgrokTunnel: SinonStub;
    validateProjectContext: SinonStub;
  }
  
  // Declare with constructor type
  let ShareCommand: { new(argv: string[]): ShareCommandType }
  
  beforeEach(async () => {
    // Setup console capture
    consoleOutput = []
    console.log = (message: string) => {
      consoleOutput.push(message)
      return originalConsoleLog(message)
    }
    
    // Create Docker service stub
    dockerServiceStub = {
      checkDockerComposeInstalled: stub().resolves(),
      checkDockerInstalled: stub().resolves(),
      checkDockerRunning: stub().resolves(),
      checkProjectExists: stub().resolves(true),
      getContainerNames: stub().returns({ mysql: 'test_mysql_1', wordpress: 'test_wordpress_1' }),
      getProjectPath: stub().returns('/test/project/path'),
      isDockerRunning: stub().resolves(true),
      updateDockerComposePorts: stub().resolves()
    }
    
    // Create Docker service constructor stub
    const DockerServiceStub = stub().returns(dockerServiceStub)
    
    // Create fs stub
    fsStub = {
      existsSync: stub().returns(true),
      writeFile: stub().resolves()
    }
    
    // Create execa stub with a default implementation
    execaStub = { 
      execa: stub()
    }
    
    // Mock Docker running check
    execaStub.execa.withArgs('docker', ['info']).resolves({ stdout: 'mock output' })
    
    // Mock Docker ps
    execaStub.execa.withArgs('docker', ['ps', '-q', '-f', 'name=wordpress']).resolves({ stdout: 'container-id' })
    
    // Mock Docker compose call
    execaStub.execa.withArgs('docker-compose', match.array).resolves({ stdout: 'wordpress' })
    
    // Mock ngrok check
    execaStub.execa.withArgs('curl', ['-s', 'http://localhost:4040/api/tunnels']).rejects(new Error('Not found'))
    
    // Mock ngrok install check
    execaStub.execa.withArgs('ngrok', ['--version']).resolves({ stdout: 'ngrok version 2.3.40' })
    execaStub.execa.withArgs('npx', ['ngrok', '--version']).resolves({ stdout: 'ngrok version 2.3.40' })
    
    // Mock docker exec commands
    execaStub.execa.withArgs('docker', match(['exec', '-i', 'test_wordpress_1'])).resolves({
      stdout: 'WordPress configuration updated'
    })
    
    // Stub the ngrok process
    const ngrokProcess = {
      kill: stub(),
      stderr: {
        on: stub().returns({ stderr: { on: stub() } })
      },
      stdout: {
        on: stub().callsFake((event, callback) => {
          if (event === 'data') {
            process.nextTick(() => {
              callback(Buffer.from('url=https://mock-12345.ngrok.io'));
            });
          }

          return { stdout: { on: stub() } };
        })
      }
    }
    
    // When ngrok is executed, return the mocked process
    execaStub.execa.withArgs('ngrok', match.array).returns(ngrokProcess)
    
    execaStub.execa.withArgs('npx', match(['ngrok', 'http']).and(match.array)).returns(ngrokProcess)
    
    // Mock inquirer
    const inquirerStub = {
      createPromptModule: stub().returns(() => Promise.resolve({ killNgrok: true }))
    }
    
    // Mock debug
    const debugStub = stub().returns(stub())
    
    // Create spawn stub with event handling
    const spawnStub = stub().returns({
      on(event: string, callback: (code: number) => void) {
        if (event === 'close') {
          callback(0); // Call with success exit code
        }

        return { on: stub() };
      },
      
      stderr: {
        on: stub().returns({ on: stub() })
      },
      
      stdout: {
        on(event: string, callback: (data: Buffer) => void) {
          if (event === 'data') {
            callback(Buffer.from('mock output'));
          }
          
          return { on: stub() };
        }
      }
    });
    
    // Create mocks for node:child_process
    const childProcessStub = {
      execSync: stub().returns('container-id'),
      spawn: spawnStub
    }

    // Create a mock ora instance
    const oraStub = stub().returns({
      fail: stub(),
      info: stub(),
      start: stub().returns({
        fail: stub(),
        info: stub(),
        start: stub(),
        succeed: stub(),
        text: '',
        warn: stub()
      }),
      succeed: stub(),
      warn: stub()
    });

    // Load Share command with mocked dependencies
    ShareCommand = await esmock('../../src/commands/share.js', {
      '../../src/config/sites.js': {
        getSiteByName: stub().returns(null)
      },
      '../../src/services/docker.js': {
        DockerService: DockerServiceStub
      },
      'debug': debugStub,
      'execa': execaStub,
      'fs-extra': fsStub,
      'inquirer': inquirerStub,
      'node:child_process': childProcessStub,
      'ora': oraStub
    });
  })
  
  afterEach(() => {
    console.log = originalConsoleLog
    restore()
  })

  it('shares the WordPress site using ngrok', async () => {
    // Create an instance of the command
    const shareCmd = new ShareCommand([])
    
    // Set up instance
    shareCmd.docker = dockerServiceStub
    shareCmd.validateProjectContext = stub().resolves('test_wordpress_1')
    shareCmd.startNgrokTunnel = stub().resolves()
    shareCmd.checkDockerEnvironment = stub().resolves()
    shareCmd.ensureNgrokInstalled = stub().resolves()
    shareCmd.getContainerNames = stub().returns({
      mysql: 'test_mysql_1',
      wordpress: 'test_wordpress_1'
    })
    shareCmd.getWordPressPort = stub().resolves(8080)
    
    // Override parse specifically for this test
    shareCmd.parse = stub().resolves({ flags: { 
      debug: false,
      fixurl: true,
      force: false,
      method: 'config',
      port: 8080
    }})
    
    try {
      await shareCmd.run()
      
      // Check if validateProjectContext was called
      expect(shareCmd.validateProjectContext.called).to.be.true
      
      // Check if startNgrokTunnel was called
      expect(shareCmd.startNgrokTunnel.called).to.be.true
    } catch (error) {
      console.error('Test error:', error)
      throw error
    }
  })
  
  it('fails if no WordPress project exists in current directory', async () => {
    // Set up the Docker service to indicate no project
    dockerServiceStub.checkProjectExists.resolves(false)
    
    // Create an instance of the command
    const shareCmd = new ShareCommand([])
    
    // Set up instance
    shareCmd.docker = dockerServiceStub
    shareCmd.checkDockerEnvironment = stub().resolves()
    
    // Set up error to return specific message
    shareCmd.error = stub().throws(new Error('Could not find a valid wp-spin project'))
    
    // Set up validateProjectContext to throw an error
    shareCmd.validateProjectContext = stub().throws(
      new Error('Could not find a valid wp-spin project')
    )
    
    try {
      await shareCmd.run()
      expect.fail('Command should have thrown an error')
    } catch (error) {
      if (error instanceof Error) {
        expect(error.message).to.include('valid wp-spin project')
      } else {
        expect.fail('Error should be an Error instance')
      }
    }
  })
  
  it('uses --force flag to bypass project checks', async () => {
    // Set up the Docker service to indicate no project
    dockerServiceStub.checkProjectExists.resolves(false)
    
    // Create an instance of the command
    const shareCmd = new ShareCommand(['--force'])
    
    // Set up instance
    shareCmd.docker = dockerServiceStub
    shareCmd.validateProjectContext = stub().resolves('test_wordpress_1')
    shareCmd.startNgrokTunnel = stub().resolves()
    shareCmd.checkDockerEnvironment = stub().resolves()
    shareCmd.ensureNgrokInstalled = stub().resolves()
    shareCmd.getContainerNames = stub().returns({
      mysql: 'test_mysql_1',
      wordpress: 'test_wordpress_1'
    })
    shareCmd.getWordPressPort = stub().resolves(8080)
    
    // Override parse specifically for this test
    shareCmd.parse = stub().resolves({ flags: { 
      debug: false,
      fixurl: true,
      force: true,  // Force flag is true
      method: 'config',
      port: 8080
    }})
    
    try {
      await shareCmd.run()
      
      // Check if validateProjectContext was called with force flag
      expect(shareCmd.validateProjectContext.calledWith(match({ force: true }), match.any)).to.be.true
      
      // Check if startNgrokTunnel was called
      expect(shareCmd.startNgrokTunnel.called).to.be.true
    } catch (error) {
      console.error('Test error:', error)
      throw error
    }
  })
  
  it('handles custom subdomains correctly', async () => {
    // Create an instance of the command
    const shareCmd = new ShareCommand(['--subdomain=mysite'])
    
    // Set up instance
    shareCmd.docker = dockerServiceStub
    shareCmd.validateProjectContext = stub().resolves('test_wordpress_1')
    shareCmd.startNgrokTunnel = stub().resolves()
    shareCmd.checkDockerEnvironment = stub().resolves()
    shareCmd.ensureNgrokInstalled = stub().resolves()
    shareCmd.getContainerNames = stub().returns({
      mysql: 'test_mysql_1',
      wordpress: 'test_wordpress_1'
    })
    shareCmd.getWordPressPort = stub().resolves(8080)
    
    // Override parse specifically for this test
    shareCmd.parse = stub().resolves({ flags: { 
      debug: false,
      fixurl: true,
      force: false,
      method: 'config',
      port: 8080,
      subdomain: 'mysite'  // Add subdomain flag
    }})
    
    try {
      await shareCmd.run()
      
      // Check if startNgrokTunnel was called with subdomain parameter
      expect(shareCmd.startNgrokTunnel.calledWith(
        match.any, 
        match({ subdomain: 'mysite' }), 
        match.any
      )).to.be.true
    } catch (error) {
      console.error('Test error:', error)
      throw error
    }
  })
  
  it('handles custom regions correctly', async () => {
    // Create an instance of the command
    const shareCmd = new ShareCommand(['--region=eu'])
    
    // Set up instance
    shareCmd.docker = dockerServiceStub
    shareCmd.validateProjectContext = stub().resolves('test_wordpress_1')
    shareCmd.startNgrokTunnel = stub().resolves()
    shareCmd.checkDockerEnvironment = stub().resolves()
    shareCmd.ensureNgrokInstalled = stub().resolves()
    shareCmd.getContainerNames = stub().returns({
      mysql: 'test_mysql_1',
      wordpress: 'test_wordpress_1'
    })
    shareCmd.getWordPressPort = stub().resolves(8080)
    
    // Override parse specifically for this test
    shareCmd.parse = stub().resolves({ flags: { 
      debug: false,
      fixurl: true,
      force: false,
      method: 'config',
      port: 8080,
      region: 'eu'  // Add region flag
    }})
    
    try {
      await shareCmd.run()
      
      // Check if startNgrokTunnel was called with region parameter
      expect(shareCmd.startNgrokTunnel.calledWith(
        match.any, 
        match({ region: 'eu' }), 
        match.any
      )).to.be.true
    } catch (error) {
      console.error('Test error:', error)
      throw error
    }
  })
}); 