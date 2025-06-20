import axios from "axios";
import * as os from "../backend_opensearch.js";
import * as n4j from '../backend_neo4j.js';

export async function getFlaskEmbeddingResponse(content) {
    let newEmbedding;
    try {
        // Get embedding from Flask endpoint
        const flaskUrl = process.env.FLASK_EMBEDDING_URL; // URL of the Flask endpoint from .env
        if (String(process.argv[1]).includes('jest')) {
            console.log('no embedding performed for testing purposes')
            return newEmbedding;
        }
        // Fetch the new embedding from the Flask API
        const embeddingResponse = await axios.post(`${flaskUrl}/get_embedding`, {
            text: content  // Use the updated content to generate a new embedding
        });
        // Use when only testing => {timeout: 3000};

        if (embeddingResponse && embeddingResponse?.data && embeddingResponse?.data?.embedding) {
            newEmbedding = embeddingResponse?.data?.embedding;
        } else {
            console.log('No embedding returned for the content');
        }
    } catch (error) {
        // console.log("getFlaskEmbeddingResponse - skipping as no ENV defined");
        // console.error("getFlaskEmbeddingResponse - Error: ", error);
    }
    return newEmbedding;
}

export async function performElementOpenSearchUpdate(updated_body, element_id) {
    try {
         const response = await os.client.update({
             id: element_id,
             index: os.os_index,
             body: {
                 doc: updated_body
             },
             refresh: true,
         });
         if (response?.body?.result) {
             return response?.body?.result;
         } else {
             return response?.body;
         }
    } catch (error) {
        console.error("performElementOpenSearchUpdate - Error: ", error);
        return "Error in updating at OpenSearch for element_id: " + element_id;
    }
}

export async function performElementOpenSearchDelete(element_id) {
    try {
        const response =
            await os.client.delete({
                index: os.os_index,
                id: element_id
            });
            let os_resp = response?.body?.result
			await os.client.indices.refresh({ index: os.os_index });
            if (os_resp !== undefined) {
                return os_resp;
            } else {
                return "Error in deleting from OpenSearch for element_id: " + element_id;
            }
    } catch (error) {
        if (error?.meta?.statusCode === 404) {
            return "Error Element does not exist in OpenSearch for Element_id: " + element_id;
        } else {
            console.error("performElementOpenSearchDelete - Error: ", error);
        }
        return "Error in deleting at OpenSearch for element_id: " + element_id;
    }

}

export async function performElementOpenSearchInsert(element_body, element_id) {
    try {
        const response =
            await os.client.index({
                id: element_id,
                index: os.os_index,
                body: element_body,
                refresh: true,
            });
        if (response?.body?.result) {
            return response.body.result
        } else {
            return "error in creating index for element_id: " + element_id
        }
    } catch (error) {
        console.error("performElementOpenSearchInsert - Error: ", error);
        return "error in creating index for element_id: " + element_id
    }
}

export async function performReIndexElementsBasedOnUserId(user_id, total_elements) {
    try {
        let user_elements = await n4j.getElementsByContributor(user_id, 0, total_elements);
        let user_elements_ids = [];
        if (user_elements['total-count'] > 0) {
            user_elements['elements'].forEach((element) => {
                user_elements_ids.push(element['id']);
            });
        }

        let user_details = await n4j.getContributorByID(user_id);
        let user_updated_name = user_details['display-first-name'] + " " + user_details['display-last-name'];

        let success_updates = 0;
        let failed_updates = 0;

        // Await all update operations in parallel
        const updateResults = await Promise.all(
            user_elements_ids.map(async (element_id) => {
                try {
                    const response = await os.client.update({
                        index: os.os_index,
                        id: element_id,
                        body: {
                            doc: {
                                contributor: user_updated_name,
                            },
                        },
                        refresh: true,
                    });

                    if (response?.body?.result) {
                        success_updates += 1;
                    } else {
                        failed_updates += 1;
                    }
                } catch (err) {
                    console.error(`Failed to update element ${element_id}:`, err.meta?.body?.error || err.message);
                    failed_updates += 1;
                }
            })
        );
        console.log(`Updated user OS Elements for user_id: ${user_id} - Success: ${success_updates}, Failed: ${failed_updates}`);
        return success_updates > 0;
    } catch (error) {
        console.error("performReIndexElementsBasedOnUserId - Error: ", error);
        return false;
    }
}
