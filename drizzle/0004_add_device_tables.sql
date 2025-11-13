-- Phase 3: Raspberry Pi Barcode Scanner System

-- Devices table
CREATE TABLE IF NOT EXISTS "devices" (
	"id" serial PRIMARY KEY NOT NULL,
	"device_id" varchar(255) NOT NULL,
	"friendly_name" varchar(255),
	"device_type" varchar(50) DEFAULT 'barcode_scanner',
	"auth_token" varchar(255) NOT NULL,
	"is_approved" boolean DEFAULT false,
	"ha_speaker_entity" varchar(255),
	"usb_device_path" varchar(255),
	"last_seen" timestamp,
	"status" varchar(50) DEFAULT 'pending',
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "devices_device_id_unique" UNIQUE("device_id"),
	CONSTRAINT "devices_auth_token_unique" UNIQUE("auth_token")
);
--> statement-breakpoint
-- Home Assistant configuration table
CREATE TABLE IF NOT EXISTS "ha_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"ha_url" varchar(500) NOT NULL,
	"ha_token" text NOT NULL,
	"default_tts_service" varchar(255) DEFAULT 'tts.google_translate_say',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
-- TTS phrases table
CREATE TABLE IF NOT EXISTS "tts_phrases" (
	"id" serial PRIMARY KEY NOT NULL,
	"phrase_key" varchar(100) NOT NULL,
	"template" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "tts_phrases_phrase_key_unique" UNIQUE("phrase_key")
);
--> statement-breakpoint
-- Insert default TTS phrases
INSERT INTO "tts_phrases" ("phrase_key", "template") VALUES
	('success', '{{itemName}} added to the shopping list'),
	('not_found', 'Unknown item, please add manually via the shopping list app'),
	('error', 'Error processing barcode, please try again')
ON CONFLICT ("phrase_key") DO NOTHING;
--> statement-breakpoint
-- Create indexes for performance
CREATE INDEX IF NOT EXISTS "idx_devices_device_id" ON "devices"("device_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_devices_auth_token" ON "devices"("auth_token");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_devices_is_approved" ON "devices"("is_approved");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_tts_phrases_key" ON "tts_phrases"("phrase_key");
