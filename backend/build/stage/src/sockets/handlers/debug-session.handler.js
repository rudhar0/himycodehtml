import sessionManager from '../../services/session-manager.service.js';
import workerPool from '../../services/worker-pool.service.js';
import loopAnalyzer from '../../services/loop-analyzer.service.js';
import DAPController from '../../services/dap-controller.service.js';
import logger from '../../utils/logger.js';

const debugSessionHandler = (socket) => {
  let session = null;
  let worker = null;
  let dapController = null;
  let currentThreadId = null;

  logger.info(`Socket ${socket.id} connected for debug session`);

  socket.on('debug:start', async ({ code, language, userId, codeHash }) => {
    try {
      // 1. Create a session
      session = await sessionManager.createSession(userId, codeHash, language);
      socket.emit('session:created', session);

      // 2. Get a worker from the pool
      worker = await workerPool.getWorker();
      await sessionManager.updateSession(session.sessionId, { workerId: worker.id });
      
      // 3. Analyze loops
      const loops = loopAnalyzer.analyze(code);
      socket.emit('loops:analyzed', loops);

      // 4. Start a DAP session
      dapController = new DAPController();
      
      // Forward DAP events to the frontend
      dapController.on('event', (event) => {
        socket.emit(`dap:event:${event.event}`, event.body);
      });

      dapController.on('stopped', (event) => {
        currentThreadId = event.threadId;
      });

      await dapController.start();
      const { executable, sourceFile } = await dapController.launch(code, language);
      logger.info(`DAP session started for session ${session.sessionId} in worker ${worker.id}`);

      // Set breakpoints based on loop analysis
      const breakpoints = loops.map(loop => ({ line: loop.line }));
      await dapController.setBreakpoints(sourceFile, breakpoints);

      logger.info('Ready to stream chunks...');

    } catch (error) {
      logger.error('Error starting debug session:', error);
      socket.emit('session:error', { error: error.message });
      if (worker) {
        workerPool.releaseWorker(worker);
      }
    }
  });

  socket.on('debug:next', async () => {
    if (dapController && currentThreadId) {
      await dapController.next(currentThreadId);
    }
  });

  socket.on('debug:stepIn', async () => {
    if (dapController && currentThreadId) {
      await dapController.stepIn(currentThreadId);
    }
  });

  socket.on('debug:stepOut', async () => {
    if (dapController && currentThreadId) {
      await dapController.stepOut(currentThreadId);
    }
  });

  socket.on('debug:continue', async () => {
    if (dapController && currentThreadId) {
      await dapController.continue(currentThreadId);
    }
  });

  socket.on('debug:stackTrace', async ({ threadId }) => {
    if (dapController) {
      const stackFrames = await dapController.getStackTrace(threadId || currentThreadId);
      socket.emit('dap:event:stackTrace', stackFrames);
    }
  });

  socket.on('debug:scopes', async ({ frameId }) => {
    if (dapController) {
      const scopes = await dapController.getScopes(frameId);
      socket.emit('dap:event:scopes', scopes);
    }
  });

  socket.on('debug:variables', async ({ variablesReference }) => {
    if (dapController) {
      const variables = await dapController.getVariables(variablesReference);
      socket.emit('dap:event:variables', variables);
    }
  });

  socket.on('disconnect', async () => {
    logger.info(`Socket ${socket.id} disconnected`);
    if (dapController) {
      await dapController.disconnect();
    }
    if (worker) {
      workerPool.releaseWorker(worker);
    }
    if (session) {
      await sessionManager.updateSession(session.sessionId, { status: 'paused' });
    }
  });
};

export default debugSessionHandler;

