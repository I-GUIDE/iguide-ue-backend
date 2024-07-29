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

import * as n4j from './backend_neo4j.cjs'

const app = express();
app.use(cors());
app.use(express.json());
dotenv.config();

const os_node = process.env.OPENSEARCH_NODE;
const os_usr = process.env.OPENSEARCH_USERNAME;
const os_pswd = process.env.OPENSEARCH_PASSWORD;
const os_index = 'neo4j-elements-dev'; process.env.OPENSEARCH_INDEX;

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

/**
 * @swagger
 * /api/upload-avatar:
 *   post:
 *     summary: Upload an avatar image for the user profile
 *     consumes:
 *       - multipart/form-data
 *     parameters:
 *       - in: formData
 *         name: file
 *         type: file
 *         description: The avatar file to upload
 *     responses:
 *       200:
 *         description: Avatar uploaded successfully
 *       400:
 *         description: No file uploaded
 */
app.post('/api/upload-avatar', uploadAvatar.single('file'), (req, res) => {
    // [Done] Neo4j Not required
    if (!req.file) {
	return res.status(400).json({ message: 'No file uploaded' });
    }

    const filePath = `https://${process.env.DOMAIN}:3000/user-uploads/avatars/${req.file.filename}`;
    res.json({
	message: 'Avatar uploaded successfully',
	url: filePath,
    });
});

/**
 * @swagger
 * /api/update-avatar:
 *   post:
 *     summary: Update the user's avatar
 *     consumes:
 *       - multipart/form-data
 *     parameters:
 *       - in: formData
 *         name: file
 *         type: file
 *         description: The new avatar file to upload
 *       - in: body
 *         name: openid
 *         description: The OpenID of the user
 *         schema:
 *           type: object
 *           required:
 *             - openid
 *           properties:
 *             openid:
 *               type: string
 *     responses:
 *       200:
 *         description: Avatar updated successfully
 *       400:
 *         description: OpenID and new avatar file are required
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
app.post('/api/update-avatar', uploadAvatar.single('file'), async (req, res) => {
    // [Done] Neo4j
    try {
	const { openid } = req.body;
	const newAvatarFile = req.file;

	if (!openid || !newAvatarFile) {
	    return res.status(400).json({ message: 'OpenID and new avatar file are required' });
	}

	// Update the user's avatar URL with the new file URL
	const newAvatarUrl = `https://${process.env.DOMAIN}:3000/user-uploads/avatars/${newAvatarFile.filename}`;

	const {result, oldAvatarUrl} = await n4j.setContributorAvatar(openid, newAvatarUrl);
	if (result == false){
	    return res.status(404).json({ message: 'User not found' });
	}
	if (oldAvatarUrl) {
	    // Delete the old avatar file
	    const oldAvatarFilePath = path.join(avatarDir, path.basename(oldAvatarUrl));
	    if (fs.existsSync(oldAvatarFilePath)) {
		fs.unlinkSync(oldAvatarFilePath);
	    }
	}

	res.json({
	    message: 'Avatar updated successfully',
	    url: newAvatarUrl,
	});
    } catch (error) {
	console.error('Error updating avatar:', error);
	res.status(500).json({ message: 'Internal server error' });
    }
});

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

/**
 * @swagger
 * /api/resources:
 *   get:
 *     summary: Fetch documents by resource type
 *     parameters:
 *       - in: query
 *         name: data_name
 *         required: true
 *         schema:
 *           type: string
 *         description: The type of resource to fetch
 *       - in: query
 *         name: sort_by
 *         required: false
 *         schema:
 *           type: string
 *         description: The field to sort by
 *       - in: query
 *         name: order
 *         required: false
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *         description: The sort order
 *       - in: query
 *         name: from
 *         required: false
 *         schema:
 *           type: integer
 *         description: The starting index of the results
 *       - in: query
 *         name: size
 *         required: false
 *         schema:
 *           type: integer
 *         description: The number of results to fetch
 *     responses:
 *       200:
 *         description: A list of resources
 *       404:
 *         description: No resource found
 *       500:
 *         description: Internal server error
 */
app.get('/api/resources', async (req, res) => {
    // [Done] Neo4j
    const type = req.query.data_name;
    //let sortBy = req.query.sort_by || '_score'; // Default to '_score' for relevance sorting
    //const order = req.query.order || 'desc'; // Default to 'desc' for descending order
    const from = parseInt(req.query.from, 10) || 0; // Default to 0 (start from the beginning)
    const size = parseInt(req.query.size, 10) || 15; // Default to 15 results

    try {
	// Note: Neo4j query always orders by title, needs to be updated if required otherwise
	const resources = await n4j.getElementsByType(type, from, size);
	if (resources.length == 0){
	    res.status(404).json({ message: 'No resource found' });
	    return;
	}
	res.json(resources);
    } catch (error) {
	console.error('Error querying OpenSearch:', error);
	res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/elements/titles:
 *   get:
 *     summary: Fetch all titles of a given type of elements
 *     parameters:
 *       - in: query
 *         name: element_type
 *         required: true
 *         schema:
 *           type: string
 *         description: The type of element to fetch titles for
 *     responses:
 *       200:
 *         description: A list of titles
 *       400:
 *         description: element_type query parameter is required
 *       500:
 *         description: Internal server error
 */
app.get('/api/elements/titles', async (req, res) => {
    // [Done] Neo4j not required. Used to search for elements when submitting. Should be from OS
    const elementType = req.query.element_type;
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
 * /api/featured-resources:
 *   get:
 *     summary: Fetch all featured documents
 *     parameters:
 *       - in: query
 *         name: sort_by
 *         required: false
 *         schema:
 *           type: string
 *         description: The field to sort by
 *       - in: query
 *         name: order
 *         required: false
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *         description: The sort order
 *       - in: query
 *         name: from
 *         required: false
 *         schema:
 *           type: integer
 *         description: The starting index of the results
 *       - in: query
 *         name: size
 *         required: false
 *         schema:
 *           type: integer
 *         description: The number of results to fetch
 *     responses:
 *       200:
 *         description: A list of featured resources
 *       404:
 *         description: No featured resource found
 *       500:
 *         description: Internal server error
 */
app.get('/api/featured-resources', async (req, res) => {
    // [Done] Neo4j
    try {
	const resources = await n4j.getFeaturedElements();
	res.json(resources);
    } catch (error) {
	console.error('Error querying OpenSearch:', error);
	res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/search:
 *   post:
 *     summary: Search for resources
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               keyword:
 *                 type: string
 *               resource_type:
 *                 type: string
 *               sort_by:
 *                 type: string
 *               order:
 *                 type: string
 *                 enum: [asc, desc]
 *               from:
 *                 type: integer
 *               size:
 *                 type: integer
 *     responses:
 *       200:
 *         description: A list of search results
 *       500:
 *         description: Error querying OpenSearch
 */
app.post('/api/search', async (req, res) => {
    // [Done] Neo4j not required. All searching shoud be from OS
    const { keyword, resource_type, sort_by = '_score', order = 'desc', from = 0, size = 15 } = req.body;

    let query = {
	multi_match: {
	    query: keyword,
	    fields: [
		'title^3',    // Boost title matches
		'authors^3',  // Boost author matches
		'tags^2',     // Slightly boost tag matches
		'contents'    // Normal weight for content matches
	    ],
	},
    };

    if (resource_type && resource_type !== 'any') {
	query = {
	    bool: {
		must: [
		    {
			multi_match: {
			    query: keyword,
			    fields: [
				'title^3',
				'authors^3',
				'tags^2',
				'contents'
			    ],
			},
		    },
		    { term: { 'resource-type': resource_type } },
		],
	    },
	};
    }

    // Replace title and authors with their keyword sub-fields for sorting
    let sortBy = sort_by;
    if (sortBy === 'title') {
	sortBy = 'title.keyword';
    } else if (sortBy === 'authors') {
	sortBy = 'authors.keyword';
    }

    try {
	const searchParams = {
	    index: os_index,
	    body: {
		from: from,
		size: size,
		query: query,
	    },
	};

	// Add sorting unless sort_by is "prioritize_title_author"
	if (sort_by !== 'prioritize_title_author') {
	    searchParams.body.sort = [
		{
		    [sortBy]: {
			order: order,
		    },
		},
	    ];
	}

	const searchResponse = await client.search(searchParams);
	const results = searchResponse.body.hits.hits.map(hit => {
	    const { _id, _source } = hit;
	    const { metadata, ...rest } = _source; // Remove metadata
	    return { _id, ...rest };
	});
	res.json(results);
    } catch (error) {
	console.error('Error querying OpenSearch:', error);
	res.status(500).json({ error: 'Error querying OpenSearch' });
    }
});


/**
 * @swagger
 * /api/resource-count:
 *   post:
 *     summary: Get the count of documents by resource-type or search keywords
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               resourceType:
 *                 type: string
 *               keywords:
 *                 type: string
 *     responses:
 *       200:
 *         description: The count of documents
 *       400:
 *         description: Either resourceType or keywords are required
 *       500:
 *         description: Internal server error
 */
app.post('/api/resource-count', async (req, res) => {
    // [Done] Neo4j + Search from OS 
    const { resourceType, keywords } = req.body;

    if (!resourceType && !keywords) {
	return res.status(400).send({ error: 'Either resourceType or keywords are required' });
    }

    if (keywords) {
	// Mainly used for searching so should be from OpenSearch
	//console.log('Resource count keywords ...' + keywords);
	const query = {
		bool: {
		    must: []
		}
	};
	query.bool.must.push({
	    multi_match: {
		query: keywords,
		fields: ['title', 'authors', 'contents','tags']
	    }
	});
	try {
	    const response = await client.count({
		index: os_index,
		body: {
		    query: query
		}
	    });
	    
	    res.send({ count: response.body.count });
	} catch (error) {
	    console.error('Error querying OpenSearch:', error);
	    res.status(500).send({ error: 'OS: Error occurred fetching resource count' });
	}
    }
    else{
	// Non-search count for a given element type should be from Neo4j
	try {
	    const response = await n4j.getElementsCountByType(resourceType);
	    if (response < 0){
		res.status(500).send({ error: 'Neo4j: Error occurred fetching resource count' });
		return;
	    }
	    res.send({ count: response });
	} catch (error) {
	    console.error('Error querying Neo4j:', error);
	    res.status(500).send({ error: 'Neo4j: Error occurred fetching resource count' });
	}
    }
});

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

/**
 * @swagger
 * /api/upload-dataset:
 *   post:
 *     summary: Upload a dataset (CSV or ZIP)
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
app.post('/api/upload-dataset', upload.single('file'), (req, res) => {
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

/**
 * @swagger
 * /api/upload-thumbnail:
 *   post:
 *     summary: Upload a thumbnail image
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
app.post('/api/upload-thumbnail', uploadThumbnail.single('file'), (req, res) => {
    if (!req.file) {
	return res.status(400).json({ message: 'No file uploaded' });
    }
    const filePath = `https://${process.env.DOMAIN}:3000/user-uploads/thumbnails/${req.file.filename}`;
    res.json({
	message: 'Thumbnail uploaded successfully',
	url: filePath,
    });
});

/**
 * @swagger
 * /api/resources:
 *   put:
 *     summary: Register a resource
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
 */
app.put('/api/resources', async (req, res) => {
    // [Done] Neo4j
    const resource = req.body;

    try {
	if (resource['resource-type'] === 'notebook' &&
	    resource['notebook-repo'] &&
	    resource['notebook-file']) {
	    const htmlNotebookPath =
		  await convertNotebookToHtml(resource['notebook-repo'],
					      resource['notebook-file'], notebookHtmlDir);
	    if (htmlNotebookPath) {
		resource['html-notebook'] =
		    `https://${process.env.DOMAIN}:3000/user-uploads/notebook_html/${path.basename(htmlNotebookPath)}`;
	    }
	}

	const contributor_id = resource['metadata']['created_by'];
	//const response = await n4j.registerElement(contributor_id, resource);
	const {response, element_id} = await n4j.registerElement(contributor_id, resource);
	console.log('registerElement: ' + response);
	if (response){
	    // Insert/index searchable part to OpenSearch
	    let os_element = {};
	    //os_element['id'] = element_id;
	    os_element['title'] = resource['title'];
	    os_element['contents'] = resource['contents'];
	    os_element['authors'] = resource['authors'];
	    os_element['tags'] = resource['tags'];
	    os_element['resource-type'] = resource['resource-type'];
	    os_element['thumbnail-image'] = resource['thumbnail-image'];
	    console.log('Getting contributor name');
	    // set contributor name
	    let contributor = await n4j.getContributorByID(contributor_id);
	    let contributor_name = '';
	    if ('first_name' in contributor || 'last_name' in contributor) {
		contributor_name = contributor['first_name'] + ' ' + contributor['last_name'];
	    }
	    os_element['contributor'] = contributor_name;

	    console.log('indexing element: ' + os_element);
	    const response = await client.index({
		id: element_id,
		index: os_index,
		body: os_element,
		refresh: true,
	    });
	    console.log(response['body']['result']);
	    res.status(200).json({ message: 'Resource registered successfully' });
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
 * /api/resources/{id}:
 *   delete:
 *     summary: Delete a resource by ID
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
app.delete('/api/resources/:id', async (req, res) => {
    const resourceId = req.params.id;

    console.log('Deleting element: ' +  resourceId);
    try {
	const response = await n4j.deleteElementByID(resourceId);
	if (response) {
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
 * /api/resources/{field}/{values}:
 *   get:
 *     summary: Retrieve resources by field and values for exact match
 *     parameters:
 *       - in: path
 *         name: field
 *         required: true
 *         schema:
 *           type: string
 *         description: The field to match
 *       - in: path
 *         name: values
 *         required: true
 *         schema:
 *           type: string
 *         description: The values to match (comma-separated)
 *     responses:
 *       200:
 *         description: A list of resources
 *       404:
 *         description: No resources found
 *       500:
 *         description: Internal server error
 */
app.get('/api/resources/:field/:values', async (req, res) => {
    const { field, values } = req.params;
    const valueArray = values.split(',').map(value => decodeURIComponent(value)); //Decompose to handle openid as url

    try {
	if (field == '_id') {
	    //console.log('getElemnetByID from Neo4j ID: ' + valueArray);
	    const resources = [];
	    for (let val of valueArray){
		let resource = await n4j.getElementByID(val);
		resources.push(resource);
	    }
	    //console.log(resources);
	    res.json(resources);
	    return;
	} else {
	    console.log('getElemnetByID from OS field: ' + field);
	}

	// Should never reach here ...
	throw Error('Neo4j getElementByID not implemented');
	
    } catch (error) {
	console.error('Error querying OpenSearch:', error);
	res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/resources/count/{field}/{values}:
 *   get:
 *     summary: Return the number of hits by field and id
 *     parameters:
 *       - in: path
 *         name: field
 *         required: true
 *         schema:
 *           type: string
 *         description: The field to match
 *       - in: path
 *         name: values
 *         required: true
 *         schema:
 *           type: string
 *         description: The values to match (comma-separated)
 *     responses:
 *       200:
 *         description: The number of hits
 *       500:
 *         description: Internal server error
 */
app.get('/api/resources/count/:field/:values', async (req, res) => {
    const { field, values } = req.params;
    const valueArray = values.split(',').map(value => decodeURIComponent(value)); // Decompose to handle openid as URL

    console.log('/api/resource/count');

    try{
	if (field == 'metadata.created_by'){
	    if (valueArray.length > 1){
		throw Error('Neo4j /api/resources/count/ not implemented for multiple values');
	    }
	    const response = await n4j.getElementsCountByContributor(valueArray[0]);
	    if (response < 0){
		res.status(500).send({ error: 'Error occurred while fetching resource count by contributor' });
		return;
	    }
	    res.json({count: response});

	} else {
	    throw Error('Neo4j Not Implemented - /api/resource/count: ' + field + ', ' + values);
	}
    } catch (error) {
	console.error('Error querying OpenSearch:', error);
	res.status(500).json({ message: 'Internal server error' });
    }
});


/**
 * @swagger
 * /api/users/{openid}:
 *   get:
 *     summary: Return the user document given the openid
 *     parameters:
 *       - in: path
 *         name: openid
 *         required: true
 *         schema:
 *           type: string
 *         description: The OpenID of the user
 *     responses:
 *       200:
 *         description: The user document
 *       404:
 *         description: User not found
 *       500:
 *         description: Error fetching the user
 */
app.get('/api/users/:openid', async (req, res) => {
    const openid = decodeURIComponent(req.params.openid);
    try {
	const response = await n4j.getContributorByID(openid);
	if (response.size == 0){
	    return res.status(404).json({ message: 'User not found' });
	}
	res.json(response);
    } catch (error) {
	console.error('Error fetching user:', error);
	res.status(500).json({ message: 'Error fetching the user' });
    }
});

/**
 * @swagger
 * /api/check_users/{openid}:
 *   get:
 *     summary: Check if a user exists given the openid
 *     parameters:
 *       - in: path
 *         name: openid
 *         required: true
 *         schema:
 *           type: string
 *         description: The OpenID of the user
 *     responses:
 *       200:
 *         description: True if user exists, false otherwise
 *       500:
 *         description: Error checking the user
 */
app.get('/api/check_users/:openid', async (req, res) => {
    const openid = decodeURIComponent(req.params.openid);

    console.log('Check user ...');
    try {
	const response = await n4j.checkContributorByID(openid);
	res.json(response);
    } catch (error) {
	console.error('Error checking user:', error);
	res.status(500).json({ message: 'Error checking the user' });
    }
});

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: Add a new user document
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               openid:
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
app.post('/api/users', async (req, res) => {
    const user = req.body;
    console.log('Adding new user');
    //console.log(user);

    try {
	const openid = user['openid'];
	const response = await n4j.registerContributor(user);
	if (response){
	    res.status(201).json({ message: 'User added successfully', id: openid });
	} else {
	    res.status(201).json({ message: 'User already exists', id: openid });
	    console.log('User already exists with openid: ' + openid);
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
 * /api/users/{openid}:
 *   put:
 *     summary: Update the user document
 *     parameters:
 *       - in: path
 *         name: openid
 *         required: true
 *         schema:
 *           type: string
 *         description: The OpenID of the user
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
app.put('/api/users/:openid', async (req, res) => {
    const openid = decodeURIComponent(req.params.openid);
    const updates = req.body;

    console.log('Updating user ...');

    try {
	const response = await n4j.updateContributor(openid, updates);
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


/**
 * @swagger
 * /api/users/{openid}:
 *   delete:
 *     summary: Delete the user document
 *     parameters:
 *       - in: path
 *         name: openid
 *         required: true
 *         schema:
 *           type: string
 *         description: The OpenID of the user
 *     responses:
 *       200:
 *         description: User deleted successfully
 *       500:
 *         description: Internal server error
 */
app.delete('/api/users/:openid', async (req, res) => {
    const openid = decodeURIComponent(req.params.openid);

    try {
	throw Error('Neo4j: Delete user is not implemented');
	// const response = await client.delete({
	//     index: 'users',
	//     id: openid
	// });

	// res.json({ message: 'User deleted successfully', result: response.body.result });
    } catch (error) {
	console.error('Error deleting user:', error);
	res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/retrieve-title:
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
app.get('/api/retrieve-title', async (req, res) => {
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
 * /api/searchByCreator:
 *   post:
 *     summary: Search for resources by creator
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               openid:
 *                 type: string
 *               sort_by:
 *                 type: string
 *               order:
 *                 type: string
 *                 enum: [asc, desc]
 *               from:
 *                 type: integer
 *               size:
 *                 type: integer
 *     responses:
 *       200:
 *         description: A list of search results
 *       400:
 *         description: openid is required
 *       500:
 *         description: Error querying OpenSearch
 */
app.post('/api/searchByCreator', async (req, res) => {
    const { openid, sort_by = '_score', order = 'desc', from = 0, size = 15 } = req.body;

    if (!openid) {
	return res.status(400).json({ error: 'openid is required' });
    }
    
    console.log('searchByCreator:' + openid);
    try {
	// Note: Neo4j query always orders by title, needs to be updated if required otherwise
	const response = await n4j.getElementsByContributor(openid, from, size);
	res.json(response);

    } catch (error) {
	console.error('Error querying OpenSearch:', error);
	res.status(500).json({ error: 'Error querying OpenSearch' });
    }
});

/**
 * @swagger
 * /api/elements/retrieve:
 *   post:
 *     summary: Retrieve elements by field and value
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               field_name:
 *                 type: string
 *               match_value:
 *                 type: array
 *                 items:
 *                   type: string
 *               element_type:
 *                 type: array
 *                 items:
 *                   type: string
 *               sort_by:
 *                 type: string
 *               order:
 *                 type: string
 *                 enum: [asc, desc]
 *               from:
 *                 type: integer
 *               size:
 *                 type: integer
 *               count_only:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: A list of elements or count of elements
 *       500:
 *         description: Internal server error
 */
app.post('/api/elements/retrieve', async (req, res) => {
    // [Done] Neo4j
    const { field_name, match_value, element_type, sort_by = '_score', order = 'desc', from = '0', size = '10', count_only = false } = req.body;

    //console.log('Neo4j /api/elements/retrieve - '+ element_type + ', ' + match_value);
    
    // Check if match_value or element_type is an empty array
    if (Array.isArray(match_value) && match_value.length === 0) {
	return res.json(count_only ? 0 : []);
    }
    if (Array.isArray(element_type) && element_type.length === 0) {
	return res.json(count_only ? 0 : []);
    }
    let sortBy = sort_by;
    if (sortBy === 'title') {
	sortBy = 'title.keyword';
    } else if (sortBy === 'authors') {
	sortBy = 'authors.keyword';
    }

    try{
	if (match_value !== null){
	    if (element_type !== null){
		throw Error('Neo4j not implemented: ' + element_type + ', ' + match_value);
	    } else if (count_only) {
		if (field_name == 'metadata.created_by') {
		    let total_count = 0;
		    for (let val of match_value){
			let response = await n4j.getElementsCountByContributor(val);
			total_count += response;
		    }
		    res.json(total_count);
		    return;
		} else {
		    throw Error('Neo4j not implemented: ' + element_type + ', ' + match_value);
		}
	    } else {
		if (field_name == '_id'){
		    const resources = [];
		    for (let val of match_value){
			let resource = await n4j.getElementByID(val);
			resources.push(resource);
		    }
		    res.json(resources);
		    return;
		} else if (field_name == 'metadata.created_by') {
		    const resources = [];
		    for (let val of match_value){
			let resource = await n4j.getElementsByContributor(val, from, size);
			resources.push(...resource);
		    }
		    res.json(resources);
		    return;
		} else {
		    throw Error('Neo4j not implemented: ' + element_type + ', ' + match_value);
		}
	    }
	} else if (element_type !== null){
	    if (match_value !== null){
		// should never reach here
		throw Error('Neo4j not implemented: ' + element_type + ', ' + match_value);
	    } else if (count_only) {
		let total_count = 0;
		for (let val of element_type){
		    let response = await n4j.getElementsCountByType(val);
		    total_count += response;
		}
		res.json(total_count);
	    } else {
		const resources = [];
		for (let val of element_type){
		    let resource = await n4j.getElementsByType(val, from, size);
		    if (resource.length > 0){
			resources.push(...resource);
		    }
		}
		res.json(resources);
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

console.log(`${process.env.SERV_TAG} server is up`);

const PORT = 3001;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

https.createServer(options, app).listen(3000, () => {
    console.log('HTTPS server is running on 3000');
});

// Serve Swagger docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));
