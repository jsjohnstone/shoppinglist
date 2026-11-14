-- Store API keys as SHA-256 hashes instead of plaintext.
--
-- Existing keys keep working: each one is replaced by its hash, and the
-- server now hashes the key a client presents before looking it up.
-- This is one-way. After it runs the original keys cannot be read back.
--
-- Safe to run more than once, and on an empty table.

ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "key_hash" varchar(64);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD COLUMN IF NOT EXISTS "key_last_four" varchar(4);
--> statement-breakpoint

DO $$
BEGIN
    -- The plaintext column only exists until this migration has run once
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'api_keys'
          AND column_name = 'key'
    ) THEN
        UPDATE "api_keys"
        SET "key_hash" = encode(sha256(convert_to("key", 'UTF8')), 'hex'),
            "key_last_four" = right("key", 4)
        WHERE "key_hash" IS NULL;

        ALTER TABLE "api_keys" DROP COLUMN "key";
    END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "api_keys" ALTER COLUMN "key_hash" SET NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "api_keys_key_hash_unique" ON "api_keys" ("key_hash");
