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
  const encodedValues = values.map(value => encodeURIComponent(value)).join(',');
  const response = await fetch(`https://backend-dev.i-guide.io:5000/api/resources/${field}/${encodedValues}`);
  if (!response.ok) {
    throw new Error('Failed to fetch resources');
  }
  return response.json();
}

let ids = ['nb1', 'nb2', 'nb3'];
// Example usage: retrieve resources by field and array of values
fetchResourcesByField('id', [ids])
  .then(resources => console.log(resources))
  .catch(error => console.error(error));


  
//console.log(fetchResourcesByField('metadata.created_by', ['http://cilogon.org/serverE/users/201337']));

