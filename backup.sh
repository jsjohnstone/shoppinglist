#!/bin/bash

# Shopping List Database Backup Script
# Creates timestamped backups of the PostgreSQL database

set -e

echo "💾 Shopping List Database Backup"
echo "================================="
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    exit 1
fi

# Load environment variables
source .env

# Create backups directory if it doesn't exist
mkdir -p ./backups

# Generate timestamp
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="./backups/shoppinglist_backup_${TIMESTAMP}.sql"

echo "📦 Creating backup: ${BACKUP_FILE}"

# Execute pg_dump inside the postgres container
docker exec shoppinglist-postgres pg_dump \
    -U ${POSTGRES_USER:-postgres} \
    -d ${POSTGRES_DB:-shoppinglist} \
    > "${BACKUP_FILE}"

# Compress the backup
echo "🗜️  Compressing backup..."
gzip "${BACKUP_FILE}"

echo ""
echo "✅ Backup complete: ${BACKUP_FILE}.gz"
echo ""
echo "💡 To restore this backup:"
echo "   gunzip ${BACKUP_FILE}.gz"
echo "   docker exec -i shoppinglist-postgres psql -U ${POSTGRES_USER:-postgres} -d ${POSTGRES_DB:-shoppinglist} < ${BACKUP_FILE}"
echo ""

# Optional: Keep only last 7 backups
BACKUP_COUNT=$(ls -1 ./backups/shoppinglist_backup_*.sql.gz 2>/dev/null | wc -l)
if [ $BACKUP_COUNT -gt 7 ]; then
    echo "🧹 Cleaning up old backups (keeping last 7)..."
    ls -1t ./backups/shoppinglist_backup_*.sql.gz | tail -n +8 | xargs rm -f
    echo "✅ Cleanup complete"
fi
