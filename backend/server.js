import 'dotenv/config';
import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import bcrypt from 'bcrypt';
import logger from './logger.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorLogger } from './middleware/errorLogger.js';
import authRoutes from './routes/auth.js';
import itemsRoutes from './routes/items.js';
import categoriesRoutes from './routes/categories.js';
import apiKeysRoutes from './routes/apiKeys.js';
import devicesRoutes from './routes/devices.js';
import homeassistantRoutes from './routes/homeassistant.js';
import settingsRoutes from './routes/settings.js';
import listsRoutes from './routes/lists.js';
import { startCleanupJob } from './services/cleanup.js';
import { db } from './db/index.js';
import { users } from './db/schema.js';
import { eq } from 'drizzle-orm';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(requestLogger);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/items', itemsRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/api-keys', apiKeysRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/homeassistant', homeassistantRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/lists', listsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error logging middleware (must be after routes)
app.use(errorLogger);

// Serve static files (frontend) in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('public'));
  app.get('*', (req, res) => {
    res.sendFile('index.html', { root: 'public' });
  });
}

// Log startup
logger.info('Starting server', {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: PORT
});

async function ensureDefaultUser() {
  if (process.env.DISABLE_AUTH !== 'true') return;
  try {
    const [existing] = await db.select().from(users).where(eq(users.username, 'default')).limit(1);
    if (!existing) {
      const hash = await bcrypt.hash(crypto.randomUUID(), 10);
      await db.insert(users).values({ username: 'default', passwordHash: hash });
      logger.info('Created default user for auth-disabled mode');
    }
  } catch (error) {
    logger.error('Failed to ensure default user', { error: error.message });
  }
}

// Start server
app.listen(PORT, async () => {
  logger.info('Server started successfully', {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    authDisabled: process.env.DISABLE_AUTH === 'true',
  });

  await ensureDefaultUser();

  // Start cleanup cron job
  startCleanupJob();
});

// Handle shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Handle errors
process.on('uncaughtException', (error) => {
  logger.error('Uncaught exception', {
    message: error.message,
    stack: error.stack
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled rejection', {
    reason: reason?.message || reason,
    stack: reason?.stack
  });
});
