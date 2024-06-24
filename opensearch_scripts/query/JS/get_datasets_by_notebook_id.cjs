const { Client } = require('@opensearch-project/opensearch');

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

async function getRelatedDatasetsByNotebookId(notebookId) {
  try {
    console.log(`Searching for notebook with ID: ${notebookId}`);

    // Search for the notebook with the given custom field ID
    const notebookResponse = await client.search({
      index: 'notebooks',
      body: {
        query: {
          match: {
            id: notebookId,
          },
        },
      },
    });

    if (notebookResponse.body.hits.total.value === 0) {
      console.log('No notebook found with the given ID.');
      return;
    }

    // Extract the first notebook document
    const notebook = notebookResponse.body.hits.hits[0]._source;
    const relatedDatasetIds = notebook['related-datasets'];

    if (!relatedDatasetIds || relatedDatasetIds.length === 0) {
      console.log('No related datasets found for the given notebook.');
      return;
    }

    // Log the related dataset IDs
    console.log('Related dataset IDs:', relatedDatasetIds);

    // Fetch details of related datasets
    const datasetResponse = await client.msearch({
      body: relatedDatasetIds.flatMap(id => [
        { index: 'datasets' },
        { query: { match: { id: id } } },
      ]),
    });

    // Log the raw dataset response
    console.log('Dataset search response:', JSON.stringify(datasetResponse, null, 2));

    const datasets = datasetResponse.body.responses.flatMap(response => response.hits.hits.map(hit => hit._source));

    console.log('Related datasets:', datasets);
  } catch (error) {
    console.error('Error querying OpenSearch:', error);
  }
}

// Example usage
getRelatedDatasetsByNotebookId('nb3'); // Replace with the notebook ID you want to search for
