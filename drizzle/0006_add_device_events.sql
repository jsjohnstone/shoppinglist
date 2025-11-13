-- Create device_events table
CREATE TABLE IF NOT EXISTS "device_events" (
  "id" serial PRIMARY KEY NOT NULL,
  "device_id" integer NOT NULL,
  "event_type" varchar(50) NOT NULL,
  "message" text NOT NULL,
  "metadata" json,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "device_events_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "devices"("id") ON DELETE cascade
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS "idx_device_events_device_id" ON "device_events"("device_id");
CREATE INDEX IF NOT EXISTS "idx_device_events_created_at" ON "device_events"("created_at" DESC);
