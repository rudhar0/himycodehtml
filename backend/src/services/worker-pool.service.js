import { EventEmitter } from 'events';
import { spawn as spawnProcess } from 'child_process';
import logger from '../utils/logger.js';
import sessionManager from './session-manager.service.js';

class WorkerPoolManager {
  constructor() {
    this.pool = [];
    this.queue = [];
    this.isInitialized = false;

    // Docker removed: operate in-local worker mode only
    this.dockerEnabled = false;
    this.docker = null;
    this.maxPoolSize = Math.max(4, parseInt(process.env.WORKER_MAX_POOL_SIZE || '20', 10));
    this.busyThreshold = parseFloat(process.env.WORKER_BUSY_THRESHOLD || '0.8');
  }

  async initialize() {
    if (this.isInitialized) {
      logger.warn('Worker pool already initialized.');
      return;
    }
    logger.info('Initializing worker pool...');
    try {
      // Create local workers
      const poolSize =  Math.max(2, parseInt(process.env.WORKER_POOL_SIZE || '4', 10));
      for (let i = 0; i < poolSize; i++) {
        const worker = await this.createWorker(`worker-${i}`);
        this.pool.push(worker);
      }
      this.isInitialized = true;
      logger.info(`Worker pool initialized with ${this.pool.length} workers.`);
      setInterval(() => this.healthCheck(), parseInt(process.env.WORKER_HEALTH_INTERVAL || '30000', 10));
      setInterval(() => this.scale(), parseInt(process.env.WORKER_HEALTH_INTERVAL || '30000', 10)); // Can be a different interval
    } catch (error) {
      logger.error('Failed to initialize worker pool:', error);
      // In a production scenario, you might want to exit the process or have a more robust retry mechanism.
      process.exit(1);
    }
  }

  async createWorker(name) {
    logger.info({ name }, 'Creating a new local worker...');
    const id = `local-${name}-${Date.now()}`;
    logger.info({ name, id }, 'Created local worker.');
    return {
      id,
      name,
      busy: false,
      local: true,
    };
  }

  getWorker() {
    return new Promise((resolve, reject) => {
      if (!this.isInitialized) {
        return reject(new Error('Worker pool is not initialized.'));
      }
      const freeWorker = this.pool.find(w => !w.busy);
      if (freeWorker) {
        freeWorker.busy = true;
        logger.info({ workerId: freeWorker.id }, 'Allocated worker.');
        return resolve(freeWorker);
      }

      // If no free worker and we can scale up, create a new one
      if (this.pool.length < this.maxPoolSize) {
        logger.info('No free workers, scaling up...');
        this.createWorker(`worker-${this.pool.length}`)
          .then(newWorker => {
            newWorker.busy = true;
            this.pool.push(newWorker);
            logger.info({ workerId: newWorker.id }, 'Allocated new worker.');
            resolve(newWorker);
          })
          .catch(err => {
            logger.error('Failed to create new worker on-demand:', err);
            this.queue.push(resolve);
          });
      } else {
        logger.info('All workers are busy and max pool size reached. Queueing request.');
        this.queue.push(resolve);
      }
    });
  }

  releaseWorker(worker) {
    if (!worker) return;
    worker.busy = false;
    logger.info({ workerId: worker.id }, 'Released worker.');

    if (this.queue.length > 0) {
      logger.info('Processing queued request.');
      const nextResolver = this.queue.shift();
      if (nextResolver) {
        const freeWorker = this.pool.find(w => !w.busy);
        if(freeWorker) {
          freeWorker.busy = true;
          logger.info({ workerId: freeWorker.id }, 'Allocating worker to queued request.');
          nextResolver(freeWorker);
        } else {
            this.queue.unshift(nextResolver);
        }
      }
    }
  }
  
  async executeInWorker(worker, code, language, sessionId) {
    const eventEmitter = new EventEmitter();
    const codeB64 = Buffer.from(code).toString('base64');

    logger.info({ workerId: worker.id, sessionId }, 'Executing command in worker.');

    // Local process: spawn a node process to run the worker script
    try {
      const proc = spawnProcess('node', ['src/docker/worker-service.js', codeB64, language, sessionId], { stdio: ['ignore', 'pipe', 'pipe'] });

      proc.stdout.on('data', (chunk) => {
        const lines = chunk.toString().split('\n').filter(l => l);
        for (const line of lines) {
          try {
            const event = JSON.parse(line);
            eventEmitter.emit('event', event);
          } catch (e) {
            logger.debug('Worker stdout line (non-json):', line);
          }
        }
      });

      proc.stderr.on('data', (chunk) => {
        logger.warn('Worker stderr:', chunk.toString());
      });

      proc.on('close', (code) => {
        logger.info({ workerId: worker.id, sessionId, code }, 'Local worker process finished.');
        this.releaseWorker(worker);
        eventEmitter.emit('end');
      });

      return eventEmitter;
    } catch (error) {
      logger.error({ err: error, workerId: worker.id }, 'Failed to spawn local worker process.');
      this.releaseWorker(worker);
      throw error;
    }
  }

  async healthCheck() {
    logger.debug('Running worker health checks...');
    for (const worker of this.pool) {
      try {
        // Local workers: nothing to inspect; if marked busy longer than threshold, recycle
        // Future: add liveness probe
        continue;
      } catch (error) {
          logger.error({ workerId: worker && worker.id }, `Error inspecting worker. It might have been removed. Handling failure.`);
          await this.handleFailedWorker(worker);
      }
    }
  }

  async handleFailedWorker(worker) {
    this.pool = this.pool.filter(w => w.id !== worker.id);
    logger.info({ workerId: worker.id }, 'Handled failed local worker.');
    // Ensure minimum pool size
    const minPool = Math.max(2, parseInt(process.env.WORKER_POOL_SIZE || '4', 10));
    if (this.pool.length < minPool) {
        logger.info('Pool is below minimum size. Provisioning new worker.');
        try {
            const newWorker = await this.createWorker(`worker-replacement-${this.pool.length}`);
            this.pool.push(newWorker);
        } catch(e) {
            logger.error("Could not provision replacement worker", e);
        }
    }
  }

  async scale() {
    const busyWorkers = this.pool.filter(w => w.busy).length;
    const utilization = this.pool.length > 0 ? busyWorkers / this.pool.length : 0;
    logger.debug({ utilization, busyWorkers, poolSize: this.pool.length }, 'Checking pool utilization.');

    if (utilization > this.busyThreshold && this.pool.length < this.maxPoolSize) {
      logger.info('High demand detected. Scaling up worker pool...');
      try {
        const newWorker = await this.createWorker(`worker-${this.pool.length}`);
        this.pool.push(newWorker);
      } catch (e) {
        logger.error("Could not scale up worker pool", e);
      }
    }
  }
  
  async cleanupLingeringWorkers() {
    // Docker removed; nothing to cleanup.
    return;
  }


  async shutdown() {
    logger.info('Shutting down worker pool...');
    this.isInitialized = false;
    for (const worker of this.pool) {
      try {
        // nothing to remove for local workers
      } catch (error) {
        logger.warn({ workerId: worker.id }, 'Could not remove worker on shutdown.');
      }
    }
    this.pool = [];
  }
}

const workerPoolManager = new WorkerPoolManager();

export default workerPoolManager;
