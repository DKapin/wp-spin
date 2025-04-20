import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinon from 'sinon';
import sinonChai from 'sinon-chai';

// Add chai plugins
chai.use(chaiAsPromised);
chai.use(sinonChai);

// Export for convenience in tests


// Set up common test environment variables
process.env.NODE_ENV = 'test';

// Add assertions to make tests more readable
sinon.assert.expose(chai.assert, { prefix: '' }); 
export {expect} from 'chai';
export {createSandbox} from 'sinon';
export {default as sinon} from 'sinon';