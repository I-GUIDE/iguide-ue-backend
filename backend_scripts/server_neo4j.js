import express from 'express';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
// import { Client } from '@opensearch-project/opensearch';
// import path from 'path';
import fs from 'fs';
// import { exec } from 'child_process';
// import fetch from 'node-fetch';
import { S3Client } from '@aws-sdk/client-s3';
import multerS3 from 'multer-s3';
import https from 'https';
import http from 'http';
import axios from 'axios';
import swaggerUi from'swagger-ui-express';
import { specs } from './swagger.js';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
// local imports
import * as utils from './utils.js';
import * as n4j from './backend_neo4j.js';
import * as os from './backend_opensearch.js';
import { jwtCORSOptions, jwtCorsOptions, jwtCorsMiddleware } from './iguide_cors.js';
import { authenticateJWT, authorizeRole, generateAccessToken } from './jwtUtils.js';
// local imports for endpoints
//import llm_routes from './routes/llm_with_filter_routes.js';
import llm_routes from './routes/llm_routes.js';
import llm_spatial_only_routes from './routes/llm_spatial_only_routes.js';
import anvil_proxy from './routes/anvil_proxy.js';
import search_routes from './routes/search_routes.js';
import private_elements from './routes/private_elements.js';
import users from './routes/users.js';
import documentation from './routes/documentation.js';
import elements from './routes/elements.js';

const app = express();

app.use(express.json());
app.use(cookieParser());
dotenv.config();

// Use the LLM-based conversational search route
app.use('/beta', llm_routes);
app.use('/beta', llm_spatial_only_routes);
app.use('/proxy', anvil_proxy);
// Use the advanced search route
app.use('/api', search_routes);
// Use the private-elements route
app.use('/api', private_elements);
// Use documentation route
app.use('/api', documentation);
// Use users/contributors route
app.use(users);
// Use elements route
app.use(elements);

const target_domain = process.env.JWT_TARGET_DOMAIN;
const SSLOptions = {
    key: fs.readFileSync(process.env.SSL_KEY),
    cert: fs.readFileSync(process.env.SSL_CERT)
};
/****************************************************************************
 * JWT Specific Functions
 ****************************************************************************/

/**
 * @swagger
 * /api/refresh-token:
 *   post:
 *     summary: Refresh Access Token
 *     tags: ['jwt']
 *     description: Refreshes the access token using the refresh token stored in cookies.
 *     responses:
 *       200:
 *         description: Successfully refreshed access token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 accessToken:
 *                   type: string
 *                   description: The new access token
 *             examples:
 *               success:
 *                 summary: Successful refresh
 *                 value: { "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." }
 *         headers:
 *           Set-Cookie:
 *             description: A new JWT access token set in the cookie
 *             schema:
 *               type: string
 *       401:
 *         description: Unauthorized - Refresh token missing
 *       403:
 *         description: Forbidden - Refresh token invalid or expired
 *     security:
 *       - cookieAuth: []
 */
app.options('/api/refresh-token', jwtCorsMiddleware);
app.post('/api/refresh-token', jwtCorsMiddleware, async (req, res) => {
	// updated refresh token to use env variable
    const refreshToken = req.cookies[process.env.JWT_REFRESH_TOKEN_NAME];
    //console.log("Refresh token", refreshToken);
    if (!refreshToken) {
	return res.sendStatus(401);
    }

    // Verify the refresh token exists in OpenSearch
    const { body } = await os.client.search({
	index: 'refresh_tokens',
	body: {
	    query: {
		term: { token: refreshToken }
	    }
	}
    });

    if (body.hits.total.value === 0) {
	console.log(`Token not found in database for ${refreshToken}`)
	return res.sendStatus(403);
    }

    jwt.verify(refreshToken, process.env.JWT_REFRESH_TOKEN_SECRET, (err, user) => {
	if (err) {
	    console.log(`Error processing refreshToken ${refreshToken}`)
	    return res.sendStatus(403);
	}


	const newAccessToken = generateAccessToken({ id: user.id, role: user.role });
	 // updated to new variable name
	res.cookie(process.env.JWT_ACCESS_TOKEN_NAME, newAccessToken, { httpOnly: true, secure: process.env.SERV_TAG === 'production' , sameSite: 'Strict', domain: target_domain, path: '/'});
	res.json({ accessToken: newAccessToken });
    });
});


app.options('/api/check-tokens', jwtCorsMiddleware);
app.get('/api/check-tokens', jwtCorsMiddleware, authenticateJWT, async (req, res) => {res.json(req.user.role);});

/****************************************************************************
 * General Helper Functions
 ****************************************************************************/

const s3Client = new S3Client({
    region: process.env.AWS_REGION,
    credentials: {
	accessKeyId: process.env.AWS_ACCESS_KEY_ID,
	secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
});

const upload = multer({
    storage: multerS3({
	s3: s3Client,
	bucket: process.env.AWS_BUCKET_NAME,
	acl: 'public-read',
	key: function (req, file, cb) {
	    cb(null, file.originalname);
	}
    }),
    fileFilter: function (req, file, cb) {
	const ext = path.extname(file.originalname).toLowerCase();
	if (ext !== '.csv' && ext !== '.zip') {
	    return cb(null, false, new Error('Only .csv and .zip files are allowed!'));
	}
	const allowedMimeTypes = ['text/csv', 'application/zip', 'application/x-zip-compressed'];
	if (!allowedMimeTypes.includes(file.mimetype)) {
	    return cb(null, false, new Error('Invalid file type, only CSV and ZIP files are allowed!'));
	}
	cb(null, true);
    }
});

// Error handling middleware
app.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
	// A Multer error occurred when uploading.
	return res.status(400).json({ message: err.message });
    } else if (err) {
	// An unknown error occurred.
	return res.status(400).json({ message: err.message });
    }

    // Forward to next middleware if no errors
    next();
});

/****************************************************************************
 * Misc. Endpoints
 ****************************************************************************/

/**
 * @swagger
 * /api/elements/datasets:
 *   post:
 *     summary: Upload a dataset (CSV or ZIP)
 *     tags: ['elements', 'datasets']
 *     consumes:
 *       - multipart/form-data
 *     parameters:
 *       - in: formData
 *         name: file
 *         type: file
 *         description: The dataset file to upload
 *     responses:
 *       200:
 *         description: Dataset uploaded successfully
 *       400:
 *         description: No file uploaded or invalid file type (.csv or .zip)
 */
app.options('/api/elements/datasets', jwtCorsMiddleware);
app.post('/api/elements/datasets', jwtCorsMiddleware, authenticateJWT, upload.single('file'), (req, res) => {
    // [Done] Neo4j not required
    if (!req.file) {
	return res.status(400).json({
	    message: 'No file uploaded or invalid file type (.csv or .zip)!'
	});
    }
    res.json({
	message: 'Dataset uploaded successfully',
	url: req.file.location,
	bucket: process.env.AWS_BUCKET_NAME,
	key: req.file.key,
    });
});

/**
 * @swagger
 * /api/url-title:
 *   get:
 *     summary: Retrieve the title of a URL
 *     parameters:
 *       - in: query
 *         name: url
 *         required: true
 *         schema:
 *           type: string
 *         description: The URL to retrieve the title from
 *     responses:
 *       200:
 *         description: The title of the URL
 *       404:
 *         description: Title not found
 *       500:
 *         description: Failed to retrieve title
 */
app.options('/api/url-title', cors());
app.get('/api/url-title', cors(), async (req, res) => {
    // [Done] Neo4j not required
    const url = req.query.url;
    try {
	const response = await axios.get(url);
	const matches = response.data.match(/<title>(.*?)<\/title>/);
	if (matches) {
	    res.json({ title: matches[1] });
	} else {
	    res.status(404).json({ error: 'Title not found' });
	}
    } catch (error) {
	console.log(error);
	res.status(500).json({ error: 'Failed to retrieve title' });
    }
});

/****************************************************************************/
console.log(`${process.env.SERV_TAG} server is up`);

const HTTP_PORT = parseInt(process.env.PORT, 10)+1; //3501;
app.listen(HTTP_PORT, () => {
    console.log(`HTTP server is running on port ${HTTP_PORT}`);
});

https.createServer(SSLOptions, app).listen(process.env.PORT, () => {
    console.log(`HTTPS server is running on port ${process.env.PORT}`);
});

// Serve Swagger docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));
console.log(`Swagger UI started at http://${process.env.DOMAIN}:${HTTP_PORT}/api-docs`);
