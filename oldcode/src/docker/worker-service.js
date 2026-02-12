// backend/src/docker/worker-service.js
// This service runs inside the worker container.
// It will be responsible for running a single debug session.

import DebuggerService from '../services/debugger.service.js';
import logger from '../utils/logger.js';

// This is a simplified entry point for the worker.
// In a real implementation, this would listen for jobs from a queue (e.g., BullMQ)
// or on a dedicated TCP socket.

async function runDebugSession(code, language, sessionId) {
  logger.info({ sessionId }, 'Worker received job.');
  const debuggerService = new DebuggerService(sessionId);

  // Set up listeners to forward events
  debuggerService.on('chunk:ready', (payload) => {
    // In a real implementation, this would send the result back to the gateway
    // via a message queue or another transport.
    process.stdout.write(JSON.stringify({ type: 'chunk:ready', payload }) + '\n');
  });

  debuggerService.on('chunk:complete', (summary) => {
    process.stdout.write(JSON.stringify({ type: 'chunk:complete', payload: summary }) + '\n');
    logger.info({ sessionId }, 'Debugging complete.');
    // The worker can now exit or wait for a new job.
    process.exit(0);
  });
  
  debuggerService.on('error', (error) => {
      process.stderr.write(JSON.stringify({ type: 'error', payload: error.message }) + '\n');
      process.exit(1);
  });
  
  // The 'start' method now kicks off the whole process.
  await debuggerService.start(code, language);

  // The rest of the execution is event-driven based on the DAP events.
}

// Read code and language from command line arguments for simplicity
const [,, codeB64, language, sessionId] = process.argv;

if (codeB64 && language && sessionId) {
    const code = Buffer.from(codeB64, 'base64').toString('utf-8');
    runDebugSession(code, language, sessionId).catch(err => {
        logger.error({ err }, 'Unhandled error in debug session.');
        process.exit(1);
    });
} else {
    logger.error('Worker started without required arguments.');
    process.exit(1);
}