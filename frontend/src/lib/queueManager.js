import { addToQueue, getQueuedOperations, removeFromQueue, updateQueueItem } from './db';
import { api } from './api';

class QueueManager {
  constructor() {
    this.processing = false;
    this.isOnline = navigator.onLine;
    
    // Listen for online/offline events
    window.addEventListener('online', () => {
      console.log('Network: Online');
      this.isOnline = true;
      this.processQueue();
    });
    
    window.addEventListener('offline', () => {
      console.log('Network: Offline');
      this.isOnline = false;
    });
    
    // Process queue periodically when online
    setInterval(() => {
      if (this.isOnline) {
        this.processQueue();
      }
    }, 30000); // Every 30 seconds
  }
  
  async queueOperation(operation) {
    // Just add to queue - mutations handle the immediate attempt
    console.log('📦 Adding operation to queue:', operation.type);
    await addToQueue(operation);
    return { queued: true };
  }
  
  async executeOperation(op) {
    switch (op.type) {
      case 'add':
        return await api.addItem(op.data);
      case 'update':
        return await api.updateItem(op.id, op.data);
      case 'toggle':
        return await api.toggleItemComplete(op.id);
      case 'delete':
        return await api.deleteItem(op.id);
      default:
        throw new Error(`Unknown operation type: ${op.type}`);
    }
  }
  
  async processQueue() {
    if (!this.isOnline || this.processing) return;
    
    this.processing = true;
    const operations = await getQueuedOperations();
    const pendingOps = operations.filter(op => op.status === 'pending');
    
    if (pendingOps.length > 0) {
      console.log(`🔄 Processing ${pendingOps.length} queued operations`);
    }
    
    let processedCount = 0;
    
    for (const op of pendingOps) {
      try {
        const result = await this.executeOperation(op);
        await removeFromQueue(op.id);
        processedCount++;
        console.log(`✅ Processed queued operation ${processedCount}/${pendingOps.length}:`, op.type, result);
      } catch (error) {
        console.error(`❌ Failed to process queued operation ${op.id}:`, error);
        // Increment retry count
        const newRetries = (op.retries || 0) + 1;
        if (newRetries > 5) {
          // Give up after 5 retries
          await updateQueueItem(op.id, { status: 'failed', retries: newRetries });
          console.error(`💀 Operation ${op.id} failed after ${newRetries} retries`);
        } else {
          await updateQueueItem(op.id, { retries: newRetries });
        }
      }
    }
    
    this.processing = false;
    
    if (processedCount > 0) {
      console.log(`🎉 Queue processing complete! Processed ${processedCount} operations`);
      return { processed: processedCount, total: pendingOps.length };
    }
    
    return { processed: 0, total: 0 };
  }
  
  async getQueueCount() {
    const operations = await getQueuedOperations();
    return operations.filter(op => op.status === 'pending').length;
  }
}

export const queueManager = new QueueManager();
