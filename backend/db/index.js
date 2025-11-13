import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema.js';

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/shoppinglist';

// Create postgres client
export const sql = postgres(connectionString);

// Create drizzle db instance
export const db = drizzle(sql, { schema });
