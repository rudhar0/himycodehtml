import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import logger from './utils/logger.js';
import corsConfig from './config/cors.config.js';
import socketConfig from './config/socket.config.js';
import routes from './routes/index.js';
import setupSocketHandlers from './sockets/index.js';
import { errorHandler, notFoundHandler } from './middleware/error.middleware.js';
import workerPool from './services/worker-pool.service.js';
import runtimeCleaner from './services/runtime-cleaner.service.js';
import { toolchainService } from './services/toolchain.service.js';
import sessionManager from './services/session-manager.service.js';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, socketConfig);

// Middleware
app.use(cors(corsConfig));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Mount API routes
app.use('/api', routes);

// Setup Socket.IO handlers
setupSocketHandlers(io);

// Error handlers
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    logger.info('🚀 Starting C/C++ Visualizer Backend...');
    
    // Initialize local worker pool (Docker removed)
    try {
      await workerPool.initialize();
      logger.info('✅ Worker pool initialized');
    } catch (error) {
      logger.error('❌ Worker pool initialization failed:', error.message);
      logger.warn('⚠️  Continuing without worker pool - using direct execution mode');
    }

    // Start runtime cleaner background worker
    runtimeCleaner.start();

    // Validate bundled toolchain
    try {
      const status = await toolchainService.verify();
      logger.info('Toolchain verification result:', status);
    } catch (e) {
      logger.error('Toolchain verification failed:', e.message);
    }
    
    httpServer.listen(PORT, () => {
      logger.info(`✅ Server running on port ${PORT}`);
      logger.info(`🔗 Socket.IO ready`);
      logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🐳 Docker: removed`);
    });
    
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  
  try {
    await workerPool.shutdown();
    // destroy any active sessions
    for (const s of sessionManager.listActive()) {
      await sessionManager.destroySession(s.id);
    }
  } catch (error) {
    logger.error('Error during shutdown cleanup:', error);
  }
  
  httpServer.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully...');
  
  try {
    await workerPool.shutdown();
    for (const s of sessionManager.listActive()) {
      await sessionManager.destroySession(s.id);
    }
  } catch (error) {
    logger.error('Error during shutdown cleanup:', error);
  }
  
  httpServer.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

startServer();

export { io };