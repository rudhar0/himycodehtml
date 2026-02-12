import Docker from 'dockerode';
import { EventEmitter } from 'events';
import { spawn as spawnProcess } from 'child_process';
import dockerConfig from '../config/docker.config.js';
import logger from '../utils/logger.js';
import sessionManager from './session-manager.service.js';

class WorkerPoolManager {
  constructor() {
    this.pool = [];
    this.queue = [];
    this.isInitialized = false;

    this.dockerEnabled = !!dockerConfig.enabled;
    if (this.dockerEnabled) {
      try {
        this.docker = new Docker({ socketPath: dockerConfig.socketPath });
      } catch (e) {
        logger.warn('Docker initialization failed, falling back to local worker mode.', e);
        this.dockerEnabled = false;
        this.docker = null;
      }
    } else {
      this.docker = null;
    }
  }

  async initialize() {
    if (this.isInitialized) {
      logger.warn('Worker pool already initialized.');
      return;
    }
    logger.info('Initializing worker pool...');
    try {
      // Clean up lingering containers only if docker mode is enabled
      if (this.dockerEnabled) {
        await this.cleanupLingeringWorkers();
      }

      for (let i = 0; i < dockerConfig.poolSize; i++) {
        const worker = await this.createWorker(`worker-${i}`);
        this.pool.push(worker);
      }
      this.isInitialized = true;
      logger.info(`Worker pool initialized with ${this.pool.length} workers.`);

      setInterval(() => this.healthCheck(), dockerConfig.healthCheckInterval);
      setInterval(() => this.scale(), dockerConfig.healthCheckInterval); // Can be a different interval
    } catch (error) {
      logger.error('Failed to initialize worker pool:', error);
      // In a production scenario, you might want to exit the process or have a more robust retry mechanism.
      process.exit(1);
    }
  }

  async createWorker(name) {
    logger.info({ name }, `Creating a new worker (${this.dockerEnabled ? 'docker' : 'local'})...`);
    if (!this.dockerEnabled) {
      // Local placeholder worker (dev fallback)
      const id = `local-${name}-${Date.now()}`;
      logger.info({ name, id }, 'Created local placeholder worker.');
      return {
        id,
        name,
        busy: false,
        local: true,
      };
    }

    try {
      const container = await this.docker.createContainer({
        Image: dockerConfig.workerImage || 'cpp-visualizer-worker',
        name: `cpp-visualizer-worker-${name}-${Date.now()}`,
        Tty: false,
        HostConfig: {
          CpuShares: dockerConfig.container.cpu,
          Memory: dockerConfig.container.memory * 1024 * 1024,
          SecurityOpt: ['no-new-privileges:true'],
          ReadonlyRootfs: true,
        },
        Labels: {
          'com.cpp-visualizer.worker': 'true'
        }
      });

      await container.start();
      const containerInfo = await container.inspect();
      const workerIp = containerInfo.NetworkSettings.IPAddress;

      logger.info({ name, containerId: container.id, ip: workerIp }, 'Worker container created and started.');
      return {
        id: container.id,
        name,
        container,
        ip: workerIp,
        busy: false,
      };
    } catch (error) {
      logger.error({ name }, 'Failed to create worker:', error);
      throw error;
    }
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
      if (this.pool.length < dockerConfig.maxPoolSize) {
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

    // If worker has a Docker container, use docker exec; otherwise spawn a local process.
    if (worker.container) {
      try {
        const cmd = [
          'node',
          'src/docker/worker-service.js',
          codeB64,
          language,
          sessionId
        ];

        const exec = await worker.container.exec({
          Cmd: cmd,
          AttachStdout: true,
          AttachStderr: true,
        });

        const stream = await exec.start({ hijack: true, stdin: false });
        this.docker.modem.demuxStream(stream, process.stdout, process.stderr);

        stream.on('data', (chunk) => {
          const lines = chunk.toString().split('\n').filter(line => line);
          for (const line of lines) {
            try {
              const event = JSON.parse(line);
              eventEmitter.emit('event', event);
            } catch (e) {
              logger.warn({ line }, 'Could not parse worker output as JSON.');
            }
          }
        });

        stream.on('end', () => {
          logger.info({ workerId: worker.id, sessionId }, 'Worker execution finished.');
          this.releaseWorker(worker);
          eventEmitter.emit('end');
        });

        return eventEmitter;
      } catch (error) {
        logger.error({ err: error, workerId: worker.id }, 'Failed to execute command in worker.');
        this.releaseWorker(worker);
        throw error;
      }
    }

    // Local process fallback: spawn a node process to run the worker script
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
        if (!worker || !worker.container) {
          // Local worker placeholders: no container to inspect.
          continue;
        }

        const containerInfo = await worker.container.inspect();
        if (!containerInfo.State.Running) {
          logger.warn(`Worker ${worker.id} is down. Handling failure...`);
          await this.handleFailedWorker(worker);
        }
      } catch (error) {
          logger.error({ workerId: worker && worker.id }, `Error inspecting worker. It might have been removed. Handling failure.`);
          await this.handleFailedWorker(worker);
      }
    }
  }

  async handleFailedWorker(worker) {
    await sessionManager.handleWorkerFailure(worker.id);
    this.pool = this.pool.filter(w => w.id !== worker.id);
    if (worker && worker.container) {
      try {
        await worker.container.remove({ force: true });
        logger.info({ workerId: worker.id }, 'Removed failed worker container.');
      } catch (error) {
        logger.warn({ workerId: worker.id }, 'Failed to remove worker container, it might already be gone.');
      }
    } else {
      logger.info({ workerId: worker.id }, 'Failed local worker (no container). Cleanup complete.');
    }
    if (this.pool.length < dockerConfig.poolSize) {
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

    if (utilization > dockerConfig.busyThreshold && this.pool.length < dockerConfig.maxPoolSize) {
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
    logger.info('Cleaning up any lingering worker containers...');
    if (!this.dockerEnabled || !this.docker) {
      logger.info('Docker disabled; skipping lingering worker cleanup.');
      return;
    }

    try {
      const containers = await this.docker.listContainers({
        all: true,
        filters: { label: ['com.cpp-visualizer.worker=true'] }
      });
      const removalPromises = containers.map(containerInfo => {
        logger.info(`Found lingering worker ${containerInfo.Id}. Removing...`);
        return this.docker.getContainer(containerInfo.Id).remove({ force: true });
      });
      await Promise.all(removalPromises);
      logger.info('Finished cleaning up lingering workers.');
    } catch (error) {
      logger.error('Error during lingering worker cleanup:', error);
    }
  }


  async shutdown() {
    logger.info('Shutting down worker pool...');
    this.isInitialized = false;
    for (const worker of this.pool) {
      try {
        if (worker && worker.container) {
          await worker.container.remove({ force: true });
        }
      } catch (error) {
        logger.warn({ workerId: worker.id }, 'Could not remove worker on shutdown.');
      }
    }
    this.pool = [];
  }
}

const workerPoolManager = new WorkerPoolManager();

export default workerPoolManager;
