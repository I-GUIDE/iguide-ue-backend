async function fetchFeaturedDocuments() {
    const response = await fetch(`https://backend.i-guide.io:5000/api/featured-resources`);
    const data = await response.json();
    return data;
}
fetchFeaturedDocuments()
  .then(response => {
    console.log('Featured Documents:', response);
  })
  .catch(error => {
    console.error('Error fetching featured documents:', error);
  });
