/**
 * Searches for resources based on a keyword, with optional resource type, sorting, and pagination.
 *
 * @async
 * @function searchResources
 * @param {string} keyword - The keyword to search for in resources.
 * @param {string} [resourceType=null] - The type of resources to filter by. Defaults to null, which means no filtering by type.
 * @param {string} [sortBy='_score'] - The field to sort the search results by. Defaults to '_score'.
 * @param {string} [order='desc'] - The order of sorting, either 'asc' or 'desc'. Defaults to 'desc'.
 * @param {number} [from=0] - The starting index for pagination. Defaults to 0.
 * @param {number} [size=15] - The number of resources to return. Defaults to 15.
 * @returns {Promise<Object>} A promise that resolves to the JSON response containing the search results.
 * @throws {Error} Throws an error if the search operation fails.
 */
async function searchResources(keyword, resourceType = null, sortBy = '_score', order = 'desc', from = 0, size = 15) {
  const body = {
    keyword,
    sort_by: sortBy,
    order,
    from,
    size,
  };

  if (resourceType) {
    body.resource_type = resourceType;
  }

  const response = await fetch('http://localhost:5001/api/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error('Failed to search resources');
  }
  return response.json();
}

//Example: search the notebook with the keyword “twitter" and show the top two results sorted by 'id' in asc order

searchResources('twitter', 'any', 'title')
  .then(data => console.log(data))
  .catch(error => console.error(error));
