export class SSEClient {
  constructor(onMessage, onError) {
    this.eventSource = null;
    this.onMessage = onMessage;
    this.onError = onError;
    this.reconnectDelay = 1000;
    this.token = null;
  }
  
  connect(token) {
    // Check SSE support
    if (typeof EventSource === 'undefined') {
      console.warn('SSE not supported, falling back to polling');
      return false;
    }
    
    this.token = token;
    const baseUrl = import.meta.env.VITE_API_URL || '';
    const url = `${baseUrl}/api/items/events`;
    
    try {
      // Note: EventSource doesn't support custom headers in standard API
      // We'll need to modify the backend to accept token via query or cookie
      // For now, relying on cookie-based auth or we need to use fetch with ReadableStream
      
      this.eventSource = new EventSource(url, {
        withCredentials: true // Include cookies
      });
      
      this.eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('SSE message received:', data.type);
          this.onMessage(data);
        } catch (error) {
          console.error('SSE parse error:', error);
        }
      };
      
      this.eventSource.onerror = (error) => {
        console.error('SSE error:', error);
        this.onError(error);
        
        // Close and reconnect with exponential backoff
        this.eventSource.close();
        setTimeout(() => {
          this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
          console.log(`Reconnecting SSE in ${this.reconnectDelay}ms...`);
          this.connect(this.token);
        }, this.reconnectDelay);
      };
      
      this.eventSource.onopen = () => {
        console.log('SSE connection established');
        this.reconnectDelay = 1000; // Reset delay on successful connection
      };
      
      return true;
    } catch (error) {
      console.error('Failed to create EventSource:', error);
      this.onError(error);
      return false;
    }
  }
  
  disconnect() {
    if (this.eventSource) {
      console.log('Disconnecting SSE');
      this.eventSource.close();
      this.eventSource = null;
    }
  }
}
