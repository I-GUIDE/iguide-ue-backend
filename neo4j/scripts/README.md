# Graph Database - Neo4j 
This directory contains scripts to transfer data from OpenSearch to Neo4j

## Getting Started
1. Set appropriate configuration variables in `.env` (Rename `.env.example`)
    - OpenSearch
        - `OPENSEARCH_NODE`
        - `OPENSEARCH_USERNAME`
        - `OPENSEARCH_PASSWORD`
        - `OPENSEARCH_INDEX`
        - [Optional] `SSL_CERT=/usr/src/app/certs/fullchain.pem`
        - [Optional] `SSL_KEY=/usr/src/app/certs/privkey.pem`
    - Neo4j
        - `NEO4J_CONNECTION_STRING`
		- `NEO4J_USER`
		- `NEO4J_PASSWORD`
		- `NEO4J_DB`
2. Install dependencies
    - `npm i node-fetch dotenv fs uuid neo4j-driver`
3. Run code
    - `node server_os2_neo4j.test.js`

## Directory Structure
- `cql`: Sample queries for Cypher Query Language to work with `neo4j`