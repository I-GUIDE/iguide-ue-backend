import fetch from 'node-fetch';

/**
 * Fetches all titles of elements of a specified type from the backend.
 *
 * @async
 * @function fetchAllTitlesByElementType
 * @param {string} elementType - The type of resources to fetch titles for.
 * @returns {Promise<Array<string>>} A promise that resolves to an array of all titles.
 * @throws {Error} Throws an error if the fetch operation fails.
 */
async function fetchAllTitlesByElementType(elementType) {
  const response = await fetch(`http://149.165.154.200:5001/api/elements/titles?element_type=${elementType}`);
  if (!response.ok) {
    throw new Error('Failed to fetch titles');
  }
  return response.json();
}

// Example usage: retrieve all notebook titles
fetchAllTitlesByElementType('dataset')
  .then(titles => console.log(titles))
  .catch(error => console.error(error));

