import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { getEnv } from '../config/env';
import { logger } from '../lib/logger';
import { WriteJobData, WriteJobSchema } from '../lib/tenant-job-context';

let queue: Queue | null = null;
let connection: Redis | null = null;

function getQueue(): Queue | null {
  const env = getEnv();

  if (!env.REDIS_URL) {
    return null;
  }

  if (!queue) {
    connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
    queue = new Queue('mitkadem-writer', { connection });
    logger.info('Queue initialized');
  }

  return queue;
}

export async function addToQueue(input: WriteJobData): Promise<string | null> {
  const jobData = WriteJobSchema.parse(input);
  const q = getQueue();

  if (!q) {
    logger.debug('Queue not available (no REDIS_URL)');
    return null;
  }

  const job = await q.add(
    'process',
    jobData,
    {
      jobId: `${jobData.tenantId}:${jobData.commandId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 50,
    }
  );

  logger.info({
    jobId: job.id,
    taskId: jobData.taskId,
    tenantId: jobData.tenantId,
    workflowId: jobData.workflowId,
    commandId: jobData.commandId,
    correlationId: jobData.correlationId,
  }, 'Job added to queue');
  return job.id || null;
}

export async function closeQueue(): Promise<void> {
  if (queue) {
    await queue.close();
    queue = null;
  }
  if (connection) {
    await connection.quit();
    connection = null;
  }
  logger.info('Queue closed');
}
