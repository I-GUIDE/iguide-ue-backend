//Need to specify the geoshape mapping
import fs from 'fs';

// === CONFIGURATION ===
const WKT_GEOSHAPE_FIELDS = ['spatial-geometry', 'spatial-bounding-box'];
const WKT_GEOPOINT_FIELDS = ['spatial-centroid'];

// === IMPROVED WKT SANITIZATION ===
function sanitizeWkt(wktString) {
  return wktString
    .replace(/(\b[A-Z]+)\s*(\()/gi, '$1$2')  // Remove space between type and (
    .replace(/\s*([(),])\s*/g, '$1')         // Remove spaces around brackets/commas
    .replace(/(\d)-/g, '$1 -')               // Fix negative numbers
    .replace(/\s+/g, ' ')                    // Collapse multiple spaces
    .trim();
}


function parseEnvelope(envelopeStr) {
  const sanitized = sanitizeWkt(envelopeStr);

  // Extract coordinates using regex
  const match = sanitized.match(/ENVELOPE\(([^)]+)\)/i);
  if (!match) throw new Error(`Invalid ENVELOPE format: ${sanitized}`);

  const parts = match[1].split(',').map(p => {
    const num = parseFloat(p.trim());
    if (isNaN(num)) throw new Error(`Invalid number: ${p}`);
    return num;
  });

  if (parts.length !== 4) throw new Error(`Need 4 coordinates, got ${parts.length}`);

  // ENVELOPE order: minLon, maxLon, maxLat, minLat
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
}

function parsePoint(pointStr) {
  const sanitized = pointStr
    .replace(/^POINT\s*/i, '')
    .replace(/[()]/g, '')
    .trim();

  const coords = sanitized.split(/\s+/).map(parseFloat);

  if (coords.length !== 2 || coords.some(isNaN)) {
    throw new Error(`Invalid POINT coordinates: ${pointStr}`);
  }

  return {
    type: 'Point',
    coordinates: coords
  };
}

function parsePolygon(polygonStr) {
  const sanitized = polygonStr
    .replace(/^POLYGON\s*/i, '')
    .replace(/(\()|(\)$)/g, '')
    .trim();

  const coordPairs = sanitized.split(/,\s*/).map(pair => {
    const coords = pair.trim().split(/\s+/).map(parseFloat);
    if (coords.length !== 2 || coords.some(isNaN)) {
      throw new Error(`Invalid polygon coordinate pair: ${pair}`);
    }
    return coords;
  });

  // Close the polygon if not already closed
  if (coordPairs.length > 0 && JSON.stringify(coordPairs[0]) !== JSON.stringify(coordPairs[coordPairs.length - 1])) {
    coordPairs.push([...coordPairs[0]]);
  }

  return {
    type: 'Polygon',
    coordinates: [coordPairs]
  };
}

function parseMultiPolygon(multiPolygonStr) {
  // Sanitize input
  const sanitized = multiPolygonStr
    .replace(/^MULTIPOLYGON\s*/i, '')
    .replace(/\)\s*,\s*\(/g, '|||') // Temporary separator
    .replace(/[()]/g, '')
    .trim();

  // Split into individual polygons
  const polygons = sanitized.split('|||').filter(p => p);
  const coordinates = [];

  for (const polyStr of polygons) {
    // Split into rings (outer and potential holes)
    const rings = polyStr.split(/\),\s*\(/).map(ring => {
      const coordPairs = ring.split(/,\s*/).map(pair => {
        const [lon, lat] = pair.trim().split(/\s+/);
        const lonNum = parseFloat(lon);
        const latNum = parseFloat(lat);

        if (isNaN(lonNum) || isNaN(latNum)) {
          throw new Error(`Invalid coordinate pair: ${pair}`);
        }
        return [lonNum, latNum];
      });

      // Close the ring if not closed
      if (coordPairs.length > 0 &&
          !(coordPairs[0][0] === coordPairs[coordPairs.length-1][0] &&
            coordPairs[0][1] === coordPairs[coordPairs.length-1][1])) {
        coordPairs.push([...coordPairs[0]]);
      }

      return coordPairs;
    });

    coordinates.push(rings);
  }

  return {
    type: 'MultiPolygon',
    coordinates: coordinates
  };
}

function convertWktToGeoJson(wktString) {
  try {
    const upperWkt = wktString.toUpperCase().trim();

    if (upperWkt.startsWith('ENVELOPE')) {
      return parseEnvelope(wktString);
    }
    if (upperWkt.startsWith('POINT')) {
      return parsePoint(wktString);
    }
    if (upperWkt.startsWith('POLYGON')) {
      return parsePolygon(wktString);
    }
    if (upperWkt.startsWith('MULTIPOLYGON')) {
      return parseMultiPolygon(wktString);
    }

    throw new Error(`Unsupported geometry type: ${wktString}`);

  } catch (err) {
    console.log("spatial_utils.js - convertWktToGeoJson - Error: ", err);
    return null;
  }
}

export function convertGeoSpatialFields(resource) {
    const temp_resource = {...resource}
    // Get the geospatial fields and do a sanity check first
    const geo_spatial_fields = [...WKT_GEOSHAPE_FIELDS, ...WKT_GEOPOINT_FIELDS];
    for (const spatial_field of geo_spatial_fields) {
        if (spatial_field in temp_resource) {
            let resource_value = temp_resource[spatial_field]
            if(resource_value && resource_value !== "") {
                let geo_json_value = null
                try {
                    if (spatial_field === "spatial-bounding-box") {
                        geo_json_value = parseEnvelope(resource_value)
                    } else {
                        geo_json_value = convertWktToGeoJson(resource_value)
                    }
                    if (geo_json_value) {
                        temp_resource[spatial_field+"-geojson"] = geo_json_value
                    }
                } catch (err) {
                    console.log("spatial_utils.js - convertGeoSpatialFields ", spatial_field," - error: ", err)
                }
            }
        }
    }
    return temp_resource
}