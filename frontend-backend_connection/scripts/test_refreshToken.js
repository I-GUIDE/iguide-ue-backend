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

