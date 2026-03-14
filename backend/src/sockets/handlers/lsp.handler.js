import lspService from '../../services/lsp.service.js';
import logger from '../../utils/logger.js';

export const handleLSP = (socket, io) => {
  const sessionId = socket.id;

  socket.on('lsp:message', async (data) => {
    try {
      // Ensure the session is initialized and we have a listener for responses
      await lspService.onMessage(sessionId, (message) => {
        socket.emit('lsp:message', message);
      });

      // Forward message to clangd
      await lspService.sendMessage(sessionId, data);
    } catch (error) {
      logger.error(`Error handling LSP message for session ${sessionId}:`, error);
    }
  });

  socket.on('disconnect', async () => {
    logger.info(`Socket ${sessionId} disconnected, cleaning up LSP session`);
    await lspService.cleanupSession(sessionId);
  });
};
