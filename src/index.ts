import { getEnv } from './config/env';
import { logger } from './lib/logger';
import { disconnectPrisma } from './lib/prisma';
import { closeQueue } from './services/queue.service';
import { startWorker, closeWorker } from './services/worker.service';
import app from './app';

const env = getEnv();

const server = app.listen(env.PORT, '0.0.0.0', () => {
  logger.info({ port: env.PORT, service: env.SERVICE_NAME, version: '0.2.0' }, 'Service started');
  startWorker();
});

// Graceful shutdown
async function shutdown(signal: string) {
  logger.info({ signal }, 'Shutdown signal received');

  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      await closeWorker();
      await closeQueue();
      await disconnectPrisma();
      logger.info('Cleanup complete');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during cleanup');
      process.exit(1);
    }
  });

  // Force exit after 10 seconds
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error({ err: reason }, 'Unhandled rejection');
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception');
  process.exit(1);
});
