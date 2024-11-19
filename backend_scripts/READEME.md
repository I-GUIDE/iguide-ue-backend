## I-GUIDE Platform Backend Server
This directory contains the backend scripts for the I-GUIDE platform.

## Getting Started
### Install the dependencies:
```bash
npm i express multer cors dotenv '@opensearch-project/opensearch' node-fetch '@aws-sdk/client-s3' multer-s3 axios swagger-ui-express swagger-jsdoc neo4j-driver compromise bad-words sharp
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
## How To Contribute
### Naming Conventions
  - Function Names: lowerCamelCase e.g. `function lowerCamelCase(){}`
  - Class Names: UowerCamelCase e.g. `class UpperCamelCase`
  - Variable Name: lower_snake_case e.g. `let snake_case = 0;`
  - Constant Name: UPPERCASE e.g. `const UPPERCASE = 10;`
### Code Structure
| File  	 | Description  |
|:----------|:----------|
| `server_neo4j.js`    | Main entry point to the middleware server    |
| `backend_neo4j.js`   | All functionalities to access and work with `neo4j` database    |
| `backend_opensearch.js`   | All functionalities to access and work with `opensearch` backend    |
| `iguide_cors.js`     | Common CORS policy configurations used by the server components |
| `utils.js`     | System `Enum`s + General utility functions |
| `routes/users.js`    | All `/api/users*` endpoint implementations    |
| `routes/elements.js`    | All `/api/elements*` endpoint implementations    |
| `routes/documentation.js`| All `/api/document*` endpoint implementations    |
| `routes/private_elements.js`| All `/api/private-elements*` endpoint implementations    |


### Creating a new endpoint
ToDo ...