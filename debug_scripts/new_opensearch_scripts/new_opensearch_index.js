/**
 * Script to create a fresh OpenSearch index from scratch using Neo4j data
**/

import * as n4j from "../../database/backend_neo4j.js";
import * as os from "../../database/backend_opensearch.js";
import * as utils from "../../utils/utils.js";
import {
  getFlaskEmbeddingResponse,
  getPdfUrlFromDoi,
  extractTextFromPdfUrl,
  splitTextIntoChunks,
} from "../../utils/elements_utils.js";

async function newOpenSearchIndex(newIndexName) {
  if (typeof newIndexName !== "string" || newIndexName.trim() === "") {
    throw new Error("newIndexName must be a non-empty string");
  }

  try {
    console.log(`New OpenSearch index: ${newIndexName}`);

    // 1. Check if index already exists
    const exists = await os.client.indices.exists({ index: newIndexName });

    if (exists.body === true) {
      console.warn(
        `Index "${newIndexName}" already exists.\n` +
        `Please delete it manually and rerun the script.\n` +
        `Exiting without making changes.`
      );
      return;
    }

    // 2. Create new index with vector fields
    await os.client.indices.create({
      index: newIndexName,
      body: {
        settings: {
          number_of_shards: 1,
          number_of_replicas: 1,
        },
        mappings: {
          dynamic: true,
          properties: {
            "contents-embedding": { type: "knn_vector", dimension: 1536 },
            "pdf_chunks_embeddings": { type: "knn_vector", dimension: 1536 },
          },
        },
      },
    });
    console.log(`Created new index: ${newIndexName}`);

    // 3. Fetch all element IDs from Neo4j and index them
    const elementTypes = Object.values(utils.ElementType);
    let bulkOps = [];

    for (let type of elementTypes) {
      console.log(`Fetching element IDs of type: ${type}`);
      const response = await n4j.getElementsByType(type, 0, 10000);
      const elements = response["elements"];

      for (let elem of elements) {
        const elementId = elem["id"];
        if (!elementId) continue;

        // Fetch full element object
        const resource = await n4j.getElementByID(elementId);
        if (!resource || Object.keys(resource).length === 0) continue;

        // Build os_element
        let os_element = {
          title: resource["title"],
          contents: resource["contents"],
          authors: resource["authors"],
          tags: resource["tags"],
          "resource-type": resource["resource-type"],
          "thumbnail-image":
            resource["thumbnail-image"]?.original || resource["thumbnail-image"],

          // spatial (if they exist in resource)
          "spatial-coverage": resource["spatial-coverage"] || null,
          "spatial-geometry": resource["spatial-geometry"] || null,
          "spatial-geometry-geojson": resource["spatial-geometry-geojson"] || null,
          "spatial-bounding-box": resource["spatial-bounding-box"] || null,
          "spatial-bounding-box-geojson": resource["spatial-bounding-box-geojson"] || null,
          "spatial-centroid": resource["spatial-centroid"] || null,
          "spatial-centroid-geojson": resource["spatial-centroid-geojson"] || null,
          "spatial-georeferenced": resource["spatial-georeferenced"] || null,
          "spatial-temporal-coverage": resource["spatial-temporal-coverage"] || null,
          "spatial-index-year": resource["spatial-index-year"] || null,
        };

        // Override contributor with new format
        if (resource["contributor"]) {
          let avatarUrl =
            resource["contributor"]["avatar-url"] || resource["contributor"]["avatar_url"];

          os_element["contributor"] = {
            id: resource["contributor"]["id"],
            "avatar-url":
              typeof avatarUrl === "string"
                ? utils.generateMultipleResolutionImagesFor(
                    avatarUrl,
                    null,
                    true
                  )
                : avatarUrl || null,
            name: resource["contributor"]["name"],
          };
        }

        try {
          if (resource["contents"]) {
            const contentEmbedding = await getFlaskEmbeddingResponse(resource["contents"]);
            if (contentEmbedding) {
              os_element["contents-embedding"] = contentEmbedding;
            }
          }

          if (resource["resource-type"] === "publication") {
            const doi = resource["external-link-publication"] || resource["doi"];
            if (doi) {
              const pdfUrl = await getPdfUrlFromDoi(doi);
              if (pdfUrl) {
                const pdfText = await extractTextFromPdfUrl(pdfUrl);
                if (pdfText) {
                  const chunks = splitTextIntoChunks(pdfText, 1000, 200);
                  const embeddingsArray = [];
                  for (const chunk of chunks) {
                    const embedding = await getFlaskEmbeddingResponse(chunk);
                    if (embedding) {
                      embeddingsArray.push(embedding);
                    }
                  }
                  if (embeddingsArray.length > 0) {
                    os_element["pdf_chunks_embeddings"] = embeddingsArray;
                  }
                }
              }
            }
          }
        } catch (err) {
          console.error(`Embedding generation failed for element ${elementId}:`, err.message);
        }

        // Add to bulk operations
        bulkOps.push({ index: { _index: newIndexName, _id: resource["id"] } });
        bulkOps.push(os_element);
      }
    }

    // 4. Bulk insert into OpenSearch
    if (bulkOps.length > 0) {
      console.log(`Bulk inserting ${bulkOps.length / 2} documents into ${newIndexName}...`);
      await os.client.bulk({ refresh: true, body: bulkOps });
      console.log("Reindexing complete!");
    } else {
      console.log("No elements found to index.");
    }
  } catch (err) {
    console.error("Error rebuilding index:", err);
  }
}

newOpenSearchIndex('new-opensearch-index');

