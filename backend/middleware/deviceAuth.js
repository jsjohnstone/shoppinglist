import { db } from '../db/index.js';
import { devices } from '../db/schema.js';
import { eq } from 'drizzle-orm';

export async function authenticateDevice(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Device authentication required' });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Find device by auth token
    const [device] = await db
      .select()
      .from(devices)
      .where(eq(devices.authToken, token))
      .limit(1);

    if (!device) {
      return res.status(401).json({ error: 'Invalid device token' });
    }

    // Check if device is approved
    if (!device.isApproved) {
      return res.status(403).json({ 
        error: 'Device not approved',
        status: 'pending_approval'
      });
    }

    // Update last seen timestamp
    await db
      .update(devices)
      .set({ 
        lastSeen: new Date(),
        status: 'online'
      })
      .where(eq(devices.id, device.id));

    // Attach device info to request
    req.device = device;

    next();
  } catch (error) {
    console.error('Device authentication error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}

// Optional device auth - allows unapproved devices but still authenticates
export async function authenticateDeviceOptional(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Device authentication required' });
    }

    const token = authHeader.substring(7);

    const [device] = await db
      .select()
      .from(devices)
      .where(eq(devices.authToken, token))
      .limit(1);

    if (!device) {
      return res.status(401).json({ error: 'Invalid device token' });
    }

    // Update last seen timestamp
    await db
      .update(devices)
      .set({ 
        lastSeen: new Date()
      })
      .where(eq(devices.id, device.id));

    req.device = device;

    next();
  } catch (error) {
    console.error('Device authentication error:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
}
