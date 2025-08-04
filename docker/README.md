# Docker Deployment for Claude Code UI

This directory contains Docker configuration files for deploying Claude Code UI.

## Quick Start

1. **Copy environment file**:
   ```bash
   cp .env.docker .env
   ```

2. **Edit the .env file** with your configuration:
   - Set your GitHub OAuth credentials (if using GitHub auth)
   - Set your Anthropic API token
   - Adjust volume mount paths as needed

3. **Start the application**:
   ```bash
   docker-compose up -d
   ```

4. **Access the application**:
   - Open http://localhost:3008 in your browser

## Configuration


### Environment Variables

Key environment variables you should configure:

#### Required
- `ANTHROPIC_AUTH_TOKEN`: Your Anthropic API token
- `GITHUB_CLIENT_ID` & `GITHUB_CLIENT_SECRET`: For GitHub OAuth (if using)

#### Optional
- `PORT`: Server port (default: 3008)
- `PROJECTS_DIR`: Host path for project storage
- `BACKUP_DIR`: Host path for backup storage
- Email SMTP settings for notifications

### Volume Mounts

The docker-compose.yml mounts several directories:

- **Projects**: `./data/projects` → `/app/data/projects`
- **Backups**: `./data/backup` → `/app/data/backup`
- **Database**: `./data/database` → `/app/server/database`
- **Logs**: `./data/logs` → `/app/logs`

### Docker Commands

#### Build and Run
```bash
# Build and start in background
docker-compose up -d

# Build and start with logs
docker-compose up

# Rebuild if you made changes
docker-compose up --build
```

#### Management
```bash
# Stop the application
docker-compose down

# View logs
docker-compose logs -f

# Shell into container
docker-compose exec claude-code-ui sh

# Restart
docker-compose restart
```

#### Data Management
```bash
# Backup data directory
tar -czf backup-$(date +%Y%m%d).tar.gz data/

# Restore data
tar -xzf backup-YYYYMMDD.tar.gz
```

## Usage Modes

### 1. Web Server Mode (Default)
Runs the full web application with React frontend and Express backend.

```bash
docker-compose up -d
```

Access at: http://localhost:3008

### 2. Claude CLI Mode
Run interactive Claude CLI within the container:

```bash
docker run -it --rm \
  -e ANTHROPIC_AUTH_TOKEN=your_token \
  -v $(pwd)/data/projects:/app/data/projects \
  claude-code-ui claude
```

## File Structure

```
docker/
├── dockerfile              # Main Dockerfile
├── docker-compose.yml      # Docker Compose configuration
├── docker-entrypoint.sh    # Startup script
├── .env.docker            # Environment template
└── README.md              # This file
```

## Troubleshooting

### Common Issues

1. **Permission errors**: Ensure Docker has permission to access mounted directories
2. **Port conflicts**: Change PORT in .env if 3008 is in use
3. **Database issues**: Delete `data/database/` to reset the database

### Logs
Check logs for issues:
```bash
docker-compose logs claude-code-ui
```

### Health Check
The container includes a health check accessible at:
```
http://localhost:3008/health
```

## Security Notes

- Never commit your actual .env file with secrets
- Use strong, unique passwords for OAuth applications
- Consider using Docker secrets for sensitive data in production
- Regularly update the base images and dependencies