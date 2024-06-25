/**
 * Fetches a resource by a specified field and value from the backend.
 *
 * @async
 * @function fetchResourceByField
 * @param {string} field - The field to query.
 * @param {string} value - The value to match.
 * @returns {Promise<Object>} A promise that resolves to the JSON response containing the resource.
 * @throws {Error} Throws an error if the fetch operation fails.
 */
async function fetchResourceByField(field, value) {
  const response = await fetch(`http://localhost:5000/api/resource/${field}/${value}`);
  if (!response.ok) {
    throw new Error('Failed to fetch resource');
  }
  return response.json();
}

// Example usage: retrieve a resource by field and value
fetchResourceByField('id', 'ds1')
  .then(resource => console.log(resource))
  .catch(error => console.error(error));

