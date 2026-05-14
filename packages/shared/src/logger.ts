import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  base: undefined,
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
      }
    : undefined,
});

export type Logger = typeof logger;

export const metrics = {
  incr(name: string, tags?: Record<string, string | number>) {
    logger.debug({ metric: name, tags }, 'metric.incr');
  },
  timing(name: string, ms: number, tags?: Record<string, string | number>) {
    logger.debug({ metric: name, ms, tags }, 'metric.timing');
  },
  gauge(name: string, value: number, tags?: Record<string, string | number>) {
    logger.debug({ metric: name, value, tags }, 'metric.gauge');
  },
};
