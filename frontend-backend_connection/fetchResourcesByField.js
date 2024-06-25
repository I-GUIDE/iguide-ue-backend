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
  const response = await fetch(`http://localhost:5000/api/resources/${field}/${valueString}`);
  if (!response.ok) {
    throw new Error('Failed to fetch resources');
  }
  return response.json();
}

// Example usage: retrieve resources by field and array of values
fetchResourcesByField('id', ['nb1', 'ds1', 'nb2'])
  .then(resources => console.log(resources))
  .catch(error => console.error(error));

