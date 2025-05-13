import os
import sys
from dotenv import load_dotenv
from neo4j import GraphDatabase
from opensearchpy import OpenSearch, helpers


class Neo4jInstance:
    def __init__(self, uri, username, password):
        self.driver = GraphDatabase.driver(uri, auth=(username, password), database=os.getenv('NEO4J_DB'))

    def close(self):
        self.driver.close()

    def query(self, query):
        with self.driver.session() as session:
            result = session.run(query)
            return result

def initialize_environment():
    if len(sys.argv) != 3:
        print("Not enough arguments to run the script.")
        sys.exit(1)

    env_path = sys.argv[1]

    if not os.path.exists(env_path):
        print("Given file not found: " + env_path)
        sys.exit(1)

    # load environment variables from the specified file
    load_dotenv(dotenv_path=env_path)

def get_all_private_elements():
    try:
        db_instance = Neo4jInstance(os.getenv("NEO4J_CONNECTION_STRING"),os.getenv("NEO4J_USER"),os.getenv("NEO4J_PASSWORD"))
        db_query = 'MATCH (n) WHERE n.visibility = "private" RETURN n.id;'
        private_elements_ids = []
        with db_instance.driver.session() as session:
            db_result = session.run(db_query)
            for element in db_result:
                private_elements_ids.append(element['n.id'])
            print("Total private element Ids: ", len(private_elements_ids))
        return private_elements_ids
    except Exception as e:
        print(e)
        print("Error in getting private elements: " + str(e))

def create_os_client():
    try:
        # Environment variables
        OPENSEARCH_NODE = os.getenv("OPENSEARCH_NODE")
        OPENSEARCH_USERNAME = os.getenv("OPENSEARCH_USERNAME")
        OPENSEARCH_PASSWORD = os.getenv("OPENSEARCH_PASSWORD")

        # Create OpenSearch client
        client = OpenSearch(
            hosts=[OPENSEARCH_NODE],
            http_auth=(OPENSEARCH_USERNAME, OPENSEARCH_PASSWORD),  # if using basic auth; adjust as needed
            use_ssl=True,
            verify_certs=False,  # Only use in dev; for production set this to True
            ssl_show_warn=False
        )
        return client

    except Exception as e:
        print("Error in creating OpenSearch client: " + str(e))
        print(e)

# Step 1: Fetch only existing documents
def fetch_existing_ids(client, index, ids):
    response = client.mget(index=index, body={"ids": ids})
    return [doc['_id'] for doc in response['docs'] if doc['found']]

def remove_ids_from_os(client, element_ids):
    OPENSEARCH_INDEX = os.getenv("OPENSEARCH_INDEX", "neo4j-elements-dev")
    # Create bulk delete actions
    actions = [
        {
            "_op_type": "delete",
            "_index": OPENSEARCH_INDEX,
            "_id": element_id
        }
        for element_id in element_ids
    ]
    helpers.bulk(client, actions)
    print("All private element ids removed!")

if __name__ == '__main__':
    initialize_environment()
    print("Environment variables initialized!")
    private_element_ids = get_all_private_elements()
    print("DB Instance created and private elements fetched!")
    os_client = create_os_client()
    print("OpenSearch Client created")
    OPENSEARCH_INDEX = os.getenv("OPENSEARCH_INDEX", "neo4j-elements-dev")
    private_deleted_ids = fetch_existing_ids(os_client, OPENSEARCH_INDEX, private_element_ids)
    print("private element ids to be deleted: ", private_deleted_ids)
    if sys.argv[2] == "delete":
        remove_ids_from_os(os_client, private_deleted_ids)
        print("OpenSearch Client process completed!")
    else:
        print("Process completed!")
