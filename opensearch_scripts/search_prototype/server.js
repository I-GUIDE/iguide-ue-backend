const express = require('express');
const cors = require('cors');
const { Client } = require('@opensearch-project/opensearch');

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

const client = new Client({
  node: 'https://localhost:9200',
  auth: {
    username: 'admin', // Replace with your username
    password: 'Iiguidedwn2024', // Replace with your password
  },
  ssl: {
    rejectUnauthorized: false, // Disable SSL certificate verification
  },
  requestTimeout: 60000, // Increase request timeout
  maxRetries: 5, // Increase the number of retries
  sniffOnStart: true, // Enable sniffing on start
});

app.post('/search', async (req, res) => {
  const { keyword } = req.body;

  try {
    const searchResponse = await client.search({
      index: 'resources', // Replace with your index name
      body: {
        query: {
          multi_match: {
            query: keyword,
            fields: ['title', 'contents', 'tags'], // Adjust fields as needed
          },
        },
      },
    });

    const results = searchResponse.body.hits.hits.map(hit => hit._source);
    res.json(results);
  } catch (error) {
    console.error('Error querying OpenSearch:', error);
    res.status(500).json({ error: 'Error querying OpenSearch' });
  }
});

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`);
});

