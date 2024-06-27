const { Client } = require('@opensearch-project/opensearch');

// Create a new OpenSearch client
const client = new Client({
  node: 'http://localhost:9200', // Replace with your OpenSearch endpoint
});

async function updateDocumentByTitle(index, title, updateFields) {
  try {
    // Search for the document by title
    const searchResponse = await client.search({
      index: index,
      body: {
        query: {
          match: { title: title }
        }
      }
    });

    // Check if any documents were found
    if (searchResponse.body.hits.total.value === 0) {
      console.log(`No documents found with title: ${title}`);
      return;
    }

    // Get the document ID
    const docId = searchResponse.body.hits.hits[0]._id;

    // Update the document
    const updateResponse = await client.update({
      index: index,
      id: docId,
      body: {
        doc: updateFields
      }
    });

    console.log(`Document updated: ${JSON.stringify(updateResponse.body)}`);
  } catch (error) {
    console.error(`Error updating document: ${error}`);
  }
}

// Use the function to update a document by title
const indexName = 'resources_dev';
const titleToUpdate = 'Document Title'; // Replace with the actual title
const fieldsToUpdate = {
  featured: true
};

updateDocumentByTitle(indexName, titleToUpdate, fieldsToUpdate);

