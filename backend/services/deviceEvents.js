import { db } from '../db/index.js';
import { deviceEvents } from '../db/schema.js';
import { eq, desc, sql } from 'drizzle-orm';

/**
 * Log a device event
 * @param {number} deviceId - Device database ID
 * @param {string} eventType - Type of event (scan_success, scan_error, api_error, status_change, error)
 * @param {string} message - Human readable message
 * @param {object} metadata - Additional event data (optional)
 */
export async function logDeviceEvent(deviceId, eventType, message, metadata = null) {
  try {
    const [event] = await db
      .insert(deviceEvents)
      .values({
        deviceId,
        eventType,
        message,
        metadata: metadata ? JSON.stringify(metadata) : null,
      })
      .returning();

    console.log(`[Device ${deviceId}] ${eventType}: ${message}`);
    
    // Clean up old events (keep last 100 per device)
    await cleanupOldEvents(deviceId, 100);
    
    return event;
  } catch (error) {
    console.error('Failed to log device event:', error);
    // Don't throw - event logging should never break the main flow
    return null;
  }
}

/**
 * Get recent events for a device
 * @param {number} deviceId - Device database ID
 * @param {number} limit - Maximum number of events to return
 */
export async function getDeviceEvents(deviceId, limit = 50) {
  try {
    const events = await db
      .select()
      .from(deviceEvents)
      .where(eq(deviceEvents.deviceId, deviceId))
      .orderBy(desc(deviceEvents.createdAt))
      .limit(limit);

    return events;
  } catch (error) {
    console.error('Failed to get device events:', error);
    throw error;
  }
}

/**
 * Clean up old events for a device (keep only the most recent N events)
 * @param {number} deviceId - Device database ID
 * @param {number} keepCount - Number of events to keep
 */
async function cleanupOldEvents(deviceId, keepCount = 100) {
  try {
    // Delete events older than the Nth most recent event
    await db.execute(sql`
      DELETE FROM device_events
      WHERE device_id = ${deviceId}
      AND id NOT IN (
        SELECT id FROM device_events
        WHERE device_id = ${deviceId}
        ORDER BY created_at DESC
        LIMIT ${keepCount}
      )
    `);
  } catch (error) {
    console.error('Failed to cleanup old events:', error);
    // Don't throw - cleanup failure shouldn't break the main flow
  }
}

/**
 * Get event count for a device
 * @param {number} deviceId - Device database ID
 */
export async function getEventCount(deviceId) {
  try {
    const result = await db
      .select({ count: sql`count(*)` })
      .from(deviceEvents)
      .where(eq(deviceEvents.deviceId, deviceId));
    
    return parseInt(result[0]?.count || 0);
  } catch (error) {
    console.error('Failed to get event count:', error);
    return 0;
  }
}
