import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'node:path';
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
import { getBackendRoot, getRuntimeDir } from './utils/project-paths.js';
import { validateStartupEnvironment } from './utils/startup-validator.js';
import {
  listenWithAutoPort,
  resolvePreferredPortRange,
} from './utils/port-manager.js';
import { registerRuntimeEnv } from './utils/runtime-manager.js';
import fssync from 'node:fs';

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

// Serve static frontend files (fallback for desktop app)
const resourcesDir = path.join(getBackendRoot(import.meta.url), 'resources');
if (fssync.existsSync(resourcesDir)) {
  logger.info(`Serving static resources from: ${resourcesDir}`);
  app.use(express.static(resourcesDir));

  // SPA Fallback: serve index.html for any non-API routes
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/socket.io/')) {
      return next();
    }
    res.sendFile(path.join(resourcesDir, 'index.html'));
  });
}

// Setup Socket.IO handlers
setupSocketHandlers(io);

// Error handlers
app.use(notFoundHandler);
app.use(errorHandler);

const backendRoot = getBackendRoot(import.meta.url);
const runtimeDir = getRuntimeDir(backendRoot);
const preferredRange = resolvePreferredPortRange();
let portSelection = null;

async function startServer() {
  try {
    logger.info('Starting NeutralaJS backend...');

    if (globalThis.__NEUTRALA_BACKEND_STARTED) {
      throw new Error(
        `Port already bound by same PID (${process.pid}). Server start attempted twice in one process.`,
      );
    }
    globalThis.__NEUTRALA_BACKEND_STARTED = true;

    const { warnings } = await validateStartupEnvironment({
      backendRoot,
      runtimeDir,
    });
    for (const warning of warnings) logger.warn(warning);

    // Neutralino runtime pack is only required for desktop builds. Avoid noisy downloads in dev by default.
    const runtimeRequired =
      process.env.NEUTRALA_RUNTIME_REQUIRED === 'true' || !!process.pkg;
    const runtimeAuto = process.env.NEUTRALA_RUNTIME_AUTO === 'true';
    if (runtimeRequired || runtimeAuto) {
      try {
        const resourcesDir = path.join(backendRoot, 'resources');
        const runtimeInfo = await registerRuntimeEnv({ resourcesDir });
        logger.info(
          `Neutrala runtime ready: ${runtimeInfo.binaryPath} (v${runtimeInfo.version})`,
        );
      } catch (err) {
        logger.error(`Neutrala runtime setup failed: ${err?.message || err}`);
        if (runtimeRequired) {
          throw err;
        }
        logger.warn(
          'Continuing without Neutrala runtime (set NEUTRALA_RUNTIME_REQUIRED=true to enforce)',
        );
      }
    }

    // Bind/lock the HTTP + WS port early to avoid restart races.
    try {
      portSelection = await listenWithAutoPort(httpServer, {
        host: process.env.HOST || '0.0.0.0',
        runtimeDir,
        preferredRange,
      });
    } catch (err) {
      if (err?.code === 'ELOCKED' && err.lock) {
        logger.error(
          `Backend already running on port ${err.lock.port} (pid=${err.lock.pid}).`,
        );
      }
      throw err;
    }
    const PORT = portSelection.port;
    logger.info(
      `Selected port: ${PORT} (saved to ${portSelection.portFilePath})`,
    );

    // Initialize local worker pool (Docker removed)
    try {
      await workerPool.initialize();
      logger.info('Worker pool initialized');
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

    (() => {
      logger.info(`Server running on port ${PORT}`);
      logger.info('Socket.IO ready');
      logger.info(`📊 Environment: ${process.env.NODE_ENV || 'development'}`);
      logger.info('Docker: removed');
    })();

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

  httpServer.close(async () => {
    await portSelection?.release?.();
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

  httpServer.close(async () => {
    await portSelection?.release?.();
    logger.info('Server closed');
    process.exit(0);
  });
});

// Nodemon restart signal on many platforms.
process.on('SIGUSR2', async () => {
  logger.info('SIGUSR2 received, shutting down gracefully...');

  try {
    await workerPool.shutdown();
    for (const s of sessionManager.listActive()) {
      await sessionManager.destroySession(s.id);
    }
  } catch (error) {
    logger.error('Error during shutdown cleanup:', error);
  }

  httpServer.close(async () => {
    await portSelection?.release?.();
    logger.info('Server closed');
    process.exit(0);
  });
});

startServer();

export { io };
