import dotenv from 'dotenv';

dotenv.config();

const securityConfig = {
  aesKey: process.env.AES_KEY,
  serverSecret: process.env.SERVER_SECRET,
  chunkSize: parseInt(process.env.CHUNK_SIZE, 10) || 100,
  compressionLevel: parseInt(process.env.COMPRESSION_LEVEL, 10) || 6,
  session: {
    ttl: parseInt(process.env.SESSION_TTL, 10) || 3600, // 1 hour in seconds
    secret: process.env.SESSION_SECRET,
  },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 5 * 1000, // 5 seconds
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 1,
  },
  maxCodeSize: parseInt(process.env.MAX_CODE_SIZE, 10) || 50 * 1024, // 50 KB
  debugTimeout: parseInt(process.env.DEBUG_TIMEOUT, 10) || 30000, // 30 seconds
};

// In production we require explicit secrets. In development warn and use safe defaults.
if (process.env.NODE_ENV === 'production') {
  if (!securityConfig.aesKey || !securityConfig.serverSecret || !securityConfig.session.secret) {
    throw new Error('Missing critical security configuration: AES_KEY, SERVER_SECRET, or SESSION_SECRET must be set in production.');
  }
} else {
  // Development defaults (insecure) — DO NOT USE IN PRODUCTION
  if (!securityConfig.aesKey || !securityConfig.serverSecret || !securityConfig.session.secret) {
    // eslint-disable-next-line no-console
    console.warn('WARNING: Missing security env vars (AES_KEY, SERVER_SECRET, SESSION_SECRET). Using development defaults. Set real values for production.');
    securityConfig.aesKey = securityConfig.aesKey || 'dev-aes-key-placeholder';
    securityConfig.serverSecret = securityConfig.serverSecret || 'dev-server-secret';
    securityConfig.session.secret = securityConfig.session.secret || 'dev-session-secret';
  }
}

export default securityConfig;
