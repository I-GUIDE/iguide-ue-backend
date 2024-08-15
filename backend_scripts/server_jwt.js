import express from 'express';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import { Client } from '@opensearch-project/opensearch';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import fetch from 'node-fetch';
import { S3Client } from '@aws-sdk/client-s3';
import multerS3 from 'multer-s3';
import https from 'https';
import http from 'http';
import axios from 'axios';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';

const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());
dotenv.config();

const os_node = process.env.OPENSEARCH_NODE;
const os_usr = process.env.OPENSEARCH_USERNAME;
const os_pswd = process.env.OPENSEARCH_PASSWORD;

const options = {
  key: fs.readFileSync(process.env.SSL_KEY),
  cert: fs.readFileSync(process.env.SSL_CERT)
};

const client = new Client({
  node: os_node, // OpenSearch endpoint
  auth: {
    username: os_usr,
    password: os_pswd,
  },
  ssl: {
    rejectUnauthorized: false, // Use this only if you encounter SSL certificate issues
  },
});

// Middleware to verify JWT token
const authenticateJWT = (req, res, next) => {
  const token = req.cookies.jwt;

  if (token) {
    jwt.verify(token, process.env.JWT_ACCESS_TOKEN_SECRET, (err, user) => {
      if (err) {
        return res.sendStatus(403);
      }

      req.user = user;
      next();
    });
  } else {
    res.sendStatus(401);
  }
};

// Middleware to check if the user has the required role
const authorizeRole = (role) => (req, res, next) => {
  if (req.user && req.user.role === role) {
    next();
  } else {
    res.status(403).json({ message: 'Forbidden' });
  }
};

// Toy endpoint that requires JWT authentication
app.get('/api/toy-auth', authenticateJWT, (req, res) => {
  res.json({ message: 'You are authenticated!', user: req.user });
});

// Toy endpoint that requires admin role
app.get('/api/toy-admin', authenticateJWT, authorizeRole('admin'), (req, res) => {
  res.json({ message: 'You are an admin!', user: req.user });
});

// Store refresh token in OpenSearch
const storeRefreshToken = async (token, user_id) => {
  await client.index({
    index: 'refresh_tokens',
    body: {
      token,
      user_id,
      created_at: new Date()
    }
  });
};

// Endpoint to refresh token
app.post('/api/refresh-token', async (req, res) => {
  const refreshToken = req.cookies.refreshToken;

  if (!refreshToken) {
    return res.sendStatus(401);
  }

  // Verify the refresh token exists in OpenSearch
  const { body } = await client.search({
    index: 'refresh_tokens',
    body: {
      query: {
        term: { token: refreshToken }
      }
    }
  });

  if (body.hits.total.value === 0) {
    return res.sendStatus(403);
  }

  jwt.verify(refreshToken, process.env.JWT_REFRESH_TOKEN_SECRET, (err, user) => {
    if (err) {
      return res.sendStatus(403);
    }

    const newAccessToken = generateAccessToken({ id: user.id, role: user.role });
    res.cookie('jwt', newAccessToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });

    res.json({ accessToken: newAccessToken });
  });
});

// Other existing routes and logic...

const PORT = 4001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

https.createServer(options, app).listen(4000, () => {
  console.log('Server is running on https://backend.i-guide.io:4000');
});

