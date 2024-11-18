#!/bin/bash

exe=`exec 2>/dev/null; readlink "/proc/$$/exe"`
case "$exe" in
*/busybox)
    line=$(ps -a | grep 'node server_neo4j.js')
    set -- junk $line
    shift
    PID=$1
    echo "Stopping running server (BusyBox Shell) with PID: $PID"
    kill -9 $PID
    exit 0
esac

line=$(ps -aux | grep 'node server_neo4j.js')
set -- junk $line
shift
PID=$2
# re='^[0-9]+$'
# if ! [[ $PID =~ $re ]] ; then
#    PID=$2
# fi
echo "Stopping running server with PID: $PID"
kill -9 $PID

# Deprecated: Used when PID was written to logfile
# # Stop any instance of existing server
# line=$(head -n 1 server.log)
# PID=$(echo $(head -n 1 server.log) | cut -d ":" -f 2)

# echo "Stopping running server with PID: $PID"
# kill -9 $PID
