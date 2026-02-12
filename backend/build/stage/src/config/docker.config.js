import dotenv from 'dotenv';

dotenv.config();

const dockerConfig = {
  // Disable Docker by default on Windows and when not explicitly enabled
  enabled: process.env.DOCKER_ENABLED === 'true' ? true : false,
  socketPath: process.env.DOCKER_SOCKET_PATH || '/var/run/docker.sock',
  workerImage: process.env.DOCKER_WORKER_IMAGE || 'cpp-visualizer-worker',
  poolSize: parseInt(process.env.DOCKER_POOL_SIZE, 10) || 10,
  maxPoolSize: parseInt(process.env.DOCKER_MAX_POOL_SIZE, 10) || 20,
  busyThreshold: parseFloat(process.env.DOCKER_BUSY_THRESHOLD) || 0.8,
  healthCheckInterval: parseInt(process.env.DOCKER_HEALTH_CHECK_INTERVAL, 10) || 30000,
  container: {
    cpu: parseInt(process.env.DOCKER_CONTAINER_CPU_SHARES, 10) || 1024,
    memory: parseInt(process.env.DOCKER_CONTAINER_MEMORY_MB, 10) || 512,
  }
};

export default dockerConfig;