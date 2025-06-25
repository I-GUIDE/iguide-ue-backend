# I-GUIDE Platform Backend Automated Testing
Contains all the artifacts required to test backend server functionalities.

## How to run?
- These tests can be run on either of the following
  1. A local docker container e.g. `docker run -it node:lts-alpine3.20 /bin/sh`
  2. As CI/CD pipeline using GitHub Action

- In either of the two cases, set the environment variable required for decrypting the configuration file

- Run `sh test-entrypoint.sh`

## Directory Structure
- `dev/`: Complete test cases for backend components along with sample test data
- `secrets/`: Secrets required for the backend server to work. 
  - Include `localhost` certificates to test `SSL`.
  - Encrypted environment file with configuration parameters. Note that the test configuration always connects to `dev` data stores i.e. `neo4j`, `opensearch` and `minio`.
- `test-entrypoint.sh`: Script to initiate automated tests