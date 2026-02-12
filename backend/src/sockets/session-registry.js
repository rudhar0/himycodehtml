import crypto from 'node:crypto';

function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

export class SessionRegistry {
  constructor() {
    this.serverInstanceId = newId();
    this.clients = new Map(); // socketId -> session
  }

  register(socket) {
    const clientInstanceId =
      socket.handshake?.auth?.clientInstanceId ||
      socket.handshake?.query?.clientInstanceId ||
      null;

    const session = {
      socketId: socket.id,
      clientInstanceId,
      connectedAt: new Date().toISOString(),
      lastSeenAt: Date.now(),
      ip: socket.handshake?.address || null,
      userAgent: socket.handshake?.headers?.['user-agent'] || null,
    };

    this.clients.set(socket.id, session);
    return session;
  }

  touch(socketId) {
    const s = this.clients.get(socketId);
    if (!s) return;
    s.lastSeenAt = Date.now();
  }

  unregister(socketId, reason = 'disconnect') {
    const s = this.clients.get(socketId);
    if (!s) return null;
    s.disconnectedAt = new Date().toISOString();
    s.disconnectReason = reason;
    this.clients.delete(socketId);
    return s;
  }

  snapshot() {
    return {
      serverInstanceId: this.serverInstanceId,
      connectedClients: this.clients.size,
      clients: Array.from(this.clients.values()),
    };
  }
}

export const sessionRegistry = new SessionRegistry();

