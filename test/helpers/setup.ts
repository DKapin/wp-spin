import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import sinonChai from 'sinon-chai';

// Add chai plugins
chai.use(chaiAsPromised);
chai.use(sinonChai);

// Set up common test environment variables
process.env.NODE_ENV = 'test';

// Add assertions to make tests more readable
// Note: No longer using sinon.assert.expose since we're using named imports
// If this causes issues in tests, we can import assert separately

export { expect } from 'chai';
export { createSandbox, match, restore, SinonStub, stub } from 'sinon';