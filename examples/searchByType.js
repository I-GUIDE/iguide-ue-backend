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

  const response = await fetch('http://149.165.169.173:5000/search', {
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


searchResources('twitter', 'notebook', 'id', 'asc', 0, 1)
  .then(data => console.log(data))
  .catch(error => console.error(error));

