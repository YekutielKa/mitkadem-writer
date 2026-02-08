import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { getEnv } from '../config/env';
import { logger } from '../lib/logger';
import { signServiceToken } from '../lib/jwt';
import { httpPost } from '../lib/http';

let worker: Worker | null = null;
let connection: Redis | null = null;

interface WriteJobData {
  taskId: string;
  tenantId: string;
}

async function processJob(job: Job<WriteJobData>): Promise<void> {
  const { taskId, tenantId } = job.data;
  logger.info({ taskId, tenantId, jobId: job.id }, 'Processing write job');

  const env = getEnv();
  const url = `http://localhost:${env.PORT}/v1/write/run`;

  const result = await httpPost<{ id: string; status: string }>(
    url,
    { taskId },
    { Authorization: `Bearer ${signServiceToken()}` },
    { timeout: 90000 } // LLM generation can be slow
  );

  logger.info({ taskId, status: result.status, jobId: job.id }, 'Write job completed');
}

export function startWorker(): void {
  const env = getEnv();

  if (!env.REDIS_URL) {
    logger.info('Worker not started (no REDIS_URL)');
    return;
  }

  connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

  worker = new Worker('mitkadem-writer', processJob, {
    connection,
    concurrency: 2,
    limiter: { max: 5, duration: 60000 }, // max 5 jobs per minute
  });

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, taskId: job.data.taskId }, 'Job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, taskId: job?.data?.taskId, error: err.message }, 'Job failed');
  });

  logger.info('BullMQ worker started (concurrency: 2)');
}

export async function closeWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
  if (connection) {
    await connection.quit();
    connection = null;
  }
  logger.info('Worker closed');
}
