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

async function addDataset() {
  try {
    const response = await client.index({
      index: 'datasets',
      id: 'ds5',
      body: {
        title: 'New Dataset',
        authors: ['Author Name'],
        tags: ['Tag1', 'Tag2'],
        contents: 'This is a new dataset.',
        'related-notebooks': ['nb1'],
        'external-link': 'http://example.com',
        'direct-download-link': 'http://example.com/download',
        size: '1 GB',
        'thumbnail-image': '/src/assets/images/dataset_images/new.png'
      }
    });

    console.log('Document added:', response.body);
  } catch (error) {
    console.error('Error adding document:', error);
  }
}

async function updateDataset() {
  try {
    const response = await client.update({
      index: 'datasets',
      id: 'ds5',
      body: {
        doc: {
          title: 'Updated Dataset Title',
          tags: ['UpdatedTag1', 'UpdatedTag2']
        }
      }
    });

    console.log('Document updated:', response.body);
  } catch (error) {
    console.error('Error updating document:', error);
  }
}

async function deleteDataset() {
  try {
    const response = await client.delete({
      index: 'datasets',
      id: 'ds5'
    });

    console.log('Document deleted:', response.body);
  } catch (error) {
    console.error('Error deleting document:', error);
  }
}

// Example usage
addDataset();
//updateDataset();
//deleteDataset();