# Graph Database - Neo4j 
This directory contains scripts, settings and initial data to setup graph database (neo4j) backend for the I-GUIDE UX

## Getting Started
1. `cd docker && sh docker_run.sh`
2. neo4j dashboard shoud be accessible at `http://localhost:7474/`
3. Copy commands from `scripts/batch_insert_csv.cypher` to dashboard console to insert data
4. Copy commands from `scripts/relations.cypher` (one by one) to dashboard console to create connections


## Work in Progress
- [ ] Connect neo4j to OpenSearch
  - LogStash: Create `logstash` pipeline to copy data from neo4j to OpenSearch
  - Triggers: Push data to OpenSearch whenever data is inserted into neo4j
    - Issue: Error connecting to `https` OpenSearch backend

## Directory Structure
- `data`: Contains initial data to populate the database.
- `docker`: Docker scripts to setup and launch a `neo4j` container. Please make sure to modify following in `docker_run.sh`
  - `LOCAL_DATA_PATH`: To persist database upon restarts
  - `LOCAL_IMPORT_PATH`: Should point to `data` directory containing initial data to batch load into the database
  - `LOCAL_CONF_PATH`: To modify neo4j configurations

- `scripts`
  - `batch_insert_csv.cypher`: To load data into database. Can be copied directly to neo4j web console
  - `insert.cypher`: Individual queries corresponding to various tasks
  - `relations.cypher`: To create relations among data inserted