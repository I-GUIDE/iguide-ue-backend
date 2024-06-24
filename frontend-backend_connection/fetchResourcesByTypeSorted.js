/**
 * Fetches resources of a specified type from a the backend with optional sorting and pagination.
 *
 * @async
 * @function fetchResourcesByType
 * @param {string} type - The type of resources to fetch.
 * @param {string} [sortBy='_score'] - The field to sort the resources by. Defaults to '_score'.
 * @param {string} [order='desc'] - The order of sorting, either 'asc' or 'desc'. Defaults to 'desc'.
 * @param {number} [from=0] - The starting index for pagination. Defaults to 0.
 * @param {number} [size=15] - The number of resources to fetch. Defaults to 15.
 * @returns {Promise<Object>} A promise that resolves to the JSON response containing the resources.
 * @throws {Error} Throws an error if the fetch operation fails.
 */
async function fetchResourcesByType(type, sortBy = '_score', order = 'desc', from = 0, size = 15) {
  const response = await fetch(`http://149.165.169.173:5000/api/resources?data_name=${type}&sort_by=${sortBy}&order=${order}&from=${from}&size=${size}`);
  if (!response.ok) {
    throw new Error('Failed to fetch resources');
  }
  return response.json();
}

// Example usage: retrieve the 1st notebook
fetchResourcesByType('notebook', 'title', 'asc', 0, 4)
  .then(data => console.log(data))
  .catch(error => console.error(error));

