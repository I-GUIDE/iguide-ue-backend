/**
 * Fetches the count of resources based on the specified resource type and/or keywords.
 *
 * @async
 * @function getResourceCount
 * @param {string} [resourceType] - The type of resources to count. Optional. If 'any', it matches all resource types.
 * @param {string} [keywords] - Search keywords to count the resources. Optional.
 * @returns {Promise<number>} A promise that resolves to the count of resources.
 * @throws {Error} Throws an error if the fetch operation fails.
 */
async function getResourceCount(resourceType, keywords) {
  const response = await fetch('http://149.165.169.173:5000/api/resource-count', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ resourceType, keywords })
  });

  if (!response.ok) {
    throw new Error('Failed to fetch resource count');
  }

  const data = await response.json();
  return data.count;
}

// Example usage: Get the count of all resources with the keyword 'twitter'
getResourceCount('any', 'twitter')
  .then(count => console.log(`Number of resources when searching 'twitter': ${count}`))
  .catch(error => console.error(error));
getResourceCount(null, 'Chicago')
  .then(count => console.log(`Number of resources when searching 'Chicago': ${count}`))
  .catch(error => console.error(error));
// Example usage: Get the count of all notebooks
getResourceCount('notebook')
  .then(count => console.log(`Number of notebooks: ${count}`))
  .catch(error => console.error(error));

