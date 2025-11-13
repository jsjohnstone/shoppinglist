import express from 'express';
import bcrypt from 'bcrypt';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { generateToken, authenticateToken } from '../middleware/auth.js';
import logger from '../logger.js';

const router = express.Router();

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      logger.warn('Registration failed - missing credentials');
      return res.status(400).json({ error: 'Username and password required' });
    }

    logger.info('Registration attempt', { username });

    // Check if user already exists
    const [existingUser] = await db.select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (existingUser) {
      logger.warn('Registration failed - username exists', { username });
      return res.status(400).json({ error: 'Username already exists' });
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user
    const [newUser] = await db.insert(users)
      .values({
        username,
        passwordHash,
      })
      .returning({ id: users.id, username: users.username });

    // Generate token
    const token = generateToken(newUser);

    logger.info('User registered successfully', {
      userId: newUser.id,
      username: newUser.username
    });

    res.status(201).json({
      user: { id: newUser.id, username: newUser.username },
      token,
    });
  } catch (error) {
    logger.error('Registration error', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      logger.warn('Login failed - missing credentials');
      return res.status(400).json({ error: 'Username and password required' });
    }

    logger.info('Login attempt', { username });

    // Find user
    const [user] = await db.select()
      .from(users)
      .where(eq(users.username, username))
      .limit(1);

    if (!user) {
      logger.warn('Login failed - user not found', { username });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.passwordHash);
    if (!validPassword) {
      logger.warn('Login failed - invalid password', { username });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate token
    const token = generateToken(user);

    logger.info('Login successful', {
      userId: user.id,
      username: user.username
    });

    res.json({
      user: { id: user.id, username: user.username },
      token,
    });
  } catch (error) {
    logger.error('Login error', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const [user] = await db.select({
      id: users.id,
      username: users.username,
      createdAt: users.createdAt,
    })
      .from(users)
      .where(eq(users.id, req.user.id))
      .limit(1);

    if (!user) {
      logger.warn('Get user failed - user not found', {
        userId: req.user.id
      });
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error) {
    logger.error('Get user error', {
      userId: req.user.id,
      error: error.message
    });
    res.status(500).json({ error: 'Failed to get user' });
  }
});

export default router;
