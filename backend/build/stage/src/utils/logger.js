import pino from 'pino';
import path from 'node:path';
import fssync from 'node:fs';
import { getBackendRoot, getRuntimeDir } from './project-paths.js';

const nodeEnv = process.env.NODE_ENV || 'development';
const wantsPretty =
  process.env.LOG_PRETTY !== 'false' &&
  nodeEnv !== 'production' &&
  Boolean(process.stdout.isTTY);

// Determine log file path in the runtime directory
let logFilePath = null;
try {
  const root = getBackendRoot(import.meta.url);
  const runtimeDir = getRuntimeDir(root);
  if (!fssync.existsSync(runtimeDir)) {
    fssync.mkdirSync(runtimeDir, { recursive: true });
  }
  logFilePath = path.join(runtimeDir, 'backend.log');
} catch (e) {
  // Fallback to a temporary file if project paths can't be resolved
  logFilePath = path.join(fssync.realpathSync(fssync.mkdtempSync(path.join(fssync.realpathSync(process.platform === 'win32' ? process.env.TEMP : '/tmp'), 'backend-log-'))), 'error.log');
}

const streams = [
  { stream: process.stdout }
];

if (logFilePath) {
  streams.push({ stream: fssync.createWriteStream(logFilePath, { flags: 'a' }) });
}

let logger;
if (wantsPretty) {
  try {
    logger = pino({
      level: process.env.LOG_LEVEL || 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          levelFirst: true,
          translateTime: 'SYS:standard',
        },
      },
    });
  } catch {
    logger = pino({ level: process.env.LOG_LEVEL || 'info' }, pino.multistream(streams));
  }
} else {
  logger = pino({ level: process.env.LOG_LEVEL || 'info' }, pino.multistream(streams));
}

// Ensure first log entry is immediate
logger.info(`--- Log initialized at ${new Date().toISOString()} (PID: ${process.pid}) ---`);
logger.info(`ExecPath: ${process.execPath}`);
logger.info(`CWD: ${process.cwd()}`);

export default logger;
