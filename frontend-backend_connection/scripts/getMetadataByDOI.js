import axios from 'axios';
async function getMetadataByDOI(doi) {
  try {
    // Construct the CrossRef API URL
    const url = `https://api.crossref.org/works/${doi}`;
    
    // Make the HTTP request to the CrossRef API
    const response = await axios.get(url);

    // Extract metadata from the response
    const metadata = response.data.message;
    
    return metadata;
  } catch (error) {
    console.error('Error fetching metadata:', error);
    throw error;
  }
}
async function main() {
  const doi = '10.1038/s41586-020-2649-2'; 
  try {
    const metadata = await getMetadataByDOI(doi);
    console.log('Metadata:', metadata);
  } catch (error) {
    console.error('Failed to retrieve metadata:', error);
  }
}

main();

