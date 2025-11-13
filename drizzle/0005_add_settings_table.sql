-- Settings table for application configuration
CREATE TABLE IF NOT EXISTS "settings" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar(255) NOT NULL,
	"value" text,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "settings_key_unique" UNIQUE("key")
);
--> statement-breakpoint

-- Insert Ollama settings with defaults
INSERT INTO "settings" ("key", "value") VALUES
	('ollama_enabled', 'false'),
	('ollama_url', 'http://192.168.5.109:11434'),
	('ollama_model', 'llama3.2')
ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint

-- Migrate Home Assistant settings from ha_config table if it exists
-- This will run but won't fail if ha_config doesn't exist
DO $$
DECLARE
    ha_record RECORD;
BEGIN
    -- Check if ha_config table exists and has data
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'ha_config') THEN
        SELECT ha_url, ha_token, default_tts_service INTO ha_record FROM ha_config LIMIT 1;
        
        IF FOUND THEN
            -- Insert HA settings into settings table
            INSERT INTO settings (key, value) VALUES
                ('ha_url', ha_record.ha_url),
                ('ha_token', ha_record.ha_token),
                ('ha_tts_service', COALESCE(ha_record.default_tts_service, 'tts.google_translate_say'))
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
        END IF;
    END IF;
END $$;
--> statement-breakpoint

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS "idx_settings_key" ON "settings"("key");
