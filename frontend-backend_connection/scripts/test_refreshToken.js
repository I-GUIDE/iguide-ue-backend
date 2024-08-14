//For testing the JWT authorizing token and refresh token
/**
 * Fetches a URL with authorization, refreshing the access token if necessary.
 *
 * @async
 * @function fetchWithAuth
 * @param {string} url - The URL to fetch.
 * @param {Object} [options={}] - The options for the fetch request.
 * @returns {Promise<Response>} A promise that resolves to the fetch response.
 * @throws {Error} If there is an error with the fetch request.
 */
async function fetchWithAuth(url, options = {}) {
    let res = await fetch(url, options);

    if (res.status === 401) {
        // Access token has expired, refresh it
        await refreshAccessToken();

        // Retry the original request
        res = await fetch(url, options);
    }

    return res;
}

/**
 * Refreshes the access token by making a request to the backend API.
 *
 * @async
 * @function refreshAccessToken
 * @returns {Promise<void>} A promise that resolves when the access token has been refreshed.
 * @throws {Error} If there is an error refreshing the access token.
 */
async function refreshAccessToken() {
    const res = await fetch('http://your-backend-domain/api/refresh-token', {
        method: 'POST',
        credentials: 'include' // Ensure cookies are sent with the request
    });

    if (!res.ok) {
        throw new Error('Failed to refresh access token');
    }

    const data = await res.json();
    // Optionally update any state with the new access token if needed
}

// Example usage
fetchWithAuth('http://your-backend-domain/api/toy-auth')
    .then(res => res.json())
    .then(data => console.log(data))
    .catch(err => console.error('Error:', err));

