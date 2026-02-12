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
import dockerConfig from './config/docker.config.js';

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
    
    // Only initialize worker pool if Docker is enabled
    if (dockerConfig.enabled) {
      logger.info('Docker mode enabled - initializing worker pool...');
      try {
        const workerPool = (await import('./services/worker-pool.service.js')).default;
        await workerPool.initialize();
        logger.info('✅ Worker pool initialized');
      } catch (error) {
        logger.error('❌ Worker pool initialization failed:', error.message);
        logger.warn('⚠️  Continuing without worker pool - using direct execution mode');
      }
    } else {
      logger.info('✅ Docker mode disabled - using direct execution (development mode)');
    }
    
    httpServer.listen(PORT, () => {
      logger.info(`✅ Server running on port ${PORT}`);
      logger.info(`🔗 Socket.IO ready`);
      logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info(`🐳 Docker: ${dockerConfig.enabled ? 'enabled' : 'disabled'}`);
    });
    
  } catch (error) {
    logger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down gracefully...');
  
  if (dockerConfig.enabled) {
    try {
      const workerPool = (await import('./services/worker-pool.service.js')).default;
      await workerPool.shutdown();
    } catch (error) {
      logger.error('Error during worker pool shutdown:', error);
    }
  }
  
  httpServer.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  logger.info('SIGINT received, shutting down gracefully...');
  
  if (dockerConfig.enabled) {
    try {
      const workerPool = (await import('./services/worker-pool.service.js')).default;
      await workerPool.shutdown();
    } catch (error) {
      logger.error('Error during worker pool shutdown:', error);
    }
  }
  
  httpServer.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});

startServer();

export { io };