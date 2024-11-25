import fetch from 'node-fetch';

/**
 * Fetches the count of resources by a specified field and array of values from the backend.
 *
 * @async
 * @function fetchResourceCountByField
 * @param {string} field - The field to query.
 * @param {Array<string>} values - The array of values to match.
 * @returns {Promise<number>} A promise that resolves to the JSON response containing the count of resources.
 * @throws {Error} Throws an error if the fetch operation fails.
 */
async function fetchResourceCountByField(field, values) {
  const encodedValues = values.map(value => encodeURIComponent(value)).join(',');
  const response = await fetch(`http://149.165.154.200:5001/api/resources/count/${field}/${encodedValues}`);
  if (!response.ok) {
    throw new Error('Failed to fetch resource count');
  }
  const data = await response.json();
  return data.count;
}


// Example usage: retrieve resource count by field and array of values
fetchResourceCountByField('metadata.created_by', ['http://cilogon.org/serverA/users/11826461'])
  .then(count => console.log(`Count of resources: ${count}`))
  .catch(error => console.error(error));

