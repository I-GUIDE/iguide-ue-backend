#!/bin/bash

# (0) Run tests in a docker container
#docker run -it node:lts-alpine3.20 /bin/sh

# (0.1) Install minica (to generate local certificates for SSL)
#docker run -it golang:1.24-alpine /bin/sh
#go install github.com/jsha/minica@latest
#minica --domains '*.local.iguide.io'
# Copy _.local.iguide.io/

##################
# Following commands should be executed inside test container
##################
# (1) Install git, gpg
apk --no-cache add git gpg gpg-agent

# (0.2) Encrypt secrets file and put it in tests/secrets/ directory
#gpg --symmetric --cipher-algo AES256 secrets_file.ext


# (2) Clone repo and install required packages
git clone -b dev-candidate --single-branch https://github.com/I-GUIDE/iguide-ue-backend.git
cd iguide-ue-backend/ && npm install

# WARN!!!
# (3) Set environment variables for configuration (Replace with Github secrets for GitHub Actions)
cd tests/secrets/ && sh decrypt.sh && cd -

# (4) Run tests
npm run test:dev
