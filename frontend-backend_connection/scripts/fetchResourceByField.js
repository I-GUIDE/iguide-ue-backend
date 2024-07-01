import fetch from 'node-fetch'
/**
 * Fetches resources by a specified field and array of values from the backend.
 *
 * @async
 * @function fetchResourcesByField
 * @param {string} field - The field to query.
 * @param {Array<string>} values - The array of values to match.
 * @returns {Promise<Array<Object>>} A promise that resolves to the JSON response containing the resources.
 * @throws {Error} Throws an error if the fetch operation fails.
 */
async function fetchResourcesByField(field, values) {
  const valueString = values.join(',');
  const response = await fetch(`http://149.165.154.200:5001/api/resources_contains/${field}/${valueString}`);
  if (!response.ok) {
    throw new Error('Failed to fetch resources');
  }
  return response.json();
}

// Example usage: retrieve resources by field and array of values
fetchResourcesByField('_id', ['y0mwb5ABQn4vdKPaC-iW'])
  .then(resources => console.log(resources))
  .catch(error => console.error(error));

