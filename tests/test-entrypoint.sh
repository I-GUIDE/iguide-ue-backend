#!/bin/bash

# (0) Run tests in a docker environment
#docker run -it node:lts-alpine3.20 /bin/sh

# (0.1) Install minica (to generate local certificates for SSL)
#docker run -it golang:1.24-alpine /bin/sh
## Inside Docker
#go install github.com/jsha/minica@latest
#minica --domains '*.local.iguide.io'
# Copy _.local.iguide.io/

# (0.2) Install git, gpg
apk --no-cache add git gpg


# (1) Clone repo and install required packages
git clone -b dev-candidate --single-branch https://github.com/I-GUIDE/iguide-ue-backend.git
cd iguide-ue-backend/ && npm install

# WARN!!!
# (2) Set environment variables for configuration (Replace with Github secrets for GitHub Actions)
cd tests/secrets/ && sh decrypt.sh && cd -

# (2) Run tests
npm run test:dev
