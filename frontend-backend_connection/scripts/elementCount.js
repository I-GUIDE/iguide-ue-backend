import fetch from 'node-fetch';
async function elementCount({ 
  field_name = '', 
  match_value = null, 
  element_type = null, 
} = {}) {
  const count_only = true;
  const response = await fetch('http://149.165.154.200:5001/api/elements/retrieve', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      field_name,
      match_value,
      element_type,
      count_only,
    }),
  });

  if (!response.ok) {
    throw new Error('Failed to retrieve elements');
  }

  return response.json();
}

elementCount({
})
  .then(data => console.log(data))
  .catch(error => console.error(error));
