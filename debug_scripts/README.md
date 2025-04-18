
# I-GUIDE User Experience Backend

The backend for the next-gen I-GUIDE platform.

## Project Status
This project is currently under development.

## Repository Structure
- `backend_scripts`: Backend scripts
- `frontend-backend_connection`: Test scripts and webpages for demonstrating the usage of endpoints
- `opensearch_scripts`: Backup search scripts, schema, and insertion scripts for opensearch

## Installation
### Clone the repo from GitHub:
```bash
git clone https://github.com/I-GUIDE/iguide-ue-backend.git
```

### Config the environment variables
```bash
cd backend_scripts
```
make a ".env" file under the backen according to the ".env.example" file to fillin the information for the Opensearch, SSL certificate, and JWT secrets.

### Run the backend server:
```bash
node server_neo4j.js
```
Then the endpoints should be available at the port specified in .env.
