//Need to specify the geoshape mapping
import fs from 'fs';

/**
 * CONFIGURATION for GeoSpatial Fields
 * @type {string[]}
 */
const WKT_GEOSHAPE_FIELDS = ['spatial-geometry', 'spatial-bounding-box'];
const WKT_GEOPOINT_FIELDS = ['spatial-centroid'];

/**
 * IMPROVED WKT STRING SANITIZATION
 * @param wkt_string
 * @returns {*}
 */
function sanitizeWkt(wkt_string) {
  return wkt_string
    .replace(/(\b[A-Z]+)\s*(\()/gi, '$1$2')  // Remove space between type and (
    .replace(/\s*([(),])\s*/g, '$1')         // Remove spaces around brackets/commas
    .replace(/(\d)-/g, '$1 -')               // Fix negative numbers
    .replace(/\s+/g, ' ')                    // Collapse multiple spaces
    .trim();
}


/**
 * Parse Envelope String into Polygon GeoJSON Format
 * @param envelope_str
 * @returns {{coordinates: *[][][], type: string}}
 */
function parseEnvelope(envelope_str) {
  const sanitized = sanitizeWkt(envelope_str);

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

/**
 * Convert point string into GeoJSON Format
 * @param point_str
 * @returns {{coordinates: *, type: string}}
 */
function parsePoint(point_str) {
  const sanitized = point_str
    .replace(/^POINT\s*/i, '')
    .replace(/[()]/g, '')
    .trim();

  const coords = sanitized.split(/\s+/).map(parseFloat);

  if (coords.length !== 2 || coords.some(isNaN)) {
    throw new Error(`Invalid POINT coordinates: ${point_str}`);
  }

  return {
    type: 'Point',
    coordinates: coords
  };
}

/**
 * Convert Line String into GeoJSON Format
 * @param line_string_str
 * @returns {{coordinates: *, type: string}}
 */
function parseLineString(line_string_str) {
    const sanitized = line_string_str
        .replace(/^LINESTRING\s*/i, '')
        .replace(/[()]/g, '')
        .trim();
    const coord_pairs = sanitized.split(",").map(coord_pair => {
        const coords = coord_pair.trim().split(" ").map(parseFloat);
        if (coords.length !== 2 || coords.some(isNaN)) {
            throw new Error(`Invalid Line String coordinate pair: ${coord_pair}`)
        }
        return coords;
    });

    return {
        type: 'LineString',
        coordinates: coord_pairs
    }
}

/**
 * Convert Polygon string into GeoJSON Format
 * @param polygon_str
 * @returns {{coordinates: *[], type: string}}
 */
function parsePolygon(polygon_str) {
  const sanitized = polygon_str
    .replace(/^POLYGON\s*/i, '')
    .replace(/(\()|(\)$)/g, '')
    .trim();

  const coord_pairs = sanitized.split(/,\s*/).map(pair => {
    const coords = pair.trim().split(/\s+/).map(parseFloat);
    if (coords.length !== 2 || coords.some(isNaN)) {
      throw new Error(`Invalid polygon coordinate pair: ${pair}`);
    }
    return coords;
  });

  // Close the polygon if not already closed
  if (coord_pairs.length > 0 && JSON.stringify(coord_pairs[0]) !== JSON.stringify(coord_pairs[coord_pairs.length - 1])) {
    coord_pairs.push([...coord_pairs[0]]);
  }

  return {
    type: 'Polygon',
    coordinates: [coord_pairs]
  };
}

/**
 * Convert Multi-Point string into GeoJSON Format
 * @param multi_point_str
 * @returns {{coordinates: *, type: string}}
 */
function parseMultiPoint(multi_point_str) {
    let sanitized = multi_point_str
        .replace(/^MULTIPOINT\s*/i, '')
        .replace(/[()]/g, "")         // remove all parentheses
        .trim();                      // trim whitespace

    const coords = sanitized.split(",").map(coord_pair => {
        const [x, y] = coord_pair.trim().split(/\s+/).map(parseFloat);
        if (isNaN(x) || isNaN(y)) {
            throw new Error(`Invalid coordinate pair: ${coord_pair}`);
        }
        return [x,y];
    });

    return {
        type: 'MultiPoint',
        coordinates: coords
    };
}

/**
 * Convert Multi-LineString into GeoJSON Format
 * @param multi_line_string_str
 * @returns {{coordinates: *, type: string}}
 */
function parseMultiLineString(multi_line_string_str) {
    const sanitized = multi_line_string_str
        .replace(/^MULTILINESTRING\s*/i, '')
        .replace(/^\s*\(\(/, "")
        .replace(/\)\)\s*$/, "");

    const line_string_list = sanitized.split(/\)\s*,\s*\(/);

    const coords = line_string_list.map(line_string => {
        return line_string.split(",").map(line_pair => {
            const [x, y] = line_pair.trim().split(/\s+/).map(parseFloat);
            if (isNaN(x) || isNaN(y)) {
                throw new Error(`Invalid coordinate pair: ${line_pair}`);
            }
            return [x, y];
        });
    });

    return {
        type: "MultiLineString",
        coordinates: coords
    }
}

/**
 * Convert multi-polygon string into GeoJSON Format
 * @param multi_polygon_str
 * @returns {{coordinates: *[], type: string}}
 */
function parseMultiPolygon(multi_polygon_str) {
  // Sanitize input
  const sanitized = multi_polygon_str
    .replace(/^MULTIPOLYGON\s*/i, '')
    .replace(/\)\s*,\s*\(/g, '|||') // Temporary separator
    .replace(/[()]/g, '')
    .trim();

  // Split into individual polygons
  const polygons = sanitized.split('|||').filter(p => p);
  const coordinates = [];

  for (const poly_str of polygons) {
    // Split into rings (outer and potential holes)
    const rings = poly_str.split(/\),\s*\(/).map(ring => {
      const coord_pairs = ring.split(/,\s*/).map(pair => {
        const [lon, lat] = pair.trim().split(/\s+/);
        const lonNum = parseFloat(lon);
        const latNum = parseFloat(lat);

        if (isNaN(lonNum) || isNaN(latNum)) {
          throw new Error(`Invalid coordinate pair: ${pair}`);
        }
        return [lonNum, latNum];
      });

      // Close the ring if not closed
      if (coord_pairs.length > 0 &&
          !(coord_pairs[0][0] === coord_pairs[coord_pairs.length-1][0] &&
            coord_pairs[0][1] === coord_pairs[coord_pairs.length-1][1])) {
        coord_pairs.push([...coord_pairs[0]]);
      }

      return coord_pairs;
    });

    coordinates.push(rings);
  }

  return {
    type: 'MultiPolygon',
    coordinates: coordinates
  };
}

/**
 * Converts the given WKT String to GeoJSON which is applicable for the following GeoJSON Types:
 *      1. Point - POINT(10 20)
 *      2. LineString - LINESTRING(10 10, 20 20, 21 30)
 *      3. Polygon - POLYGON((0 0, 0 40, 40 40, 40 0, 0 0))
 *      4. MultiPoint - MULTIPOINT((0 0), (10 20), (15 20), (30 30))
 *      5. MultiLineString - MULTILINESTRING((10 10, 20 20), (15 15, 30 15))
 *      6. MultiPolygon - MULTIPOLYGON(((10 10, 10 20, 20 20, 20 15, 10 10)), ((60 60, 70 70, 80 60, 60 60 )))
 *      7. Envelope - ENVELOPE(10, 20, 30, 40)
 * @param wkt_string
 * @returns {{coordinates: *[], type: string}|{coordinates: *[][][], type: string}|{coordinates: *, type: string}|null}
 */
function convertWktToGeoJson(wkt_string) {
  try {
    const upper_wkt_str = wkt_string.toUpperCase().trim();

    if (upper_wkt_str.startsWith('POINT')) {
        return parsePoint(wkt_string);
    }
    if (upper_wkt_str.startsWith("LINESTRING")) {
        return parseLineString(wkt_string);
    }
    if (upper_wkt_str.startsWith('POLYGON')) {
        return parsePolygon(wkt_string);
    }
    if (upper_wkt_str.startsWith("MULTIPOINT")) {
        return parseMultiPoint(wkt_string);
    }
    if (upper_wkt_str.startsWith("MULTILINESTRING")) {
        return parseMultiLineString(wkt_string);
    }
    if (upper_wkt_str.startsWith('MULTIPOLYGON')) {
        return parseMultiPolygon(wkt_string);
    }
    if (upper_wkt_str.startsWith('ENVELOPE')) {
        return parseEnvelope(wkt_string);
    }

    throw new Error(`Unsupported geometry type: ${wkt_string}`);

  } catch (err) {
    console.log("spatial_utils.js - convertWktToGeoJson - Error: ", err);
    return null;
  }
}

/**
 *  Wrapper function used to convert the resource and include geo-json fields
 * @param resource
 * @returns {*}
 */
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