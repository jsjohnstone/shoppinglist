#!/bin/sh

# Wait for PostgreSQL to be ready
echo "Waiting for PostgreSQL to be ready..."
while ! pg_isready -h localhost -p 5432 > /dev/null 2>&1; do
    sleep 1
done

echo "PostgreSQL is ready!"

# Create database if it doesn't exist
psql -U postgres -lqt | cut -d \| -f 1 | grep -qw shoppinglist
if [ $? -ne 0 ]; then
    echo "Creating database..."
    psql -U postgres -c "CREATE DATABASE shoppinglist;"
fi

# Run migrations
echo "Running database migrations..."
cd /app
npm run migrate

# Start the application
echo "Starting Node.js application..."
NODE_ENV=production node backend/server.js
