import os
import sys
from dotenv import load_dotenv
from neo4j import GraphDatabase
'''
    Script to migrate the Contributor's already present open_id as primary alias for each and every contributor to support
    the new architecture.
'''
class AliasMigrator:
    def __init__(self, uri, user, password):
        self.driver = GraphDatabase.driver(uri, auth=(user, password))

    def close(self):
        self.driver.close()

    def migrate_contributor_alias(self, user_id):
        with self.driver.session() as session:
            result = session.write_transaction(self._migrate_alias_transaction, user_id)
            if result:
                print(f"✅ Migrated alias for user_id: {user_id}")
            else:
                print(f"⚠️  No valid fields found or migration skipped for user_id: {user_id}")

    def migrate_all_users(self):
        with self.driver.session() as session:
            result = session.run("MATCH (c:Contributor) WHERE c.openid IS NOT NULL RETURN c{.*} AS contributor")
            contributors = [record["contributor"] for record in result]
            for contributor in contributors:
                self.migrate_contributor_alias(contributor["id"])

    @staticmethod
    def _migrate_alias_transaction(tx, user_id):
        # Fetch contributor data
        query = """
        MATCH (c:Contributor {id: $user_id})
        RETURN c.openid AS openid, c.email AS email, c.affiliation AS affiliation, c
        """
        record = tx.run(query, user_id=user_id).single()
        if not record:
            return False

        open_id = record["openid"]
        email = record["email"]
        affiliation = record["affiliation"]
        contributor = record["c"]

        if not open_id or not email:
            return False  # Nothing to migrate

        # Remove fields and create alias
        tx.run("""
        MATCH (c:Contributor {id: $user_id})
        REMOVE c.openid, c.email, c.affiliation
        CREATE (a:Alias {
            openid: $open_id,
            email: $email,
            affiliation: $affiliation,
            is_primary: true
        })
        CREATE (a)-[:ALIAS_OF]->(c)
        """, user_id=user_id, open_id=open_id, email=email, affiliation=affiliation)

        return True


def initialize_environment():
    if len(sys.argv) < 3:
        print("Not enough arguments to run the script.")
        sys.exit(1)

    env_path = sys.argv[1]

    if not os.path.exists(env_path):
        print("Given file not found: " + env_path)
        sys.exit(1)

    # load environment variables from the specified file
    load_dotenv(dotenv_path=env_path)

# ---- USAGE EXAMPLE ----
if __name__ == "__main__":
    initialize_environment()
    # Replace with your Neo4j credentials and endpoint
    NEO4J_URI = os.getenv("NEO4J_CONNECTION_STRING")
    NEO4J_USER = os.getenv("NEO4J_USER")
    NEO4J_PASSWORD = os.getenv("NEO4J_PASSWORD")

    migrator = AliasMigrator(NEO4J_URI, NEO4J_USER, NEO4J_PASSWORD)
    if sys.argv[2] == "migrate_one":
        migrator.migrate_contributor_alias(sys.argv[3])
    elif sys.argv[2] == "migrate_all":
        migrator.migrate_all_users()
    migrator.close()
