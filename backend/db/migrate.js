import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { sql as dbSql, db } from './index.js';
import { categories } from './schema.js';

async function runMigration() {
  console.log('Running migrations...');
  
  try {
    // Run migrations
    await migrate(db, { migrationsFolder: './drizzle' });
    
    console.log('Migrations completed successfully!');
    
    // Seed default categories
    console.log('Seeding default categories...');
    const defaultCategories = [
      { name: 'Vegetables', sortOrder: 1 },
      { name: 'Fruit', sortOrder: 2 },
      { name: 'Meat', sortOrder: 3 },
      { name: 'Dairy', sortOrder: 4 },
      { name: 'Bakery', sortOrder: 5 },
      { name: 'Pantry Aisles', sortOrder: 6 },
      { name: 'Household', sortOrder: 7 },
    ];
    
    for (const category of defaultCategories) {
      try {
        await db.insert(categories).values(category).onConflictDoNothing();
      } catch (err) {
        // Category might already exist, continue
      }
    }
    
    console.log('Default categories seeded!');
    
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
  
  // Close connection
  await dbSql.end();
  process.exit(0);
}

runMigration();
