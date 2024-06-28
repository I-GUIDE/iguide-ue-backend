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

const app = express();
app.use(cors());
app.use(express.json());
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

// Ensure thumbnails and notebook_html directories exist
const thumbnailDir = path.join(process.env.UPLOAD_FOLDER, 'thumbnails');
const notebookHtmlDir = path.join(process.env.UPLOAD_FOLDER, 'notebook_html');
fs.mkdirSync(thumbnailDir, { recursive: true });
fs.mkdirSync(notebookHtmlDir, { recursive: true });

// Serve static files from the thumbnails directory
app.use('/user-uploads/thumbnails', express.static(thumbnailDir));
app.use('/user-uploads/notebook_html', express.static(notebookHtmlDir));

// Configure storage for thumbnails
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, thumbnailDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  }
});
const uploadThumbnail = multer({ storage });

// Function to convert notebook to HTML
async function convertNotebookToHtml(githubRepo, notebookPath, outputDir) {
  const notebookUrl = `${githubRepo}/raw/main/${notebookPath}`;
  const notebookName = path.basename(notebookPath, '.ipynb');
  const timestamp = Date.now();
  const htmlOutputPath = path.join(outputDir, `${timestamp}-${notebookName}.html`);
  
  const response = await fetch(notebookUrl);
  if (!response.ok) {
    throw new Error('Failed to fetch the notebook from GitHub');
  }

  const notebookContent = await response.text();
  const notebookFilePath = path.join(outputDir, `${timestamp}-${notebookName}.ipynb`);
  fs.writeFileSync(notebookFilePath, notebookContent);

  return new Promise((resolve, reject) => {
    exec(`jupyter nbconvert --to html "${notebookFilePath}" --output "${htmlOutputPath}"`, (error, stdout, stderr) => {
      if (error) {
        reject(`Error converting notebook: ${stderr}`);
      } else {
        resolve(htmlOutputPath);
      }
    });
  });
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
      index: 'resources_dev',
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
    const resources = resourceResponse.body.hits.hits.map(hit => ({
	  _id: hit._id,
	  ...hit._source,
	}));
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
      index: 'resources_dev',
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
    const resources = featuredResponse.body.hits.hits.map(hit => ({
	  _id: hit._id,
	  ...hit._source,
	}));
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
      fields: ['title', 'authors', 'contents', 'tags'],
    },
  };

  if (resource_type && resource_type !== 'any') {
    query = {
      bool: {
        must: [
          { multi_match: { query: keyword, fields: ['title', 'authors', 'contents', 'tags'] } },
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
    const searchResponse = await client.search({
      index: 'resources_dev',
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

    const results = searchResponse.body.hits.hits.map(hit => ({
	  _id: hit._id,
	  ...hit._source,
	}));
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
      index: 'resources_dev',
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
    message: 'File uploaded successfully',
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
  const filePath = `https://backend.i-guide.io:5000/user-uploads/thumbnails/${req.file.filename}`;
  res.json({
    message: 'File uploaded successfully',
    url: filePath,
  });
});

// Endpoint to register a new resource, including converting notebook to HTML if provided
/*app.put('/api/resources', async (req, res) => {
  const data = req.body;
  //console.log(data);
  try {
    // Check if the resource type is 'notebook' and contains the GitHub repo and notebook path
    if (data['resource-type'] === 'notebook' && data['notebook-repo'] && data['notebook-file']) {
      const htmlNotebookPath = await convertNotebookToHtml(data['notebook-repo'], data['notebook-file'], notebookHtmlDir);
      data['html-notebook'] = `/user-uploads/notebook_html/${path.basename(htmlNotebookPath)}`;
    }

    await client.index({
      index: 'resources_dev',
      body: data,
    });

    res.status(200).json({ message: 'Resource registered successfully' });
  } catch (error) {
    console.error('Error indexing resource in OpenSearch:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});*/
// Function to update related documents
const updateRelatedDocuments = async (resourceId, relatedIds, relatedField) => {
  for (const relatedId of relatedIds) {
    const { body: existingDoc } = await client.get({
      index: 'resources_dev',
      id: relatedId
    });

    if (existingDoc._source) {
      existingDoc._source[relatedField] = existingDoc._source[relatedField] || [];
      if (!existingDoc._source[relatedField].includes(resourceId)) {
        existingDoc._source[relatedField].push(resourceId);
      }

      await client.index({
        index: 'resources_dev',
        id: relatedId,
        body: existingDoc._source
      });
    }
  }
};
// Endpoint to register a resource
app.put('/api/resources', async (req, res) => {
  const resource = req.body;
  //console.log(resource)
  //resource.id = uuidv4(); // Generate a unique ID

  try {
  if (resource['resource-type'] === 'notebook' && resource['notebook-repo'] && resource['notebook-file']) {
      const htmlNotebookPath = await convertNotebookToHtml(resource['notebook-repo'], resource['notebook-file'], notebookHtmlDir);
      resource['html-notebook'] = `https://backend.i-guide.io:5000/user-uploads/notebook_html/${path.basename(htmlNotebookPath)}`;
    }
    // Retrieve and update related document IDs
    const relatedNotebooks = [];
    const relatedDatasets = [];
    const relatedPublications = [];

    const relatedResources = resource['related-resources'] || [];
    for (const relatedResource of relatedResources) {
      const { type, title } = relatedResource;

      const { body } = await client.search({
        index: 'resources_dev',
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
	//console.log(relatedId)
        if (type === 'notebook') {
          relatedNotebooks.push(relatedId);
        } else if (type === 'dataset') {
          relatedDatasets.push(relatedId);
        } else if (type === 'publication') {
          relatedPublications.push(relatedId);
        }

        //await updateRelatedDocuments(resource.id, [relatedId], `related-${type}s`);
      }
    }

    resource['related-notebooks'] = relatedNotebooks;
    resource['related-datasets'] = relatedDatasets;
    resource['related-publications'] = relatedPublications;

    // Remove temporary related-resources field
    delete resource['related-resources'];

    // Index the new resource
    const response = await client.index({
      index: 'resources_dev',
      //id: resource.id,
      body: resource
    });
    //console.log(response)
    //console.log(response.body._id)

    for (const relatedResource of relatedResources) {
      const { type, title } = relatedResource;

      const { body } = await client.search({
        index: 'resources_dev',
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
	//console.log(relatedId)


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
      index: 'resources_dev',
      id: resourceId
    });

    if (existingDoc._source) {
      // Update related documents to remove this resource ID
      const relatedNotebooks = existingDoc._source['related-notebooks'] || [];
      const relatedDatasets = existingDoc._source['related-datasets'] || [];
      const relatedPublications = existingDoc._source['related-publications'] || [];
      const relatedOers = existingDoc._source['related-oers'] || [];

      const relatedIds = [...relatedNotebooks, ...relatedDatasets, ...relatedPublications, ...relatedOers];
      for (const relatedId of relatedIds) {
        const { body: relatedDoc } = await client.get({
          index: 'resources_dev',
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
            index: 'resources_dev',
            id: relatedId,
            body: relatedDoc._source
          });
        }
      }
    }

    // Delete the resource
    const response = await client.delete({
      index: 'resources_dev',
      id: resourceId
    });

    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to retrieve a resources by field and values for exact match
/*app.get('/api/resources/:field/:values', async (req, res) => {
  const { field, values } = req.params;
  const valueArray = values.split(',');

  try {
    const resourceResponse = await client.search({
      index: 'resources_dev',
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
      },
    });

    if (resourceResponse.body.hits.total.value === 0) {
      res.status(404).json({ message: 'No resources found' });
      return;
    }
    const resources = resourceResponse.body.hits.hits.map(hit => hit._source);
    res.json(resources);
  } catch (error) {
    console.error('Error querying OpenSearch:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});*/
// Endpoint to fetch resources by field and value
app.get('/api/resources/:field/:value', async (req, res) => {
  const { field, value } = req.params;
  try {
    const resourceResponse = await client.search({
      index: 'resources_dev', // Replace with your index name
      body: {
        query: {
          match: {
            [field]: value,
          },
        },
        //_source: true,
      },
    });

    const resources = resourceResponse.body.hits.hits.map(hit => ({
	  _id: hit._id,
	  ...hit._source,
	}));
    console.log(resources)
    res.json(resources);
  } catch (error) {
    console.error('Error querying OpenSearch:', error);
    res.status(500).json({ message: 'Failed to fetch resources' });
  }
});

const PORT = 5001;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

https.createServer(options, app).listen(5000, () => {
    console.log('Server is running on https://backend.i-guide.io:5000');
});

