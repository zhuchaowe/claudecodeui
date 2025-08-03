#!/bin/sh
# Wrapper script for claude command in Docker container
exec /usr/local/bin/node /usr/local/lib/node_modules/@anthropic-ai/claude-code/cli.js "$@"