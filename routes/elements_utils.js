import axios from "axios";
import * as os from "../backend_opensearch.js";

export async function getFlaskEmbeddingResponse(content) {
    let newEmbedding;
    try {
        // Get embedding from Flask endpoint
        const flaskUrl = process.env.FLASK_EMBEDDING_URL; // URL of the Flask endpoint from .env

        // Fetch the new embedding from the Flask API
        const embeddingResponse = await axios.post(`${flaskUrl}/get_embedding`, {
            text: content  // Use the updated content to generate a new embedding
        },{timeout: 3000});

        if (embeddingResponse && embeddingResponse?.data && embeddingResponse?.data?.embedding) {
            newEmbedding = embeddingResponse?.data?.embedding;
        } else {
            console.log('No embedding returned for the content');
        }
    } catch (error) {
        console.error("getFlaskEmbeddingResponse - Error: ", error);
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