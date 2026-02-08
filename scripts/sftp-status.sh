#!/bin/bash

# SFTP Server Status Check
# Shows connection status, user directories, and file counts

set -e

SFTP_HOST="localhost"
SFTP_PORT="2222"

echo "======================================"
echo "SFTP Server Status"
echo "======================================"
echo ""

# Check if SFTP container is running
CONTAINER_ID=$(docker compose -f validation/docker-compose.yml ps -q sftp-server 2>/dev/null)

if [ -z "$CONTAINER_ID" ]; then
    echo "Status: NOT RUNNING"
    echo ""
    echo "Start with:"
    echo "  npm run sftp:up"
    exit 1
fi

CONTAINER_STATE=$(docker inspect --format='{{.State.Status}}' "$CONTAINER_ID" 2>/dev/null)
echo "Container: $CONTAINER_STATE"
echo "Port:      $SFTP_HOST:$SFTP_PORT"
echo ""

if [ "$CONTAINER_STATE" != "running" ]; then
    echo "Container is not running. Start with: npm run sftp:up"
    exit 1
fi

# Check SSH connectivity
if command -v sftp &> /dev/null; then
    echo "--- Connection Test ---"
    # Use sshpass if available, otherwise just check port
    if command -v sshpass &> /dev/null; then
        if sshpass -p "javapass" sftp -o StrictHostKeyChecking=no -o ConnectTimeout=5 -P "$SFTP_PORT" "javauser@$SFTP_HOST" <<< "bye" &>/dev/null; then
            echo "javauser: Connected OK"
        else
            echo "javauser: Connection FAILED"
        fi
        if sshpass -p "nodepass" sftp -o StrictHostKeyChecking=no -o ConnectTimeout=5 -P "$SFTP_PORT" "nodeuser@$SFTP_HOST" <<< "bye" &>/dev/null; then
            echo "nodeuser: Connected OK"
        else
            echo "nodeuser: Connection FAILED"
        fi
    else
        # Fall back to port check
        if nc -z "$SFTP_HOST" "$SFTP_PORT" 2>/dev/null; then
            echo "Port $SFTP_PORT: OPEN (install sshpass for full auth test)"
        else
            echo "Port $SFTP_PORT: CLOSED"
        fi
    fi
    echo ""
fi

# List directory contents inside the container
echo "--- User Directories ---"
for USER in javauser nodeuser; do
    echo ""
    echo "$USER:"
    for DIR in input output; do
        COUNT=$(docker exec "$CONTAINER_ID" sh -c "ls -1 /home/$USER/$DIR 2>/dev/null | wc -l" 2>/dev/null || echo "?")
        echo "  /home/$USER/$DIR: $COUNT file(s)"
    done
done

echo ""
echo "--- Docker Logs (last 5 lines) ---"
docker compose -f validation/docker-compose.yml logs --tail=5 sftp-server 2>/dev/null || true
echo ""
