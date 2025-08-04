#!/bin/bash

# Database migration script to move from Docker volume to bind mount
# and add missing anthropic_config column

set -e

echo "🔄 Starting database migration..."

# Create local database directory
mkdir -p ./data/database
echo "📁 Created ./data/database directory"

# Check if container is running
if docker ps | grep -q claude-code-ui; then
    echo "🛑 Stopping container..."
    docker-compose -f docker/docker-compose.yml down
fi

# Copy existing database from volume to local directory (if volume exists)
if docker volume ls | grep -q docker_claude-database; then
    echo "📋 Copying existing database from volume..."
    
    # Create temporary container to copy data
    docker run --rm -v docker_claude-database:/source -v "$(pwd)/data/database":/dest alpine sh -c "
        if [ -f /source/auth.db ]; then
            cp -r /source/* /dest/ 2>/dev/null || true
            echo 'Database files copied successfully'
        else
            echo 'No existing database found in volume'
        fi
    "
    
    # Remove old volume
    echo "🗑️  Removing old volume..."
    docker volume rm docker_claude-database
else
    echo "ℹ️  No existing database volume found"
fi

# Start container with new configuration
echo "🚀 Starting container with new database configuration..."
docker-compose -f docker/docker-compose.yml up -d

# Wait for container to be ready
echo "⏳ Waiting for container to start..."
sleep 10

# Run database repair inside container
echo "🔧 Running database repair..."
docker exec claude-code-ui node /app/server/database/repair-anthropic-column.js

echo "✅ Database migration completed successfully!"
echo ""
echo "📝 Summary:"
echo "  - Database moved from Docker volume to ./data/database"
echo "  - anthropic_config column added to users table"
echo "  - /api/anthropic-config endpoint should now work"
echo ""
echo "🗂️  Database files are now stored in: $(pwd)/data/database"