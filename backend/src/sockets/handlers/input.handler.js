import inputManagerService from '../../services/input-manager.service.js';
import logger from '../../utils/logger.js';

export const handleInput = (socket, io) => {
  socket.on('execution:provide_input', ({ value }) => {
    logger.info(`Received input from client: ${value}`);
    inputManagerService.provideInput(value);
  });
};