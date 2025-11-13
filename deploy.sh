#!/bin/bash

# Shopping List Production Deployment Script
# This script pulls the latest images and restarts the services

set -e

echo "🚀 Shopping List Deployment Script"
echo "===================================="
echo ""

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please copy .env.production.example to .env and configure it."
    exit 1
fi

# Load environment variables
source .env

echo "📦 Pulling latest Docker images..."
docker-compose -f docker-compose.prod.yml pull

echo ""
echo "🔄 Restarting services..."
docker-compose -f docker-compose.prod.yml up -d

echo ""
echo "⏳ Waiting for services to be healthy..."
sleep 10

echo ""
echo "📊 Service Status:"
docker-compose -f docker-compose.prod.yml ps

echo ""
echo "✅ Deployment complete!"
echo ""
echo "🌐 Access the application at: http://$(hostname -I | awk '{print $1}'):${APP_PORT:-3000}"
echo ""
echo "📝 View logs with:"
echo "   docker-compose -f docker-compose.prod.yml logs -f"
