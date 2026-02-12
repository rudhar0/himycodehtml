import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import resourceResolver from './resource-resolver.service.js';

class SessionManager {
  constructor() {
    this.sessions = new Map();
  }

  async createSession(sessionId = null) {
    const id = sessionId || uuidv4();
    const folder = resourceResolver.getSessionPath(id);
    if (!existsSync(folder)) {
      await fs.mkdir(folder, { recursive: true });
    }
    const meta = { id, path: folder, createdAt: Date.now() };
    this.sessions.set(id, meta);
    return meta;
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  async destroySession(sessionId) {
    const meta = this.sessions.get(sessionId);
    if (!meta) return false;
    try {
      await fs.rm(meta.path, { recursive: true, force: true });
    } catch (e) {
      // ignore errors
    }
    this.sessions.delete(sessionId);
    return true;
  }

  listActive() {
    return Array.from(this.sessions.values());
  }
}

const sessionManager = new SessionManager();
export default sessionManager;