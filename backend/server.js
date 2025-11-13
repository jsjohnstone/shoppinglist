import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import authRoutes from './routes/auth.js';
import itemsRoutes from './routes/items.js';
import categoriesRoutes from './routes/categories.js';
import apiKeysRoutes from './routes/apiKeys.js';
import devicesRoutes from './routes/devices.js';
import homeassistantRoutes from './routes/homeassistant.js';
import settingsRoutes from './routes/settings.js';
import { startCleanupJob } from './services/cleanup.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/items', itemsRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/api-keys', apiKeysRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/homeassistant', homeassistantRoutes);
app.use('/api/settings', settingsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve static files (frontend) in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static('public'));
  app.get('*', (req, res) => {
    res.sendFile('index.html', { root: 'public' });
  });
}

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`API available at http://localhost:${PORT}/api`);
  
  // Start cleanup cron job
  startCleanupJob();
});

// Handle errors
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});
