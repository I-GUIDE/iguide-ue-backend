#!/bin/bash

exe=`exec 2>/dev/null; readlink "/proc/$$/exe"`
case "$exe" in
*/busybox)
    echo "It's a busybox shell (Local environment)";
    line=$(ps -a | grep 'node server_neo4j.js')
    set -- junk $line
    shift
    PID=$1
    echo "Stopping running server with PID: $PID"
    kill -9 $PID
    exit 0
esac

echo "Not busybox shell";
line=$(ps -aux | grep 'node server_neo4j.js')
set -- junk $line
shift
PID=$1
echo "Stopping running server with PID: $PID"
kill -9 $PID

# Deprecated: Used when PID was written to logfile
# # Stop any instance of existing server
# line=$(head -n 1 server.log)
# PID=$(echo $(head -n 1 server.log) | cut -d ":" -f 2)

# echo "Stopping running server with PID: $PID"
# kill -9 $PID
