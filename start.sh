#!/bin/bash

ROLLOVER_LOG_FILE_NAME=server-$(date +"%Y-%m-%dT%H:%M:%S").log
if [ -f "server.log" ]; then
    sh stop.sh
    mv server.log $ROLLOVER_LOG_FILE_NAME
    echo "Server log rolled over to $ROLLOVER_LOG_FILE_NAME"
fi

LOG_FILE_NAME=server.log
echo "Starting server ..."
#node server_neo4j.js >> $LOG_FILE_NAME &
node server.js > $LOG_FILE_NAME 2>&1 &
BACKGROUND_PID=$!
#(echo "BACKGROUND PID: ${BACKGROUND_PID}" > /dev/stdout) > $LOG_FILE_NAME 2>&1
echo "Server started with PID: $BACKGROUND_PID"
