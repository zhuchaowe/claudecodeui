#!/bin/bash

# Define color codes
YELLOW='\033[1;33m'
BLUE='\033[1;34m'
GREEN='\033[1;32m'
RED='\033[1;31m'
NC='\033[0m' # No Color

# Set default environment variables
export PROJECTS_DIR=${PROJECTS_DIR:-/app/data/projects}
export BACKUP_DIR=${BACKUP_DIR:-/app/data/backup}
export PORT=${UI_PORT:-3009}

# Create necessary directories if they don't exist
mkdir -p "$PROJECTS_DIR" "$BACKUP_DIR" /app/logs /app/server/database

# Copy SQL schema files if they don't exist (when volume is mounted empty)
if [ ! -f /app/server/database/init.sql ] && [ -d /app/database-schema ]; then
    echo "Copying database schema files..."
    cp /app/database-schema/*.sql /app/server/database/
fi

# Copy db.js if it doesn't exist
if [ ! -f /app/server/database/db.js ] && [ -f /app/database-schema/db.js ]; then
    echo "Copying database module..."
    cp /app/database-schema/db.js /app/server/database/
fi

# Initialize database if needed
if [ ! -f /app/server/database/auth.db ]; then
    echo "Initializing database..."
    cd /app && node --input-type=module -e "
        import('./server/database/db.js').then(async (module) => {
            try {
                await module.initializeDatabase();
                console.log('Database initialized successfully');
            } catch (err) {
                console.error('Database initialization failed:', err);
                process.exit(1);
            }
        }).catch(err => {
            console.error('Database initialization failed:', err);
            process.exit(1);
        });
    "
fi

# Start claude-code-proxy if OPENAI_API_KEY is set
if [ -n "$OPENAI_API_KEY" ]; then
    echo -e "${YELLOW}Starting claude-code-proxy...${NC}"
    echo -e "${BLUE}Using OpenAI API base: ${OPENAI_BASE_URL:-https://api.openai.com/v1}${NC}"
    echo -e "${BLUE}Big model: ${BIG_MODEL:-gpt-4}${NC}"
    echo -e "${BLUE}Small model: ${SMALL_MODEL:-gpt-3.5-turbo}${NC}"
    
    # Create proxy .env file with environment variables
    cat > /opt/claude-code-proxy/.env << EOF
OPENAI_API_KEY="${OPENAI_API_KEY}"
OPENAI_BASE_URL="${OPENAI_BASE_URL:-https://api.openai.com/v1}"
BIG_MODEL="${BIG_MODEL:-gpt-4}"
SMALL_MODEL="${SMALL_MODEL:-gpt-3.5-turbo}"
EOF
    
    # Start proxy in background
    cd /opt/claude-code-proxy && python3 start_proxy.py &
    PROXY_PID=$!
    echo -e "${GREEN}Claude-code-proxy started with PID: $PROXY_PID${NC}"
    
    # Wait a moment for proxy to start
    sleep 2
    
    # Set Anthropic environment variables to use the proxy
    export ANTHROPIC_BASE_URL="http://localhost:8082"
    export ANTHROPIC_AUTH_TOKEN="${ANTHROPIC_AUTH_TOKEN:-some-api-key}"
    echo -e "${GREEN}Anthropic API redirected to proxy${NC}"
else
    echo -e "${YELLOW}OPENAI_API_KEY not set, claude-code-proxy will not be started${NC}"
fi

# Function to check if running server mode
is_server_mode() {
    [[ "$1" == "npm" && "$2" == "run" && "$3" == "server" ]] || \
    [[ "$1" == "node" && "$2" == "server/index.js" ]] || \
    [[ "$1" == "server" ]]
}

# Check if we're starting the server
if is_server_mode "$@"; then
    echo -e "${GREEN}==================================================${NC}"
    echo -e "${GREEN}Starting Claude Code UI Server${NC}"
    echo -e "${GREEN}正在启动 Claude Code UI 服务器${NC}"
    echo -e "${GREEN}==================================================${NC}"
    echo ""
    echo -e "${BLUE}Server will be available at:${NC}"
    echo -e "${BLUE}服务器将在以下地址可用：${NC}"
    echo -e "${YELLOW}http://localhost:${PORT}${NC}"
    echo ""
    echo -e "${BLUE}Environment:${NC}"
    echo -e "${BLUE}- Projects Directory: ${PROJECTS_DIR}${NC}"
    echo -e "${BLUE}- Backup Directory: ${BACKUP_DIR}${NC}"
    echo -e "${BLUE}- Port: ${PORT}${NC}"
    echo ""
    
    # Change to app directory and start server
    cd /app
    exec npm run server
else
    # Claude CLI mode - check for token
    if [ -z "$ANTHROPIC_AUTH_TOKEN" ]; then
        clear
        echo -e "${YELLOW}==================================================${NC}"
        echo -e "${YELLOW}ANTHROPIC_AUTH_TOKEN not set. Please enter your API token:${NC}"
        echo -e "${YELLOW}ANTHROPIC_AUTH_TOKEN 未设置。请输入您的 API 密钥：${NC}"
        echo ""
        
        # Function to display with flashing URL
        display_with_flash() {
            while true; do
                for color in "$RED" "$YELLOW" "$GREEN" "$BLUE"; do
                    tput cup 4 0
                    echo -e "${BLUE}You can create an API Key at: ${color}https://console.anthropic.com/${NC}\033[K"
                    echo -e "${BLUE}您可以在 Anthropic 控制台创建 API 密钥：${color}https://console.anthropic.com/${NC}\033[K"
                    tput cup 8 0
                    sleep 0.3
                done
            done
        }
        
        # Display initial content with infinite flashing
        display_with_flash &
        FLASH_PID=$!
        
        echo -e "${YELLOW}==================================================${NC}"
        echo ""
        echo -ne "${GREEN}API Token/API 密钥【粘贴后直接按回车Enter】: ${NC}"
        
        # Read input
        read -s ANTHROPIC_AUTH_TOKEN
        
        # Stop flashing if still running
        kill $FLASH_PID 2>/dev/null
        wait $FLASH_PID 2>/dev/null
        
        export ANTHROPIC_AUTH_TOKEN
        echo ""
        echo ""
        
        # Show asterisks based on token length
        if [ -n "$ANTHROPIC_AUTH_TOKEN" ]; then
            TOKEN_LENGTH=${#ANTHROPIC_AUTH_TOKEN}
            echo -n "Token received: "
            printf '*%.0s' $(seq 1 $TOKEN_LENGTH)
            echo ""
            echo ""
            echo "Token set successfully. / 密钥设置成功。"
            echo ""
            
            # Confirmation step with 10-second timeout
            CONFIRM=""
            for i in 10 9 8 7 6 5 4 3 2 1; do
                echo -ne "\r${GREEN}Continue? / 是否继续? [Y/n] (auto-confirm in / 自动确认倒计时: $i): ${NC}"
                read -t 1 -r CONFIRM
                if [ $? -eq 0 ]; then  # User pressed something
                    break
                fi
            done
            echo ""
            
            # Default to Y if empty (just Enter pressed), timeout, or user enters yes formats
            # Only reject if user explicitly enters n/N/no/No
            if [[ -z "$CONFIRM" || "$CONFIRM" =~ ^[Yy]([Ee][Ss])?$ ]]; then
                echo "Starting Claude Code... / 正在启动 Claude Code..."
                echo ""
                
                # Show instructions instead of countdown
                echo ""
                echo -e "${YELLOW}==================================================${NC}"
                echo -e "${GREEN}Container is ready! / 容器已就绪！${NC}"
                echo ""
                echo -e "${BLUE}To start Claude Code, run: / 启动 Claude Code，请运行：${NC}"
                echo -e "${YELLOW}claude${NC}"
                echo -e "${YELLOW}==================================================${NC}"
                echo ""
            else
                echo "Exiting. / 退出。"
                exit 0
            fi
        else
            echo "No token entered. / 未输入密钥。"
            exit 1
        fi
    fi
    
    # Execute the command passed to the container
    exec "$@"
fi
