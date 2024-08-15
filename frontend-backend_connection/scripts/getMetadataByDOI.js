/**
 * Fetches metadata for a given DOI from the CrossRef API.
 * 
 * @async
 * @function getMetadataByDOI
 * @param {string} doi - The DOI for which to fetch metadata.
 * @returns {Promise<Object>} A promise that resolves to the metadata object.
 * @throws {Error} If there is an error fetching the metadata.
 */
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

// The NumPy DOI
const doi = '10.1038/s41586-020-2649-2';

(async () => {
  try {
    // Fetch metadata by DOI
    const metadata = await getMetadataByDOI(doi);
    console.log('Metadata:', metadata);
  } catch (error) {
    console.error('Failed to retrieve metadata:', error);
  }
})();

