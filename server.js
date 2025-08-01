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
import * as utils from './utils/utils.js';
import * as n4j from './backend_neo4j.js';
import * as os from './backend_opensearch.js';
import { jwtCORSOptions, jwtCorsOptions, jwtCorsMiddleware } from './iguide_cors.js';
import { authenticateJWT, authorizeRole, generateAccessToken } from './utils/jwtUtils.js';
// local imports for endpoints
//import llm_routes from './routes/llm_with_filter_routes.js';
//import llm_routes from './routes/llm_routes.js';
import pipeline_routes from './routes/pipeline_routes.js';
import llm_spatial_only_routes from './routes/llm_spatial_only_routes.js';
import anvil_proxy from './routes/anvil_proxy.js';
import search_routes from './routes/search_routes.js';
import spatial_routes from './routes/spatial_search_routes.js';
import private_elements from './routes/private_elements.js';
import users from './routes/users.js';
import documentation from './routes/documentation.js';
import elements from './routes/elements.js';
import {
	generateOptimizedDomainList,
} from "./utils/domain_utils.js";
import path from "path";

const app = express();

app.use(express.json());
app.use(cookieParser());
dotenv.config();

// Use the LLM-based conversational search route
//app.use('/beta', llm_routes);
app.use('/beta', pipeline_routes);
app.use('/beta', llm_spatial_only_routes);
app.use('/proxy', anvil_proxy);
// Use the advanced search route
app.use('/api', search_routes);
// Use the spatial search route
app.use('/api', spatial_routes);
// Use the private-elements route
app.use('/api', private_elements);
// Use documentation route
app.use('/api', documentation);
// Use users/contributors route
app.use(users);
// Use elements route
app.use(elements);

const target_domain = process.env.JWT_TARGET_DOMAIN;
// To make sure the path found through env is absolute when running the code
const keyPath = path.resolve(process.env.SSL_KEY)
const certPath = path.resolve(process.env.SSL_CERT)

const SSLOptions = {
	key: fs.readFileSync(keyPath),
	cert: fs.readFileSync(certPath)
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

	jwt.verify(refreshToken, process.env.JWT_REFRESH_TOKEN_SECRET, async (err, user) => {
		if (err) {
			console.log(`Error processing refreshToken ${refreshToken}`)
			return res.sendStatus(403);
		}
		// Generate a new access token with the role in the database
		try {
			const response = await n4j.getContributorByID(user.id);
			if (response.size == 0){
				return res.status(404).json({ message: 'User not found' });
			}
			const newAccessToken = generateAccessToken({ id: user.id, role: response['role'] });
			res.cookie(process.env.JWT_ACCESS_TOKEN_NAME, newAccessToken, { httpOnly: true, secure: process.env.SERV_TAG === 'production' , sameSite: 'Strict', domain: target_domain, path: '/'});
			// res.json({ accessToken: newAccessToken });
			res.json({id: user.id, role: response['role']});
			} catch (error) {
				console.error('Error fetching user:', error);
				res.status(500).json({ message: 'Error fetching the user' });
			}

		//const newAccessToken = generateAccessToken({ id: user.id, role: user.role });
		// updated to new variable name
		//res.cookie(process.env.JWT_ACCESS_TOKEN_NAME, newAccessToken, { httpOnly: true, secure: process.env.SERV_TAG === 'production' , sameSite: 'Strict', domain: target_domain, path: '/'});
		//res.json({ accessToken: newAccessToken });
	});
});


app.options('/api/check-tokens', jwtCorsMiddleware);
app.get('/api/check-tokens', jwtCorsMiddleware, authenticateJWT, async (req, res) => {
	try {
		res.json({
			id: req.user.id,
			role: req.user.role
		});
	} catch (error) {
		console.error("Error performing check user: ", error)
		res.status(500).json({message: 'Error checking user details'});
	}
});

/****************************************************************************
 * General Helper Functions
 ****************************************************************************/

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
 * Importing Domain List
 ****************************************************************************/
console.log("Importing domain list from JSON into Object...");
generateOptimizedDomainList();
console.log("Domain list import complete!");

/****************************************************************************
 * Misc. Endpoints
 ****************************************************************************/

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
/**
 * Changes to handle JEST Testing module this if statement will run only when running the server
 * and not run when jest is operating to avoid dual execution of the same and stop the process form JEST side
 */
if (import.meta.url === `file://${process.argv[1]}`) {
	app.listen(HTTP_PORT, () => {
		console.log(`HTTP server is running on port ${HTTP_PORT}`);
	});
}

/**
 * Changes to handle JEST Testing module this if statement will run only when running the server
 * and not run when jest is operating to avoid dual execution of the same and stop the process form JEST side
 */
if (import.meta.url === `file://${process.argv[1]}`) {
	https.createServer(SSLOptions, app).listen(process.env.PORT, () => {
		console.log(`HTTPS server is running on port ${process.env.PORT}`);
	});
}

// Serve Swagger docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));
console.log(`Swagger UI started at http://${process.env.DOMAIN}:${HTTP_PORT}/api-docs`);
/**
 * Exporting the default app to be imported for Testing
 */
export default app;