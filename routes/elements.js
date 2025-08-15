/****************************************************************************
 * Elements Endpoints
 ****************************************************************************/
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import fs from 'fs';
import { exec } from 'child_process';
import fetch from 'node-fetch';
import path from 'path';
import axios from 'axios';
// local imports
import * as utils from '../utils.js';
import * as n4j from '../backend_neo4j.js';
import * as os from '../backend_opensearch.js';
import { jwtCORSOptions, jwtCorsOptions, jwtCorsMiddleware } from '../iguide_cors.js';
import {authenticateJWT, authorizeRole, checkJWTTokenBypass, generateAccessToken} from '../jwtUtils.js';
import {
	ElementType,
	parseElementType,
	parseVisibility,
	Role,
	updateOSBasedtOnVisibility,
	Visibility
} from "../utils.js";
import {
	getFlaskEmbeddingResponse,
	performElementOpenSearchDelete,
	performElementOpenSearchInsert, performElementOpenSearchUpdate
} from "./elements_utils.js";
import {convertGeoSpatialFields} from "./rag_modules/spatial_utils.js"
import {
	abortMultipartUpload, ALLOWED_MIME_TYPES,
	completeMultipartUpload,
	deleteElementData,
	getUploadDetails,
	getUploadProgress,
	initializeChunkUpload,
	MAX_FILE_SIZE,
	moveDatasetToElement,
	multiChunkUpload,
	performDatasetDeletion,
	processChunkBasedOnUploadId,
	upload,
} from "./minio_uploader.js";
import {elementsRateLimiter} from "../ip_policy.js";

const router = express.Router();

//Addition of rate limiter
router.use(elementsRateLimiter);

/****************************************************************************/
// Ensure required directories exist
const thumbnail_dir = path.join(process.env.UPLOAD_FOLDER, 'thumbnails');
const notebook_html_dir = path.join(process.env.UPLOAD_FOLDER, 'notebook_html');
fs.mkdirSync(thumbnail_dir, { recursive: true });
fs.mkdirSync(notebook_html_dir, { recursive: true });
// Serve static files from the thumbnails directory
router.use('/user-uploads/thumbnails', express.static(thumbnail_dir));
router.use('/user-uploads/notebook_html', express.static(notebook_html_dir));
// Configure storage for thumbnails
const thumbnailStorage = multer.diskStorage({
    destination: (req, file, cb) => {
	cb(null, thumbnail_dir);
    },
    filename: (req, file, cb) => {
	// It's a good practice to sanitize the original file name
	const sanitizedFilename = file.originalname.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
	cb(null, `${Date.now()}-${sanitizedFilename}`);
    }
});
const uploadThumbnail = multer({ storage: thumbnailStorage });

// Function to convert notebook to HTML
async function fetchNotebookContent(url) {
    // [Done] Neo4j not required
    const response = await fetch(url);
    if (response.ok) {
	return await response.text();
    }
    throw Error('Failed to fetch the notebook');
}

function parseGitHubNotebookUrl(url) {
  const GITHUB_BLOB_PREFIX = 'https://github.com/';

  if (!url.startsWith(GITHUB_BLOB_PREFIX)) {
    throw new Error('Invalid GitHub URL: Must start with https://github.com/');
  }

  const parts = new URL(url).pathname.split('/').filter(Boolean);

  if (parts.length < 5 || parts[2] !== 'blob') {
    throw new Error('Invalid GitHub notebook URL format');
  }

  const username = parts[0];
  const repo = parts[1];
  const branch = parts[3];
  const filePath = parts.slice(4).join('/');
  const filename = parts[parts.length - 1];

  const rawUrl = `https://raw.githubusercontent.com/${username}/${repo}/${branch}/${filePath}`;

  return {
    username: username,
    repo: repo,
    branch: branch,
    file_path: filePath,
    filename: filename,
    raw_url: rawUrl
  };
}

async function convertNotebookToHtmlV2(githubUrl, outputDir) {
	const fileDetails = parseGitHubNotebookUrl(githubUrl)
	const notebookName = fileDetails.filename;
	const timestamp = Date.now();
	const htmlOutputPath = path.join(outputDir, `${timestamp}-${notebookName}.html`);
	let notebookContent;
	try {
		notebookContent = await fetchNotebookContent(fileDetails.raw_url)
	} catch (error) {
		console.log(`Failed to fetch from ${fileDetails.branch}. Exiting process..`);
	}
	if (!notebookContent) {
		console.log('Failed to fetch the notebook from the provided branch');
		return null;
    }
	const notebookFilePath = path.join(outputDir, `${timestamp}-${notebookName}.ipynb`);
    fs.writeFileSync(notebookFilePath, notebookContent);

	try {
		await new Promise((resolve, reject) => {
	    	exec(`jupyter nbconvert --to html "${notebookFilePath}" --output "${timestamp}-${notebookName}.html" --output-dir "${outputDir}"`,
		 	(error, stdout, stderr) => {
		    	 if (error) {
			 		reject(`Error converting notebook: ${stderr}`);
		     	} else {
			 		resolve();
		     	}
		 	});
		});

		// Once html is converted deleting the .ipynb notebook file
		if (fs.existsSync(notebookFilePath)) {
			fs.unlinkSync(notebookFilePath);
		}
		return {
			htmlOutputPath: htmlOutputPath,
			'notebook-repo': `https://github.com/${fileDetails.username}/${fileDetails.repo}`,
			'notebook-file': fileDetails.file_path,
			'notebook-url': githubUrl,
		};
	} catch (error) {
		console.log('Error in converting to html: ' + error);
		return null;
    }
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

/****************************************************************************/

/**
 * @swagger
 * /api/elements/bookmark:
 *   get:
 *     summary: Get all bookmarked elements by user with userId
 *     tags: ['elements']
 *     parameters:
 *       - in: query
 *         name: user-id
 *         required: true
 *         schema:
 *           type: string
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
 *     responses:
 *       200:
 *         description: Bookmarked elements by user found
 *       404:
 *         description: No bookmarked elements found
 *       500:
 *         description: Internal server error
 */
router.options('/api/elements/bookmark', jwtCorsMiddleware);
router.get('/api/elements/bookmark', jwtCorsMiddleware, authenticateJWT, async (req, res) => {
    //const user_id = decodeURIComponent(req.params['userId']);
    const { 'user-id': user_id,
	    'sort-by': sort_by,
	    'order': order,
	    'from': from,
	    'size': size,
	    'count-only':count_only} = req.query;

    try {
	let total_count = 0;
	let bookmarked_elements = [];
	// get all public bookmarked elements for user
	const public_elements = await n4j.getElementsBookmarkedByContributor(user_id,
									      from,
									      size,
									      sort_by,
									      order,
									      false
									     );
	total_count += public_elements['total-count'];
	// get all private bookmarked elements for user
	const private_elements = await n4j.getElementsBookmarkedByContributor(user_id,
									       from,
									       size,
									       sort_by,
									       order,
									       true
									      );
	total_count += private_elements['total-count'];
	bookmarked_elements = [...public_elements['elements'],
			       ...private_elements['elements']];
	if (total_count == 0){
	    return res.status(404).json({message: 'No bookmarked elements found'});
	}

	res.status(200).json({elements:bookmarked_elements,
			      'total-count': total_count});
    } catch (error) {
	console.error('Error getting bookmarked elememts:', error);
	res.status(500).json({ message: 'Error getting bookmarked elememts' });
    }
});

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
router.options('/api/elements/titles', cors());
router.get('/api/elements/titles', cors(), async (req, res) => {
    // [Done] Neo4j not required. For related elements when registering. Should be from OS
    const elementType = req.query['element-type'];
    const scrollTimeout = '1m'; // Scroll timeout

    if (!elementType) {
	res.status(400).json({ message: 'element_type query parameter is required' });
	return;
    }

    try {
	// Initial search request with scrolling
	const initialSearchResponse = await os.client.search({
	    index: os.os_index,
	    scroll: scrollTimeout,
	    body: {
        size: 100, // Number of results to fetch per scroll request
        query: {
            bool: {
                must: [
                    { term: { 'resource-type': elementType } }
                ]
            }
        },
        _source: ['title'], // Only fetch the title field
    },
	});

	let scrollId = initialSearchResponse.body._scroll_id;
	let allTitles = initialSearchResponse.body.hits.hits.map(hit => hit._source.title);

	// Function to handle scrolling
	const fetchAllTitles = async (scrollId) => {
	    while (true) {
		const scrollResponse = await os.client.scroll({
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
 *           enum: [dataset, notebook, publication, oer, map, code]
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
router.options('/api/elements/homepage', cors());
router.get('/api/elements/homepage', cors(), async (req, res) => {
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
 * /api/elements/datasets:
 *   delete:
 *     summary: Delete an uploaded dataset
 *     tags: ['elements', 'datasets']
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - url
 *             properties:
 *               url:
 *                 type: string
 *                 description: The S3/MinIO URL of the uploaded dataset to delete
 *                 example: "https://minio.example.com/my-bucket/path/to/file.csv"
 *     responses:
 *       200:
 *         description: Upload deleted successfully
 *       404:
 *         description: Dataset URL not present
 *       500:
 *         description: Failed to delete dataset
 */

router.options('/api/elements/datasets', jwtCorsMiddleware);
router.delete('/api/elements/datasets',
	jwtCorsMiddleware,
	authenticateJWT,
	async (req, res) => {
	try {
		const request_body = req.body;
		let uploadedUrl = ""
		if (!request_body['url']) {
			res.status(404).json({message: 'Dataset URL not present.'});
			return;
		} else {
			uploadedUrl = request_body['url'];
		}
		const response = await deleteElementData(uploadedUrl);
		if (response.success) {
			res.status(200).json(response);
		} else {
			res.status(500).json(response);
		}

	} catch (error) {
		console.error('Error deleting dataset:', error);
		res.status(500).json({error: 'Failed to delete dataset'});
	}
});

/**
 * @swagger
 * /api/elements/{id}:
 *   get:
 *     summary: Retrieve ONE public element using id.
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
 *       403:
 *         description: Insufficient permission to view this element
 *       404:
 *         description: No element found with given ID
 *       500:
 *         description: Internal server error
 */
router.get('/api/elements/:id', cors(), async (req, res) => {

    const element_id = decodeURIComponent(req.params['id']);
    try {
	// to avoid direct access to private elements via URL
	const element_visibility = await n4j.getElementVisibilityForID(element_id);
	if (element_visibility === utils.Visibility.PRIVATE){
	    res.status(404).json({ message: 'Element not found' });
	    return;
	}
	const element = await n4j.getElementByID(element_id);
	if (JSON.stringify(element) === '{}'){
	    res.status(404).json({ message: 'Element not found' });
	    return;
	}

	res.status(200).json(element);
    } catch (error) {
	console.error('/api/resources/:id Error querying:', error);
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
router.options('/api/elements/:id', (req, res) => {
    const method = req.header('Access-Control-Request-Method');
    if (method === 'PUT') {
        res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
        res.header('Access-Control-Allow-Methods', 'PUT');
        res.header('Access-Control-Allow-Headers', jwtCorsOptions.allowedHeaders);
        res.header('Access-Control-Allow-Credentials', 'true');
    } else if (method === 'POST') {
        res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
        res.header('Access-Control-Allow-Methods', 'POST');
        res.header('Access-Control-Allow-Headers', jwtCorsOptions.allowedHeaders);
        res.header('Access-Control-Allow-Credentials', 'true');
    } else if (method === 'GET') {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET');
        res.header('Access-Control-Allow-Headers', jwtCorsOptions.allowedHeadersWithoutAuth);
    }else if (method === 'DELETE') {
        res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
        res.header('Access-Control-Allow-Methods', 'DELETE');
        res.header('Access-Control-Allow-Headers', jwtCorsOptions.allowedHeaders);
        res.header('Access-Control-Allow-Credentials', 'true');
    }
    res.sendStatus(204); // No content
});

router.options('/api/elements', (req, res) => {
    const method = req.header('Access-Control-Request-Method');
    if (method === 'PUT') {
        res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
        res.header('Access-Control-Allow-Methods', 'PUT');
        res.header('Access-Control-Allow-Headers', jwtCorsOptions.allowedHeaders);
        res.header('Access-Control-Allow-Credentials', 'true');
    } else if (method === 'POST') {
        res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
        res.header('Access-Control-Allow-Methods', 'POST');
        res.header('Access-Control-Allow-Headers', jwtCorsOptions.allowedHeaders);
        res.header('Access-Control-Allow-Credentials', 'true');
    } else if (method === 'GET') {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET');
        res.header('Access-Control-Allow-Headers', jwtCorsOptions.allowedHeadersWithoutAuth);
    }else if (method === 'DELETE') {
        res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
        res.header('Access-Control-Allow-Methods', 'DELETE');
        res.header('Access-Control-Allow-Headers', jwtCorsOptions.allowedHeaders);
        res.header('Access-Control-Allow-Credentials', 'true');
    }
    res.sendStatus(204); // No content
});
//router.options('/api/elements', cors());
router.get('/api/elements', cors(), async (req, res) => {
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
		} else if (field_name == 'contributor') {
		    const resources = [];
		    let total_count = 0;
		    for (let val of match_value){
			let resource = await n4j.getElementsByContributor(val,
									  from,
									  size,
									  sort_by,
									  order);
			//total_count += await n4j.getElementsCountByContributor(val);
			total_count += resource['total-count'];
			resources.push(...resource['elements']);
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
		    if (resource['total-count'] > 0){
			resources.push(...resource['elements']);
		    }
		    total_count += resource['total-count'];
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
 *       402:
 *         description: Registration failed because of duplicate
 *       403:
 *         description: The user does not have the permission to make the contribution
 *       500:
 *         description: Internal server error
 */
//router.options('/api/elements', jwtCorsMiddleware);
router.post('/api/elements',
	 jwtCorsMiddleware,
	 authenticateJWT,
	 authorizeRole(utils.Role.TRUSTED_USER),
	 async (req, res) => {
    const resource = req.body;
    const {user_id, user_role} = (() => {
	if (!req.user || req.user == null || typeof req.user === 'undefined'){
	    return {user_id:null, user_role:null};
	}
	return {user_id:req.user.id, user_role:req.user.role}
    })();

    try {
        console.log('Registering ' + resource['resource-type'] + 'by ' + user_id);
        // Check if the resource type is "oer" and user have enough permission to add OER
        //if (resource['resource-type'] === 'oer' &&
	    //!(user_role <= utils.Role.UNRESTRICTED_CONTRIBUTOR)) {
		// HotFix: OERshare
	    if (resource['resource-type'] === 'oer' &&
	    !(user_role <= utils.Role.TRUSTED_USER_PLUS)) {
            console.log(user_id, " blocked by role")
            return res.status(403).json({ message: 'Forbidden: You do not have permission to submit OER elements.' });
        }else{
            console.log(user_id, " is allowed to submit oers")
        }
		// HotFix: OERshare
		if (resource['resource-type'] === 'oer' &&
	    	(user_role === utils.Role.TRUSTED_USER_PLUS)) {
			if (!resource['tags'].includes('OERshare')) {
				resource['tags'].push('OERshare')
			}
		}		
		/**
		 * Updated logic building the repo details,
		 * 	In the request resource['notebook-url']
		 * 		resource['notebook-repo']  => repo name
		 * 		resource['notebook-file'] => file_name (
		 * 		resource['html-notebook'] => generated
		 * 		resource['notebook-url'] => new additions (if not present in the resource )
		 */
		if (resource['resource-type'] === 'notebook' &&
			resource['notebook-url']) {
			const notebookDetails = await convertNotebookToHtmlV2(resource['notebook-url'], notebook_html_dir);
			console.log("notebook details runs: ", notebookDetails);
			if (notebookDetails) {
				resource['html-notebook'] =
					`https://${process.env.DOMAIN}:${process.env.PORT}/user-uploads/notebook_html/${path.basename(notebookDetails.htmlOutputPath)}`
				resource['notebook-repo'] = notebookDetails["notebook-repo"];
				resource['notebook-file'] = notebookDetails['notebook-file'];
			}
		}
		// Handle notebook resource type
		// if (resource['resource-type'] === 'notebook' &&
        //     resource['notebook-repo'] &&
        //     resource['notebook-file']) {
        //     const htmlNotebookPath =
        //         await convertNotebookToHtml(resource['notebook-repo'],
        //                                     resource['notebook-file'], notebook_html_dir);
        //     if (htmlNotebookPath) {
        //         resource['html-notebook'] =
        //             `https://${process.env.DOMAIN}:${process.env.PORT}/user-uploads/notebook_html/${path.basename(htmlNotebookPath)}`;
        //     }
        // }

        const contributor_id = resource['metadata']['created_by'];

        // Register element in Neo4j
        const {response, element_id} = await n4j.registerElement(contributor_id, resource);

        if (response) {
			if (parseElementType(resource['resource-type']) === ElementType.DATASET
				&& resource['direct-download-link'].startsWith(process.env.MINIO_ENDPOINT)) {
				// Move the dataset to the element entry
				const updated_download_link = await moveDatasetToElement(resource['direct-download-link'], element_id)
				if (updated_download_link === "") {
					console.log('error in updating direct-download-link for file: ' + resource['direct-download-link']);
				} else {
					resource['direct-download-link'] = updated_download_link;
					resource['user-uploaded-dataset'] = true;
					const response = await n4j.updateElement(element_id, resource);
					if (!response) {
						console.log('registerElement() - Error in updating direct-download-link for element_id: '
							+ element_id + " link: "  + updated_download_link);
					}
				}
			}
			let resource_visibility = parseVisibility(resource['visibility']);
			//Indexing the Element only if the visibility is Public
			if (resource_visibility === Visibility.PUBLIC) {
				let geo_spatial_resource = convertGeoSpatialFields(resource)
				//Create indexable part for the resource
				let os_element = {
					title: resource['title'],
					contents: resource['contents'],
					authors: resource['authors'],
					tags: resource['tags'],
					'resource-type': resource['resource-type'],
					'thumbnail-image': resource['thumbnail-image']['original'],
					// spatial-temporal
					'spatial-coverage': resource['spatial-coverage'],
					'spatial-geometry': resource['spatial-geometry'],
					'spatial-geometry-geojson': geo_spatial_resource['spatial-geometry-geojson'],
					'spatial-bounding-box': resource['spatial-bounding-box'],
					'spatial-bounding-box-geojson': geo_spatial_resource['spatial-bounding-box-geojson'],
					'spatial-centroid': resource['spatial-centroid'],
					'spatial-centroid-geojson': geo_spatial_resource['spatial-centroid-geojson'],
					'spatial-georeferenced': resource['spatial-georeferenced'],
					'spatial-temporal-coverage': resource['spatial-temporal-coverage'],
					'spatial-index-year': resource['spatial-index-year']
				};
				console.log('Getting contributor name');
				// Set contributor name
				let contributor = await n4j.getContributorByID(contributor_id);
				let contributor_name = '';
				if ('display-first-name' in contributor || 'display-last-name' in contributor) {
					contributor_name = `${contributor['display-first-name']} ${contributor['display-last-name']}`;
				}
				os_element['contributor'] = contributor_name;

				let content_embedding = await getFlaskEmbeddingResponse(resource['contents']);
				if (content_embedding) {
					os_element['contents-embedding'] = content_embedding;
				}
				console.log('Indexing element: ' + os_element);
				let os_response = await performElementOpenSearchInsert(os_element, element_id);
				console.log('OpenSearch Indexing result: ', os_response);
			}
            res.status(200).json({ message: 'Resource registered successfully', elementId: element_id });
        } else {
			if (element_id) {
			// registration failed because of duplicate element
			console.log('Duplicate found while registering resource ...');
			res.status(402).json(
				{
					message: 'Duplicate found while registering resource',
					error: 'Duplicate found while registering resource',
					elementId: element_id
				});
	    	} else {
				console.log('Error registering resource ...');
				res.status(500).json({ error: 'Error registering resource' });
	    	}
        }
    } catch (error) {
		console.log("error in creating element: ", error);
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
router.options('/api/elements/:id', jwtCorsMiddleware);
router.delete('/api/elements/:id', jwtCorsMiddleware, authenticateJWT, async (req, res) => {
    const resourceId = req.params['id'];
	const {user_id, user_role} = (() => {
		if (!req.user || req.user == null || typeof req.user === 'undefined'){
	    	return {user_id:null, user_role:null};
		}
		return {user_id:req.user.id, user_role:req.user.role}
    })();
    console.log('Deleting element: ' +  resourceId + " for user id: " + user_id);
	let elementDetails = await n4j.getElementByID(resourceId);
	if (!elementDetails['id']) {
		/**
		 * Check if the element is private as it won't be returned in the normal GET call
		 */
		elementDetails = await n4j.getElementByID(resourceId, user_id);
	}
	if (!elementDetails['id']) {
		res.status(404).json({message: 'Element does not exist'});
		return;
	}
    try {
		const response = await n4j.deleteElementByID(resourceId);
		if (response) {
	    	// Deletes from OpenSearch regardless if it's present or not
			let os_response = await performElementOpenSearchDelete(resourceId);
			console.log("OpenSearch Response: " , os_response);
			try {
                //Delete the dataset from MinIO if the same is hosted there
				let minIOResponse = await performDatasetDeletion(elementDetails);
				console.log("MinIO Response: ", minIOResponse);

				let thumbnail_url = elementDetails['thumbnail-image'];
				console.log("Deleting element's thumbnail image for Element Id: ", resourceId);
				if (thumbnail_url) {
					for (const type in thumbnail_url) {
						let thumbnail_filepath = path.join(thumbnail_dir, path.basename(thumbnail_url[type]));
						if (fs.existsSync(thumbnail_filepath)) {
							fs.unlinkSync(thumbnail_filepath);
						}
					}
				}

                let notebook_html_url = elementDetails['html-notebook'];
				console.log("Deleting element's html-notebook file for Element Id: ", resourceId);
				if (notebook_html_url) {
					let notebook_html_filepath = path.join(notebook_html_dir, path.basename(notebook_html_url));
					if (fs.existsSync(notebook_html_filepath)) {
						fs.unlinkSync(notebook_html_filepath);
					}
				}
			} catch (error) {
				console.log('Users Delete API - Error in deleting avatar: ' + error);
			}
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
//router.options('/api/elements/:id', jwtCorsMiddleware);
router.put('/api/elements/:id', jwtCorsMiddleware, authenticateJWT, async (req, res) => {
    const id = decodeURIComponent(req.params.id);
    const updates = req.body;

    console.log('Updating element with id: ' + id);

    try {
		const can_edit = await utils.userCanEditElement(id, req.user.id, req.user.role);
		if (!can_edit) {
			res.status(403).json({message: 'Forbidden: You do not have permission to edit this element.'});
		}
		// HotFix: OERshare
		if (updates['resource-type'] === 'oer' &&
	    	(req.user.role === utils.Role.TRUSTED_USER_PLUS)) {
			if (!updates['tags'].includes('OERshare')) {
				updates['tags'].push('OERshare')
			}
		}
		/**
		 * Updated logic building the repo details,
		 *    In the request resource['notebook-url']
		 *        resource['notebook-repo']  => repo name
		 *        resource['notebook-file'] => file_name (
		 *        resource['html-notebook'] => generated
		 *        resource['notebook-url'] => new additions (if not present in the resource )
		 */
		if (updates['resource-type'] === 'notebook' &&
			updates['notebook-url']) {
			const notebookDetails = await convertNotebookToHtmlV2(updates['notebook-url'], notebook_html_dir);
			if (notebookDetails) {
				updates['html-notebook'] =
					`https://${process.env.DOMAIN}:${process.env.PORT}/user-uploads/notebook_html/${path.basename(notebookDetails.htmlOutputPath)}`
				updates['notebook-repo'] = notebookDetails["notebook-repo"];
				updates['notebook-file'] = notebookDetails['notebook-file'];
			}
		}
		// if (updates['resource-type'] === 'notebook' &&
		//         updates['notebook-repo'] &&
		//         updates['notebook-file']) {
		//         const htmlNotebookPath =
		//             await convertNotebookToHtml(updates['notebook-repo'],
		//                                         updates['notebook-file'], notebook_html_dir);
		//         if (htmlNotebookPath) {
		//             updates['html-notebook'] =
		//                 `https://${process.env.DOMAIN}:${process.env.PORT}/user-uploads/notebook_html/${path.basename(htmlNotebookPath)}`;
		//         }
		//     }
		const element_old_visibility = await n4j.getElementVisibilityForID(id);
		const response = await n4j.updateElement(id, updates);
		if (response) {
			// 'visibility' field is NOT searchable so should NOT be added to OS
			// elements should ONLY be in OpenSearch if they are public
			const visibility = utils.parseVisibility(updates['visibility']);
			const visibility_action = updateOSBasedtOnVisibility(element_old_visibility, visibility);
			const geo_spatial_updates = convertGeoSpatialFields(updates)
			let os_doc_body = {
				'title': updates['title'],
				'contents': updates['contents'],
				// Update the embedding field
				// 'contents-embedding': newEmbedding,
				'resource-type': updates['resource-type'],
				'authors': updates['authors'],
				'tags': updates['tags'],
				'thumbnail-image': updates['thumbnail-image']['original'],
				// Spatial-temporal properties
				'spatial-coverage': updates['spatial-coverage'],
				'spatial-geometry': updates['spatial-geometry'],
				'spatial-geometry-geojson': geo_spatial_updates['spatial-geometry-geojson'],
				'spatial-bounding-box': updates['spatial-bounding-box'],
				'spatial-bounding-box-geojson': geo_spatial_updates['spatial-bounding-box-geojson'],
				'spatial-centroid': updates['spatial-centroid'],
				'spatial-centroid-geojson': geo_spatial_updates['spatial-centroid-geojson'],
				'spatial-georeferenced': updates['spatial-georeferenced'],
				'spatial-temporal-coverage': updates['spatial-temporal-coverage'],
				'spatial-index-year': updates['spatial-index-year'],
				// Type and contributor should never be updated
			}
			switch (visibility_action) {
				case 'INSERT':
					let contributor = await n4j.getContributorByID(req.user.id);
					let contributor_name = '';
					if ('display-first-name' in contributor || 'display-last-name' in contributor) {
						contributor_name = `${contributor['display-first-name']} ${contributor['display-last-name']}`;
					}
					os_doc_body['contributor'] = contributor_name;
					let contentEmbeddingInsert = await getFlaskEmbeddingResponse(updates['contents']);
					if (contentEmbeddingInsert) {
						os_doc_body['contents-embedding'] = contentEmbeddingInsert;
					}
					let os_insert_response = await performElementOpenSearchInsert(os_doc_body, id);
					console.log("OpenSearch Response: ", os_insert_response);
					break;
				case 'UPDATE':
					let contentEmbeddingUpdate = await getFlaskEmbeddingResponse(updates['contents']);
					if (contentEmbeddingUpdate) {
						os_doc_body['contents-embedding'] = contentEmbeddingUpdate;
					}
					let os_update_response = await performElementOpenSearchUpdate(os_doc_body, id);
					console.log("OpenSearch Response: ", os_update_response);
					break;
				case 'DELETE':
					let os_delete_response = await performElementOpenSearchDelete(id);
					console.log("OpenSearch Response: ", os_delete_response);
					break;
				case 'NONE':
				default:
					break;
			}
			res.status(200).json({message: 'Element updated successfully', result: response});
		} else {
			console.log('Error updating element');
			res.status(500).json({message: 'Error updating element', result: response});
		}
    } catch (error) {
		console.error('Error updating element:', error);
		res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/elements/{id}/visibility:
 *   put:
 *     summary: Set visibility for the element with given ID
 *     tags: ['elements']
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The id of the element
 *       - in: query
 *         name: visibility
 *         required: true
 *         schema:
 *           type: string
 *           enum: [public, private]
 *         description: The visibility value
 *     responses:
 *       200:
 *         description: Element visibility updated successfully
 *       403:
 *         description: The user does not have the permission to edit this element
 *       500:
 *         description: Internal server error
 */
router.put('/api/elements/:id/visibility', cors(), jwtCorsMiddleware, authenticateJWT, async (req, res) => {
    const id = decodeURIComponent(req.params.id);
    const visibility_str = decodeURIComponent(req.query.visibility);

    console.log('Setting visibility (' + visibility_str + ') for element with id: ' + id);

    try {
	const can_edit = await utils.userCanEditElement(id, req.user.id, req.user.role);
	if (!can_edit){
	    res.status(403).json({ message: 'Forbidden: You do not have permission to edit this element.' });
	}

	const visibility = utils.parseVisibility(visibility_str);
	console.log(visibility);

	const response =
	      await n4j.setElementVisibilityForID(id, visibility);

	// 'visibility' field is NOT searchable so should NOT be added to OS
	// elements should ONLY be in OpenSearch if they are public
	if (response) {
	    if (visibility === utils.Visibility.PUBLIC) {
		// [ToDo] add/update element to OpenSearch
	    } else {
		// [ToDo] remove element from OpenSearch
	    }

	    // // Update in OpenSearch
	    // const response = await os.client.update({
	    // 	id: id,
	    // 	index: os.os_index,
	    // 	body: {
	    // 	    doc: {
	    // 		'visibility': visibility
	    // 	    }
	    // 	},
	    // 	refresh: true,
	    // });
	    // console.log('OpenSearch set visibility:' + response['body']['result']);
	    res.status(200).json({ message: 'Element visibility updated successfully'});
	} else {
	    console.log('Error updating element');
	    res.status(500).json({ message: 'Error updating element'});
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
router.options('/api/elements/thumbnail', jwtCorsMiddleware);
router.post('/api/elements/thumbnail', jwtCorsMiddleware, uploadThumbnail.single('file'), authenticateJWT, (req, res) => {
	// // [ToDo] Change filename to user ID
    // const filePath = `https://${process.env.DOMAIN}:${process.env.PORT}/user-uploads/thumbnails/${req.file.filename}`;
    try {
        const body = JSON.parse(JSON.stringify(req.body));
        const element_id = body.id;
        const new_thumbnail_file = req.file;

        if (!new_thumbnail_file) {
            return res.status(400).json({ message: 'Element ID and new thumbnail file are required' });
        }

        // Call the image processing function with a callback for error handling
        utils.generateMultipleResolutionImagesFor(new_thumbnail_file.filename, thumbnail_dir, false, (errorMessage, images) => {
            if (errorMessage) {
                return res.status(400).json({ message: errorMessage });
            }

            res.json({
                message: 'Thumbnail uploaded successfully',
                'image-urls': images
            });
        });

    } catch (error) {
        console.error('Error processing image:', error);
        res.status(500).json({ message: 'Error processing image' });
    }
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
 *         description: The ID of the elements
 *     responses:
 *       200:
 *         description: JSON Map for related elements
 *       404:
 *         description: User not found
 *       500:
 *         description: Error fetching the element
 */
router.options('/api/elements/:id/neighbors', cors());
router.get('/api/elements/:id/neighbors', cors(), async (req, res) => {
    const id = decodeURIComponent(req.params.id);
    try {
	const response = await n4j.getRelatedElementsForID(id);
	if (JSON.stringify(response) === '{}'){
	    return res.status(404).json({message: 'No related elements found',
					 nodes:[],
					 neighbors:[] });
	}
	res.status(200).json(response);
    } catch (error) {
	console.error('Error fetching related elements:', error);
	res.status(500).json({ message: 'Error fetching related elements' });
    }
});

/**
 * @swagger
 * /api/duplicate:
 *   get:
 *     summary: Check for duplicate in elements given field-name
 *     tags: ['elements']
 *     parameters:
 *       - in: query
 *         name: field-name
 *         required: true
 *         schema:
 *           type: string
 *           enum: [doi, dataset-link, github-repo-link]
 *         description: The field to check duplicate for
 *       - in: query
 *         name: value
 *         required: true
 *         schema:
 *           type: string
 *         description: Value of the field name to check for duplicates
 *     responses:
 *       200:
 *         description: True if duplicate found, false otherwise
 *       500:
 *         description: Internal server error
 */
router.options('/api/duplicate', cors());
router.get('/api/duplicate',
	cors(),
	async (req, res) => {
//router.get('/api/elements/duplicate', async (req, res) => {

    let field_name = req.query['field-name'];
    let value = req.query['value'];
    try {
	const {response, element_id} = await n4j.checkDuplicatesForField(field_name, value);
	if (response) {
	    res.status(200).json({duplicate:true, elementId:element_id});
	} else {
	    res.status(200).json({duplicate:false, elementId:null});
	}
    } catch (error) {
	console.error('Error checking duplicate:', error);
	res.status(500).json({ message: 'Error checking duplicate' });
    }
});

/**
 * @swagger
 * /api/connected-graph:
 *   get:
 *     summary: Get all nodes and relations for the connected elements
 *     tags: ['elements']
 *     responses:
 *       200:
 *         description: Related elements found
 *       404:
 *         description: No related elements found
 *       500:
 *         description: Internal server error
 */
router.options('/api/connected-graph', cors());
router.get('/api/connected-graph', cors(), async (req, res) => {
    try {
	const response = await n4j.getAllRelatedElements();
	if (JSON.stringify(response) === '{}'){
	    return res.status(404).json({message: 'No related elements found',
					 nodes:[],
					 neighbors:[] });
	}
	//console.log('Number of connected nodes: ' + response['nodes'].length);
	//console.log('Number of relations: ' + response['neighbors'].length);
	res.status(200).json(response);
    } catch (error) {
	console.error('Error getting related elememts:', error);
	res.status(500).json({ message: 'Error getting related elememts' });
    }
});

// /**
//  * @swagger
//  * /api/elements/datasets/simple:
//  *   post:
//  *     summary: Upload a dataset (CSV or ZIP) for sizes less than 5 MB
//  *     tags: ['elements', 'datasets']
//  *     consumes:
//  *       - multipart/form-data
//  *     parameters:
//  *       - in: formData
//  *         name: file
//  *         type: file
//  *         description: The dataset file to upload
//  *     responses:
//  *       200:
//  *         description: Dataset uploaded successfully
//  *       400:
//  *         description: No file uploaded or invalid file type (.csv or .zip)
//  */
router.options('/api/elements/datasets/simple', jwtCorsMiddleware);
router.post('/api/elements/datasets/simple',
	jwtCorsMiddleware,
	authenticateJWT,
	upload.single('file'), (req, res) => {
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
 * /api/elements/datasets/chunk/init:
 *   post:
 *     summary: Initialize a multipart upload for a large dataset (more than 100 MB Limit 2 GB)
 *     tags: ['elements', 'datasets']
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - filename
 *               - fileSize
 *               - mimeType
 *             properties:
 *               filename:
 *                 type: string
 *               fileSize:
 *                 type: integer
 *               mimeType:
 *                 type: string
 *     responses:
 *       200:
 *         description: Upload initialized successfully
 *       400:
 *         description: File size or type is invalid
 *       500:
 *         description: Failed to initialize upload
 */
router.options('/api/elements/datasets/chunk/init', jwtCorsMiddleware);
router.post('/api/elements/datasets/chunk/init',
	jwtCorsMiddleware,
	authenticateJWT,
	async (req, res) => {
	try {
		const {filename, fileSize, mimeType} = req.body;
		const {user_id, user_role} = (() => {
			if (checkJWTTokenBypass(req)) {
				return {user_id: "MASTER_USER", user_role: Role.SUPER_ADMIN};
			}
			if (!req.user || req.user == null || typeof req.user === 'undefined'){
	    		return {user_id:null, user_role:null};
			}
			return {user_id:req.user.id, user_role:req.user.role};
    	})();

		// Validate file size (2GB limit)
		if (fileSize > MAX_FILE_SIZE) {
			return res.status(400).json({
				error: 'File size exceeds 2GB limit'
			});
		}

		// Validate mime type
		if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
			return res.status(400).json({
				error: 'Invalid file type. Only CSV and ZIP files are allowed.'
			});
		}

		// Generate unique upload ID
		const response = await initializeChunkUpload(filename, fileSize, mimeType, user_id);
		if (response) {
			res.status(200).json(response);
		} else {
			res.status(500).json({message: 'Failed to initialize upload'});
		}

	} catch (error) {
		console.error('Error initializing upload:', error);
		res.status(500).json({message: 'Failed to initialize upload'});
	}
});

/**
 * @swagger
 * /api/elements/datasets/chunk/{uploadId}:
 *   post:
 *     summary: Upload a chunk of a large dataset file
 *     tags: ['elements', 'datasets']
 *     consumes:
 *       - multipart/form-data
 *     parameters:
 *       - in: path
 *         name: uploadId
 *         required: true
 *         schema:
 *           type: string
 *       - in: formData
 *         name: chunk
 *         type: file
 *         description: The chunk file part
 *       - in: formData
 *         name: chunkNumber
 *         type: integer
 *       - in: formData
 *         name: totalChunks
 *         type: integer
 *     responses:
 *       200:
 *         description: Chunk uploaded successfully
 *       400:
 *         description: No chunk data received
 *       404:
 *         description: Upload not found
 *       500:
 *         description: Failed to upload chunk data
 */
router.options('/api/elements/datasets/chunk/:uploadId', jwtCorsMiddleware);
router.post('/api/elements/datasets/chunk/:uploadId',
	jwtCorsMiddleware,
	authenticateJWT,
	multiChunkUpload.single('chunk'),
	async (req, res) => {
	const { uploadId } = req.params;
	const { chunkNumber, totalChunks } = req.body;
    try {

      if (!req.file) {
        return res.status(400).json({ error: 'No chunk data received' });
      }

      const uploadData = getUploadDetails(uploadId);
      if (!uploadData) {
        return res.status(404).json({ error: 'Upload not found' });
      }

      const response = await processChunkBasedOnUploadId(uploadId, uploadData, chunkNumber, totalChunks, req);
	  if (response) {
		  res.status(200).json(response);
	  } else {
		  res.status(500).json({message: 'Failed to upload chunk data, aborting operation'});
		  const res = await abortMultipartUpload(uploadId);
	  }

    } catch (error) {
      console.error('Error uploading chunk:', error);
      res.status(500).json({message: 'Failed to upload chunk data, aborting operation'});
    }
  }
);

/**
 * @swagger
 * /api/elements/datasets/chunk/complete/{uploadId}:
 *   post:
 *     summary: Complete a multipart upload process
 *     tags: ['elements', 'datasets']
 *     parameters:
 *       - in: path
 *         name: uploadId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Upload completed successfully
 *       404:
 *         description: Upload not found
 *       500:
 *         description: Failed to complete upload
 */
router.options('/api/elements/datasets/chunk/complete/:uploadId', jwtCorsMiddleware);
router.post('/api/elements/datasets/chunk/complete/:uploadId',
	jwtCorsMiddleware,
	authenticateJWT,
	async (req, res) => {
  try {
    const { uploadId } = req.params;

	const uploadData = getUploadDetails(uploadId);
	if (!uploadData) {
        return res.status(404).json({ error: 'Upload not found' });
	}

	const response = await completeMultipartUpload(uploadId);
	if (response) {
		res.status(200).json(response);
	} else {
		res.status(500).json({message: 'Error in completing upload process, aborting the process'});
		const res = await abortMultipartUpload(uploadId);
	}
  } catch (error) {
    console.error('Error completing upload:', error);
    res.status(500).json({ error: 'Failed to complete upload' });
  }
});

/**
 * @swagger
 * /api/elements/datasets/chunk/{uploadId}:
 *   delete:
 *     summary: Abort a multipart upload
 *     tags: ['elements', 'datasets']
 *     parameters:
 *       - in: path
 *         name: uploadId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Upload aborted successfully
 *       404:
 *         description: Upload not found
 *       500:
 *         description: Failed to abort upload
 */
router.options('/api/elements/datasets/chunk/:uploadId', jwtCorsMiddleware);
router.delete('/api/elements/datasets/chunk/:uploadId',
	jwtCorsMiddleware,
	authenticateJWT,
	async (req, res) => {
	try {
		const {uploadId} = req.params;
		const uploadData = getUploadDetails(uploadId);

		if (!uploadData) {
			return res.status(404).json({message: 'Upload not found'});
		}

		const response = await abortMultipartUpload(uploadId);
		if (response) {
			res.status(200).json({message: 'Upload aborted successfully'});
		} else {
			res.status(500).json({message: 'Error in aborting upload process'});
		}

	} catch (error) {
		console.error('Error aborting upload:', error);
		res.status(500).json({error: 'Failed to abort upload'});
	}
});

// /**
//  * @swagger
//  * /api/elements/datasets/chunk/progress/{uploadId}:
//  *   get:
//  *     summary: Check the progress of a multipart upload
//  *     tags: ['elements', 'datasets']
//  *     parameters:
//  *       - in: path
//  *         name: uploadId
//  *         required: true
//  *         schema:
//  *           type: string
//  *     responses:
//  *       200:
//  *         description: Upload progress retrieved successfully
//  *       404:
//  *         description: Upload not found
//  *       500:
//  *         description: Failed to fetch upload progress
//  */
router.options('/api/elements/datasets/chunk/progress/:uploadId', jwtCorsMiddleware);
router.get('/api/elements/datasets/chunk/progress/:uploadId',
	jwtCorsMiddleware,
	authenticateJWT,
	(req, res) => {
	const {uploadId} = req.params;

	const uploadData = getUploadDetails(uploadId);
	if (!uploadData) {
		return res.status(404).json({error: 'Upload not found'});
	}

	const response = getUploadProgress(uploadId);
	if (response) {
		res.status(200).json(response);
	} else {
		res.status(500).json({message: 'Error in fetching upload progress'});
	}
});

export default router;
