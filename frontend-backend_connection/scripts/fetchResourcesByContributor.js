import fetch from 'node-fetch';

/**
 * Fetches resources created by a specified contributor from the backend with optional sorting and pagination.
 *
 * @async
 * @function fetchResourcesByContributor
 * @param {string} openid - The openid of the contributor.
 * @param {string} [sortBy='_score'] - The field to sort the resources by. Defaults to '_score'.
 * @param {string} [order='desc'] - The order of sorting, either 'asc' or 'desc'. Defaults to 'desc'.
 * @param {number} [from=0] - The starting index for pagination. Defaults to 0.
 * @param {number} [size=15] - The number of resources to fetch. Defaults to 15.
 * @returns {Promise<Object>} A promise that resolves to the JSON response containing the resources.
 * @throws {Error} Throws an error if the fetch operation fails.
 */
async function fetchResourcesByContributor(openid, sortBy = '_score', order = 'desc', from = 0, size = 15) {
  const response = await fetch(`http://149.165.154.200:5001/api/searchByCreator`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      openid,
      sort_by: sortBy,
      order: order,
      from: from,
      size: size,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to fetch resources');
  }
  return response.json();
}

// Example usage: retrieve resources created by a specific contributor
fetchResourcesByContributor('http%3A%2F%2Fcilogon.org%2FserverE%2Fusers%2F201338', 'title', 'asc', 0, 4)
  .then(data => console.log(data))
  .catch(error => console.error(error));

