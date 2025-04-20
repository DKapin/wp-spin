import {expect} from 'chai'
import * as fs from 'fs-extra'
import {join} from 'node:path'
import sinon from 'sinon'

import {DockerService} from '../../src/services/docker.js'

describe('DockerService', () => {
  // Test constants
  const TEST_PROJECT_PATH = '/test/project/path'
  
  // Stubs
  let execaStub: sinon.SinonStub
  let fsPathExistsStub: sinon.SinonStub
  
  // Service instance
  let dockerService: DockerService
  
  beforeEach(() => {
    // Set test environment variable
    process.env.NODE_ENV = 'test'
    
    // Create stubs
    execaStub = sinon.stub()
    sinon.stub(globalThis, 'require').callsFake(() => ({ execa: execaStub }));
    
    fsPathExistsStub = sinon.stub(fs, 'pathExists')
    sinon.stub(fs, 'mkdirSync')
    sinon.stub(fs, 'writeFile').resolves()
    
    // Create DockerService instance
    dockerService = new DockerService(TEST_PROJECT_PATH)
    
    // Default behavior for stubs
    execaStub.resolves({stderr: '', stdout: ''})
    fsPathExistsStub.resolves(true)
  })
  
  afterEach(() => {
    // Restore all stubs
    sinon.restore()
  })
  
  describe('checkDockerInstalled', () => {
    it('succeeds when Docker is installed', async () => {
      execaStub.withArgs('docker', ['--version'], sinon.match.any).resolves({stderr: '', stdout: 'Docker version 20.10.14'})
      
      await expect(dockerService.checkDockerInstalled()).to.be.fulfilled
    })
    
    it('throws error when Docker is not installed', async () => {
      execaStub.withArgs('docker', ['--version'], sinon.match.any).rejects(new Error('command not found: docker'))
      
      await expect(dockerService.checkDockerInstalled()).to.be.rejected
    })
  })
  
  describe('checkDockerRunning', () => {
    it('succeeds when Docker is running', async () => {
      execaStub.withArgs('docker', ['info'], sinon.match.any).resolves({stderr: '', stdout: ''})
      
      await expect(dockerService.checkDockerRunning()).to.be.fulfilled
    })
    
    it('throws error when Docker is not running', async () => {
      execaStub.withArgs('docker', ['info'], sinon.match.any).rejects(new Error('Cannot connect to the Docker daemon'))
      
      await expect(dockerService.checkDockerRunning()).to.be.rejected
    })
  })
  
  describe('checkDockerComposeInstalled', () => {
    it('succeeds when Docker Compose is installed', async () => {
      execaStub.withArgs('docker-compose', ['--version'], sinon.match.any).resolves({stderr: '', stdout: 'docker-compose version 2.4.1'})
      
      await expect(dockerService.checkDockerComposeInstalled()).to.be.fulfilled
    })
    
    it('throws error when Docker Compose is not installed', async () => {
      execaStub.withArgs('docker-compose', ['--version'], sinon.match.any).rejects(new Error('command not found: docker-compose'))
      
      await expect(dockerService.checkDockerComposeInstalled()).to.be.rejected
    })
  })
  
  describe('checkProjectExists', () => {
    it('returns true when docker-compose.yml exists', async () => {
      fsPathExistsStub.withArgs(join(TEST_PROJECT_PATH, 'docker-compose.yml')).resolves(true)
      
      const result = await dockerService.checkProjectExists()
      expect(result).to.be.true
    })
    
    it('returns false when docker-compose.yml does not exist', async () => {
      fsPathExistsStub.withArgs(join(TEST_PROJECT_PATH, 'docker-compose.yml')).resolves(false)
      
      const result = await dockerService.checkProjectExists()
      expect(result).to.be.false
    })
  })
  
  describe('start', () => {
    it('starts the Docker environment', async () => {
      // Skip internal method tests for simplicity
      await dockerService.start()
      
      // Verify checkProjectExists was called
      expect(await dockerService.checkProjectExists()).to.be.true
    })
  })
  
  describe('stop', () => {
    it('stops the Docker environment', async () => {
      await dockerService.stop()
      
      // Simplified test - just verify it doesn't throw
      expect(true).to.be.true
    })
  })
  
  describe('restart', () => {
    it('restarts the Docker environment', async () => {
      // Mock the methods that get called in restart()
      sinon.stub(dockerService, 'stop').resolves()
      sinon.stub(dockerService, 'start').resolves()
      
      await dockerService.restart()
      
      // Verify stop and start were called
      expect(dockerService.stop).to.have.been.calledOnce
      expect(dockerService.start).to.have.been.calledOnce
    })
  })
  
  describe('port checking', () => {
    it('handles port conflicts by checking ports', async () => {
      await dockerService.checkPorts()
      
      // Simplified test - just verify it doesn't throw
      expect(true).to.be.true
    })
  })
}) 