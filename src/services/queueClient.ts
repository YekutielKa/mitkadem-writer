import { Queue } from 'bullmq';
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL;
let queue: Queue | null = null;

export function getQueue(serviceName: string): Queue | null {
  if (!REDIS_URL) {
    return null;
  }
  if (!queue) {
    const connection = new Redis(REDIS_URL, { maxRetriesPerRequest: null });
    queue = new Queue('mitkadem-' + serviceName, { connection });
  }
  return queue;
}

export async function addToQueue(serviceName: string, taskId: string, tenantId: string) {
  const q = getQueue(serviceName);
  if (!q) {
    return null;
  }
  const job = await q.add('process', { taskId, tenantId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 50
  });
  return job.id;
}
