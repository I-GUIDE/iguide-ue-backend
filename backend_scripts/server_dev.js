import express from 'express';
import multer from 'multer';
import cors from 'cors';
import dotenv from 'dotenv';
import { Client } from '@opensearch-project/opensearch';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import fetch from 'node-fetch';

const app = express();
app.use(cors());
app.use(express.json());
dotenv.config();

const os_node = process.env.OPENSEARCH_NODE;
const os_usr = process.env.OPENSEARCH_USERNAME;
const os_pswd = process.env.OPENSEARCH_PASSWORD;

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
    exec(`jupyter nbconvert --to html ${notebookFilePath} --output ${htmlOutputPath}`, (error, stdout, stderr) => {
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
      index: 'resources',
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
    const resources = resourceResponse.body.hits.hits.map((hit) => hit._source);
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
      index: 'resources',
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
    const resources = featuredResponse.body.hits.hits.map((hit) => hit._source);
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
      fields: ['title', 'contents', 'tags'],
    },
  };

  if (resource_type && resource_type !== 'any') {
    query = {
      bool: {
        must: [
          { multi_match: { query: keyword, fields: ['title', 'contents', 'tags'] } },
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
      index: 'resources',
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

    const results = searchResponse.body.hits.hits.map((hit) => hit._source);
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
        fields: ['title', 'contents','tags']
      }
    });
  }

  try {
    const response = await client.count({
      index: 'resources',
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

// Upload thumbnail
app.post('/api/upload-thumbnail', uploadThumbnail.single('file'), (req, res) => {
  const filePath = `/user-uploads/thumbnails/${req.file.filename}`;
  res.json({
    message: 'File uploaded successfully',
    url: filePath,
  });
});

// Endpoint to register a new resource, including converting notebook to HTML if provided
app.put('/api/resources', async (req, res) => {
  const data = req.body;

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
});

// Endpoint to retrieve a resource by id
app.get('/api/resource/:field/:value', async (req, res) => {
  const { field, value } = req.params;

  try {
    const resourceResponse = await client.search({
      index: 'resources',
      body: {
        query: {
          term: {
            [field]: value,
          },
        },
      },
    });

    if (resourceResponse.body.hits.total.value === 0) {
      res.status(404).json({ message: 'No resource found' });
      return;
    }
    const resource = resourceResponse.body.hits.hits[0]._source;
    res.json(resource);
  } catch (error) {
    console.error('Error querying OpenSearch:', error);
    res.status(500).json({ message: 'Internal server error' });
  }
});

const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

