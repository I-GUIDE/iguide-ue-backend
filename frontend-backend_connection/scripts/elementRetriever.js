import fetch from 'node-fetch';

/**
 * Retrieves or counts elements from the database based on the provided criteria.
 *
 * @param {Object} options - The options for retrieving elements.
 * @param {string} [options.field_name=''] - The name of the field in the element database.
 * @param {(string[]|null)} [options.match_value=null] - The value used for filtering. If it provides an empty array, returns an empty array as result. If it provides "null", return everything.
 * @param {(string[]|null)} [options.element_type=null] - Type of the element. If it provides an empty array, returns an empty array as result. If it provides "null", return everything.
 * @param {string} [options.sort_by='_score'] - The field by which to sort the results.
 * @param {string} [options.order='desc'] - The order of the sorting (ascending or descending).
 * @param {string} [options.from='0'] - The starting point of the results.
 * @param {string} [options.size='10'] - The number of results to retrieve.
 * @param {boolean} [options.count_only=false] - If set to true, only returns the count of the documents; otherwise, returns the documents.
 * @returns {Promise<Object|number>} The retrieved elements or the count of elements.
 * @throws {Error} If the request fails.
 */
async function elementRetriever({ 
  field_name = '', 
  match_value = null, 
  element_type = null, 
  sort_by = '_score', 
  order = 'desc', 
  from = '0', 
  size = '10', 
  count_only = false 
} = {}) {
  const response = await fetch('http://149.165.154.200:5001/api/elements/retrieve', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      field_name,
      match_value,
      element_type,
      sort_by,
      order,
      from,
      size,
      count_only,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to retrieve elements');
  }

  return response.json();
}

// Example usage to get count only
/*elementRetriever({ count_only: true })
  .then(data => console.log(data))
  .catch(error => console.error(error));*/
  
// Example usage to get elements with specific parameters
/*elementRetriever({
  field_name: 'metadata.created_by',
  match_value: ['http://cilogon.org/serverA/users/11826461'],
  element_type: null,
  sort_by: 'title',
  order: 'asc',
  from: '0',
  size: '10',
  count_only: false
})
  .then(data => console.log(data))
  .catch(error => console.error(error));*/
  
  
elementRetriever({
  field_name: 'tags',
  match_value: ['heat exposure']
})
  .then(data => console.log(data))
  .catch(error => console.error(error));

