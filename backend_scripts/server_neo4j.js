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
import swaggerUi from'swagger-ui-express';
import { specs } from './swagger.js';
import jwt from 'jsonwebtoken';
import cookieParser from 'cookie-parser';
import * as n4j from './backend_neo4j.cjs'
import llm_routes from './routes/llm_routes.js';
import llm_spatial_only_routes from './routes/llm_spatial_only_routes.js';
import anvil_proxy from './routes/anvil_proxy.js';
import search_routes from './routes/search_routes.js';

import { authenticateJWT, authorizeRole, generateAccessToken } from './jwtUtils.js';

const app = express();
//app.use(cors());
const jwtCORSOptions = { credentials: true, origin: `${process.env.FRONTEND_DOMAIN}` }

const jwtCorsOptions = {
    origin: `${process.env.FRONTEND_DOMAIN}`,
    methods: 'GET, POST, PUT, DELETE, OPTIONS',
    allowedHeaders: 'Origin, X-Requested-With, Content-Type, Accept, Authorization'
};

const jwtCorsMiddleware = (req, res, next) => {
    res.header('Access-Control-Allow-Credentials', true);
    res.header('Access-Control-Allow-Origin', jwtCorsOptions.origin);
    res.header('Access-Control-Allow-Methods', jwtCorsOptions.methods);
    res.header('Access-Control-Allow-Headers', jwtCorsOptions.allowedHeaders);

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    next();
};

app.use(express.json());
app.use(cookieParser());
dotenv.config();

// Use the LLM-based conversational search route
app.use('/beta', llm_routes);
app.use('/beta', llm_spatial_only_routes);
app.use('/proxy', anvil_proxy);
// Use the advanced search route
app.use('/api', search_routes);

const os_node = process.env.OPENSEARCH_NODE;
const os_usr = process.env.OPENSEARCH_USERNAME;
const os_pswd = process.env.OPENSEARCH_PASSWORD;
const os_index = process.env.OPENSEARCH_INDEX; //'neo4j-elements-dev';
const target_domain = process.env.JWT_TARGET_DOMAIN;

const SSLOptions = {
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

console.log('Connectd to OpenSearch: ' + os_node);
console.log('\t- Using OpenSearch User: ' + os_usr);
console.log('\t- Using OpenSearch Index: ' + os_index);

// Ensure thumbnails and notebook_html directories exist
const thumbnailDir = path.join(process.env.UPLOAD_FOLDER, 'thumbnails');
const notebookHtmlDir = path.join(process.env.UPLOAD_FOLDER, 'notebook_html');
const avatarDir = path.join(process.env.UPLOAD_FOLDER, 'avatars');
fs.mkdirSync(thumbnailDir, { recursive: true });
fs.mkdirSync(notebookHtmlDir, { recursive: true });

// Serve static files from the thumbnails directory
app.use('/user-uploads/thumbnails', express.static(thumbnailDir));
app.use('/user-uploads/notebook_html', express.static(notebookHtmlDir));
app.use('/user-uploads/avatars', express.static(avatarDir));

// Configure storage for thumbnails
const thumbnailStorage = multer.diskStorage({
    destination: (req, file, cb) => {
	cb(null, thumbnailDir);
    },
    filename: (req, file, cb) => {
	// It's a good practice to sanitize the original file name
	const sanitizedFilename = file.originalname.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
	cb(null, `${Date.now()}-${sanitizedFilename}`);
    }
});
const uploadThumbnail = multer({ storage: thumbnailStorage });

// Configure storage for avatars
const avatarStorage = multer.diskStorage({
    destination: (req, file, cb) => {
	cb(null, avatarDir);
    },
    filename: (req, file, cb) => {
	// It's a good practice to sanitize the original file name
	const sanitizedFilename = file.originalname.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
	cb(null, `${Date.now()}-${sanitizedFilename}`);
    }
});
const uploadAvatar = multer({ storage: avatarStorage });

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
    const refreshToken = req.cookies.refreshToken;
    //console.log("Refresh token", refreshToken);
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
	res.cookie('jwt', newAccessToken, { httpOnly: true, secure: process.env.SERV_TAG === 'production' , sameSite: 'Strict', domain: target_domain, path: '/'});

	res.json({ accessToken: newAccessToken });
    });
});


app.options('/api/check-tokens', jwtCorsMiddleware);
app.get('/api/check-tokens', jwtCorsMiddleware, authenticateJWT, async (req, res) => {res.json(req.user.role);});

/****************************************************************************
 * General Helper Functions
 ****************************************************************************/

// Function to convert notebook to HTML

async function fetchNotebookContent(url) {
    // [Done] Neo4j not required
    const response = await fetch(url);
    if (response.ok) {
	return await response.text();
    }
    throw Error('Failed to fetch the notebook');
}
async function convertNotebookToHtml(githubRepo, notebookPath, outputDir) {
    // [Done] Neo4j not required
    const notebookName = path.basename(notebookPath, '.ipynb');
    const timestamp = Date.now();
    const htmlOutputPath = path.join(outputDir, `${timestamp}-${notebookName}.html`);
    const branches = ['main', 'master'];

    let notebookContent;

    for (const branch of branches) {
	try {
	    const notebookUrl = `${githubRepo}/raw/${branch}/${notebookPath}`;
	    notebookContent = await fetchNotebookContent(notebookUrl);
	    break;
	} catch (error) {
	    console.log(`Failed to fetch from ${branch} branch. Trying next branch...`);
	}
    }

    if (!notebookContent) {
	console.log('Failed to fetch the notebook from both main and master branches');
	return null;
    }

    const notebookFilePath = path.join(outputDir, `${timestamp}-${notebookName}.ipynb`);
    fs.writeFileSync(notebookFilePath, notebookContent);

    try {
	await new Promise((resolve, reject) => {
	    exec(`jupyter nbconvert --to html "${notebookFilePath}" --output "${htmlOutputPath}"`,
		 (error, stdout, stderr) => {
		     if (error) {
			 reject(`Error converting notebook: ${stderr}`);
		     } else {
			 resolve();
		     }
		 });
	});
	return htmlOutputPath;
    } catch (error) {
	console.log(error);
	return null;
    }
}

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


/****************************************************************************
 * Elements Endpoints
 ****************************************************************************/

/**
 * @swagger
 * /api/elements/titles:
 *   get:
 *     summary: Fetch all titles of a given type of elements
 *     tags: ['elements']
 *     parameters:
 *       - in: query
 *         name: element-type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [dataset, notebook, publication, oer, map]
 *         description: The type of element to fetch titles for
 *     responses:
 *       200:
 *         description: A list of titles
 *       400:
 *         description: element_type query parameter is required
 *       500:
 *         description: Internal server error
 */
app.options('/api/elements/titles', cors());
app.get('/api/elements/titles', cors(), async (req, res) => {
    // [Done] Neo4j not required. For related elements when registering. Should be from OS
    const elementType = req.query['element-type'];
    const scrollTimeout = '1m'; // Scroll timeout

    if (!elementType) {
	res.status(400).json({ message: 'element_type query parameter is required' });
	return;
    }

    try {
	// Initial search request with scrolling
	const initialSearchResponse = await client.search({
	    index: os_index,
	    scroll: scrollTimeout,
	    body: {
		size: 100, // Number of results to fetch per scroll request
		query: {
		    term: {
			'resource-type': elementType,
		    },
		},
		_source: ['title'], // Only fetch the title field
	    },
	});

	let scrollId = initialSearchResponse.body._scroll_id;
	let allTitles = initialSearchResponse.body.hits.hits.map(hit => hit._source.title);

	// Function to handle scrolling
	const fetchAllTitles = async (scrollId) => {
	    while (true) {
		const scrollResponse = await client.scroll({
		    scroll_id: scrollId,
		    scroll: scrollTimeout,
		});

		const hits = scrollResponse.body.hits.hits;
		if (hits.length === 0) {
		    break; // Exit loop when no more results are returned
		}

		allTitles = allTitles.concat(hits.map(hit => hit._source.title));
		scrollId = scrollResponse.body._scroll_id; // Update scrollId for the next scroll request
	    }
	    return allTitles;
	};

	const titles = await fetchAllTitles(scrollId);

	res.json(titles);
    } catch (error) {
	console.error('Error querying OpenSearch:', error);
	res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/elements/homepage:
 *   get:
 *     summary: Fetch elements to show on homepage (featured etc.)
 *     tags: ['elements']
 *     parameters:
 *       - in: query
 *         name: element-type
 *         required: true
 *         schema:
 *           type: string
 *           enum: [dataset, notebook, publication, oer, map]
 *         description: Type of featured elements to get
  *       - in: query
 *         name: limit
 *         required: true
 *         schema:
 *           type: integer
 *         description: Maximum number of featured elements
 *     responses:
 *       200:
 *         description: A list of featured resources
 *       404:
 *         description: No featured resource found
 *       500:
 *         description: Internal server error
 */
app.options('/api/elements/homepage', cors());
app.get('/api/elements/homepage', cors(), async (req, res) => {
    let { 'element-type': element_type,
	  'limit': limit} = req.query;
    // [Done] Neo4j
    try {
	const resources = await n4j.getFeaturedElementsByType(element_type, limit);
	      //await n4j.getFeaturedElements();
	res.json(resources);
    } catch (error) {
	console.error('Error querying OpenSearch:', error);
	res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/elements/{id}:
 *   get:
 *     summary: Retrieve ONE element using id
 *     tags: ['elements']
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The element ID to fetch
 *     responses:
 *       200:
 *         description: JSON Map object for element with given ID
 *       404:
 *         description: No element found with given ID
 *       500:
 *         description: Internal server error
 */
//app.options('/api/elements/:id', cors());
app.get('/api/elements/:id', cors(), async (req, res) => {

    const element_id = decodeURIComponent(req.params['id']);
    //console.log('getElementByID(): ' + element_id);
    try {
	const element = await n4j.getElementByID(element_id);
	if (JSON.stringify(element) === '{}'){
	    return res.status(404).json({ message: 'Element not found' });
	}
	res.status(200).json(element);
    } catch (error) {
	console.error('/api/resources/:id Error querying OpenSearch:', error);
	res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/elements:
 *   get:
 *     summary: Retrieve elements by field and value
 *     tags: ['elements']
 *     parameters:
 *       - in: query
 *         name: field-name
 *         required: false
 *         schema:
 *           type: string
 *           enum: [_id, contributor, tags]
 *         description: The field to match
 *       - in: query
 *         name: match-value
 *         required: false
 *         schema:
 *           type: string
 *         description: The values to match (comma-separated)
 *       - in: query
 *         name: element-type
 *         required: false
 *         schema:
 *           type: string
 *         description: Comma-separated (notebook, dataset, publication, oer)
 *       - in: query
 *         name: sort-by
 *         required: false
 *         schema:
 *           type: string
 *           enum: [click_count, creation_time, title]
 *         description: The field to sort the elements by
 *       - in: query
 *         name: order
 *         required: false
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *         description: Sort order of returned elements
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: integer
 *         description: The offset value for pagination
 *       - in: query
 *         name: size
 *         required: true
 *         schema:
 *           type: integer
 *         description: The limit value for pagination
 *       - in: query
 *         name: count-only
 *         required: false
 *         schema:
 *           type: boolean
 *         description: Only return the count of filtered elements
 *     responses:
 *       200:
 *         description: A list of elements or count of elements
 *       500:
 *         description: Internal server error
 */
app.options('/api/elements/:id', (req, res) => {
    const method = req.header('Access-Control-Request-Method');
    if (method === 'PUT') {
        res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
        res.header('Access-Control-Allow-Methods', 'PUT');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        res.header('Access-Control-Allow-Credentials', 'true');
    } else if (method === 'POST') {
        res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
        res.header('Access-Control-Allow-Methods', 'POST');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        res.header('Access-Control-Allow-Credentials', 'true');
    } else if (method === 'GET') {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    }else if (method === 'DELETE') {
        res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
        res.header('Access-Control-Allow-Methods', 'DELETE');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        res.header('Access-Control-Allow-Credentials', 'true');
    }
    res.sendStatus(204); // No content
});

app.options('/api/elements', (req, res) => {
    const method = req.header('Access-Control-Request-Method');
    if (method === 'PUT') {
        res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
        res.header('Access-Control-Allow-Methods', 'PUT');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        res.header('Access-Control-Allow-Credentials', 'true');
    } else if (method === 'POST') {
        res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
        res.header('Access-Control-Allow-Methods', 'POST');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        res.header('Access-Control-Allow-Credentials', 'true');
    } else if (method === 'GET') {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    }else if (method === 'DELETE') {
        res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
        res.header('Access-Control-Allow-Methods', 'DELETE');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        res.header('Access-Control-Allow-Credentials', 'true');
    }
    res.sendStatus(204); // No content
});
//app.options('/api/elements', cors());
app.get('/api/elements', cors(), async (req, res) => {
    // [Done] Neo4j
    let { 'field-name': field_name,
	  'match-value': match_value,
	  'element-type': element_type,
	  'sort-by': sort_by,
	  'order': order,
	  'from': from,
	  'size': size,
	  'count-only':count_only} = req.query;

    if (typeof element_type !== 'undefined')
	element_type = element_type.split(',').map(item => item.trim());
    if (typeof match_value !== 'undefined')
	match_value = match_value.split(',').map(item => item.trim());

    //console.log('Neo4j /api/elements/retrieve - '+ element_type + ', ' + match_value);

    try{
	if (typeof match_value !== 'undefined' && match_value !== null){
	    if (typeof element_type !== 'undefined' && element_type !== null){
		throw Error('Neo4j not implemented: ' + element_type + ', ' + match_value);
	    } else if (count_only === 'true') {
		if (field_name == 'contributor') {
		    let total_count = 0;
		    for (let val of match_value){
			let response = await n4j.getElementsCountByContributor(val);
			total_count += response;
		    }
		    res.json(total_count);
		    return;
		} else if (field_name == 'tags') {
		    let total_count = 0;
		    for (let val of match_value){
			let response = await n4j.getElementsCountByTag(val);
			total_count += response;
		    }
		    res.json(total_count);
		    return;
		} else {
		    throw Error('Neo4j not implemented Count:' + element_type + ', ' + match_value);
		}
	    } else {
		// [ToDo] Should be removed since '_id' is not used anymore???
		if (field_name == '_id'){
		    throw Error('GET /api/elements field_name=_id: Should not be used');

		    const resources = [];
		    let total_count = 0;
		    for (let val of match_value){
			let resource = await n4j.getElementByID(val);
			//let resource_count = await n4j.getElementsCountByContributor(val);
			resources.push(resource);
		    }
		    res.json({elements:resources, 'total-count': total_count});
		    return;
		} else if (field_name == 'contributor') {
		    const resources = [];
		    let total_count = 0;
		    for (let val of match_value){
			let resource = await n4j.getElementsByContributor(val,
									  from,
									  size,
									  sort_by,
									  order);
			total_count += await n4j.getElementsCountByContributor(val);
			resources.push(...resource);
		    }
		    res.json({elements:resources, 'total-count': total_count});
		    return;
		} else if (field_name == 'tags') {
		    const resources = [];
		    let total_count = 0;
		    for (let val of match_value){
			let resource = await n4j.getElementsByTag(val, from, size, sort_by, order);
			resources.push(...resource);
			total_count += await n4j.getElementsCountByTag(val);
		    }
		    res.json({elements:resources, 'total-count': total_count});
		    return;
		} else {
		    throw Error('Neo4j not implemented: ' + element_type + ', ' + match_value);
		}
	    }
	} else if (typeof element_type !== 'undefined' && element_type !== null){
	    if (typeof match_value !== 'undefined' && match_value !== null){
		// should never reach here
		throw Error('Neo4j not implemented: ' + element_type + ', ' + match_value);
	    } else if (count_only === 'true') {
		let total_count = 0;
		for (let val of element_type){
		    let response = await n4j.getElementsCountByType(val);
		    total_count += response;
		}
		res.json(total_count);
	    } else {
		const resources = [];
		let total_count = 0;
		for (let val of element_type){
		    let resource = await n4j.getElementsByType(val, from, size, sort_by, order);
		    if (resource.length > 0){
			resources.push(...resource);
		    }
		    total_count += await n4j.getElementsCountByType(val);
		}
		res.json({elements:resources, 'total-count': total_count});
		return;
	    }
	} else {
	    throw Error('Neo4j not implemented: ' + element_type + ', ' + match_value);
	}
    } catch (error) {
	console.error('Error retrieving elements:', error);
	res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/elements:
 *   post:
 *     summary: Register an element
 *     tags: ['elements']
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               resource-type:
 *                 type: string
 *               notebook-repo:
 *                 type: string
 *               notebook-file:
 *                 type: string
 *               related-resources:
 *                 type: array
 *                 items:
 *                   type: object
 *                   properties:
 *                     type:
 *                       type: string
 *                     title:
 *                       type: string
 *     responses:
 *       200:
 *         description: Resource registered successfully
 *       500:
 *         description: Internal server error
 *       403:
 *         description: The user does not have the permission to make the contribution
 */
//app.options('/api/elements', jwtCorsMiddleware);
app.post('/api/elements', jwtCorsMiddleware, authenticateJWT, authorizeRole(n4j.Role.TRUSTED_USER), async (req, res) => {
    const resource = req.body;

    try {
        console.log(resource['resource-type']);
	console.log(req.user);
        // Check if the resource type is "oer" and user have enough permission to add OER
        if (resource['resource-type'] === 'oer' &&
	    !(req.user.role <= n4j.Role.UNRESTRICTED_CONTRIBUTOR)) {
            console.log(req.user, " blocked by role")
            return res.status(403).json({ message: 'Forbidden: You do not have permission to submit OER elements.' });
        }else{
            console.log(req.user, " is allowed to submit oers")
        }

        // Handle notebook resource type
        if (resource['resource-type'] === 'notebook' &&
            resource['notebook-repo'] &&
            resource['notebook-file']) {
            const htmlNotebookPath =
                await convertNotebookToHtml(resource['notebook-repo'],
                                            resource['notebook-file'], notebookHtmlDir);
            if (htmlNotebookPath) {
                resource['html-notebook'] =
                    `https://${process.env.DOMAIN}:${process.env.PORT}/user-uploads/notebook_html/${path.basename(htmlNotebookPath)}`;
            }
        }

        const contributor_id = resource['metadata']['created_by'];

        // Register element in Neo4j
        const {response, element_id} = await n4j.registerElement(contributor_id, resource);

        if (response) {
            // Insert/index searchable part to OpenSearch
            let os_element = {
                title: resource['title'],
                contents: resource['contents'],
                authors: resource['authors'],
                tags: resource['tags'],
                'resource-type': resource['resource-type'],
                'thumbnail-image': resource['thumbnail-image'],
		// spatial-temporal
		'spatial-coverage': resource['spatial-coverage'],
		'spatial-geometry': resource['spatial-geometry'],
		'spatial-bounding-box': resource['spatial-bounding-box'],
		'spatial-centroid': resource['spatial-centroid'],
		'spatial-georeferenced': resource['spatial-georeferenced'],
		'spatial-temporal-coverage': resource['spatial-temporal-coverage'],
		'spatial-index-year': resource['spatial-index-year']
            };

            console.log('Getting contributor name');
            // Set contributor name
            let contributor = await n4j.getContributorByID(contributor_id);
            let contributor_name = '';
            if ('first_name' in contributor || 'last_name' in contributor) {
                contributor_name = `${contributor['first_name']} ${contributor['last_name']}`;
            }
            os_element['contributor'] = contributor_name;

            console.log('Indexing element: ' + os_element);
            const response = await client.index({
                id: element_id,
                index: os_index,
                body: os_element,
                refresh: true,
            });

            console.log(response['body']['result']);
            res.status(200).json({ message: 'Resource registered successfully', elementId: element_id });
        } else {
            console.log('Error registering resource ...');
            res.status(500).json({ error: 'Error registering resource' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * @swagger
 * /api/elements/{id}:
 *   delete:
 *     summary: Delete a resource by ID
 *     tags: ['elements']
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Resource deleted successfully
 *       500:
 *         description: Internal server error
 */
app.options('/api/elements/:id', jwtCorsMiddleware);
app.delete('/api/elements/:id', jwtCorsMiddleware, authenticateJWT, async (req, res) => {
    const resourceId = req.params['id'];

    console.log('Deleting element: ' +  resourceId);
    try {
	const response = await n4j.deleteElementByID(resourceId);
	if (response) {
	    // Delete from OpenSearch
	    const response = await client.delete({
		index: os_index,
		id: resourceId
	    });
	    console.log(response['body']['result']);
	    await client.indices.refresh({ index: os_index });

	    res.status(200).json({ message: 'Resource deleted successfully' });
	} else {
	    res.status(500).json({ error: 'Resource still exists after deletion' });
	}
    } catch (error) {
	console.error('Error deleting resource:', error.message);
	res.status(500).json({ error: error.message });
    }
});

/**
 * @swagger
 * /api/elements/{id}:
 *   put:
 *     summary: Update the element with given ID
 *     tags: ['elements']
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The id of the element
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: User updated successfully
 *       403:
 *         description: The user does not have the permission to edit this element
 *       500:
 *         description: Internal server error
 */
//app.options('/api/elements/:id', jwtCorsMiddleware);
app.put('/api/elements/:id', jwtCorsMiddleware, authenticateJWT, async (req, res) => {
    const id = decodeURIComponent(req.params.id);
    const updates = req.body;

    console.log('Updating element with id: ' + id);

    try {
	// only allow updating if
	// (1) this element is owned by the user sending update request
	// (2) user sending update request is admin or super admin
	const element_owner = await n4j.getContributorIdForElement(id);
	const can_edit = (() => {
	    if (req.user.id == element_owner['id'] || req.user.id == element_owner['openid']){
		console.log('This element is owned by the user');
		// this element is owned by the user sending update request
		return true;
	    } else if (req.user.role <= n4j.Role.CONTENT_MODERATOR) {
		// user sending update request is admin or super admin
		return true;
	    }
	    return false;
	})();

	if (!can_edit){
	    res.status(403).json({ message: 'Forbidden: You do not have permission to edit this element.' });
	}

	const response = await n4j.updateElement(id, updates);
	if (response) {
	    // Update in OpenSearch
	    const response = await client.update({
		id: id,
		index: os_index,
		body: {
		    doc: {
			'title': updates['title'],
			'contents': updates['contents'],
			'authors': updates['authors'],
			'tags': updates['tags'],
			'thumbnail-image': updates['thumbnail-image'],
			// spatial-temporal properties
			'spatial-coverage': updates['spatial-coverage'],
			'spatial-geometry': updates['spatial-geometry'],
			'spatial-bounding-box': updates['spatial-bounding-box'],
			'spatial-centroid': updates['spatial-centroid'],
			'spatial-georeferenced': updates['spatial-georeferenced'],
			'spatial-temporal-coverage': updates['spatial-temporal-coverage'],
			'spatial-index-year': updates['spatial-index-year']
			// type and contributor should never be updated
		    }
		},
		refresh: true,
	    });
	    //console.log(response['body']['result']);
	    res.status(200).json({ message: 'Element updated successfully', result: response });
	} else {
	    console.log('Error updating element');
	    res.status(500).json({ message: 'Error updating element', result: response });
	}
    } catch (error) {
	console.error('Error updating element:', error);
	res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/elements/thumbnail:
 *   post:
 *     summary: Upload a thumbnail image
 *     tags: ['elements']
 *     consumes:
 *       - multipart/form-data
 *     parameters:
 *       - in: formData
 *         name: file
 *         type: file
 *         description: The thumbnail file to upload
 *     responses:
 *       200:
 *         description: Thumbnail uploaded successfully
 *       400:
 *         description: No file uploaded
 */
app.options('/api/elements/thumbnail', jwtCorsMiddleware);
app.post('/api/elements/thumbnail', jwtCorsMiddleware, uploadThumbnail.single('file'), authenticateJWT, (req, res) => {
    if (!req.file) {
	return res.status(400).json({ message: 'No file uploaded' });
    }
    // [ToDo] Change filename to user ID
    const filePath = `https://${process.env.DOMAIN}:${process.env.PORT}/user-uploads/thumbnails/${req.file.filename}`;
    res.json({
	message: 'Thumbnail uploaded successfully',
	url: filePath,
    });
});

/**
 * @swagger
 * /api/elements/{id}/neighbors:
 *   get:
 *     summary: Return neighbor elements of element with given ID
 *     tags: ['elements']
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the user
 *     responses:
 *       200:
 *         description: JSON Map for related elements
 *       404:
 *         description: User not found
 *       500:
 *         description: Error fetching the user
 */
app.options('/api/elements/:id/neighbors', cors());
app.get('/api/elements/:id/neighbors', cors(), async (req, res) => {
    const id = decodeURIComponent(req.params.id);
    try {
	const response = await n4j.getRelatedElementsForID(id);
	if (JSON.stringify(response) === '{}'){
	    //return res.status(404).json({ message: 'No related elements found' });
	    return res.status(404).json({r1:[], r2:[] });
	}
	res.status(200).json(response);
    } catch (error) {
	console.error('Error fetching related elements:', error);
	res.status(500).json({ message: 'Error fetching related elements' });
    }
});
/****************************************************************************
 * User/Contributor Endpoints
 ****************************************************************************/
/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Return the user document given the id
 *     tags: ['users']
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the user
 *     responses:
 *       200:
 *         description: The user document
 *       404:
 *         description: User not found
 *       500:
 *         description: Error fetching the user
 */
//app.options('/api/users/:id', cors());
app.get('/api/users/:id', cors(), async (req, res) => {
    const id = decodeURIComponent(req.params.id);
    try {
	const response = await n4j.getContributorByID(id);
	if (response.size == 0){
	    return res.status(404).json({ message: 'User not found' });
	}
	// remove role attribute
	delete response['role'];
	res.status(200).json(response);
    } catch (error) {
	console.error('Error fetching user:', error);
	res.status(500).json({ message: 'Error fetching the user' });
    }
});

/**
 * @swagger
 * /api/users/{id}/role:
 *   get:
 *     summary: Return the user role given the id
 *     tags: ['users']
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the user
 *     responses:
 *       200:
 *         description: The user role i.e. admin, user
 *       404:
 *         description: User not found
 *       500:
 *         description: Error fetching the user
 */
app.options('/api/users/:id/role', cors());
app.get('/api/users/:id/role', cors(), async (req, res) => {
    const id = decodeURIComponent(req.params.id);
    try {
	const response = await n4j.getContributorByID(id);
	if (response.size == 0){
	    return res.status(404).json({ message: 'User not found' });
	}
	let ret = {'role' : response['role']};
	res.json(ret);
    } catch (error) {
	console.error('Error fetching user:', error);
	res.status(500).json({ message: 'Error fetching the user' });
    }
});

/**
 * @swagger
 * /api/users/{id}/valid:
 *   get:
 *     summary: Check if a user exists given the id
 *     tags: ['users']
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the user
 *     responses:
 *       200:
 *         description: True if user exists, false otherwise
 *       500:
 *         description: Error checking the user
 */
app.options('/api/users/:id/valid', cors());
app.get('/api/users/:id/valid', cors(), async (req, res) => {
    const id = decodeURIComponent(req.params.id);

    console.log('Check user ...' + id);
    // [ToDo] Return {true, version_num} OR {false, -1}
    try {
	const response = await n4j.checkContributorByID(id);
	res.json(response);
    } catch (error) {
	console.error('Error checking user:', error);
	res.status(500).json({ message: 'Error checking the user' });
    }
});

// /**
//  * @swagger
//  * /api/users/{id}:
//  *   delete:
//  *     summary: Delete the user document
//  *     tags: ['users']
//  *     parameters:
//  *       - in: path
//  *         name: id
//  *         required: true
//  *         schema:
//  *           type: string
//  *         description: The OpenID of the user
//  *     responses:
//  *       200:
//  *         description: User deleted successfully
//  *       500:
//  *         description: Internal server error
//  */
// app.delete('/api/users/:id', async (req, res) => {
//   const openid = decodeURIComponent(req.params.id);

//   try {
//   throw Error('Neo4j: Delete user is not implemented');
//   // const response = await client.delete({
//   //     index: 'users',
//   //     id: openid
//   // });

//   // res.json({ message: 'User deleted successfully', result: response.body.result });
//   } catch (error) {
//   console.error('Error deleting user:', error);
//   res.status(500).json({ message: 'Internal server error' });
//   }
// });

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

/**
 * @swagger
 * /api/users/avatar:
 *   post:
 *     summary: Upload/update an avatar image for the user profile
 *     tags: ['users']
 *     consumes:
 *       - multipart/form-data
 *     parameters:
 *       - in: formData
 *         name: file
 *         type: file
 *         description: The avatar file to upload
 *       - in: formData
 *         name: id
 *         type: string
 *         description: The user ID
 *     responses:
 *       200:
 *         description: Avatar uploaded successfully
 *       400:
 *         description: No file uploaded
 */
app.options('/api/users/avatar', jwtCorsMiddleware);
app.post('/api/users/avatar', jwtCorsMiddleware, authenticateJWT, uploadAvatar.single('file'), async (req, res) => {
    // if (!req.file) {
    // 	return res.status(400).json({ message: 'No file uploaded' });
    // }

    // const filePath = `https://${process.env.DOMAIN}:${process.env.PORT}/user-uploads/avatars/${req.file.filename}`;

    // res.json({
    // 	message: 'Avatar uploaded successfully',
    // 	url: filePath,
    // });

    try {
	const body = JSON.parse(JSON.stringify(req.body));
	const id = body.id;
	const newAvatarFile = req.file;

	if (!id || !newAvatarFile) {
	    return res.status(400).json({ message: 'ID and new avatar file are required' });
	}

	// Update the user's avatar URL with the new file URL
	const newAvatarUrl = `https://${process.env.DOMAIN}:${process.env.PORT}/user-uploads/avatars/${newAvatarFile.filename}`;

	const {result, oldAvatarUrl} = await n4j.setContributorAvatar(id, newAvatarUrl);
	if (result == false){
	    return res.status(404).json({ message: 'User not found' });
	}
	if (oldAvatarUrl) {
	    // Delete the old avatar file
	    const oldAvatarFilePath = path.join(avatarDir, path.basename(oldAvatarUrl));
	    if (fs.existsSync(oldAvatarFilePath)) {
		fs.unlinkSync(oldAvatarFilePath);
	    }
	    var ret_message = 'Avatar updated successfully'
	} else {
	    var ret_message = 'Avatar uploaded successfully'
	}

	res.json({
	    message: ret_message,
	    url: newAvatarUrl,
	});
    } catch (error) {
	console.error('Error updating avatar:', error);
	res.status(500).json({ message: 'Internal server error' });
    }

});

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: Add a new user document
 *     tags: ['users']
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *     responses:
 *       201:
 *         description: User added successfully
 *       500:
 *         description: Internal server error
 */
app.options('/api/users', jwtCorsMiddleware);
app.post('/api/users', jwtCorsMiddleware, authenticateJWT, async (req, res) => {
    const user = req.body;
    console.log('Adding new user');
    //console.log(user);

    try {
	const id = user['id'];
	const response = await n4j.registerContributor(user);
	if (response){
	    res.status(201).json({ message: 'User added successfully', id: id });
	} else {
	    res.status(201).json({ message: 'User already exists', id: id });
	    console.log('User already exists with id: ' + id);
	}
	// [ToDo] Add contributor name to OpenSearch

	// const response = await client.index({
	//     index: 'users',
	//     id: user.openid,
	//     body: user,
	//     refresh:'wait-for'
	// });
	//res.status(201).json({ message: 'User added successfully', id: response.body._id });
    } catch (error) {
	console.error('Error adding user:', error);
	res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/users/{id}:
 *   put:
 *     summary: Update the user document
 *     tags: ['users']
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: User updated successfully
 *       500:
 *         description: Internal server error
 */
// Handle OPTIONS requests for both methods
app.options('/api/users/:id', (req, res) => {
    const method = req.header('Access-Control-Request-Method');
    if (method === 'PUT') {
        res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
        res.header('Access-Control-Allow-Methods', 'PUT');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        res.header('Access-Control-Allow-Credentials', 'true');
    } else if (method === 'GET') {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    }
    res.sendStatus(204); // No content
});
app.put('/api/users/:id', jwtCorsMiddleware, authenticateJWT, async (req, res) => {
    const id = decodeURIComponent(req.params.id);
    const updates = req.body;

    console.log('Updating user ...');

    try {
	const response = await n4j.updateContributor(id, updates);
	if (response) {
	    res.json({ message: 'User updated successfully', result: response });
	} else {
	    console.log('Error updating user');
	    res.json({ message: 'Error updating user', result: response });
	}
    } catch (error) {
	console.error('Error updating user:', error);
	res.status(500).json({ message: 'Internal server error' });
    }
});

/****************************************************************************
 * Documentation Endpoints
 ****************************************************************************/
/**
 * @swagger
 * /api/documentation/{id}:
 *   get:
 *     summary: Retrieve the documentation given ID
 *     tags: ['documentation']
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The URL to retrieve the title from
 *     responses:
 *       200:
 *         description: The documentation object Map with given ID
 *       404:
 *         description: Documentation not found
 *       500:
 *         description: Failed to retrieve documentation
 */
app.options('/api/documentation', (req, res) => {
    const method = req.header('Access-Control-Request-Method');
    if (method === 'POST') {
        res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
        res.header('Access-Control-Allow-Methods', 'POST');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        res.header('Access-Control-Allow-Credentials', 'true');
    } else {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', method);
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    }
    res.sendStatus(204); // No content
});

app.options('/api/documentation/:id', (req, res) => {
    const method = req.header('Access-Control-Request-Method');
    if (method === 'PUT') {
        res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
        res.header('Access-Control-Allow-Methods', 'PUT');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        res.header('Access-Control-Allow-Credentials', 'true');
    } else if (method === 'DELETE') {
        res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
        res.header('Access-Control-Allow-Methods', 'DELETE');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        res.header('Access-Control-Allow-Credentials', 'true');
    }else {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', method);
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    }
    res.sendStatus(204); // No content
});
app.get('/api/documentation/:id', cors(), async (req, res) => {
    const doc_id = decodeURIComponent(req.params['id']);
    try {
	const documentation = await n4j.getDocumentationByID(doc_id);
	if (JSON.stringify(documentation) === '{}'){
	    return res.status(404).json({ message: 'Documentation not found' });
	}
	res.status(200).json(documentation);
    } catch (error) {
	console.log(error);
	res.status(500).json({ error: 'Failed to retrieve documentation with id: ' + doc_id});
    }
});

/**
 * @swagger
 * /api/documentation:
 *   get:
 *     summary: Retrieve all documentation filtered by given criteria
 *     tags: ['documentation']
 *     parameters:
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: integer
 *         description: The offset value for pagination
 *       - in: query
 *         name: size
 *         required: true
 *         schema:
 *           type: integer
 *         description: The limit value for pagination
 *     responses:
 *       200:
 *         description: The list of documentation object with given ID
 *       404:
 *         description: Documentation not found
 *       500:
 *         description: Failed to retrieve title
 */
app.get('/api/documentation', cors(), async (req, res) => {
        let {
	  'from': from,
	  'size': size} = req.query;

    try {
	const documentation = await n4j.getAllDocumentation(from, size);
	if (documentation.length == 0){
	    return res.status(404).json({ message: 'No Documentation found' });
	}
	res.status(200).json({documentation:documentation, 'total-count': documentation.length});
    } catch (error) {
	console.log(error);
	res.status(500).json({ error: 'Failed to retrieve documentations'});
    }
});

/**
 * @swagger
 * /api/documentation:
 *   post:
 *     summary: Add a new documentation item
 *     tags: ['documentation']
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               content:
 *                 type: string
 *     responses:
 *       200:
 *         description: Documentation added successfully
 *       400:
 *         description: Error adding documentation in DB
 *       500:
 *         description: Internal server error
 */
app.post('/api/documentation', jwtCorsMiddleware, authenticateJWT, authorizeRole(n4j.Role.ADMIN), async (req, res) => {
    const documentation = req.body;
    try {
	const {response, documentation_id} = await n4j.registerDocumentation(documentation);

	if (response){
	    res.status(200).json({ message: 'Documentation added successfully',
				   id: documentation_id });
	} else {
	    res.status(400).json({ message: 'Error adding documentation'});
	}
    } catch (error) {
	console.error('Error adding documentation:', error);
	res.status(500).json({ message: 'Internal server error' });
    }
});
/**
 * @swagger
 * /api/documentation/{id}:
 *   put:
 *     summary: Update the user document
 *     tags: ['documentation']
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the documentation
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               content:
 *                 type: string
 *     responses:
 *       200:
 *         description: User updated successfully
 *       400:
 *         description: Error updating documentation
 *       500:
 *         description: Internal server error
 */
app.put('/api/documentation/:id', jwtCorsMiddleware, authenticateJWT, authorizeRole(n4j.Role.ADMIN), async (req, res) => {
    const id = decodeURIComponent(req.params.id);
    const updates = req.body;

    try {
	const response = await n4j.updateDocumentation(id, updates);
	if (response) {
	    res.status(200).json({ message: 'Documentation updated successfully', result: response });
	} else {
	    console.log('Error updating user');
	    res.status(400).json({ message: 'Error updating documentation', result: response });
	}
    } catch (error) {
	console.error('Error updating user:', error);
	res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/documentation/{id}:
 *   delete:
 *     summary: Delete a documentation by ID
 *     tags: ['documentation']
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Documentation deleted successfully
 *       500:
 *         description: Internal server error
 */
app.delete('/api/documentation/:id', jwtCorsMiddleware, authenticateJWT, authorizeRole(n4j.Role.ADMIN), async (req, res) => {
    const doc_id = req.params['id'];

    try {
	const response = await n4j.deleteDocumentationByID(doc_id);
	if (response) {
	    res.status(200).json({ message: 'Documentation deleted successfully' });
	} else {
	    res.status(500).json({ error: 'Documentation still exists after deletion' });
	}
    } catch (error) {
	console.error('Error deleting documentation:', error.message);
	res.status(500).json({ error: error.message });
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
