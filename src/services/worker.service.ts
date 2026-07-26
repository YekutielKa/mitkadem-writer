import { Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { getEnv } from '../config/env';
import { logger } from '../lib/logger';
import { signServiceToken } from '../lib/jwt';
import { httpPost } from '../lib/http';
import { WriteJobData, WriteJobSchema } from '../lib/tenant-job-context';

let worker: Worker | null = null;
let connection: Redis | null = null;

async function processJob(job: Job<WriteJobData>): Promise<void> {
  const context = WriteJobSchema.parse(job.data);
  const { taskId, tenantId } = context;
  logger.info({
    taskId,
    tenantId,
    workflowId: context.workflowId,
    commandId: context.commandId,
    correlationId: context.correlationId,
    traceId: context.traceId,
    jobId: job.id,
  }, 'Processing write job');

  const env = getEnv();
  const url = `http://localhost:${env.PORT}/v1/write/run`;

  const result = await httpPost<{ id: string; status: string }>(
    url,
    context,
    {
      Authorization: `Bearer ${signServiceToken('writer-worker', {
        tenantId,
        workflowId: context.workflowId,
        commandId: context.commandId,
        permissions: context.authorityContext.permissions,
      })}`,
      'Idempotency-Key': context.idempotencyKey,
      'X-Tenant-Id': tenantId,
      'X-Workflow-Id': context.workflowId,
      'X-Command-Id': context.commandId,
      'X-Correlation-Id': context.correlationId,
      'X-Trace-Id': context.traceId,
    },
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
