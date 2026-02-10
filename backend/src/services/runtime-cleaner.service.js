import fs from 'fs/promises';
import path from 'path';
import resourceResolver from './resource-resolver.service.js';
import sessionManager from './session-manager.service.js';

class RuntimeCleaner {
  constructor() {
    this.tempRoot = resourceResolver.getTempRoot();
    this.interval = null;
    this.maxAgeMs = 1000 * 60 * 30; // 30 minutes default
  }

  start() {
    if (this.interval) return;
    this.interval = setInterval(() => this.cleanup(), 1000 * 60 * 5);
  }

  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async cleanup() {
    try {
      const items = await fs.readdir(this.tempRoot, { withFileTypes: true });
      const now = Date.now();
      for (const it of items) {
        if (!it.isDirectory()) continue;
        const full = path.join(this.tempRoot, it.name);
        try {
          const st = await fs.stat(full);
          if ((now - st.mtimeMs) > this.maxAgeMs) {
            await fs.rm(full, { recursive: true, force: true });
            // remove from sessionManager if present
            const sid = it.name.replace(/^session_/, '');
            if (sessionManager.getSession(sid)) {
              await sessionManager.destroySession(sid);
            }
          }
        } catch (e) {
          // ignore per-folder errors
        }
      }
    } catch (e) {
      // ignore
    }
  }
}

const runtimeCleaner = new RuntimeCleaner();
export default runtimeCleaner;
