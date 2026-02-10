// backend/tests/session-manager.test.js
import SessionManager from '../src/services/session-manager.service';
import { v4 as uuidv4 } from 'uuid';

// Mock ioredis
const redisStore = new Map();
const mockRedis = {
  get: jest.fn((key) => Promise.resolve(redisStore.get(key) || null)),
  set: jest.fn((key, value, ...args) => {
      redisStore.set(key, value);
      return Promise.resolve('OK');
  }),
  del: jest.fn((key) => {
      redisStore.delete(key);
      return Promise.resolve(1);
  }),
};

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => mockRedis);
});

describe('SessionManagerService', () => {
    
  beforeEach(() => {
    // Clear the mock store and mock function calls before each test
    redisStore.clear();
    jest.clearAllMocks();
    // We need to re-import the service to get the mocked version
    // This is a common pattern when dealing with singleton modules in Jest.
    jest.resetModules();
  });
  
  // We need to import the service inside a test or beforeEach to get the mocked version
  let sessionManager;
  beforeEach(() => {
      sessionManager = require('../src/services/session-manager.service').default;
  });

  it('should create a new session', async () => {
    const userId = uuidv4();
    const codeHash = 'some-hash';
    const language = 'cpp';

    const session = await sessionManager.createSession(userId, codeHash, language);

    expect(session).toHaveProperty('sessionId');
    expect(session.userId).toBe(userId);
    expect(session.status).toBe('pending');
    
    expect(mockRedis.set).toHaveBeenCalledTimes(1);
    const setArgs = mockRedis.set.mock.calls[0];
    expect(setArgs[0]).toBe(`session:${session.sessionId}`);
  });

  it('should get an existing session', async () => {
    const userId = uuidv4();
    const session = await sessionManager.createSession(userId, 'hash', 'c');
    
    const retrievedSession = await sessionManager.getSession(session.sessionId);
    
    expect(retrievedSession).toEqual(session);
    expect(mockRedis.get).toHaveBeenCalledWith(`session:${session.sessionId}`);
  });
  
  it('should update a session', async () => {
      const session = await sessionManager.createSession('user1', 'hash', 'c');
      const workerId = uuidv4();

      const updates = { status: 'active', workerId };
      await sessionManager.updateSession(session.sessionId, updates);
      
      const updatedSession = await sessionManager.getSession(session.sessionId);

      expect(updatedSession.status).toBe('active');
      expect(updatedSession.workerId).toBe(workerId);
      expect(mockRedis.set).toHaveBeenCalledTimes(3); // create, update, update index
      expect(mockRedis.set).toHaveBeenCalledWith(`worker-session-index:${workerId}`, session.sessionId);
  });
  
  it('should handle worker failure', async () => {
    const workerId = uuidv4();
    const session = await sessionManager.createSession('user1', 'hash', 'c');
    await sessionManager.updateSession(session.sessionId, { workerId, status: 'active' });
    
    // Check that the index is set
    expect(mockRedis.set).toHaveBeenCalledWith(`worker-session-index:${workerId}`, session.sessionId);
    
    await sessionManager.handleWorkerFailure(workerId);
    
    const recoveredSession = await sessionManager.getSession(session.sessionId);
    expect(recoveredSession.status).toBe('recovery');
    expect(recoveredSession.workerId).toBeNull();
    
    // The worker-session index should be deleted
    expect(mockRedis.del).toHaveBeenCalledWith(`worker-session-index:${workerId}`);
  });
  
  it('should delete a session', async () => {
    const session = await sessionManager.createSession('user1', 'hash', 'c');
    await sessionManager.deleteSession(session.sessionId);
    
    const retrieved = await sessionManager.getSession(session.sessionId);
    expect(retrieved).toBeNull();
    expect(mockRedis.del).toHaveBeenCalledWith(`session:${session.sessionId}`);
  });
});