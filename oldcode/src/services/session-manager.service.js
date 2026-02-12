import { v4 as uuidv4 } from 'uuid';
import securityConfig from '../config/security.config.js';
import logger from '../utils/logger.js';

class SessionManager {
  constructor() {
    this.redis = null;
    this.inMemoryStore = new Map(); // Fallback for development
    this.prefix = 'session:';
    this.workerSessionIndex = 'worker-session-index:';
    this.useRedis = false;

    // Try to initialize Redis, fall back to in-memory if it fails
    this.initializeRedis();

    // Periodically run cleanup
    setInterval(this.cleanupExpiredSessions.bind(this), securityConfig.session.ttl * 1000);
    logger.info('SessionManager initialized and cleanup job scheduled.');
  }

  async initializeRedis() {
    try {
      const { createRedis } = await import('../config/redis.config.js');
      this.redis = createRedis();
      
      // Test connection
      await this.redis.ping();
      this.useRedis = true;
      logger.info('✅ Redis connected - using Redis for session storage');
    } catch (error) {
      logger.warn('⚠️  Redis not available - using in-memory session storage (development mode)');
      this.useRedis = false;
    }
  }

  async createSession(userId, codeHash, language) {
    const sessionId = uuidv4();
    const session = {
      sessionId,
      userId,
      workerId: null,
      status: 'pending',
      createdAt: Date.now(),
      lastActivity: Date.now(),
      codeHash,
      language,
    };

    if (this.useRedis) {
      const sessionKey = `${this.prefix}${sessionId}`;
      await this.redis.set(sessionKey, JSON.stringify(session), 'EX', securityConfig.session.ttl);
    } else {
      this.inMemoryStore.set(sessionId, session);
    }
    
    logger.info({ sessionId, userId }, 'Session created.');
    return session;
  }

  async getSession(sessionId) {
    if (this.useRedis) {
      const sessionData = await this.redis.get(`${this.prefix}${sessionId}`);
      if (!sessionData) {
        logger.warn({ sessionId }, 'Session not found.');
        return null;
      }
      return JSON.parse(sessionData);
    } else {
      const session = this.inMemoryStore.get(sessionId);
      if (!session) {
        logger.warn({ sessionId }, 'Session not found.');
        return null;
      }
      return session;
    }
  }

  async updateSession(sessionId, updates) {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    const previousWorkerId = session.workerId;
    const updatedSession = { ...session, ...updates, lastActivity: Date.now() };

    if (this.useRedis) {
      await this.redis.set(`${this.prefix}${sessionId}`, JSON.stringify(updatedSession), 'EX', securityConfig.session.ttl);
      
      // Update worker-session index if workerId changes
      if (updates.workerId && updates.workerId !== previousWorkerId) {
        if (previousWorkerId) {
          await this.redis.del(`${this.workerSessionIndex}${previousWorkerId}`);
        }
        await this.redis.set(`${this.workerSessionIndex}${updates.workerId}`, sessionId);
      }
    } else {
      this.inMemoryStore.set(sessionId, updatedSession);
    }

    logger.info({ sessionId, updates }, 'Session updated.');
    return updatedSession;
  }

  async deleteSession(sessionId) {
    if (this.useRedis) {
      const session = await this.getSession(sessionId);
      if (session && session.workerId) {
        await this.redis.del(`${this.workerSessionIndex}${session.workerId}`);
      }
      await this.redis.del(`${this.prefix}${sessionId}`);
    } else {
      this.inMemoryStore.delete(sessionId);
    }
    
    logger.info({ sessionId }, 'Session deleted.');
  }

  async findSessionByWorkerId(workerId) {
    if (this.useRedis) {
      const sessionId = await this.redis.get(`${this.workerSessionIndex}${workerId}`);
      if (!sessionId) {
        logger.warn({ workerId }, 'No session found for this worker.');
        return null;
      }
      return this.getSession(sessionId);
    } else {
      // In-memory: iterate to find
      for (const [sessionId, session] of this.inMemoryStore.entries()) {
        if (session.workerId === workerId) {
          return session;
        }
      }
      return null;
    }
  }

  async handleWorkerFailure(workerId) {
    logger.warn({ workerId }, 'Handling worker failure.');
    const session = await this.findSessionByWorkerId(workerId);
    if (session) {
      logger.info({ sessionId: session.sessionId, workerId }, 'Found session associated with failed worker. Marking for recovery.');
      await this.updateSession(session.sessionId, { workerId: null, status: 'recovery' });
    } else {
      logger.warn({ workerId }, 'No active session found for the failed worker.');
    }
    
    if (this.useRedis) {
      await this.redis.del(`${this.workerSessionIndex}${workerId}`);
    }
  }

  async cleanupExpiredSessions() {
    if (!this.useRedis) {
      // In-memory cleanup
      const now = Date.now();
      for (const [sessionId, session] of this.inMemoryStore.entries()) {
        const age = now - session.lastActivity;
        if (age > securityConfig.session.ttl * 1000) {
          this.inMemoryStore.delete(sessionId);
          logger.info({ sessionId }, 'Cleaned up expired session (in-memory)');
        }
      }
    }
    // Redis handles TTL automatically
  }
}

export default new SessionManager();