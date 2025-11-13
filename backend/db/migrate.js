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
    
    // Run migrations with better error handling
    try {
      await migrate(db, { 
        migrationsFolder: './drizzle',
        migrationsTable: '__drizzle_migrations'
      });
      
      if (pendingMigrations.length > 0) {
        console.log('');
        console.log('✅ Migrations processing completed');
        console.log('');
        console.log('🔍 Verifying migrations were applied...');
        
        // Verify critical tables exist
        const tablesToCheck = ['users', 'categories', 'items', 'devices', 'device_events', 'settings'];
        const missingTables = [];
        
        for (const table of tablesToCheck) {
          try {
            await db.execute(`SELECT 1 FROM ${table} LIMIT 1`);
            console.log(`   ✓ Table '${table}' exists`);
          } catch (error) {
            missingTables.push(table);
            console.log(`   ✗ Table '${table}' is MISSING`);
          }
        }
        
        if (missingTables.length > 0) {
          console.log('');
          console.log('⚠️  WARNING: Some tables are missing after migration!');
          console.log('   Missing tables:', missingTables.join(', '));
          console.log('');
          console.log('   This usually means:');
          console.log('   1. Migration files are malformed');
          console.log('   2. Database user lacks permissions');
          console.log('   3. Migration tracking is out of sync');
          console.log('');
          console.log('   Attempting recovery by running SQL directly...');
          
          // Try to apply missing migrations directly
          await applyMissingMigrations(pendingMigrations);
        } else {
          console.log('');
          console.log('✅ All expected tables verified successfully');
        }
      }
    } catch (migrationError) {
      console.error('');
      console.error('Migration execution error:', migrationError);
      throw migrationError;
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

// Apply migrations directly from SQL files (recovery mechanism)
async function applyMissingMigrations(migrationNames) {
  const path = await import('path');
  
  for (const migrationName of migrationNames) {
    try {
      const migrationPath = `./drizzle/${migrationName}.sql`;
      const sql = fs.readFileSync(migrationPath, 'utf8');
      
      console.log(`   📝 Applying ${migrationName} directly...`);
      
      // Split by statement and execute
      const statements = sql
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));
      
      for (const statement of statements) {
        try {
          await db.execute(statement);
        } catch (err) {
          // Log but continue - some statements might be idempotent
          if (!err.message.includes('already exists')) {
            console.log(`      ⚠️  Statement warning: ${err.message}`);
          }
        }
      }
      
      console.log(`   ✓ ${migrationName} applied`);
    } catch (error) {
      console.error(`   ✗ Failed to apply ${migrationName}:`, error.message);
    }
  }
  
  console.log('');
  console.log('🔍 Re-verifying tables after direct application...');
  
  const tablesToCheck = ['users', 'categories', 'items', 'devices', 'device_events', 'settings'];
  let allTablesExist = true;
  
  for (const table of tablesToCheck) {
    try {
      await db.execute(`SELECT 1 FROM ${table} LIMIT 1`);
      console.log(`   ✓ Table '${table}' now exists`);
    } catch (error) {
      console.log(`   ✗ Table '${table}' still missing`);
      allTablesExist = false;
    }
  }
  
  if (!allTablesExist) {
    console.log('');
    console.log('❌ CRITICAL: Unable to create all required tables');
    console.log('   Please check database permissions and migration files');
    throw new Error('Migration recovery failed');
  }
}

runMigration();
