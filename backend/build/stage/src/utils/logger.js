import pino from 'pino';

const nodeEnv = process.env.NODE_ENV || 'development';
const wantsPretty =
  process.env.LOG_PRETTY !== 'false' &&
  nodeEnv !== 'production' &&
  Boolean(process.stdout.isTTY);

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
    logger = pino({ level: process.env.LOG_LEVEL || 'info' });
  }
} else {
  logger = pino({ level: process.env.LOG_LEVEL || 'info' });
}

export default logger;
