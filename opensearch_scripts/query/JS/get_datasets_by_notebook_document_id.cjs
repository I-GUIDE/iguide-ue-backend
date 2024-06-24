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
  requestTimeout: 600, // Increase request timeout
  maxRetries: 5, // Increase the number of retries
  sniffOnStart: true, // Enable sniffing on start
});

async function getRelatedDatasetsByNotebookId(notebookId) {
  try {
    console.log(`Searching for notebook with ID: ${notebookId}`);

    // Search for the notebook with the given ID
    const notebookResponse = await client.get({
      index: 'notebooks',
      id: notebookId,
    });

    const notebook = notebookResponse.body._source;
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


// Replace 'National-level Analysis using Twitter Data' with the title of the notebook you want to search for
// getDatasetsByNotebookTitle('National-level Analysis using Twitter Data').catch(console.error);
getRelatedDatasetsByNotebookId('LH32CJABTt7sTSBmivSy')