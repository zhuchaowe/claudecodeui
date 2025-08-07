# Database Migration Guide

## Problem
The `/api/anthropic-config` endpoint fails with error: `no such column: anthropic_config`

## Root Cause
The Docker volume `claude-database` contains an old database schema without the `anthropic_config` column. When the container starts, it uses the old database from the volume instead of running new migrations.

## Solution
We've changed the database storage from a Docker volume to a bind mount to allow schema updates.

## Migration Steps

### Option 1: Automatic Migration (Recommended)
Run the migration script:
```bash
./migrate-database.sh
```

This script will:
1. Stop the container
2. Copy existing database from volume to local directory
3. Remove the old volume
4. Start container with new configuration
5. Add the missing `anthropic_config` column

### Option 2: Manual Migration
If you prefer manual steps:

1. **Stop the container:**
   ```bash
   docker-compose -f docker/docker-compose.yml down
   ```

2. **Create local database directory:**
   ```bash
   mkdir -p ./data/database
   ```

3. **Copy existing database (if needed):**
   ```bash
   docker run --rm -v docker_claude-database:/source -v "$(pwd)/data/database":/dest alpine cp -r /source/* /dest/
   ```

4. **Remove old volume:**
   ```bash
   docker volume rm docker_claude-database
   ```

5. **Start container:**
   ```bash
   docker-compose -f docker/docker-compose.yml up -d
   ```

6. **Add missing column:**
   ```bash
   docker exec claude-code-ui node /app/server/database/repair-anthropic-column.js
   ```

### Option 3: Fresh Start (Data Loss)
If you don't need to preserve existing data:
```bash
docker-compose -f docker/docker-compose.yml down
docker volume rm docker_claude-database
docker-compose -f docker/docker-compose.yml up -d
```

## Changes Made

### docker-compose.yml
- Changed database volume from named volume to bind mount
- Database files now stored in `./data/database`
- Removed `claude-database` from volumes section

### Database Schema
- Added `anthropic_config TEXT` column to users table
- Updated `init.sql` to include the column for new installations
- Improved migration logic with better error handling

### New Files
- `repair-anthropic-column.js` - Script to add missing column
- `migrate-anthropic.sql` - SQL migration file
- `migrate-database.sh` - Automated migration script

## Verification
After migration, the `/api/anthropic-config` endpoint should work:
- GET `/api/anthropic-config` - Returns user's Anthropic configuration
- POST `/api/anthropic-config` - Saves user's Anthropic configuration

## Benefits of New Approach
1. **Schema Updates**: Database schema can be updated without data loss
2. **Development**: Easier to debug and modify database structure
3. **Backup**: Database files are easily accessible in `./data/database`
4. **Migration**: Future schema changes can be applied more easily