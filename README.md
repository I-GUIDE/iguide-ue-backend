
# I-GUIDE User Experience Backend

The backend for the next-gen I-GUIDE platform.

## Project Status
This project is currently under development.

## Installation
### Clone the repo from GitHub:
```bash
git clone https://github.com/I-GUIDE/iguide-ue-backend .git
```

### Config the environment variables
```bash
cd backend_scripts
```
make a ".env" file under the backen according to the ".env.example" file to fillin the information for the Opensearch, SSL certificate, and JWT secrets.

### Run the backend server:
```bash
node server.js
```
Then the endpoints should be available at port 5000
