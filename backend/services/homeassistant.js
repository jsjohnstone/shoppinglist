import axios from 'axios';
import { getSetting } from '../routes/settings.js';
import logger from '../logger.js';

class HomeAssistantService {
  constructor() {
    this.config = null;
    this.lastConfigLoad = null;
    this.configCacheDuration = 5 * 60 * 1000; // 5 minutes
  }

  async loadConfig() {
    // Use cached config if available and not expired
    if (this.config && this.lastConfigLoad && 
        (Date.now() - this.lastConfigLoad < this.configCacheDuration)) {
      return this.config;
    }

    const haUrl = await getSetting('ha_url');
    const haToken = await getSetting('ha_token');
    const defaultTtsService = await getSetting('ha_tts_service', 'tts.google_translate_say');
    
    if (!haUrl || !haToken) {
      throw new Error('Home Assistant not configured');
    }

    this.config = {
      haUrl,
      haToken,
      defaultTtsService,
    };
    this.lastConfigLoad = Date.now();
    return this.config;
  }

  async getAxiosInstance() {
    const config = await this.loadConfig();
    
    // Ensure URL doesn't have trailing slash
    const baseURL = config.haUrl.replace(/\/$/, '');

    return axios.create({
      baseURL,
      headers: {
        'Authorization': `Bearer ${config.haToken}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
  }

  async testConnection() {
    logger.debug('Testing Home Assistant connection');
    
    try {
      const api = await this.getAxiosInstance();
      const response = await api.get('/api/');
      
      logger.info('Home Assistant connection successful', {
        version: response.data.version
      });
      
      return {
        success: true,
        message: response.data.message || 'Connected to Home Assistant',
        version: response.data.version,
      };
    } catch (error) {
      logger.error('Home Assistant connection failed', {
        error: error.message
      });
      return {
        success: false,
        error: error.response?.data?.message || error.message,
      };
    }
  }

  async getMediaPlayerEntities() {
    logger.debug('Fetching Home Assistant media player entities');
    
    try {
      const api = await this.getAxiosInstance();
      const response = await api.get('/api/states');
      
      // Filter for media_player entities
      const mediaPlayers = response.data
        .filter(entity => entity.entity_id.startsWith('media_player.'))
        .map(entity => ({
          entity_id: entity.entity_id,
          friendly_name: entity.attributes.friendly_name || entity.entity_id,
          state: entity.state,
        }));

      logger.info('Home Assistant media players fetched', {
        count: mediaPlayers.length
      });

      return mediaPlayers;
    } catch (error) {
      logger.error('Failed to fetch Home Assistant media players', {
        error: error.message
      });
      throw new Error('Failed to fetch Home Assistant entities');
    }
  }

  async playTTS(entityId, message, service = null) {
    logger.debug('Home Assistant TTS request', {
      entityId,
      messageLength: message.length,
      service
    });
    
    try {
      const config = await this.loadConfig();
      const ttsService = service || config.defaultTtsService;
      const api = await this.getAxiosInstance();

      // Parse service domain and name (e.g., "tts.google_translate_say")
      const [domain, serviceName] = ttsService.split('.');

      if (!domain || !serviceName) {
        throw new Error('Invalid TTS service format');
      }

      // Call the TTS service
      await api.post(`/api/services/${domain}/${serviceName}`, {
        entity_id: entityId,
        message: message,
      });

      logger.info('Home Assistant TTS sent', {
        entityId,
        service: ttsService
      });

      return { success: true };
    } catch (error) {
      logger.error('Home Assistant TTS failed', {
        entityId,
        error: error.message
      });
      throw new Error('Failed to play TTS message');
    }
  }

  async playSound(entityId, soundUrl) {
    logger.debug('Home Assistant sound playback request', {
      entityId,
      soundUrl
    });
    
    try {
      const api = await this.getAxiosInstance();

      // Use media_player.play_media service
      await api.post('/api/services/media_player/play_media', {
        entity_id: entityId,
        media_content_id: soundUrl,
        media_content_type: 'music',
      });

      logger.info('Home Assistant sound played', {
        entityId,
        soundUrl
      });

      return { success: true };
    } catch (error) {
      logger.error('Home Assistant sound playback failed', {
        entityId,
        error: error.message
      });
      throw new Error('Failed to play sound');
    }
  }

  async getStates() {
    logger.debug('Fetching Home Assistant states');
    
    try {
      const api = await this.getAxiosInstance();
      const response = await api.get('/api/states');
      
      logger.info('Home Assistant states fetched', {
        count: response.data.length
      });
      
      return response.data;
    } catch (error) {
      logger.error('Failed to fetch Home Assistant states', {
        error: error.message
      });
      throw new Error('Failed to fetch Home Assistant states');
    }
  }

  clearCache() {
    this.config = null;
    this.lastConfigLoad = null;
  }
}

export const haService = new HomeAssistantService();
