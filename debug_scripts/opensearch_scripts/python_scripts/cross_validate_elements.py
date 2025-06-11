import os
import sys
from dotenv import load_dotenv
from neo4j import GraphDatabase
from opensearchpy import OpenSearch, helpers

element_types = ['Code',
                 #'Contributor'
                 'Dataset',
                 'Documentation',
                 'Map',
                 'Notebook',
                 'Oer',
                 'Publication']

def initialize_environment():
    if len(sys.argv) != 2:
        print("Not enough arguments to run the script.")
        sys.exit(1)

    env_path = sys.argv[1]

    if not os.path.exists(env_path):
        print("Given file not found: " + env_path)
        sys.exit(1)

    # load environment variables from the specified file
    load_dotenv(dotenv_path=env_path)


class Neo4jInstance:
    def __init__(self, uri, username, password):
        self.driver = GraphDatabase.driver(uri,
                                           auth=(username, password),
                                           database=os.getenv('NEO4J_DB'))

    def close(self):
        self.driver.close()

    def get_elements_count_by_type(self, element_type):
        query = f'MATCH (n:{element_type}) RETURN COUNT(n) AS ElementCount;'
        with self.driver.session() as session:
            result = session.run(query)
            #ret = result[0].data()["ElementCount"]
            #return ret
            for r in result:
                ret = r.data()["ElementCount"]
                #print(f'Neo4j > {element_type} Count: {r.data()["ElementCount"]}')
                return ret
        return None

    def get_element_ids_for(self, element_type):
        query = f'MATCH (n:{element_type}) RETURN n.id AS IDs;'
        ids = []
        with self.driver.session() as session:
            result = session.run(query)
            for r in result:
                ids.append(r.data()['IDs'])
        return ids

class OpenSearchInstance:
    def __init__(self, os_node, username, password, index):
        try:
            # Create OpenSearch client
            self.client = OpenSearch(
                hosts=[os_node],
                http_auth=(username, password),  # if using basic auth; adjust as needed
                use_ssl=True,
                verify_certs=False,  # Only use in dev; for production set this to True
                ssl_show_warn=False
            )
            self.index = index
        except Exception as e:
            print("Error in creating OpenSearch client: " + str(e))
            print(e)
            pass
        pass

    def get_elements_count_by_type(self, element_type):
        response = self.client.count(index=self.index,
                                     body={
                                         "query": {"match": {"resource-type": element_type.lower()}}
                                     })
        return response['count']

    def get_element_ids_for(self, element_type):
        query = {
            '_source': False,
            'fields': ['_id', 'title'],
            'size': 1000,
            'query': {
                'match': {
                    'resource-type': element_type.lower()
                }
            }
        }
        response = self.client.search(index=self.index, body=query)
        ids = []
        for hit in response['hits']['hits']:
            #print(f"ID: {hit['_id']}, Title: {hit.get('title', 'N/A')}")
            ids.append(hit['_id'])
        return ids

    def bulk_delete_by_ids(self, document_ids, refresh=False):
        '''
        Bulk delete documents by their IDs

        Args:
            document_ids (list): List of document IDs to delete
            refresh (bool): Whether to refresh the index after deletion

        Returns:
            tuple: (success_count, error_count)
        '''
        actions = [
            {
                '_op_type': 'delete',
                '_index': self.index,
                '_id': doc_id
            }
            for doc_id in document_ids
        ]

        try:
            # Perform the bulk operation
            success_count, errors = helpers.bulk(
                self.client,
                actions,
                refresh=refresh,
                raise_on_error=False
            )

            if errors:
                print(f'Completed with {len(errors)} errors')
                for error in errors:
                    print(f'Failed to delete {error["delete"]["_id"]}: {error["delete"]["error"]["reason"]}')

            print(f'Successfully deleted {success_count} documents')
            return success_count, len(errors)

        except Exception as e:
            print(f'Bulk delete failed: {str(e)}')
            return 0, len(document_ids)


if __name__ == '__main__':
    initialize_environment()
    print("Environment variables initialized!")

    print('-'*100)
    print('''
    NOTE: This script will check and remove elements in OpenSearch which are NOT in Neo4j.
    This will ensure invalid elements are not returned as part of search results.
    However, there may be cases where elements are in Neo4j but NOT indexed properly in OpenSearch.
    In such case, a separate cleanup will need to be performed to re-create OpenSearch index.
    ''')
    print('-'*100)

    db = Neo4jInstance(os.getenv("NEO4J_CONNECTION_STRING"),
                       os.getenv("NEO4J_USER"),
                       os.getenv("NEO4J_PASSWORD"))

    os_instance = OpenSearchInstance(os.getenv("OPENSEARCH_NODE"),
                                     os.getenv("OPENSEARCH_USERNAME"),
                                     os.getenv("OPENSEARCH_PASSWORD"),
                                     os.getenv("OPENSEARCH_INDEX"))


    neo4j_element_counts = {}
    os_element_counts = {}

    print('| {:20s} | {:10s} | {:10s} |'.format('Element Type', 'Neo4j', 'OpenSearch'))
    print('-'*50)
    for e_type in element_types:
        neo4j_element_counts[e_type] = db.get_elements_count_by_type(e_type)
        os_element_counts[e_type] = os_instance.get_elements_count_by_type(e_type)

        print('| {:20s} | {:10d} | {:10d} |'.format(e_type,
                                                    neo4j_element_counts[e_type],
                                                    os_element_counts[e_type]))
        pass

    for e_type in element_types:
        if True: #os_element_counts[e_type] > neo4j_element_counts[e_type]:
            #print(f'Inconsistencies found for Element Type: {e_type}')

            neo4j_element_ids = db.get_element_ids_for(e_type)
            os_element_ids = os_instance.get_element_ids_for(e_type)

            neo4j_set = set(neo4j_element_ids)
            if len(neo4j_set) != len(neo4j_element_ids):
                print(f'WARN: Duplicates found in Neo4j for {e_type}')
                pass

            os_set = set(os_element_ids)
            if len(os_set) != len(os_element_ids):
                print(f'WARN: Duplicates found in OpenSearch for {e_type}')
                pass

            os_elements_not_in_neo4j = list(os_set - neo4j_set)

            if len(os_elements_not_in_neo4j) > 0:
                print(f'Inconsistencies found for Element Type: {e_type}')
                proceed = input(f'Delete {len(os_elements_not_in_neo4j)} {e_type} elements from OpenSearch? (yes/NO): ').lower()
                if proceed in ['yes', 'y']:
                    # remove extra elements from OpenSearch
                    print('Removing extra elements from OpenSearch')
                    os_instance.bulk_delete_by_ids(os_elements_not_in_neo4j)
                    pass
        pass
