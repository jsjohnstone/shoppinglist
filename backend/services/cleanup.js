import cron from 'node-cron';
import { db } from '../db/index.js';
import { items } from '../db/schema.js';
import { and, eq, lt, sql } from 'drizzle-orm';

/**
 * Remove items that have been completed for more than 24 hours
 */
export async function cleanupCompletedItems() {
  try {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const result = await db.delete(items)
      .where(
        and(
          eq(items.isCompleted, true),
          lt(items.completedAt, twentyFourHoursAgo)
        )
      );

    console.log(`Cleanup: Removed completed items older than 24 hours`);
    return result;
  } catch (error) {
    console.error('Error during cleanup:', error);
  }
}

/**
 * Start the cleanup cron job (runs every hour)
 */
export function startCleanupJob() {
  // Run every hour at minute 0
  cron.schedule('0 * * * *', async () => {
    console.log('Running scheduled cleanup job...');
    await cleanupCompletedItems();
  });
  
  console.log('Cleanup cron job scheduled (runs hourly)');
}
