import fetch from 'node-fetch';
import fs from 'fs';

const url = 'http://localhost:5000/api/resources';

// Read datasets.json file
fs.readFile('notebooks.json', 'utf8', async (err, data) => {
    if (err) {
        console.error('Error reading datasets.json file:', err);
        return;
    }

    try {
        const datasets = JSON.parse(data);

        // Iterate through each dataset and send PUT request
        for (const dataset of datasets) {
            try {
                const response = await fetch(url, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(dataset)
                });

                const result = await response.json();
                console.log('Response for dataset', dataset.id, ':', result);
            } catch (error) {
                console.error('Error sending PUT request for dataset', dataset.id, ':', error);
            }
        }
    } catch (error) {
        console.error('Error parsing datasets.json file:', error);
    }
});

