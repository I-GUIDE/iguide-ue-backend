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

const app = express();
app.use(cors());
app.use(express.json());
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

// Upload avatar
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

// Update avatar
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

// Function to convert notebook to HTML

async function fetchNotebookContent(url) {
  const response = await fetch(url);
  if (response.ok) {
    return await response.text();
  }
  throw new Error('Failed to fetch the notebook');
}
async function convertNotebookToHtml(githubRepo, notebookPath, outputDir) {
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
      exec(`jupyter nbconvert --to html "${notebookFilePath}" --output "${htmlOutputPath}"`, (error, stdout, stderr) => {
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

// Endpoint to fetch documents by resource-type
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

// Endpoint to fetch all featured documents
app.get('/api/featured-resources', async (req, res) => {
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

  try {
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



// Endpoint to get the count of documents by resource-type or search keywords
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

// Upload thumbnail
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

// Endpoint to register a resource
app.put('/api/resources', async (req, res) => {
  const resource = req.body;

  try {
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

// Endpoint to delete a resource by ID
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


// Endpoint to retrieve resources by field and values for exact match

app.get('/api/resources/:field/:values', async (req, res) => {
  const { field, values } = req.params;
  const valueArray = values.split(',').map(value => decodeURIComponent(value)); //Decompose to handle openid as url

  try {
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
      const { metadata, ...rest } = _source; // Remove metadata
      return { _id, ...rest };
    });

    res.json(resources);
  } catch (error) {
    console.error('Error querying OpenSearch:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});
//Return the number of hits by field and id
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



/*
// Endpoint to fetch resources by field and value. If the field contains the value.
app.get('/api/resources_contains/:field/:value', async (req, res) => {
  const { field, value } = req.params;
  try {
    const resourceResponse = await client.search({
      index: os_index, // Replace with your index name
      body: {
        query: {
          match: {
            [field]: value,
          },
        },
      },
    });

    const resources = resourceResponse.body.hits.hits.map(hit => {
      const { _id, _source } = hit;
      const { metadata, ...rest } = _source; // Remove metadata
      return { _id, ...rest };
    });

    res.json(resources);
  } catch (error) {
    console.error('Error querying OpenSearch:', error);
    res.status(500).json({ message: 'Failed to fetch resources' });
  }
});*/

// Endpoint to return the user document given the openid
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




// Endpoint to add a new user document
app.post('/api/users', async (req, res) => {
  const user = req.body;
  console.log(user);

  try {
    const response = await client.index({
      index: 'users',
      id: user.openid,
      body: user
    });

    res.status(201).json({ message: 'User added successfully', id: response.body._id });
  } catch (error) {
    console.error('Error adding user:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});


// Endpoint to update the user document
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


// Endpoint to delete the user document
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
//Retrieve the title of the url
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
      terms: { [field_name]: match_value },
    });
  }

  // Add element_type condition to the query
  if (element_type !== null) {
    query.query.bool.filter.push({
      terms: { 'resource-type': element_type },
    });
  }

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
      const elements = searchResponse.body.hits.hits.map(hit => hit._source);
  res.json(elements);
    }
  } catch (error) {
    console.error('Error retrieving elements:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

console.log(`${process.env.SERV_TAG} server is up`);


https.createServer(options, app).listen(443, () => {
  console.log('HTTPS server is running on 443');
});
https.createServer(options, app).listen(8443, () => {
  console.log('HTTPS server is running on 8443');
});

