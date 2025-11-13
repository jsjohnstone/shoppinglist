#!/bin/sh

# Initialize PostgreSQL if not already initialized
if [ ! -f /var/lib/postgresql/data/PG_VERSION ]; then
    echo "Initializing PostgreSQL database..."
    su-exec postgres initdb -D /var/lib/postgresql/data
fi

# Start PostgreSQL
echo "Starting PostgreSQL..."
su-exec postgres postgres -D /var/lib/postgresql/data -c listen_addresses='*'
