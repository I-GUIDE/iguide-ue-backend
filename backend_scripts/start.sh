#!/bin/bash

# if [ -f "backend_neo4j.cjs" ]; then
#     rm backend_neo4j.cjs
# fi
# ln backend_neo4j.js backend_neo4j.cjs

ROLLOVER_LOG_FILE_NAME=server-$(date +"%Y-%m-%dT%H:%M:%S").log
if [ -f "server.log" ]; then
    sh stop.sh
    mv server.log $ROLLOVER_LOG_FILE_NAME
    echo "Server log rolled over to $ROLLOVER_LOG_FILE_NAME"
fi

LOG_FILE_NAME=server.log
echo "Starting server ..."
node server_neo4j.js >> $LOG_FILE_NAME &
BACKGROUND_PID=$!
echo "BACKGROUND PID: ${BACKGROUND_PID}" >> $LOG_FILE_NAME
echo "Server started with PID: $BACKGROUND_PID"
