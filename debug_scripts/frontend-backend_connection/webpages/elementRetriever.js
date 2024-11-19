import fetch from 'node-fetch';
async function elementRetriever(field_name, match_value = 'null', element_type = 'null', sort_by = '_score', order = 'desc', from = '0', size = '10', count_only = false) {
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
elementRetriever('title')
  .then(data => console.log(data))
  .catch(error => console.error(error));

