#!/bin/bash

# Setup script for claudecode-dev.gbase.ai domain

echo "Setting up domain claudecode-dev.gbase.ai..."

# Check if running with sudo
if [ "$EUID" -ne 0 ]; then 
    echo "Please run this script with sudo"
    exit 1
fi

# Copy nginx configuration
echo "1. Setting up Nginx configuration..."
cp /home/claude/claudecodeui/nginx-claudecode-dev-http.conf /etc/nginx/sites-available/claudecode-dev.gbase.ai

# Enable the site
ln -sf /etc/nginx/sites-available/claudecode-dev.gbase.ai /etc/nginx/sites-enabled/

# Test nginx configuration
echo "2. Testing Nginx configuration..."
nginx -t

if [ $? -eq 0 ]; then
    echo "3. Reloading Nginx..."
    systemctl reload nginx
    echo "✓ Nginx configuration successful"
else
    echo "✗ Nginx configuration failed. Please check the configuration."
    exit 1
fi

echo ""
echo "Basic setup complete! Next steps:"
echo "1. Update /home/claude/claudecodeui/.env with your configuration:"
echo "   - Set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET"
echo "   - Set FRONTEND_URL=https://claudecode-dev.gbase.ai"
echo ""
echo "2. Update your GitHub OAuth App settings:"
echo "   - Homepage URL: https://claudecode-dev.gbase.ai"
echo "   - Callback URL: https://claudecode-dev.gbase.ai/api/github/callback"
echo ""
echo "3. Start the application:"
echo "   cd /home/claude/claudecodeui"
echo "   npm install"
echo "   npm start"
echo ""
echo "4. For SSL setup, run:"
echo "   sudo certbot --nginx -d claudecode-dev.gbase.ai"
echo ""
echo "Check the setup-domain.md file for detailed instructions."