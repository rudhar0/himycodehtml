import dotenv from 'dotenv';
import Redis from 'ioredis';
import logger from '../utils/logger.js';

dotenv.config();

const redisConfig = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || null,
};

function createRedis(opts = {}) {
  const cfg = { ...redisConfig, ...opts };
  // Create the client in lazy mode so we can attach handlers before it attempts to connect.
  // Disable automatic retrying to avoid noisy repeated connection attempts when Redis is down.
  const client = new Redis({
    ...cfg,
    lazyConnect: true,
    // stop retrying by returning null from retryStrategy
    retryStrategy: () => null,
    // do not queue commands while offline
    enableOfflineQueue: false,
    // limit retries for individual commands
    maxRetriesPerRequest: 1,
  });

  client.on('error', (err) => {
    logger.warn({ err }, 'Redis client error (handled)');
  });

  client.on('connect', () => {
    logger.info('Redis client connected');
  });

  client.on('end', () => {
    logger.warn('Redis client connection closed');
  });

  // Start connection after handlers are attached. Catch connect promise rejection to avoid unhandled rejections.
  client.connect().catch((err) => {
    logger.warn({ err }, 'Redis initial connect failed (caught)');
  });

  return client;
}

export { redisConfig as default, createRedis };
