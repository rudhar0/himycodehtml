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
    logger.info(`Backend Root: ${backendRoot}`);
    logger.info(`Runtime Dir: ${runtimeDir}`);
    logger.info(`Process pkg: ${!!process.pkg}`);

    if (globalThis.__NEUTRALA_BACKEND_STARTED) {
      throw new Error(
        `Port already bound by same PID (${process.pid}). Server start attempted twice in one process.`,
      );
    }
    globalThis.__NEUTRALA_BACKEND_STARTED = true;

    // Ensure runtime directory exists before validation
    if (!fssync.existsSync(runtimeDir)) {
      fssync.mkdirSync(runtimeDir, { recursive: true });
      logger.info(`Created runtime directory: ${runtimeDir}`);
    }

    logger.info('Validating startup environment...');
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
      logger.info('Registering Neutralino runtime...');
      try {
        const resourcesDir = path.join(backendRoot, 'resources');
        const runtimeInfo = await registerRuntimeEnv({ resourcesDir });
        logger.info(
          `Neutrala runtime ready: ${runtimeInfo.binaryPath} (v${runtimeInfo.version})`,
        );
      } catch (err) {
        // Fix: Make backend startup resilient to runtime registration failures.
        // Even if the desktop runtime isn't found/valid, the backend should still serve the API.
        logger.warn(`Neutrala runtime registration skipped/failed: ${err?.message || err}`);
        if (process.pkg) {
          logger.info('Running in packaged mode; continuing with internal defaults.');
        }
      }
    }

    // Bind/lock the HTTP + WS port early to avoid restart races.
    logger.info('Binding port...');
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
    logger.info('Initializing worker pool...');
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

// Auto-shutdown Watchdog
// Prevents orphan processes when the frontend is closed abruptly.
let idleTimer = null;
const IDLE_TIMEOUT = 60000; // 60 seconds (increased for dev mode stability)

function startWatchdog() {
  if (idleTimer) return;

  idleTimer = setInterval(() => {
    const activeClients = io.engine.clientsCount;
    if (activeClients === 0) {
      logger.info(`[Watchdog] No active connections for ${IDLE_TIMEOUT}ms. Shutting down...`);
      process.emit('SIGTERM');
    }
  }, IDLE_TIMEOUT);
}

function stopWatchdog() {
  if (idleTimer) {
    clearInterval(idleTimer);
    idleTimer = null;
  }
}

io.on('connection', (socket) => {
  stopWatchdog();
  socket.on('disconnect', () => {
    if (io.engine.clientsCount === 0) {
      startWatchdog();
    }
  });
});

// Start initial watchdog in case no one ever connects
startWatchdog();

export { io };
