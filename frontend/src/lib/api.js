const API_URL = '/api';

class ApiClient {
  constructor() {
    this.token = localStorage.getItem('token');
  }

  setToken(token) {
    this.token = token;
    if (token) {
      localStorage.setItem('token', token);
    } else {
      localStorage.removeItem('token');
    }
  }

  getHeaders() {
    const headers = {
      'Content-Type': 'application/json',
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  async request(endpoint, options = {}) {
    const response = await fetch(`${API_URL}${endpoint}`, {
      ...options,
      headers: {
        ...this.getHeaders(),
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Request failed' }));
      throw new Error(error.error || 'Request failed');
    }

    return response.json();
  }

  // Auth
  async login(username, password) {
    const data = await this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    this.setToken(data.token);
    return data;
  }

  async register(username, password) {
    const data = await this.request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    this.setToken(data.token);
    return data;
  }

  async getCurrentUser() {
    return this.request('/auth/me');
  }

  logout() {
    this.setToken(null);
  }

  // Items
  async getItems(params = {}) {
    const queryString = new URLSearchParams(params).toString();
    return this.request(`/items${queryString ? `?${queryString}` : ''}`);
  }

  async addItem(itemData) {
    return this.request('/items', {
      method: 'POST',
      body: JSON.stringify(itemData),
    });
  }

  async updateItem(id, itemData) {
    return this.request(`/items/${id}`, {
      method: 'PUT',
      body: JSON.stringify(itemData),
    });
  }

  async toggleItemComplete(id) {
    return this.request(`/items/${id}/complete`, {
      method: 'PATCH',
    });
  }

  async deleteItem(id) {
    return this.request(`/items/${id}`, {
      method: 'DELETE',
    });
  }

  // Categories
  async getCategories() {
    return this.request('/categories');
  }

  async addCategory(categoryData) {
    return this.request('/categories', {
      method: 'POST',
      body: JSON.stringify(categoryData),
    });
  }

  async updateCategory(id, categoryData) {
    return this.request(`/categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(categoryData),
    });
  }

  async deleteCategory(id) {
    return this.request(`/categories/${id}`, {
      method: 'DELETE',
    });
  }

  // Reordering
  async reorderItems(itemOrders) {
    return this.request('/items/reorder', {
      method: 'POST',
      body: JSON.stringify({ itemOrders }),
    });
  }

  async reorderCategories(categoryOrders) {
    return this.request('/categories/reorder', {
      method: 'POST',
      body: JSON.stringify({ categoryOrders }),
    });
  }

  // API Keys
  async getApiKeys() {
    return this.request('/api-keys');
  }

  async createApiKey(keyData) {
    return this.request('/api-keys', {
      method: 'POST',
      body: JSON.stringify(keyData),
    });
  }

  async deleteApiKey(id) {
    return this.request(`/api-keys/${id}`, {
      method: 'DELETE',
    });
  }

  // Devices
  async getDevices() {
    return this.request('/devices');
  }

  async approveDevice(id, deviceData) {
    return this.request(`/devices/${id}/approve`, {
      method: 'PATCH',
      body: JSON.stringify(deviceData),
    });
  }

  async updateDevice(id, deviceData) {
    return this.request(`/devices/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(deviceData),
    });
  }

  async deleteDevice(id) {
    return this.request(`/devices/${id}`, {
      method: 'DELETE',
    });
  }

  // Home Assistant
  async getHAConfig() {
    return this.request('/settings/homeassistant');
  }

  async updateHAConfig(configData) {
    return this.request('/settings/homeassistant', {
      method: 'PUT',
      body: JSON.stringify(configData),
    });
  }

  async deleteHAConfig() {
    return this.request('/settings/homeassistant', {
      method: 'DELETE',
    });
  }

  async getHAEntities() {
    return this.request('/homeassistant/entities');
  }

  async testHAConnection() {
    return this.request('/homeassistant/test', {
      method: 'POST',
    });
  }

  // TTS Phrases
  async getTTSPhrases() {
    return this.request('/settings/tts-phrases');
  }

  async updateTTSPhrase(key, template) {
    return this.request(`/settings/tts-phrases/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ template }),
    });
  }

  async resetTTSPhrases() {
    return this.request('/settings/tts-phrases/reset', {
      method: 'POST',
    });
  }
}

export const api = new ApiClient();
