import pino from 'pino';
import pinoPretty from 'pino-pretty';

const logger = pino(pinoPretty({
    colorize: true,
    levelFirst: true,
    translateTime: 'SYS:standard',
}));

export default logger;
