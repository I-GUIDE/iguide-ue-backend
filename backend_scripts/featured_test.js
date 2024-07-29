async function fetchFeaturedDocuments() {
    const response = await fetch(`http://149.165.169.173:5000/api/featured-resources`);
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
