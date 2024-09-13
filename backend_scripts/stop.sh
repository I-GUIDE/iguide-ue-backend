#!/bin/bash

# Stop any instance of existing server
line=$(head -n 1 server.log)
PID=$(echo $(head -n 1 server.log) | cut -d ":" -f 2)

echo "Stopping running server with PID: $PID"
kill -9 $PID
