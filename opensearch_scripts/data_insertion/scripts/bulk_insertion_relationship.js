import fetch from 'node-fetch';
import fs from 'fs';

// Get the JSON file path from command-line arguments
const filePath = process.argv[2];

if (!filePath) {
    console.error('Please provide the path to the JSON file as a command-line argument.');
    process.exit(1);
}

const url = 'http://localhost:5001/api/resources';

// Read the JSON file
fs.readFile(filePath, 'utf8', async (err, data) => {
    if (err) {
        console.error('Error reading JSON file:', err);
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
        console.error('Error parsing JSON file:', error);
    }
});

