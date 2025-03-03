import dotenv from 'dotenv';
const { Client } = require('@opensearch-project/opensearch');
const WKT = require('wellknown');

// Configure OpenSearch client
const client = new Client({
  node: process.env.OPENSEARCH_NODE || 'http://localhost:9200',
  auth: {
    username: process.env.OPENSEARCH_USERNAME || 'admin',
    password: process.env.OPENSEARCH_PASSWORD || 'admin',
  },
  ssl: {
    rejectUnauthorized: false
  }
});

const indexOld = process.env.OPENSEARCH_INDEX || 'neo4j-elements-dev-v3';
const indexNew = 'neo4j-elements-dev-vspatial';

function parseEnvelopeToGeoJSON(envelopeStr) {
  try {
    const cleanStr = envelopeStr.replace(/ENVELOPE\(/i, '').replace(/\)$/, '');
    const parts = cleanStr.split(',').map(p => parseFloat(p.trim()));
    const [minLon, maxLon, maxLat, minLat] = parts;
    
    return {
      type: 'Polygon',
      coordinates: [[
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat]
      ]]
    };
  } catch (e) {
    console.error(`⚠️ Failed to parse ENVELOPE: ${envelopeStr} | Error: ${e}`);
    return null;
  }
}

function convertWKTToGeoJSON(wktString) {
  if (!wktString) return null;
  try {
    return WKT.parse(wktString);
  } catch (e) {
    console.error(`⚠️ Failed to convert WKT: ${wktString} | Error: ${e}`);
    return null;
  }
}

function transformDocument(doc) {
  const source = { ...doc._source };

  // Handle spatial-bounding-box
  if (source['spatial-bounding-box']) {
    const sbb = source['spatial-bounding-box'];
    if (typeof sbb === 'string' && sbb.toUpperCase().startsWith('ENVELOPE(')) {
      source['spatial-bounding-box'] = parseEnvelopeToGeoJSON(sbb);
    } else {
      source['spatial-bounding-box'] = convertWKTToGeoJSON(sbb);
    }
  }

  // Handle other spatial fields
  ['spatial-geometry', 'spatial-centroid'].forEach(field => {
    if (source[field]) {
      source[field] = convertWKTToGeoJSON(source[field]);
    }
  });

  return {
    _index: indexNew,
    _id: doc._id,
    _source: source
  };
}

async function reindexDocuments() {
  console.log(`🔄 Fetching documents from ${indexOld}...`);
  
  let scrollId;
  let totalSuccess = 0;
  let totalFailed = 0;
  
  try {
    const initialResponse = await client.search({
      index: indexOld,
      scroll: '1m',
      size: 1000,
      body: { query: { match_all: {} } }
    });

    scrollId = initialResponse.body._scroll_id;
    let hits = initialResponse.body.hits.hits;

    while (hits.length > 0) {
      const transformedDocs = hits.map(doc => transformDocument(doc));

      console.log(`🚀 Reindexing ${transformedDocs.length} documents...`);
      const bulkResult = await client.helpers.bulk({
        datasource: transformedDocs,
        onDocument(doc) {
          return {
            index: { 
              _index: doc._index,
              _id: doc._id
            },
            doc: doc._source
          };
        },
        retries: 3,
        wait: 5000
      });

      totalSuccess += bulkResult.successful;
      totalFailed += bulkResult.failed;

      // Get next batch
      const scrollResponse = await client.scroll({
        scroll_id: scrollId,
        scroll: '1m'
      });
      scrollId = scrollResponse.body._scroll_id;
      hits = scrollResponse.body.hits.hits;
    }

    console.log(`✅ Reindexing complete! Successful: ${totalSuccess}, Failed: ${totalFailed}`);
  } catch (error) {
    console.error(`❌ Error during reindexing: ${error.message}`);
    process.exit(1);
  }
}

reindexDocuments().catch(console.error);