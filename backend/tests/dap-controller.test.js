// backend/tests/dap-controller.test.js
import DAPController from '../src/services/dap-controller.service.js';
import { EventEmitter } from 'events';

// Mock the child_process module
jest.mock('child_process', () => ({
  spawn: jest.fn(() => {
    const mockProcess = new EventEmitter();
    mockProcess.stdin = { write: jest.fn() };
    mockProcess.stdout = new EventEmitter();
    mockProcess.stderr = new EventEmitter();
    // Emit a 'close' event to avoid hanging tests
    setTimeout(() => mockProcess.emit('close', 0), 100); 
    return mockProcess;
  }),
}));

// Mock fs/promises and fs
jest.mock('fs/promises', () => ({
  writeFile: jest.fn(() => Promise.resolve()),
  mkdir: jest.fn(() => Promise.resolve()),
}));

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
}));

describe('DAPController', () => {
  let dapController;

  beforeEach(() => {
    dapController = new DAPController();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should start and initialize the DAP adapter', async () => {
    const startPromise = dapController.start();
    
    // Simulate the adapter sending an initialize response
    const initResponse = {
      request_seq: 1,
      seq: 1,
      success: true,
      type: 'response',
      command: 'initialize'
    };
    dapController.handleMessage(initResponse);

    await expect(startPromise).resolves.toBeDefined();
    expect(dapController.adapterProcess).toBeDefined();
  });

  it('should launch a program and send configurationDone', async () => {
    // Start the controller first
    const startPromise = dapController.start();
    const initResponse = {
      request_seq: 1,
      seq: 1,
      success: true,
      type: 'response',
      command: 'initialize'
    };
    dapController.handleMessage(initResponse);
    await startPromise;

    // Now, test the launch
    const launchPromise = dapController.launch('int main() { return 0; }');
    
    // Simulate the adapter sending a launch response
    const launchResponse = {
      request_seq: 2,
      seq: 2,
      success: true,
      type: 'response',
      command: 'launch'
    };
    dapController.handleMessage(launchResponse);

    // After launch, 'configurationDone' is sent. Simulate its response.
    const configDoneResponse = {
      request_seq: 3,
      seq: 3,
      success: true,
      type: 'response',
      command: 'configurationDone'
    };
    dapController.handleMessage(configDoneResponse);

    await expect(launchPromise).resolves.toBeDefined();
  });
});
