#!/usr/bin/env node

import { Client } from '@opensearch-project/opensearch';
// reindex_wkt_spatial.js
import wktParser from 'wkt-parser';

// wktParser is a function, not an object, so call it directly
const wktString = 'POINT(30 10)';
console.log(`Parsing WKT: ${wktString}`);

try {
    const geoJson = wktParser(wktString);
    console.log('Parsed GeoJSON:', JSON.stringify(geoJson, null, 2));
} catch (err) {
    console.error(`Failed to parse WKT: "${wktString}"`);
    console.error(`Error: ${err.message}`);
}



// === CONFIG ===
const OLD_INDEX = 'neo4j-elements-dev-v3';
const NEW_INDEX = 'neo4j-elements-dev-vspatial';

// Adjust your connection info as needed
const client = new Client({
  node: process.env.OPENSEARCH_NODE || 'http://localhost:9200',
  auth: {
    username: process.env.OPENSEARCH_USERNAME || 'admin',
    password: process.env.OPENSEARCH_PASSWORD || 'admin',
  },
  ssl: {
    rejectUnauthorized: false,
  },
});

// Maximum docs to process in one bulk request
const BATCH_SIZE = 1000;

// Which fields do we parse from WKT => GeoJSON or WKT => (lon, lat) array?
const WKT_GEOSHAPE_FIELDS = ['spatial-geometry', 'spatial-bounding-box']; // these become type=geo_shape
const WKT_GEOPOINT_FIELDS = ['spatial-centroid']; // these become type=geo_point

/**
 * Converts a WKT string (e.g., 'POLYGON ((...))' or 'POINT (...)') to a GeoJSON object.
 */
function convertWktToGeoJson(wktString) {
    console.log(`Parsing WKT: "${wktString}"`); // Ensures WKT is printed before parsing
  
    try {
      return WKTParser.parse(wktString);
    } catch (err) {
      console.error(`\n❌ Failed to parse WKT: "${wktString}"`);
      console.error(`Error: ${err.message}\n`);
  
      // Write bad WKT to a log file for debugging
      fs.appendFileSync('bad_wkt_log.txt', `${wktString}\n`);
  
      return null;
    }
  }
  
/**
 * Converts a WKT representation of a POINT to a standard [lon, lat] array for geo_point.
 * If the WKT is 'POINT (lon lat)', parse it to [lon, lat].
 * If you have WKT that's actually a LINESTRING or POLYGON, handle accordingly, or skip.
 */
function convertWktToGeoPoint(wktString) {
  const geometry = parseWKT(wktString);
  // Expect geometry.type === 'Point'
  // The coordinates array is [lon, lat]
  return geometry.coordinates; 
}

/**
 * Process a single document's _source, converting WKT strings as needed
 */
function transformSource(docSource) {
  // For each geo_shape field
  for (const field of WKT_GEOSHAPE_FIELDS) {
    if (docSource[field]) {
      try {
        docSource[field] = convertWktToGeoJson(docSource[field]);
      } catch (err) {
        console.warn(`Skipping invalid WKT in field [${field}]:`, docSource[field]);
        // Optionally remove the field or leave it as-is
        delete docSource[field];
      }
    }
  }

  // For each geo_point field
  for (const field of WKT_GEOPOINT_FIELDS) {
    if (docSource[field]) {
      try {
        docSource[field] = convertWktToGeoPoint(docSource[field]);
      } catch (err) {
        console.warn(`Skipping invalid WKT for geo_point in field [${field}]:`, docSource[field]);
        delete docSource[field];
      }
    }
  }

  return docSource;
}

async function runReindex() {
  let totalDocs = 0;
  let keepScrolling = true;
  let scrollId = null;

  try {
    // 1. Initial search with scroll
    const firstResponse = await client.search({
      index: OLD_INDEX,
      scroll: '2m', // keep the scroll context alive for 2 minutes
      size: BATCH_SIZE,
      body: {
        query: { match_all: {} },
      },
    });

    scrollId = firstResponse.body._scroll_id;
    let hits = firstResponse.body.hits.hits || [];

    while (keepScrolling && hits.length > 0) {
      // 2. Prepare a bulk request for these hits
      const bulkOps = [];

      for (const hit of hits) {
        const source = hit._source;
        const id = hit._id;

        // Transform the source to parse WKT => GeoJSON / geo_point
        const transformed = transformSource({ ...source });

        // Add to the bulk array
        bulkOps.push({ index: { _index: NEW_INDEX, _id: id } });
        bulkOps.push(transformed);
      }

      if (bulkOps.length > 0) {
        // 3. Execute the bulk insert
        const bulkResponse = await client.bulk({ body: bulkOps });
        if (bulkResponse.body.errors) {
          console.error('Bulk indexing encountered errors:', JSON.stringify(bulkResponse.body, null, 2));
        }
        totalDocs += hits.length;
        console.log(`Indexed batch of ${hits.length} docs. Total so far: ${totalDocs}`);
      }

      // 4. Fetch next batch via scroll
      const scrollResponse = await client.scroll({
        scrollId,
        scroll: '2m',
      });

      scrollId = scrollResponse.body._scroll_id;
      hits = scrollResponse.body.hits.hits;

      if (!hits || hits.length === 0) {
        keepScrolling = false;
      }
    }
  } catch (error) {
    console.error('Error during reindex process:', error);
  } finally {
    // 5. Clear scroll
    if (scrollId) {
      try {
        await client.clearScroll({ scrollId });
      } catch (err) {
        console.warn('Error clearing scroll:', err);
      }
    }
  }

  console.log(`Reindex complete. Processed ${totalDocs} documents from [${OLD_INDEX}] to [${NEW_INDEX}].`);
}

// Run the script
runReindex().catch(err => {
  console.error(err);
  process.exit(1);
});
