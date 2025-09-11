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
      .replace(/^POLYGON\s*\(\(/i, '')
      .replace(/\)\)$/, '')
      .trim();

  const rings = [];
  let current_ring = [];

  let tokens = sanitized.split(",");

  for (let i = 0; i < tokens.length; i++) {
      const pair = tokens[i].trim();

      //check for ring boundary
      if (pair.includes('(')) {
          //start a new ring
          if (current_ring?.length > 0) {
              rings.push(current_ring);
          }
          current_ring = [];
      }

      const coords = pair.replace(/[()]/g, '').trim().split(/\s+/).map(parseFloat);
      if (coords?.length !== 2 || coords.some(isNaN)) {
          throw new Error(`Invalid Coordinates: ${pair}`);
      }
      current_ring.push([coords[0], coords[1]]);
  }

  //Push the last ring
  if (current_ring?.length > 0) {
      rings.push(current_ring);
  }

  for (let ring of rings) {
      const first_coord = ring[0];
      const last_coord = ring[ring?.length - 1];
      if (first_coord[0] !== last_coord[0] || first_coord[1] !== last_coord[1]) {
          ring.push([...first_coord]);
      }
  }

  return {
    type: 'Polygon',
    coordinates: rings
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
        .trim();                      // trim whitespace
    // Detect if the format is nested (e.g., ((x y), (x y)))
    const isNested = sanitized.startsWith('(') && sanitized.includes('(') && sanitized.includes(')');

    let coords = [];
    if (isNested) {
        // Strip outer parens
        sanitized = sanitized.replace(/^\(\s*/, '').replace(/\s*\)$/, '');

        // Split into point strings
        const pointStrings = sanitized.split(/\)\s*,\s*\(/);
        coords = pointStrings.map(pt => {
            const pair = pt.replace(/[()]/g, '').trim().split(/\s+/).map(parseFloat);
            if (pair.length !== 2 || pair.some(isNaN)) {
                throw new Error(`Invalid coordinate pair: ${pt}`);
            }
            return pair;
        });
    } else {
         const coords = sanitized.split(",").map(coord_pair => {
            const [x, y] = coord_pair.trim().split(/\s+/).map(parseFloat);
            if (isNaN(x) || isNaN(y)) {
                throw new Error(`Invalid coordinate pair: ${coord_pair}`);
            }
            return [x,y];
        });
    }

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
 * Convert WKT MULTIPOLYGON string into GeoJSON Format
 * @param {string} wkt - MULTIPOLYGON WKT string
 * @returns {{type: string, coordinates: number[][][][]}}
 */
function parseMultiPolygon(wkt) {
  const result = {
    type: 'MultiPolygon',
    coordinates: []
  };

  // Remove 'MULTIPOLYGON' and outer parentheses
  const body = wkt
    .replace(/^MULTIPOLYGON\s*/i, '')
    .trim()
    .replace(/^\(\(\(/, '')
    .replace(/\)\)\)$/, '');

  // Split polygons using regex that matches polygon-level closing and opening
  const polygonStrings = body.split(/\)\s*,\s*\(\(/);

  polygonStrings.forEach(polygonStr => {
    // Split rings
    const rings = polygonStr.split(/\)\s*,\s*\(/).map(ringStr => {
      const coords = ringStr
        .replace(/[()]/g, '') // remove all parentheses
        .trim()
        .split(',')
        .map(pair => {
          const [lon, lat] = pair.trim().split(/\s+/).map(Number);
          return [lon, lat];
        });

      // Close the ring if not already closed
      const first = coords[0];
      const last = coords[coords.length - 1];
      if (first[0] !== last[0] || first[1] !== last[1]) {
        coords.push([...first]);
      }

      return coords;
    });

    result.coordinates.push(rings);
  });

  return result;
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
export function convertWktToGeoJson(wkt_string) {
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
 * @param append_geojson
 * @returns {*}
 */
export function convertGeoSpatialFields(resource, append_geojson=true) {
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
			if (append_geojson)
                            temp_resource[spatial_field+"-geojson"] = geo_json_value
			else
			    temp_resource[spatial_field] = geo_json_value
                    }
                } catch (err) {
                    console.log("spatial_utils.js - convertGeoSpatialFields ", spatial_field," - error: ", err)
                }
            }
        }
    }
    return temp_resource
}