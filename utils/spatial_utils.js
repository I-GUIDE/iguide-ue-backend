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

// ...existing code from the original file...

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
