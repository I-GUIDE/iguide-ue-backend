
async function fetchResourcesByType(type, sortBy = '_score', order = 'desc', from = 0, size = 15) {
  const response = await fetch(`http://149.165.169.173:5000/api/resources?data_name=${type}&sort_by=${sortBy}&order=${order}&from=${from}&size=${size}`);
  if (!response.ok) {
    throw new Error('Failed to fetch resources');
  }
  return response.json();
}

// Example usage
fetchResourcesByType('notebook', '_score', 'asc', 0, 1)
  .then(data => console.log(data))
  .catch(error => console.error(error));

