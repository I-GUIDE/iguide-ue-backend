# I-GUIDE Platform Backend
The backend middleware server for the next-gen I-GUIDE platform. The middleware serves as a bridge between `React.js` frontend and data layer consisting of `neo4j` and `OpenSearch`. `neo4j` provides consistent and reliable data storage for the system along with providing graph based data manipulation capabilities. On the other hand `OpenSearch` replicates searchable data from the data store and provides robust and scalable search functionalities including keyword search, llm search etc.

## Getting Started
### Clone the repo from GitHub:
```bash
git clone https://github.com/I-GUIDE/iguide-ue-backend.git
```
### Install the dependencies:
If `package.json` is available 
```bash
npm install 
```
Otherwise
```bash
npm i express multer cors dotenv '@opensearch-project/opensearch' node-fetch '@aws-sdk/client-s3' multer-s3 axios swagger-ui-express swagger-jsdoc neo4j-driver compromise bad-words sharp
```
### Update configurations:
Create `.env` file with configuration options for OpenSearch, SSL certificates, JWT secrets, neo4j etc. (NOTE: `.env.example` is provided for reference)


### Start the development server:
```bash
sh start.sh
```
The server logs will be written to `server.log`. If restarted, the logs are rolled over with timestamp (e.g. `server-2024-09-12T20:01:19.log`) with latest server logs always written to `server.log`.

Swagger UI for endpoints will be accessible at `${HOST}:${PORT}/api-docs` as specified in the `.env` file.

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


### Creating a new Element Type
  - Update element definition in `utils.js`
    - Add new element type to the `ElementType` enum
    - Update `parseElementType()` function to handle new element type
  - Update element registration
    - `server.js`: Update endpoint `router.post(/api/elements, ...)` if some pre-processing is required
    - `backend_neo4j.js`
      - Update `elementToNode()` to convert javascript element to neo4j node
      - Update `registerElement()` if some post-processing is reuiqred
   - Update element retrieval
     - `backend_neo4j.js`: Update `getElementByID()` to make sure all element information is returned
### Creating a new endpoint
ToDo ...