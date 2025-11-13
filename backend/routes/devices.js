import express from 'express';
import crypto from 'crypto';
import { db } from '../db/index.js';
import { devices } from '../db/schema.js';
import { eq, desc } from 'drizzle-orm';
import { authenticateToken } from '../middleware/auth.js';
import { authenticateDevice, authenticateDeviceOptional } from '../middleware/deviceAuth.js';
import { logDeviceEvent, getDeviceEvents } from '../services/deviceEvents.js';

const router = express.Router();

// Generate secure random token
function generateAuthToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Device self-registration (no auth required)
router.post('/register', async (req, res) => {
  try {
    const { device_id, usb_devices } = req.body;

    if (!device_id) {
      return res.status(400).json({ error: 'device_id is required' });
    }

    // Check if device already exists
    const [existingDevice] = await db
      .select()
      .from(devices)
      .where(eq(devices.deviceId, device_id))
      .limit(1);

    if (existingDevice) {
      // Return existing auth token
      return res.json({
        auth_token: existingDevice.authToken,
        status: existingDevice.isApproved ? 'approved' : 'pending_approval',
        device_id: existingDevice.deviceId,
      });
    }

    // Generate new auth token
    const authToken = generateAuthToken();

    // Create new device
    const [newDevice] = await db
      .insert(devices)
      .values({
        deviceId: device_id,
        authToken,
        isApproved: false,
        status: 'pending',
        lastSeen: new Date(),
      })
      .returning();

    console.log(`New device registered: ${device_id}`);
    console.log(`USB devices detected:`, usb_devices);

    res.status(201).json({
      auth_token: authToken,
      status: 'pending_approval',
      device_id: newDevice.deviceId,
    });
  } catch (error) {
    console.error('Device registration error:', error);
    res.status(500).json({ error: 'Failed to register device' });
  }
});

// Get device config (requires device auth, allows unapproved)
router.get('/config', authenticateDeviceOptional, async (req, res) => {
  try {
    const device = req.device;

    res.json({
      device_id: device.deviceId,
      friendly_name: device.friendlyName,
      is_approved: device.isApproved,
      ha_speaker_entity: device.haSpeakerEntity,
      usb_device_path: device.usbDevicePath,
      status: device.status,
    });
  } catch (error) {
    console.error('Error fetching device config:', error);
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

// Update device heartbeat (requires device auth, allows unapproved)
router.post('/heartbeat', authenticateDeviceOptional, async (req, res) => {
  try {
    const { status } = req.body;

    await db
      .update(devices)
      .set({
        lastSeen: new Date(),
        status: status || 'online',
      })
      .where(eq(devices.id, req.device.id));

    res.json({ success: true });
  } catch (error) {
    console.error('Heartbeat error:', error);
    res.status(500).json({ error: 'Failed to update heartbeat' });
  }
});

// List all devices (admin only)
router.get('/', authenticateToken, async (req, res) => {
  try {
    const allDevices = await db
      .select({
        id: devices.id,
        device_id: devices.deviceId,
        friendly_name: devices.friendlyName,
        device_type: devices.deviceType,
        is_approved: devices.isApproved,
        ha_speaker_entity: devices.haSpeakerEntity,
        usb_device_path: devices.usbDevicePath,
        last_seen: devices.lastSeen,
        status: devices.status,
        created_at: devices.createdAt,
      })
      .from(devices)
      .orderBy(desc(devices.createdAt));

    res.json(allDevices);
  } catch (error) {
    console.error('Error fetching devices:', error);
    res.status(500).json({ error: 'Failed to fetch devices' });
  }
});

// Approve device (admin only)
router.patch('/:id/approve', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { friendly_name, ha_speaker_entity, usb_device_path } = req.body;

    if (!friendly_name || !ha_speaker_entity) {
      return res.status(400).json({ 
        error: 'friendly_name and ha_speaker_entity are required' 
      });
    }

    const [updatedDevice] = await db
      .update(devices)
      .set({
        friendlyName: friendly_name,
        haSpeakerEntity: ha_speaker_entity,
        usbDevicePath: usb_device_path || null,
        isApproved: true,
        status: 'approved',
      })
      .where(eq(devices.id, parseInt(id)))
      .returning();

    if (!updatedDevice) {
      return res.status(404).json({ error: 'Device not found' });
    }

    console.log(`Device approved: ${updatedDevice.deviceId} (${friendly_name})`);

    // Log approval event
    await logDeviceEvent(
      updatedDevice.id,
      'status_change',
      `Device approved as "${friendly_name}"`,
      { action: 'approved', friendly_name, ha_speaker_entity, usb_device_path }
    );

    res.json({
      id: updatedDevice.id,
      device_id: updatedDevice.deviceId,
      friendly_name: updatedDevice.friendlyName,
      is_approved: updatedDevice.isApproved,
      ha_speaker_entity: updatedDevice.haSpeakerEntity,
      usb_device_path: updatedDevice.usbDevicePath,
      status: updatedDevice.status,
    });
  } catch (error) {
    console.error('Error approving device:', error);
    res.status(500).json({ error: 'Failed to approve device' });
  }
});

// Reject/delete device (admin only)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const [deletedDevice] = await db
      .delete(devices)
      .where(eq(devices.id, parseInt(id)))
      .returning();

    if (!deletedDevice) {
      return res.status(404).json({ error: 'Device not found' });
    }

    console.log(`Device deleted: ${deletedDevice.deviceId}`);

    res.json({ message: 'Device deleted successfully' });
  } catch (error) {
    console.error('Error deleting device:', error);
    res.status(500).json({ error: 'Failed to delete device' });
  }
});

// Update device settings (admin only)
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { friendly_name, ha_speaker_entity, usb_device_path } = req.body;

    const updateData = {};
    if (friendly_name !== undefined) updateData.friendlyName = friendly_name;
    if (ha_speaker_entity !== undefined) updateData.haSpeakerEntity = ha_speaker_entity;
    if (usb_device_path !== undefined) updateData.usbDevicePath = usb_device_path;

    const [updatedDevice] = await db
      .update(devices)
      .set(updateData)
      .where(eq(devices.id, parseInt(id)))
      .returning();

    if (!updatedDevice) {
      return res.status(404).json({ error: 'Device not found' });
    }

    // Log settings update event
    const changes = [];
    if (friendly_name !== undefined) changes.push('friendly name');
    if (ha_speaker_entity !== undefined) changes.push('speaker entity');
    if (usb_device_path !== undefined) changes.push('USB device path');
    
    await logDeviceEvent(
      updatedDevice.id,
      'status_change',
      `Device settings updated: ${changes.join(', ')}`,
      updateData
    );

    res.json({
      id: updatedDevice.id,
      device_id: updatedDevice.deviceId,
      friendly_name: updatedDevice.friendlyName,
      is_approved: updatedDevice.isApproved,
      ha_speaker_entity: updatedDevice.haSpeakerEntity,
      usb_device_path: updatedDevice.usbDevicePath,
      status: updatedDevice.status,
    });
  } catch (error) {
    console.error('Error updating device:', error);
    res.status(500).json({ error: 'Failed to update device' });
  }
});

// Get device events (admin only)
router.get('/:id/events', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const limit = parseInt(req.query.limit) || 50;

    const events = await getDeviceEvents(parseInt(id), limit);

    res.json(events);
  } catch (error) {
    console.error('Error fetching device events:', error);
    res.status(500).json({ error: 'Failed to fetch device events' });
  }
});

// Create device event (device auth or admin auth)
router.post('/:id/events', async (req, res) => {
  try {
    const { id } = req.params;
    const { type, message, metadata } = req.body;

    if (!type || !message) {
      return res.status(400).json({ error: 'type and message are required' });
    }

    // Verify device exists
    const [device] = await db
      .select()
      .from(devices)
      .where(eq(devices.id, parseInt(id)))
      .limit(1);

    if (!device) {
      return res.status(404).json({ error: 'Device not found' });
    }

    const event = await logDeviceEvent(
      parseInt(id),
      type,
      message,
      metadata || null
    );

    res.status(201).json(event);
  } catch (error) {
    console.error('Error creating device event:', error);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// Create device event by device_id (for scanner apps)
router.post('/events', authenticateDeviceOptional, async (req, res) => {
  try {
    const { type, message, metadata, device_id } = req.body;

    if (!type || !message) {
      return res.status(400).json({ error: 'type and message are required' });
    }

    // If authenticated via device auth, use that device
    let deviceDbId;
    if (req.device) {
      deviceDbId = req.device.id;
    } else if (device_id) {
      // Look up device by device_id
      const [device] = await db
        .select()
        .from(devices)
        .where(eq(devices.deviceId, device_id))
        .limit(1);
      
      if (!device) {
        return res.status(404).json({ error: 'Device not found' });
      }
      deviceDbId = device.id;
    } else {
      return res.status(400).json({ error: 'device_id is required when not authenticated' });
    }

    const event = await logDeviceEvent(
      deviceDbId,
      type,
      message,
      metadata || null
    );

    res.status(201).json(event);
  } catch (error) {
    console.error('Error creating device event:', error);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

export default router;
