import {expect} from 'chai'
import esmock from 'esmock'
import { restore, SinonSpyCall, SinonStub, stub } from 'sinon'

interface CommandType {
  checkDockerEnvironment: SinonStub;
  checkWordPressContainer: SinonStub;
  docker: Record<string, SinonStub>;
  log: SinonStub;
  parse: SinonStub;
  run: () => Promise<void>;
  runWpCli: SinonStub;
}

describe('theme', () => {
  // For capturing output
  let consoleOutput: string[] = []
  const originalConsoleLog = console.log
  
  // Test constants
  const TEST_THEME_NAME = 'twentytwentyfour'
  const TEST_THEME_VERSION = '1.0.0'
  
  // Stubs for dependencies
  let dockerServiceStub: Record<string, SinonStub>
  let fsStub: Record<string, SinonStub>
  // Using CommandType instead of any
  let ThemeCommand: { new(argv: string[]): CommandType }
  let childProcessStub: Record<string, SinonStub>
  
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
      isDockerRunning: stub().resolves(true)
    }
    
    // Create Docker service constructor stub
    const DockerServiceStub = stub().returns(dockerServiceStub)
    
    // Create fs stub
    fsStub = {
      existsSync: stub().returns(true),
      writeFile: stub().resolves()
    }
    
    // Create a spawn stub for Docker exec and other child processes
    const spawnStub = stub().returns({
      on(event: string, callback: (code: number) => void) {
        if (event === 'close') {
          callback(0) // Call with success exit code
        }

        return { on: stub() }
      },
      
      stderr: {
        on: stub().returns({ on: stub() })
      },
      
      stdout: {
        on(event: string, callback: (data: Buffer) => void) {
          if (event === 'data') {
            callback(Buffer.from('Command executed successfully'))
          }

          return { on: stub() }
        }
      }
    })
    
    // Create mocks for node:child_process
    childProcessStub = {
      execSync: stub().returns('container-id'),
      spawn: spawnStub
    }
    
    // Load Theme command with mocked dependencies
    ThemeCommand = await esmock('../../src/commands/theme.js', {
      '../../src/config/sites.js': {
        getSiteByName: stub().returns(null)
      },
      '../../src/services/docker.js': {
        DockerService: DockerServiceStub
      },
      'fs-extra': fsStub,
      'node:child_process': childProcessStub
    })
  })
  
  afterEach(() => {
    console.log = originalConsoleLog
    restore()
  })

  it('lists themes when no flags are provided', async () => {
    // Create a theme command instance
    const themeCmd = new ThemeCommand([])
    
    // Set up instance
    themeCmd.docker = dockerServiceStub
    themeCmd.checkDockerEnvironment = stub().resolves()
    themeCmd.checkWordPressContainer = stub().resolves()
    themeCmd.log = stub()
    themeCmd.runWpCli = stub().resolves('twentytwentyfour\ntwentytwentythree')
    
    // Override parse to return empty flags
    themeCmd.parse = stub().resolves({ 
      flags: {}
    })
    
    // Run the command
    await themeCmd.run()
    
    // Verify output
    expect(themeCmd.log.calledWith('Installed themes:')).to.be.true
    expect(themeCmd.runWpCli.calledWith('wp theme list')).to.be.true
  })

  it('installs a theme with --add flag', async () => {
    // Create a theme command instance
    const themeCmd = new ThemeCommand(['--add', TEST_THEME_NAME])
    
    // Set up instance
    themeCmd.docker = dockerServiceStub
    themeCmd.checkDockerEnvironment = stub().resolves()
    themeCmd.checkWordPressContainer = stub().resolves()
    themeCmd.log = stub()
    themeCmd.runWpCli = stub().resolves(`Installed: ${TEST_THEME_NAME}`)
    
    // Override parse to return an 'add' flag
    themeCmd.parse = stub().resolves({ 
      flags: { 
        add: TEST_THEME_NAME,
        force: false
      }
    })
    
    // Run the command
    await themeCmd.run()
    
    // Verify the output
    expect(themeCmd.log.calledWith(`Installing theme ${TEST_THEME_NAME}...`)).to.be.true
    expect(themeCmd.log.calledWith(`Theme ${TEST_THEME_NAME} installed successfully!`)).to.be.true
    
    // The issue might be in how wp theme install command is formatted
    // Let's check the actual command string that was passed
    const wpCliCalls = themeCmd.runWpCli.getCalls().map((call: SinonSpyCall) => call.args[0] as string)
    expect(wpCliCalls.some((cmd: string) => cmd.includes(`wp theme install ${TEST_THEME_NAME}`))).to.be.true
  })

  it('installs a theme with version using --add and --version flags', async () => {
    // Create a theme command instance
    const themeCmd = new ThemeCommand(['--add', TEST_THEME_NAME, '--version', TEST_THEME_VERSION])
    
    // Set up instance
    themeCmd.docker = dockerServiceStub
    themeCmd.checkDockerEnvironment = stub().resolves()
    themeCmd.checkWordPressContainer = stub().resolves()
    themeCmd.log = stub()
    themeCmd.runWpCli = stub().resolves(`Installed: ${TEST_THEME_NAME} version ${TEST_THEME_VERSION}`)
    
    // Override parse to return add and version flags
    themeCmd.parse = stub().resolves({ 
      flags: { 
        add: TEST_THEME_NAME,
        force: false,
        version: TEST_THEME_VERSION
      }
    })
    
    // Run the command
    await themeCmd.run()
    
    // Verify the output
    expect(themeCmd.log.calledWith(`Installing theme ${TEST_THEME_NAME} version ${TEST_THEME_VERSION}...`)).to.be.true
    expect(themeCmd.log.calledWith(`Theme ${TEST_THEME_NAME} installed successfully!`)).to.be.true
    expect(themeCmd.runWpCli.calledWith(`wp theme install ${TEST_THEME_NAME} --version=${TEST_THEME_VERSION} --force=false`)).to.be.true
  })

  it('removes a theme with --remove flag', async () => {
    // Create a theme command instance
    const themeCmd = new ThemeCommand(['--remove', TEST_THEME_NAME])
    
    // Set up instance
    themeCmd.docker = dockerServiceStub
    themeCmd.checkDockerEnvironment = stub().resolves()
    themeCmd.checkWordPressContainer = stub().resolves()
    themeCmd.log = stub()
    themeCmd.runWpCli = stub().resolves(`Removed: ${TEST_THEME_NAME}`)
    
    // Override parse to return a 'remove' flag
    themeCmd.parse = stub().resolves({ 
      flags: { 
        remove: TEST_THEME_NAME
      }
    })
    
    // Run the command
    await themeCmd.run()
    
    // Verify the output
    expect(themeCmd.log.calledWith(`Removing theme ${TEST_THEME_NAME}...`)).to.be.true
    expect(themeCmd.log.calledWith(`Theme ${TEST_THEME_NAME} removed successfully!`)).to.be.true
    expect(themeCmd.runWpCli.calledWith(`wp theme delete ${TEST_THEME_NAME}`)).to.be.true
  })
  
  it('handles errors during theme operations', async () => {
    // Create a theme command instance
    const themeCmd = new ThemeCommand(['--add', TEST_THEME_NAME])
    
    // Set up instance
    themeCmd.docker = dockerServiceStub
    themeCmd.checkDockerEnvironment = stub().resolves()
    themeCmd.checkWordPressContainer = stub().resolves()
    themeCmd.log = stub()
    
    // Make runWpCli throw an error
    themeCmd.runWpCli = stub().throws(new Error('Theme installation failed'))
    
    // Override parse to return an 'add' flag
    themeCmd.parse = stub().resolves({ 
      flags: { 
        add: TEST_THEME_NAME,
        force: false
      }
    })
    
    // Expect an error when running the command
    try {
      await themeCmd.run()
      expect.fail('Command should have thrown an error')
    } catch (error) {
      if (error instanceof Error) {
        expect(error.message).to.include('Theme installation failed')
      } else {
        expect.fail('Error should be an Error instance')
      }
    }
  })
  
  it('checks WordPress container before running commands', async () => {
    // Create a theme command instance
    const themeCmd = new ThemeCommand([])
    
    // Set up instance
    themeCmd.docker = dockerServiceStub
    themeCmd.checkDockerEnvironment = stub().resolves()
    themeCmd.checkWordPressContainer = stub().resolves()
    themeCmd.log = stub()
    themeCmd.runWpCli = stub().resolves('themes list')
    
    // Override parse to return empty flags
    themeCmd.parse = stub().resolves({ 
      flags: {}
    })
    
    // Run the command
    await themeCmd.run()
    
    // Verify container checks were performed
    expect(themeCmd.checkDockerEnvironment.called).to.be.true
    expect(themeCmd.checkWordPressContainer.called).to.be.true
  })
})
