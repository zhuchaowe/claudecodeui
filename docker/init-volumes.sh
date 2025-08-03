#!/bin/bash
# Initialize volume directories with correct permissions

# Create directories if they don't exist
mkdir -p docker/data/projects
mkdir -p docker/data/backup
mkdir -p docker/data/database
mkdir -p docker/data/logs

# Set permissions to allow node user (UID 1000) to write
chmod -R 777 docker/data

echo "Volume directories initialized with correct permissions"