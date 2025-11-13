import { pgTable, serial, varchar, text, integer, boolean, timestamp, uuid, json } from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  username: varchar('username', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  key: varchar('key', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }),
  createdAt: timestamp('created_at').defaultNow(),
});

export const categories = pgTable('categories', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow(),
});

export const items = pgTable('items', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  quantity: varchar('quantity', { length: 100 }),
  notes: text('notes'),
  relatedTo: varchar('related_to', { length: 255 }),
  categoryId: integer('category_id').references(() => categories.id),
  isCompleted: boolean('is_completed').default(false),
  isProcessing: boolean('is_processing').default(false),
  completedAt: timestamp('completed_at'),
  sortOrder: integer('sort_order').default(0),
  addedBy: integer('added_by').references(() => users.id),
  barcode: varchar('barcode', { length: 255 }),
  wasScanned: boolean('was_scanned').default(false),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

export const barcodes = pgTable('barcodes', {
  id: serial('id').primaryKey(),
  barcode: varchar('barcode', { length: 255 }).notNull().unique(),
  fullProductName: varchar('full_product_name', { length: 500 }),
  genericName: varchar('generic_name', { length: 255 }).notNull(),
  categoryId: integer('category_id').references(() => categories.id),
  lastUsed: timestamp('last_used').defaultNow(),
  source: varchar('source', { length: 50 }),
});

export const pendingBarcodes = pgTable('pending_barcodes', {
  id: serial('id').primaryKey(),
  barcode: varchar('barcode', { length: 255 }).notNull(),
  rawData: text('raw_data'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Phase 3: Device Management
export const devices = pgTable('devices', {
  id: serial('id').primaryKey(),
  deviceId: varchar('device_id', { length: 255 }).notNull().unique(),
  friendlyName: varchar('friendly_name', { length: 255 }),
  deviceType: varchar('device_type', { length: 50 }).default('barcode_scanner'),
  authToken: varchar('auth_token', { length: 255 }).notNull().unique(),
  isApproved: boolean('is_approved').default(false),
  haSpeakerEntity: varchar('ha_speaker_entity', { length: 255 }),
  usbDevicePath: varchar('usb_device_path', { length: 255 }),
  lastSeen: timestamp('last_seen'),
  status: varchar('status', { length: 50 }).default('pending'),
  createdAt: timestamp('created_at').defaultNow(),
});

// Device Events
export const deviceEvents = pgTable('device_events', {
  id: serial('id').primaryKey(),
  deviceId: integer('device_id').references(() => devices.id, { onDelete: 'cascade' }).notNull(),
  eventType: varchar('event_type', { length: 50 }).notNull(),
  message: text('message').notNull(),
  metadata: json('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// Phase 3: Home Assistant Configuration
export const haConfig = pgTable('ha_config', {
  id: serial('id').primaryKey(),
  haUrl: varchar('ha_url', { length: 500 }).notNull(),
  haToken: text('ha_token').notNull(),
  defaultTtsService: varchar('default_tts_service', { length: 255 }).default('tts.google_translate_say'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
});

// Phase 3: TTS Phrases
export const ttsPhrases = pgTable('tts_phrases', {
  id: serial('id').primaryKey(),
  phraseKey: varchar('phrase_key', { length: 100 }).notNull().unique(),
  template: text('template').notNull(),
  createdAt: timestamp('created_at').defaultNow(),
});

// Application Settings
export const settings = pgTable('settings', {
  id: serial('id').primaryKey(),
  key: varchar('key', { length: 255 }).notNull().unique(),
  value: text('value'),
  updatedAt: timestamp('updated_at').defaultNow(),
});
