import os
import json
from opensearchpy import OpenSearch, helpers
from shapely.wkt import loads as wkt_loads
from dotenv import load_dotenv

# Load environment variables from .env file (if present)
load_dotenv()

# OpenSearch configuration using environment variables
opensearch_host = os.getenv('OPENSEARCH_NODE', 'http://localhost:9200')
index_old = os.getenv('OPENSEARCH_INDEX', 'neo4j-elements-dev-v3')
index_new = 'neo4j-elements-dev-vspatial'  # New index name

username = os.getenv('OPENSEARCH_USERNAME', 'admin')
password = os.getenv('OPENSEARCH_PASSWORD', 'admin')

# Connect to OpenSearch
client = OpenSearch(
    hosts=[opensearch_host],
    http_auth=(username, password),
    use_ssl=False,
)

def parse_envelope_to_geojson(envelope_str):
    """Convert ENVELOPE(minLon, maxLon, maxLat, minLat) to GeoJSON Polygon"""
    try:
        # Clean and parse the envelope string
        clean_str = envelope_str.replace("ENVELOPE(", "").replace(")", "")
        min_lon, max_lon, max_lat, min_lat = map(float, clean_str.split(","))
        
        return {
            "type": "polygon",
            "coordinates": [[
                [min_lon, min_lat],  # Bottom-left
                [max_lon, min_lat],  # Bottom-right
                [max_lon, max_lat],  # Top-right
                [min_lon, max_lat],  # Top-left
                [min_lon, min_lat]   # Close the polygon
            ]]
        }
    except Exception as e:
        print(f"⚠️ Failed to parse ENVELOPE: {envelope_str} | Error: {e}")
        return None

def convert_wkt_to_geojson(wkt_string):
    """Converts standard WKT to GeoJSON"""
    if not wkt_string:
        return None
    try:
        geometry = wkt_loads(wkt_string)
        return json.loads(json.dumps({
            "type": geometry.geom_type.lower(),
            "coordinates": (
                list(geometry.coords) 
                if geometry.geom_type == "Point"
                else [list(c) for c in geometry.exterior.coords] 
                if geometry.geom_type == "Polygon"
                else []
            )
        }))
    except Exception as e:
        print(f"⚠️ Failed to convert WKT: {wkt_string} | Error: {e}")
        return None

def fetch_documents():
    """Fetch all documents from the old index"""
    query = {"query": {"match_all": {}}}
    results = helpers.scan(client, index=index_old, query=query, size=1000)
    return results

def transform_document(doc):
    """Transform a document: Convert spatial fields to GeoJSON"""
    doc_id = doc["_id"]
    source = doc["_source"]

    # Handle spatial-bounding-box (ENVELOPE format)
    if "spatial-bounding-box" in source:
        if source["spatial-bounding-box"].upper().startswith("ENVELOPE"):
            source["spatial-bounding-box"] = parse_envelope_to_geojson(
                source["spatial-bounding-box"]
            )
        else:
            source["spatial-bounding-box"] = convert_wkt_to_geojson(
                source["spatial-bounding-box"]
            )

    # Handle other WKT fields
    if "spatial-geometry" in source:
        source["spatial-geometry"] = convert_wkt_to_geojson(source["spatial-geometry"])

    if "spatial-centroid" in source:
        source["spatial-centroid"] = convert_wkt_to_geojson(source["spatial-centroid"])

    return {"_op_type": "index", "_index": index_new, "_id": doc_id, "_source": source}

def reindex_documents():
    """Fetch, transform, and reindex documents"""
    print(f"🔄 Fetching documents from {index_old}...")
    docs = fetch_documents()
    
    transformed_docs = (transform_document(doc) for doc in docs)

    print(f"🚀 Reindexing documents into {index_new}...")
    success, failed = helpers.bulk(client, transformed_docs, chunk_size=500)

    print(f"✅ Reindexing complete: {success} successful, {failed} failed.")

if __name__ == "__main__":
    reindex_documents()