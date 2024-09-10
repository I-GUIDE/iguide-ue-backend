#!/bin/bash

if [ ! -f "backend_neo4j.cjs" ]; then
    ln backend_neo4j.js backend_neo4j.cjs
fi
#mv backend_neo4j.js backend_neo4j.cjs

LOG_FILE_NAME=server-$(date +"%Y-%m-%dT%H:%M:%S").log
node server_neo4j.js >> $LOG_FILE_NAME &
BACKGROUND_PID=$!
echo "BACKGROUND PID: ${BACKGROUND_PID}" >> $LOG_FILE_NAME

