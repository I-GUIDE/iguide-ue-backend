#!/bin/bash

### GraphDB #######

LOCAL_DATA_PATH="/Users/fbaig/Google Drive/Other computers/My MacBook Pro/docker_shared/uiuc_pd/iguide_data_catalog/data"
LOCAL_IMPORT_PATH="/Users/fbaig/Google Drive/Other computers/My MacBook Pro/docker_shared/uiuc_pd/iguide_data_catalog/data"
LOCAL_CONF_PATH="/Users/fbaig/Google Drive/Other computers/My MacBook Pro/docker_shared/uiuc_pd/iguide_data_catalog/conf"

# http://localhost:7474/
docker run \
    --restart always \
    --publish=7474:7474 --publish=7687:7687 \
    --env NEO4J_AUTH=neo4j/neo4j-24 \
    --volume="$LOCAL_DATA_PATH":/data \
    --volume="$LOCAL_IMPORT_PATH":/var/lib/neo4j/import \
    --volume="$LOCAL_CONF_PATH":/var/lib/neo4j/conf \
    -e NEO4J_apoc_export_file_enabled=true \
    -e NEO4J_apoc_import_file_enabled=true \
    -e NEO4J_apoc_import_file_use__neo4j__config=true \
    -e NEO4J_PLUGINS=\[\"apoc\",\"apoc-extended\"\] \
    neo4j:5.20.0
