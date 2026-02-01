import express from 'express';
import cors from 'cors';
import pinoHttp from 'pino-http';
import 'express-async-errors';

import { logger } from './lib/logger';
import { requestIdMiddleware } from './middleware/requestId';
import { errorHandler } from './middleware/errorHandler';

import healthRoutes from './routes/health';
import devRoutes from './routes/dev';
import writeRoutes from './routes/write';
import writerRoutes from './routes/writer';

const app = express();

// Middleware
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger }));
app.use(requestIdMiddleware);

// Routes
app.use('/', healthRoutes);
app.use('/v1/_dev', devRoutes);
app.use('/v1/write', writeRoutes);
app.use('/v1/writer', writerRoutes);

// Error handler (must be last)
app.use(errorHandler);

export default app;
