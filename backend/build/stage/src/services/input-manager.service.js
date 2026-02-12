// backend/src/services/input-manager.service.js

import logger from '../utils/logger.js';

class InputManagerService {
  constructor() {
    this.io = null;
    this.inputQueue = [];
    this.isWaitingForInput = false;
    this.currentRequest = null;
    this.inputLines = new Map();
  }

  /**
   * Statically scans code for input calls (scanf, cin).
   * This is a simplified implementation. A real implementation would need a proper parser.
   */
  scanCode(code) {
    this.inputLines.clear();
    const lines = code.split('\n');
    const scanfRegex = /scanf\s*\(\s*".*?"\s*,\s*&(\w+)/;
    const cinRegex = /cin\s*>>\s*(\w+)/;

    lines.forEach((line, index) => {
      const lineNumber = index + 1;
      let match;

      if ((match = line.match(scanfRegex))) {
        this.inputLines.set(lineNumber, {
            line: lineNumber,
            prompt: `Waiting for scanf on line ${lineNumber}`,
            type: 'scanf',
            varName: match[1]
        });
      } else if ((match = line.match(cinRegex))) {
        this.inputLines.set(lineNumber, {
            line: lineNumber,
            prompt: `Waiting for cin on line ${lineNumber}`,
            type: 'cin',
            varName: match[1]
        });
      }
    });
    logger.info(`Scanned code, found ${this.inputLines.size} input locations.`);
  }

  setSocket(io) {
    this.io = io;
  }

  isInputLine(lineNumber) {
    return this.inputLines.has(lineNumber);
  }

  getInputInfo(lineNumber) {
    return this.inputLines.get(lineNumber);
  }

  /**
   * Called by the debugger service when input is needed.
   * Returns a promise that resolves with the user's input.
   */
  requestInput({ line, prompt, type, varName }) {
    return new Promise((resolve) => {
      const request = { line, prompt, type, varName, resolve };
      this.inputQueue.push(request);
      this.processQueue();
    });
  }

  /**
   * Processes the next input request in the queue.
   */
  processQueue() {
    if (this.isWaitingForInput || this.inputQueue.length === 0) {
      return;
    }

    this.isWaitingForInput = true;
    const request = this.inputQueue.shift();
    this.currentRequest = request;

    logger.info(`Requesting input for line ${request.line}`);
    if (!this.io) {
      logger.error('Socket.io instance not set in InputManager');
      return;
    }
    this.io.emit('execution:input_required', {
      line: request.line,
      prompt: request.prompt,
      type: request.type,
      varName: request.varName,
    });
  }

  /**
   * Called when the client provides input via a socket event.
   */
  provideInput(value) {
    if (!this.isWaitingForInput || !this.currentRequest) {
      logger.warn('Received unsolicited input, ignoring.');
      return;
    }

    // TODO: Add type validation based on this.currentRequest.type

    // Resolve the promise to send the input back to the debugger service
    this.currentRequest.resolve(value);

    // Reset state for the next request
    this.isWaitingForInput = false;
    this.currentRequest = null;
    
    // Process the next item in the queue, if any
    this.processQueue();
  }
}

const inputManagerService = new InputManagerService();
export default inputManagerService;