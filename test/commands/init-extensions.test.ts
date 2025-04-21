import { expect } from 'chai';
import { execa } from 'execa';
import * as fs from 'fs-extra';
import * as path from 'node:path';
import * as sinon from 'sinon';

import Init from '../../src/commands/init.js';
import { DockerService } from '../../src/services/docker.js';

describe('init command extensions', () => {
  let dockerServiceStub: sinon.SinonStubbedInstance<DockerService>;
  let fsExistsStub: sinon.SinonStub;
  let fsMkdirStub: sinon.SinonStub;
  let fsEnsureDirStub: sinon.SinonStub;
  let fsCopyStub: sinon.SinonStub;
  let fsRemoveStub: sinon.SinonStub;
  let execaStub: sinon.SinonStub;
  let inquirerStub: sinon.SinonStub;
  
  beforeEach(() => {
    // Create stubs for Docker service and filesystem operations
    dockerServiceStub = sinon.createStubInstance(DockerService);
    dockerServiceStub.checkDockerInstalled.resolves();
    dockerServiceStub.checkDockerRunning.resolves();
    dockerServiceStub.checkDockerComposeInstalled.resolves();
    dockerServiceStub.checkDiskSpace.resolves();
    dockerServiceStub.checkMemory.resolves();
    dockerServiceStub.checkPorts.resolves();
    dockerServiceStub.start.resolves();
    
    // Stub the docker property on Init
    Object.defineProperty(Init.prototype, 'docker', { 
      value: dockerServiceStub,
      writable: true
    });
    
    // Stub fs methods
    fsExistsStub = sinon.stub(fs, 'existsSync');
    fsMkdirStub = sinon.stub(fs, 'mkdirSync');
    fsEnsureDirStub = sinon.stub(fs, 'ensureDir').resolves();
    fsCopyStub = sinon.stub(fs, 'copy').resolves();
    fsRemoveStub = sinon.stub(fs, 'remove').resolves();
    
    // Stub the execa function for git clone
    execaStub = sinon.stub();
    sinon.stub(execa, 'execa').returns(execaStub as any);
    execaStub.resolves({ stderr: '', stdout: '' });
    
    // Stub inquirer for user prompts
    inquirerStub = sinon.stub().resolves({ proceed: true });
    sinon.stub(require('inquirer'), 'prompt').returns(inquirerStub);
    
    // Set default behavior for file existence checks
    fsExistsStub.returns(false);
    
    // Create stubs for additional fs methods used in Init
    sinon.stub(fs, 'writeFile').resolves();
    sinon.stub(fs, 'chmod').resolves();
    
    // Set test environment
    process.env.NODE_ENV = 'test';
  });
  
  afterEach(() => {
    sinon.restore();
  });
  
  describe('from-github flag', () => {
    it('clones a GitHub repository and uses it as source', async () => {
      const repoUrl = 'https://github.com/test/wordpress-repo';
      const args = ['init', 'test-site', '--from-github', repoUrl];
      
      // Setup valid WordPress files check
      fsExistsStub.withArgs(sinon.match(/wp-config\.php$/)).returns(true);
      fsExistsStub.withArgs(sinon.match(/wp-content$/)).returns(true);
      fsExistsStub.withArgs(sinon.match(/wp-includes$/)).returns(true);
      fsExistsStub.withArgs(sinon.match(/wp-admin$/)).returns(true);
      
      // Run the command
      const command = new Init(args, {} as any);
      await command.run();
      
      // Verify git clone was called
      expect(execaStub.calledWith('git', ['clone', repoUrl, sinon.match.string, '--depth', '1'])).to.be.true;
      
      // Verify files were copied
      expect(fsCopyStub.called).to.be.true;
      
      // Verify Docker was started
      expect(dockerServiceStub.start.called).to.be.true;
    });
    
    it('handles invalid WordPress repository with user confirmation', async () => {
      const repoUrl = 'https://github.com/test/not-wordpress-repo';
      const args = ['init', 'test-site', '--from-github', repoUrl];
      
      // Setup invalid WordPress files check
      fsExistsStub.withArgs(sinon.match(/wp-config\.php$/)).returns(false);
      fsExistsStub.withArgs(sinon.match(/wp-content$/)).returns(false);
      
      // Set inquirer to confirm continuing anyway
      inquirerStub.resolves({ proceed: true });
      
      // Run the command
      const command = new Init(args, {} as any);
      await command.run();
      
      // Verify git clone was called
      expect(execaStub.calledWith('git', ['clone', repoUrl, sinon.match.string, '--depth', '1'])).to.be.true;
      
      // Verify files were copied despite invalid WordPress
      expect(fsCopyStub.called).to.be.true;
      
      // Verify Docker was started
      expect(dockerServiceStub.start.called).to.be.true;
    });
    
    it('aborts when repository validation fails and user declines', async () => {
      const repoUrl = 'https://github.com/test/not-wordpress-repo';
      const args = ['init', 'test-site', '--from-github', repoUrl];
      
      // Setup invalid WordPress files check
      fsExistsStub.withArgs(sinon.match(/wp-config\.php$/)).returns(false);
      fsExistsStub.withArgs(sinon.match(/wp-content$/)).returns(false);
      
      // Set inquirer to reject continuing
      inquirerStub.resolves({ proceed: false });
      
      // Run the command and expect error
      const command = new Init(args, {} as any);
      
      try {
        await command.run();
        // Should not reach here
        expect.fail('Command should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Aborted due to invalid WordPress installation');
      }
      
      // Verify temp dir was cleaned up
      expect(fsRemoveStub.called).to.be.true;
      
      // Verify Docker was not started
      expect(dockerServiceStub.start.called).to.be.false;
    });
  });
  
  describe('from-current-dir flag', () => {
    it('uses current directory as WordPress source', async () => {
      const args = ['init', 'test-site', '--from-current-dir'];
      
      // Setup valid WordPress files check
      fsExistsStub.withArgs(sinon.match(/wp-config\.php$/)).returns(true);
      fsExistsStub.withArgs(sinon.match(/wp-content$/)).returns(true);
      fsExistsStub.withArgs(sinon.match(/wp-includes$/)).returns(true);
      fsExistsStub.withArgs(sinon.match(/wp-admin$/)).returns(true);
      
      // Run the command
      const command = new Init(args, {} as any);
      await command.run();
      
      // Verify files were copied
      expect(fsCopyStub.called).to.be.true;
      
      // Verify Docker was started
      expect(dockerServiceStub.start.called).to.be.true;
    });
    
    it('handles invalid current directory with user confirmation', async () => {
      const args = ['init', 'test-site', '--from-current-dir'];
      
      // Setup invalid WordPress files check
      fsExistsStub.withArgs(sinon.match(/wp-config\.php$/)).returns(false);
      fsExistsStub.withArgs(sinon.match(/wp-content$/)).returns(false);
      
      // Set inquirer to confirm continuing anyway
      inquirerStub.resolves({ proceed: true });
      
      // Run the command
      const command = new Init(args, {} as any);
      await command.run();
      
      // Verify files were copied despite invalid WordPress
      expect(fsCopyStub.called).to.be.true;
      
      // Verify Docker was started
      expect(dockerServiceStub.start.called).to.be.true;
    });
    
    it('aborts when current directory validation fails and user declines', async () => {
      const args = ['init', 'test-site', '--from-current-dir'];
      
      // Setup invalid WordPress files check
      fsExistsStub.withArgs(sinon.match(/wp-config\.php$/)).returns(false);
      fsExistsStub.withArgs(sinon.match(/wp-content$/)).returns(false);
      
      // Set inquirer to reject continuing
      inquirerStub.resolves({ proceed: false });
      
      // Run the command and expect error
      const command = new Init(args, {} as any);
      
      try {
        await command.run();
        // Should not reach here
        expect.fail('Command should have thrown an error');
      } catch (error) {
        expect(error.message).to.include('Aborted due to invalid WordPress installation');
      }
      
      // Verify Docker was not started
      expect(dockerServiceStub.start.called).to.be.false;
    });
  });
  
  it('throws error when both flags are specified', async () => {
    const args = ['init', 'test-site', '--from-github', 'https://github.com/test/repo', '--from-current-dir'];
    
    // Run the command and expect error
    const command = new Init(args, {} as any);
    
    try {
      await command.run();
      // Should not reach here
      expect.fail('Command should have thrown an error');
    } catch (error) {
      expect(error.message).to.include('Cannot use both --from-github and --from-current-dir flags');
    }
  });
}); 