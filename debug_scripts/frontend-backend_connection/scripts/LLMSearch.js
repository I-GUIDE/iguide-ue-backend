async function queryConversationalSearch(userQuery) {
    const requestBody = {
        userQuery: userQuery
    };

    try {
        const response = await fetch("http://localhost:5001/beta/llm-search", {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        return data; // The results from the conversational search
    } catch (error) {
        console.error('Error querying conversational search:', error);
        return null;
    }
}
const userQuery = "What are some datasets for Illinois?";
queryConversationalSearch(userQuery)
    .then(data => {
        if (data) {
            console.log('Conversational Search Results:', data);
        } else {
            console.log('No data found or an error occurred.');
        }
    });

