## I-GUIDE Platform Backend Server Scripts
This directory contains the backend scripts for the I-GUIDE platform.

## Deployment
### Install the dependencies:
```bash
npm i express multer cors dotenv '@opensearch-project/opensearch' node-fetch '@aws-sdk/client-s3' multer-s3 axios swagger-ui-express swagger-jsdoc neo4j-driver
```
### Update configurations:
 - `.env`
 - `neo4j.env`


### Start the development server:
```bash
sh run.sh
```
