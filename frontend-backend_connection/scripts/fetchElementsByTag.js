import fetch from 'node-fetch';

/**
 * Fetches documents associated with a given tag from the backend API.
 * 
 * @async
 * @function fetchDocumentsByTag
 * @param {string} tag - The tag for which to fetch documents.
 * @returns {Promise<Object[]>} A promise that resolves to an array of documents.
 * @throws {Error} If there is an error fetching the data.
 */
async function fetchDocumentsByTag(tag) {
    const response = await fetch(`http://149.165.154.200:5001/api/elements/tag/${tag}`);
    if (!response.ok) {
        throw new Error(`Error fetching documents by tag: ${response.statusText}`);
    }
    const data = await response.json();
    return data;
}

/**
 * Calls fetchDocumentsByTag and handles the response or any errors.
 */
const tag = 'Aging-Dams';

fetchDocumentsByTag(tag)
  .then(response => {
    console.log('Documents:', response);
  })
  .catch(error => {
    console.error('Error fetching documents:', error);
  });

