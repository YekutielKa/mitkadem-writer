import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

let prisma: PrismaClient | null = null;
let migrationPrisma: PrismaClient | null = null;

export function getPrisma(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient();
  }
  return prisma;
}

/**
 * Dedicated boot-migration client. The runtime client must remain bound to the
 * least-privilege writer role and is never used for DDL.
 */
export function getMigrationPrisma(): PrismaClient {
  if (!migrationPrisma) {
    const url = process.env.WRITER_MIGRATION_DATABASE_URL;
    if (!url) {
      throw new Error('WRITER_MIGRATION_DATABASE_URL is required for startup migrations');
    }
    migrationPrisma = new PrismaClient({
      datasources: { db: { url } },
    });
  }
  return migrationPrisma;
}

export async function disconnectMigrationPrisma(): Promise<void> {
  if (migrationPrisma) {
    await migrationPrisma.$disconnect();
    migrationPrisma = null;
    logger.info('Migration Prisma disconnected');
  }
}

export async function disconnectPrisma(): Promise<void> {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
    logger.info('Prisma disconnected');
  }
}
