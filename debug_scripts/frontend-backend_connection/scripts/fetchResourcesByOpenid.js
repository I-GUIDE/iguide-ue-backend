import fetch from 'node-fetch';

/**
 * Fetches resources by a specified openid (metadata.created_by) from the backend with optional sorting and pagination.
 *
 * @async
 * @function fetchResourcesByOpenid
 * @param {string} openid - The openid (metadata.created_by) to fetch resources by.
 * @param {string} [sortBy='_score'] - The field to sort the resources by. Defaults to '_score'.
 * @param {string} [order='desc'] - The order of sorting, either 'asc' or 'desc'. Defaults to 'desc'.
 * @param {number} [from=0] - The starting index for pagination. Defaults to 0.
 * @param {number} [size=15] - The number of resources to fetch. Defaults to 15.
 * @returns {Promise<Object>} A promise that resolves to the JSON response containing the resources.
 * @throws {Error} Throws an error if the fetch operation fails.
 */
async function fetchResourcesByOpenid(openid, sortBy = '_score', order = 'desc', from = 0, size = 15) {
  const response = await fetch(`http://149.165.154.200:5001/api/resources/${encodeURIComponent(openid)}?sort_by=${encodeURIComponent(sortBy)}&order=${encodeURIComponent(order)}&from=${from}&size=${size}`);
  if (!response.ok) {
    console.log(response);
    throw new Error('Failed to fetch resources');
  }
  return response.json();
}

// Example usage: retrieve resources by openid
fetchResourcesByOpenid('http://cilogon.org/serverA/users/33101641', 'title', 'asc', 0, 4)
  .then(data => console.log(data))
  .catch(error => console.error(error));

