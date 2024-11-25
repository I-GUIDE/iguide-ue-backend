#!/bin/bash
export COMPOSE_PROJECT_NAME=iguide-ux
docker-compose --env-file config.env up -d

# source config.env
# # stop setup
# docker-compose down
