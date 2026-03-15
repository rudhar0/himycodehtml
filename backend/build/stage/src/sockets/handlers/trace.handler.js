import DebuggerService from '../../services/debugger.service.js';
import logger from '../../utils/logger.js';

let debuggerInstance = null;

export const handleTrace = (socket, io) => {
  socket.on('code:trace:generate', async ({ code, language }) => {
    logger.info(`Received code trace generation request for language: ${language}`);

    if (debuggerInstance) {
      logger.info('Stopping existing debugger instance.');
      debuggerInstance.stop();
    }

    // The debugger service needs io for communication
    debuggerInstance = new DebuggerService(io); 

    try {
      await debuggerInstance.start(code, language);
      socket.emit('code:trace:started', { message: 'Debugger started successfully.' });
    } catch (error) {
      logger.error('Error starting debugger:', error);
      socket.emit('code:trace:error', { message: error.message || 'Failed to start debugger.' });
    }
  });

  socket.on('debug:step', () => {
    if (debuggerInstance) {
      logger.info('Executing debug step.');
      debuggerInstance.step();
    }
  });

  socket.on('debug:continue', () => {
    if (debuggerInstance) {
      logger.info('Executing debug continue.');
      debuggerInstance.continue();
    }
  });

  socket.on('debug:stop', () => {
    if (debuggerInstance) {
      logger.info('Stopping debugger.');
      debuggerInstance.stop();
      debuggerInstance = null;
    }
  });
};