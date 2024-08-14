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
import swaggerUi from'swagger-ui-express';
import { specs } from './swagger.js';

const app = express();
app.use(cors());
/*const corsOptions = {
  origin: 'https://localhost', // Allow requests from this origin
  credentials: true,           // Allow cookies and other credentials
};

app.use(cors(corsOptions));*/
app.use(cors({ credentials: true, origin: "https://localhost" }));
app.use(express.json());
app.use(cookieParser());
dotenv.config();

const os_node = process.env.OPENSEARCH_NODE;
const os_usr = process.env.OPENSEARCH_USERNAME;
const os_pswd = process.env.OPENSEARCH_PASSWORD;
const os_index = process.env.OPENSEARCH_INDEX;

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





// Toy endpoint that requires JWT authentication
app.get('/api/toy-auth', authenticateJWT, (req, res) => {
  res.json({ message: 'You are authenticated!', user: req.user });
});

// Toy endpoint that requires admin role
app.get('/api/toy-admin', authenticateJWT, authorizeRole('admin'), (req, res) => {
  res.json({ message: 'You are an admin!', user: req.user });
});


// Endpoint to refresh token
app.post('/api/refresh-token', async (req, res) => {
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
    res.cookie('jwt', newAccessToken, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });

    res.json({ accessToken: newAccessToken });
  });
});


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
  if (!req.file) {
    return res.status(400).json({ message: 'No file uploaded' });
  }

  const filePath = `https://${process.env.DOMAIN}:5000/user-uploads/avatars/${req.file.filename}`;
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
  try {
    const { openid } = req.body;
    const newAvatarFile = req.file;

    if (!openid || !newAvatarFile) {
      return res.status(400).json({ message: 'OpenID and new avatar file are required' });
    }

    // Fetch user by openid from OpenSearch
    const { body: searchResponse } = await client.search({
      index: 'users',
      body: {
        query: {
          match: { openid }
        }
      }
    });

    if (searchResponse.hits.total.value === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = searchResponse.hits.hits[0]._source;
    const userId = searchResponse.hits.hits[0]._id;
    const oldAvatarUrl = user.avatar_url;

    if (oldAvatarUrl) {
      // Delete the old avatar file
      const oldAvatarFilePath = path.join(avatarDir, path.basename(oldAvatarUrl));
      if (fs.existsSync(oldAvatarFilePath)) {
        fs.unlinkSync(oldAvatarFilePath);
      }
    }

    // Update the user's avatar URL with the new file URL
    const newAvatarUrl = `https://${process.env.DOMAIN}:5000/user-uploads/avatars/${newAvatarFile.filename}`;
    user.avatar_url = newAvatarUrl;

    // Update the user document in OpenSearch
    await client.update({
      index: 'users',
      id: userId,
      body: {
        doc: { avatar_url: newAvatarUrl }
      }
    });

    res.json({
      message: 'Avatar updated successfully',
      url: newAvatarUrl,
    });
  } catch (error) {
    console.error('Error updating avatar:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});



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
  const type = req.query.data_name;
  let sortBy = req.query.sort_by || '_score'; // Default to '_score' for relevance sorting
  const order = req.query.order || 'desc'; // Default to 'desc' for descending order
  const from = parseInt(req.query.from, 10) || 0; // Default to 0 (start from the beginning)
  const size = parseInt(req.query.size, 10) || 15; // Default to 15 results

  // Replace title and authors with their keyword sub-fields for sorting
  if (sortBy === 'title') {
    sortBy = 'title.keyword';
  } else if (sortBy === 'authors') {
    sortBy = 'authors.keyword';
  }

  try {
    const resourceResponse = await client.search({
      index: os_index,
      body: {
        from: from,
        size: size,
        query: {
          term: {
            'resource-type': type,
          },
        },
        sort: [
          {
            [sortBy]: {
              order: order,
            },
          },
        ],
      },
    });

    if (resourceResponse.body.hits.total.value === 0) {
      res.status(404).json({ message: 'No resource found' });
      return;
    }
    const resources = resourceResponse.body.hits.hits.map(hit => {
      const { _id, _source } = hit;
      const { metadata, ...rest } = _source; // Remove metadata
      return { _id, ...rest };
    });
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
app.get('/api/featured-resources', authenticateJWT, async (req, res) => {
    let sortBy = req.query.sort_by || '_score';
    const order = req.query.order || 'desc';
    const from = parseInt(req.query.from, 10) || 0;
    const size = parseInt(req.query.size, 10) || 15;

    // Replace title and authors with their keyword sub-fields for sorting
    if (sortBy === 'title') {
      sortBy = 'title.keyword';
    } else if (sortBy === 'authors') {
      sortBy = 'authors.keyword';
    }

    //console.log('Featured resources from Neo4j');
    
    try {
	//const resources = await n4j_server.getFeaturedElements();
	//res.json(resources);
	const featuredResponse = await client.search({
	    index: os_index,
	    body: {
		from: from,
		size: size,
		query: {
		    match: {
			featured: true,
		    },
		},
		sort: [
		    {
			[sortBy]: {
			    order: order,
			},
		    },
		],
	    },
	});

	if (featuredResponse.body.hits.total.value === 0) {
	    res.status(404).json({ message: 'No featured resource found' });
	    return;
	}
	const resources = featuredResponse.body.hits.hits.map(hit => {
	    const { _id, _source } = hit;
	    const { metadata, ...rest } = _source; // Remove metadata
	    return { _id, ...rest };
	});
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
  const { resourceType, keywords } = req.body;

  if (!resourceType && !keywords) {
    return res.status(400).send({ error: 'Either resourceType or keywords are required' });
  }

  const query = {
    bool: {
      must: []
    }
  };

  if (resourceType && resourceType !== 'any') {
    query.bool.must.push({
      match: {
        'resource-type': resourceType
      }
    });
  }

  if (keywords) {
    query.bool.must.push({
      multi_match: {
        query: keywords,
        fields: ['title', 'authors', 'contents','tags']
      }
    });
  }

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
    res.status(500).send({ error: 'An error occurred while fetching the resource count' });
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
  const filePath = `https://${process.env.DOMAIN}:5000/user-uploads/thumbnails/${req.file.filename}`;
  res.json({
    message: 'Thumbnail uploaded successfully',
    url: filePath,
  });
});

// Function to update related documents
const updateRelatedDocuments = async (resourceId, relatedIds, relatedField) => {
  for (const relatedId of relatedIds) {
    const { body: existingDoc } = await client.get({
      index: os_index,
      id: relatedId
    });

    if (existingDoc._source) {
      existingDoc._source[relatedField] = existingDoc._source[relatedField] || [];
      if (!existingDoc._source[relatedField].includes(resourceId)) {
        existingDoc._source[relatedField].push(resourceId);
      }

      await client.index({
        index: os_index,
        id: relatedId,
        body: existingDoc._source
      });
    }
  }
};

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
app.put('/api/resources', authenticateJWT, async (req, res) => {
  const resource = req.body;
  console.log(resource);
  try {
    resource.metadata = resource.metadata || {};
    resource.metadata.created_by_jwt = req.user.id;
    if (resource['resource-type'] === 'notebook' && resource['notebook-repo'] && resource['notebook-file']) {
      const htmlNotebookPath = await convertNotebookToHtml(resource['notebook-repo'], resource['notebook-file'], notebookHtmlDir);
      if (htmlNotebookPath) {
        resource['html-notebook'] = `https://${process.env.DOMAIN}:5000/user-uploads/notebook_html/${path.basename(htmlNotebookPath)}`;
      }
    }

    // Retrieve and update related document IDs
    const relatedNotebooks = [];
    const relatedDatasets = [];
    const relatedPublications = [];
    const relatedOERs = [];

    const relatedResources = resource['related-resources'] || [];
    for (const relatedResource of relatedResources) {
      const { type, title } = relatedResource;

      const { body } = await client.search({
        index: os_index,
        body: {
          query: {
            bool: {
              must: [
                { match: { 'resource-type': type } },
                { match_phrase: { title: title } }
              ]
            }
          },
          size: 1
        }
      });

      if (body.hits.hits.length > 0) {
        const relatedId = body.hits.hits[0]._id;
        if (type === 'notebook') {
          relatedNotebooks.push(relatedId);
        } else if (type === 'dataset') {
          relatedDatasets.push(relatedId);
        } else if (type === 'publication') {
          relatedPublications.push(relatedId);
        } else if (type === 'oer') {
          relatedOERs.push(relatedId);
         }
      }
    }

    resource['related-notebooks'] = [...new Set(relatedNotebooks)];
    resource['related-datasets'] = [...new Set(relatedDatasets)];
    resource['related-publications'] = [...new Set(relatedPublications)];
    resource['related-oers'] = [...new Set(relatedOERs)];

    // Remove temporary related-resources field
    delete resource['related-resources'];

    // Index the new resource
    const response = await client.index({
      index: os_index,
      body: resource
    });

    for (const relatedResource of relatedResources) {
      const { type, title } = relatedResource;

      const { body } = await client.search({
        index: os_index,
        body: {
          query: {
            bool: {
              must: [
                { match: { 'resource-type': type } },
                { match_phrase: { title: title } }
              ]
            }
          },
          size: 1
        }
      });

      if (body.hits.hits.length > 0) {
        const relatedId = body.hits.hits[0]._id;
        await updateRelatedDocuments(response.body._id, [relatedId], `related-${resource['resource-type']}s`);
      }
    }

    res.status(200).json({ message: 'Resource registered successfully' });
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

  try {
    const { body: existingDoc } = await client.get({
      index: os_index,
      id: resourceId
    });

    if (existingDoc._source) {
      // Update related documents to remove this resource ID
      const relatedNotebooks = existingDoc._source['related-notebooks'] || [];
      const relatedDatasets = existingDoc._source['related-datasets'] || [];
      const relatedPublications = existingDoc._source['related-publications'] || [];
      const relatedOERs = existingDoc._source['related-oers'] || [];

      const relatedIds = [...new Set([...relatedNotebooks, ...relatedDatasets, ...relatedPublications, ...relatedOERs])];
      for (const relatedId of relatedIds) {
        try {
          const { body: relatedDoc } = await client.get({
            index: os_index,
            id: relatedId
          });

          if (relatedDoc._source) {
            const relatedField = `related-${existingDoc._source['resource-type']}s`;
            relatedDoc._source[relatedField] = relatedDoc._source[relatedField] || [];
            const index = relatedDoc._source[relatedField].indexOf(resourceId);
            if (index > -1) {
              relatedDoc._source[relatedField].splice(index, 1);
            }

            await client.index({
              index: os_index,
              id: relatedId,
              body: relatedDoc._source
            });
          }
        } catch (relatedError) {
          if (relatedError.meta.statusCode === 404) {
            console.log(`Related document with ID ${relatedId} not found.`);
          } else {
            throw relatedError;
          }
        }
      }

      // Delete the HTML notebook file if it exists
      if (existingDoc._source['html-notebook']) {
        const notebookPath = path.join(process.env.UPLOAD_FOLDER, existingDoc._source['html-notebook'].replace(`https://${process.env.DOMAIN}:5000/user-uploads/`, ''));
        if (fs.existsSync(notebookPath)) {
          fs.unlinkSync(notebookPath);
          console.log(`Deleted notebook file: ${notebookPath}`);
        } else {
          console.log(`Notebook file not found: ${notebookPath}`);
        }
      }

      // Delete the thumbnail image file if it exists (Re-enable when "update" is in place)
      /*
      if (existingDoc._source['thumbnail-image']) {
        const thumbnailPath = path.join(process.env.UPLOAD_FOLDER, existingDoc._source['thumbnail-image'].replace('https://backend.i-guide.io:5000/user-uploads/', ''));
        if (fs.existsSync(thumbnailPath)) {
          fs.unlinkSync(thumbnailPath);
          console.log(`Deleted thumbnail image file: ${thumbnailPath}`);
        } else {
          console.log(`Thumbnail image file not found: ${thumbnailPath}`);
        }
      }*/
    }

    // Delete the resource
    await client.delete({
      index: os_index,
      id: resourceId
    });

    // Force a refresh
    await client.indices.refresh({ index: os_index });

    // Verify deletion
    const { body: searchResults } = await client.search({
      index: os_index,
      body: {
        query: {
          term: {
            _id: resourceId
          }
        }
      }
    });

    if (searchResults.hits.total.value === 0) {
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
    // 	if (field == '_id'){
    // 	    console.log('getElemnetByID from Neo4j');
    // 	    const resources = n4j_server.getElementByID(values[0]);
    // 	    res.json(resources);
    // 	    return;
    // 	}
	
    // Initial search request to initialize the scroll context
    const initialResponse = await client.search({
      index: os_index,
      scroll: '1m', // Set the scroll timeout
      body: {
        query: {
          terms: {
            [field]: valueArray,
          },
        },
        sort: {
          _script: {
            type: 'number',
            script: {
              lang: 'painless',
              source: `
                int index = params.valueArray.indexOf(doc[params.field].value);
                return index != -1 ? index : params.valueArray.length;
              `,
              params: {
                valueArray: valueArray,
                field: field,
              },
            },
            order: 'asc',
          },
        },
        size: 1000, // Set an initial batch size
      },
    });

    let allHits = initialResponse.body.hits.hits;
    let scrollId = initialResponse.body._scroll_id;

    // Use the scroll ID to fetch subsequent batches of documents
    while (true) {
      const scrollResponse = await client.scroll({
        scroll_id: scrollId,
        scroll: '1m',
      });

      if (scrollResponse.body.hits.hits.length === 0) {
        break;
      }

      allHits = allHits.concat(scrollResponse.body.hits.hits);
      scrollId = scrollResponse.body._scroll_id;
    }

    // Clear the scroll context
    await client.clearScroll({
      body: {
        scroll_id: scrollId,
      },
    });

    if (allHits.length === 0) {
      res.status(404).json({ message: 'No resources found' });
      return;
    }

    const resources = allHits.map(hit => {
      const { _id, _source } = hit;
      //const { metadata, ...rest } = _source; // Remove metadata
      //return { _id, ...rest };
      return {_id, ..._source};
    });

	res.json(resources);
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

  try {
    // Count request to get the number of hits
    const countResponse = await client.count({
      index: os_index,
      body: {
        query: {
          terms: {
            [field]: valueArray,
          },
        },
      },
    });

    const count = countResponse.body.count;

    res.json({ count });
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
    const response = await client.search({
      index: 'users',
      body: {
        query: {
          term: {
            openid: openid
          }
        }
      }
    });

    if (response.body.hits.total.value === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    const user = response.body.hits.hits[0]._source;
    res.json(user);
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

  try {
    const response = await client.search({
      index: 'users',
      body: {
        query: {
          term: {
            openid: openid
          }
        }
      }
    });

    if (response.body.hits.total.value === 0) {
      return res.json(false);
    }

    res.json(true);
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
  console.log(user);

  try {
    const response = await client.index({
      index: 'users',
      id: user.openid,
	body: user,
	refresh: true
    });

    res.status(201).json({ message: 'User added successfully', id: response.body._id });
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

  try {
    const response = await client.update({
      index: 'users',
      id: openid,
      body: {
        doc: updates
      }
    });

    res.json({ message: 'User updated successfully', result: response.body.result });
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
    const response = await client.delete({
      index: 'users',
      id: openid
    });

    res.json({ message: 'User deleted successfully', result: response.body.result });
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

  let query = {
    term: { 'metadata.created_by': openid },
  };

  // Replace title and authors with their keyword sub-fields for sorting
  let sortBy = sort_by;
  if (sortBy === 'title') {
    sortBy = 'title.keyword';
  } else if (sortBy === 'authors') {
    sortBy = 'authors.keyword';
  }

  try {
    const searchResponse = await client.search({
      index: os_index,
      body: {
        from: from,
        size: size,
        query: query,
        sort: [
          {
            [sortBy]: {
              order: order,
            },
          },
        ],
      },
    });
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
 *                 description: The name of the field to filter elements by.
 *               match_value:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: The values to match in the specified field.
 *               element_type:
 *                 type: array
 *                 items:
 *                   type: string
 *                 description: The type of elements to retrieve.
 *               sort_by:
 *                 type: string
 *                 description: The field by which to sort the results.
 *               order:
 *                 type: string
 *                 enum: [asc, desc]
 *                 description: The order to sort the results, either ascending (asc) or descending (desc).
 *               from:
 *                 type: integer
 *                 description: The starting index for the results.
 *               size:
 *                 type: integer
 *                 description: The number of elements to retrieve.
 *               count_only:
 *                 type: boolean
 *                 description: Whether to return only the count of matching elements.
 *     responses:
 *       200:
 *         description: A list of elements or count of elements
 *       500:
 *         description: Internal server error
 */

app.post('/api/elements/retrieve', async (req, res) => {
  const { field_name, match_value, element_type, sort_by = '_score', order = 'desc', from = '0', size = '10', count_only = false } = req.body;

  // Check if match_value or element_type is an empty array
  if (Array.isArray(match_value) && match_value.length === 0) {
    return res.json(count_only ? 0 : []);
  }
  if (Array.isArray(element_type) && element_type.length === 0) {
    return res.json(count_only ? 0 : []);
  }
  let sortBy = sort_by;
  let fieldName = field_name;
  if (fieldName === 'tags'){
    fieldName = 'tags.keyword';
  }
  if (sortBy === 'title') {
    sortBy = 'title.keyword';
  } else if (sortBy === 'authors') {
    sortBy = 'authors.keyword';
  }

  // Build the query
  const query = {
    from: parseInt(from, 10),
    size: parseInt(size, 10),
    sort: [{ [sortBy]: { order: order } }],
    query: {
      bool: {
        must: [],
        filter: [],
      },
    },
  };

  // Add match_value condition to the query
  if (match_value !== null) {
    query.query.bool.must.push({
      terms: { [fieldName]: match_value },
    });
  }

  // Add element_type condition to the query
  if (element_type !== null) {
    query.query.bool.filter.push({
      terms: { 'resource-type': element_type },
    });
  }
  //console.log(query.query.bool.must);

  try {
    if (count_only) {
      const countResponse = await client.count({
        index: os_index,
        body: { query: query.query },
      });
      res.json(countResponse.body.count);
    } else {
      const searchResponse = await client.search({
        index: os_index,
        body: query,
      });
      const elements = searchResponse.body.hits.hits.map(hit => {
        const { _id, _source } = hit;
        //const { metadata, ...rest } = _source; // Remove metadata
        return { _id, ..._source };
      });
      res.json(elements);
    }
  } catch (error) {
    console.error('Error retrieving elements:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});
/**
 * @swagger
 * /api/elements/tag/{value}:
 *   get:
 *     summary: Retrieve elements by exact tag match
 *     parameters:
 *       - in: path
 *         name: value
 *         required: true
 *         schema:
 *           type: string
 *         description: The exact tag value to match.
 *     responses:
 *       200:
 *         description: A list of elements matching the exact tag
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 type: object
 *                 properties:
 *                   _id:
 *                     type: string
 *                     description: The unique identifier of the document.
 *                   title:
 *                     type: string
 *                     description: The title of the document.
 *                   authors:
 *                     type: array
 *                     items:
 *                       type: string
 *                     description: The authors of the document.
 *                   tags:
 *                     type: array
 *                     items:
 *                       type: string
 *                     description: The tags associated with the document.
 *                   contents:
 *                     type: string
 *                     description: The contents of the document.
 *                   # Add other fields relevant to the documents
 *       404:
 *         description: No elements found for the given tag
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "No elements found for the given tag"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *                   example: "Internal server error"
 */

app.get('/api/elements/tag/:value', async (req, res) => {
  const tagValue = req.params.value;

  try {
    const searchResponse = await client.search({
      index: os_index,
      body: {
        query: {
          term: {
            'tags.keyword': tagValue // Use '.keyword' to ensure exact match
          }
        },
        size: 1000 // Set a reasonable size or use pagination for large datasets
      }
    });

    const results = searchResponse.body.hits.hits.map(hit => {
      const { _id, _source } = hit;
      return { _id, ...(_source || {}) };
    });

    res.status(200).json(results);
  } catch (error) {
    console.error('Error retrieving documents by tag:', error);
    res.status(500).json({ error: 'Error retrieving documents by tag' });
  }
});


console.log(`${process.env.SERV_TAG} server is up`);

// Serve Swagger docs
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs));


const PORT = 4001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

https.createServer(options, app).listen(4000, () => {
  console.log('Server is running on https://backend.i-guide.io:4000');
});

