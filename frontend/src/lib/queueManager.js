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
    // Try to execute immediately if online
    if (this.isOnline) {
      try {
        const result = await this.executeOperation(operation);
        return { success: true, result };
      } catch (error) {
        console.error('Operation failed, queueing for later:', error);
        // If failed, add to queue
        await addToQueue(operation);
        return { success: false, queued: true };
      }
    } else {
      // Offline - add to queue
      console.log('Offline: Queueing operation', operation.type);
      await addToQueue(operation);
      return { success: false, queued: true };
    }
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
      console.log(`Processing ${pendingOps.length} queued operations`);
    }
    
    for (const op of pendingOps) {
      try {
        await this.executeOperation(op);
        await removeFromQueue(op.id);
        console.log(`Processed queued operation: ${op.type}`);
      } catch (error) {
        console.error(`Failed to process queued operation ${op.id}:`, error);
        // Increment retry count
        const newRetries = (op.retries || 0) + 1;
        if (newRetries > 5) {
          // Give up after 5 retries
          await updateQueueItem(op.id, { status: 'failed', retries: newRetries });
          console.error(`Operation ${op.id} failed after ${newRetries} retries`);
        } else {
          await updateQueueItem(op.id, { retries: newRetries });
        }
      }
    }
    
    this.processing = false;
  }
  
  async getQueueCount() {
    const operations = await getQueuedOperations();
    return operations.filter(op => op.status === 'pending').length;
  }
}

export const queueManager = new QueueManager();
