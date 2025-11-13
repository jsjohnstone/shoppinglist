import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql as dbSql, db } from './index.js';
import { categories } from './schema.js';
import fs from 'fs';
import path from 'path';

async function runMigration() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║           DATABASE MIGRATION STARTING                      ║');
  console.log('╚════════════════════════════════════════════════════════════╝');
  console.log('');
  
  try {
    // Check if migrations table exists
    console.log('📋 Checking migration status...');
    const migrationsTableExists = await checkMigrationsTable();
    
    if (!migrationsTableExists) {
      console.log('✨ First-time setup detected - creating migrations tracking table');
    }
    
    // List available migrations
    console.log('');
    console.log('📂 Available migrations in ./drizzle:');
    const availableMigrations = listAvailableMigrations();
    availableMigrations.forEach((migration, index) => {
      console.log(`   ${index + 1}. ${migration}`);
    });
    console.log('');
    
    // Get already applied migrations
    const appliedMigrations = await getAppliedMigrations();
    if (appliedMigrations.length > 0) {
      console.log('✅ Previously applied migrations:');
      appliedMigrations.forEach((migration, index) => {
        console.log(`   ${index + 1}. ${migration}`);
      });
    } else {
      console.log('📝 No migrations have been applied yet');
    }
    console.log('');
    
    // Determine which migrations will run
    const pendingMigrations = availableMigrations.filter(
      m => !appliedMigrations.includes(m)
    );
    
    if (pendingMigrations.length > 0) {
      console.log('🚀 Pending migrations to apply:');
      pendingMigrations.forEach((migration, index) => {
        console.log(`   ${index + 1}. ${migration}`);
      });
      console.log('');
      console.log('⏳ Applying migrations...');
    } else {
      console.log('✨ Database is up to date - no migrations to apply');
      console.log('');
    }
    
    // Run migrations
    await migrate(db, { 
      migrationsFolder: './drizzle',
      migrationsTable: '__drizzle_migrations'
    });
    
    if (pendingMigrations.length > 0) {
      console.log('');
      console.log('✅ Successfully applied migrations:');
      pendingMigrations.forEach((migration, index) => {
        console.log(`   ✓ ${migration}`);
      });
    }
    
    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('✅ All migrations completed successfully!');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');
    
    // Seed default categories
    console.log('🌱 Seeding default categories...');
    const defaultCategories = [
      { name: 'Fresh Food', sortOrder: 1 },
      { name: 'Vegetables', sortOrder: 2 },
      { name: 'Fruit', sortOrder: 3 },
      { name: 'Meat', sortOrder: 4 },
      { name: 'Dairy', sortOrder: 5 },
      { name: 'Frozen', sortOrder: 6 },
      { name: 'Bakery', sortOrder: 7 },
      { name: 'Pantry', sortOrder: 8 },
      { name: 'Snacks', sortOrder: 9 },
      { name: 'Beverages', sortOrder: 10 },
      { name: 'Household', sortOrder: 11 },
      { name: 'Personal Care', sortOrder: 12 },
    ];
    
    let categoriesAdded = 0;
    for (const category of defaultCategories) {
      try {
        const result = await db.insert(categories).values(category).onConflictDoNothing().returning();
        if (result.length > 0) {
          categoriesAdded++;
        }
      } catch (err) {
        // Category might already exist, continue
      }
    }
    
    if (categoriesAdded > 0) {
      console.log(`✅ Added ${categoriesAdded} default categories`);
    } else {
      console.log('✨ Default categories already exist');
    }
    console.log('');
    
  } catch (error) {
    console.log('');
    console.log('╔════════════════════════════════════════════════════════════╗');
    console.log('║                  MIGRATION FAILED                          ║');
    console.log('╚════════════════════════════════════════════════════════════╝');
    console.error('');
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('');
      console.error('Stack trace:');
      console.error(error.stack);
    }
    console.log('');
    process.exit(1);
  }
  
  // Close connection
  await dbSql.end();
  process.exit(0);
}

// Check if migrations table exists
async function checkMigrationsTable() {
  try {
    await db.execute(`SELECT 1 FROM __drizzle_migrations LIMIT 1`);
    return true;
  } catch (error) {
    return false;
  }
}

// List all available migration files
function listAvailableMigrations() {
  try {
    const migrationsDir = './drizzle';
    const files = fs.readdirSync(migrationsDir);
    return files
      .filter(f => f.endsWith('.sql'))
      .map(f => f.replace('.sql', ''))
      .sort();
  } catch (error) {
    console.error('Warning: Could not read migrations directory:', error.message);
    return [];
  }
}

// Get list of applied migrations
async function getAppliedMigrations() {
  try {
    const result = await db.execute(`
      SELECT hash FROM __drizzle_migrations ORDER BY created_at
    `);
    return result.rows.map(row => row.hash);
  } catch (error) {
    // Migrations table doesn't exist yet
    return [];
  }
}

runMigration();
