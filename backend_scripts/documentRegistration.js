const express = require('express');
const bodyParser = require('body-parser');
const { Client } = require('@opensearch-project/opensearch');
const dotenv = require('dotenv');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

dotenv.config();

const app = express();
app.use(cors());
const port = 3000;

// OpenSearch client setup
const client = new Client({
  node: process.env.OPENSEARCH_NODE, // Replace with your OpenSearch host
  auth: {
    username: process.env.OPENSEARCH_USERNAME, // Replace with your OpenSearch credentials
    password: process.env.OPENSEARCH_PASSWORD
  },
  ssl: {
    rejectUnauthorized: false, // Use this only if you encounter SSL certificate issues
  },
});

app.use(bodyParser.json());
app.use(express.static('public'));

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
app.put('/resources', async (req, res) => {
  const resource = req.body;
  //console.log(resource)
  //resource.id = uuidv4(); // Generate a unique ID

  try {
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
        

        await updateRelatedDocuments(response.body._id, [relatedId], `related-${type}s`);
      }
    }
    
    res.status(200).json(response);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Endpoint to delete a resource by ID
app.delete('/resources/:id', async (req, res) => {
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

      const relatedIds = [...relatedNotebooks, ...relatedDatasets, ...relatedPublications];
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

// Endpoint to search for resources
app.get('/search-resources', async (req, res) => {
  const { type, keyword } = req.query;
  try {
    const { body } = await client.search({
      index: 'resources_dev',
      body: {
        query: {
          bool: {
            must: [
              { match: { 'resource-type': type } },
              { match_phrase_prefix: { title: keyword } }
            ]
          }
        },
        size: 5 // Limit the number of results to top 5
      }
    });
    const results = body.hits.hits.map(hit => hit._source);
    res.status(200).json(results);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`);
});

