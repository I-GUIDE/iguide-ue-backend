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
sh start.sh
```
The server logs will be written to `server.log`. If restarted, the logs are rolled over with timestamp (e.g. `server-2024-09-12T20:01:19.log`) with latest server logs always written to `server.log`.

Running server can be stopped by 
```bash
sh stop.sh
```