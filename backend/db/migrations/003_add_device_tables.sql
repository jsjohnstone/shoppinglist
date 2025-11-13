-- Phase 3: Raspberry Pi Barcode Scanner System

-- Devices table
CREATE TABLE IF NOT EXISTS devices (
  id SERIAL PRIMARY KEY,
  device_id VARCHAR(255) NOT NULL UNIQUE,
  friendly_name VARCHAR(255),
  device_type VARCHAR(50) DEFAULT 'barcode_scanner',
  auth_token VARCHAR(255) NOT NULL UNIQUE,
  is_approved BOOLEAN DEFAULT FALSE,
  ha_speaker_entity VARCHAR(255),
  usb_device_path VARCHAR(255),
  last_seen TIMESTAMP,
  status VARCHAR(50) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Home Assistant configuration table
CREATE TABLE IF NOT EXISTS ha_config (
  id SERIAL PRIMARY KEY,
  ha_url VARCHAR(500) NOT NULL,
  ha_token TEXT NOT NULL,
  default_tts_service VARCHAR(255) DEFAULT 'tts.google_translate_say',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- TTS phrases table
CREATE TABLE IF NOT EXISTS tts_phrases (
  id SERIAL PRIMARY KEY,
  phrase_key VARCHAR(100) NOT NULL UNIQUE,
  template TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Insert default TTS phrases
INSERT INTO tts_phrases (phrase_key, template) VALUES
  ('success', '{{itemName}} added to the shopping list'),
  ('not_found', 'Unknown item, please add manually via the shopping list app'),
  ('error', 'Error processing barcode, please try again')
ON CONFLICT (phrase_key) DO NOTHING;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_devices_device_id ON devices(device_id);
CREATE INDEX IF NOT EXISTS idx_devices_auth_token ON devices(auth_token);
CREATE INDEX IF NOT EXISTS idx_devices_is_approved ON devices(is_approved);
CREATE INDEX IF NOT EXISTS idx_tts_phrases_key ON tts_phrases(phrase_key);
