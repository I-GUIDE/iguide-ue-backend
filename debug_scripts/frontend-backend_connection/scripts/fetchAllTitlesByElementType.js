import fetch from 'node-fetch';

/**
 * Fetches the featured documents from the backend API.
 * 
 * @async
 * @function fetchFeaturedDocuments
 * @returns {Promise<Object[]>} A promise that resolves to an array of featured documents.
 * @throws {Error} If there is an error fetching the data.
 */
async function fetchFeaturedDocuments() {
    const response = await fetch(`https://backend.i-guide.io:5000/api/featured-resources`);
    if (!response.ok) {
        throw new Error(`Error fetching featured documents: ${response.statusText}`);
    }
    const data = await response.json();
    return data;
}

/**
 * Calls fetchFeaturedDocuments and handles the response or any errors.
 */
fetchFeaturedDocuments()
  .then(response => {
    console.log('Featured Documents:', response);
  })
  .catch(error => {
    console.error('Error fetching featured documents:', error);
  });
