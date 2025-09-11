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

    def revert_migration(self, user_id):
        with self.driver.session() as session:
            result = session.write_transaction(self._revert_migration_transaction, user_id)
            if result:
                print(f"✅ Reverted migration for user_id: {user_id}")
            else:
                print(f"⚠️  No alias found or revert skipped for user_id: {user_id}")

    def revert_all_migrations(self):
        with self.driver.session() as session:
            # Find all contributors that have primary aliases
            result = session.run("""
                MATCH (c:Contributor)<-[:ALIAS_OF]-(a:Alias {is_primary: true})
                RETURN c.id AS contributor_id
            """)
            contributor_ids = [record["contributor_id"] for record in result]
            for contributor_id in contributor_ids:
                self.revert_migration(contributor_id)

    @staticmethod
    def _migrate_alias_transaction(tx, user_id):
        # Fetch contributor data
        query = """
        MATCH (c:Contributor {id: $user_id})
        RETURN c.openid AS openid, c.email AS email, c.affiliation AS affiliation, c.first_name as first_name, c.last_name as last_name, c
        """
        record = tx.run(query, user_id=user_id).single()
        if not record:
            return False

        open_id = record["openid"]
        email = record["email"]
        affiliation = record["affiliation"]
        first_name = record['first_name']
        last_name = record['last_name']
        contributor = record["c"]

        if not open_id and not email:
            return False  # Nothing to migrate

        # Remove fields and create alias
        tx.run("""
        MATCH (c:Contributor {id: $user_id})
        REMOVE c.openid, c.email, c.affiliation, c.first_name, c.last_name
        CREATE (a:Alias {
            openid: $open_id,
            email: $email,
            affiliation: $affiliation,
            first_name: $first_name,
            last_name: $last_name,
            is_primary: true
        })
        CREATE (a)-[:ALIAS_OF]->(c)
        """, user_id=user_id, open_id=open_id, email=email, affiliation=affiliation, first_name=first_name, last_name=last_name)

        return True

    @staticmethod
    def _revert_migration_transaction(tx, user_id):
        # Find the primary alias for this contributor
        query = """
        MATCH (c:Contributor {id: $user_id})<-[:ALIAS_OF]-(a:Alias {is_primary: true})
        RETURN a.openid AS openid, a.email AS email, a.affiliation AS affiliation, 
               a.first_name AS first_name, a.last_name AS last_name, a
        """
        record = tx.run(query, user_id=user_id).single()
        if not record:
            return False

        # Extract alias properties
        open_id = record["openid"]
        email = record["email"]
        affiliation = record["affiliation"]
        first_name = record["first_name"]
        last_name = record["last_name"]

        # Restore properties to contributor and delete alias
        tx.run("""
        MATCH (c:Contributor {id: $user_id})<-[r:ALIAS_OF]-(a:Alias {is_primary: true})
        SET c.openid = $open_id,
            c.email = $email,
            c.affiliation = $affiliation,
            c.first_name = $first_name,
            c.last_name = $last_name
        DELETE r, a
        """, user_id=user_id, open_id=open_id, email=email, affiliation=affiliation,
             first_name=first_name, last_name=last_name)

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
    elif sys.argv[2] == "revert_one":
        migrator.revert_migration(sys.argv[3])
    elif sys.argv[2] == "revert_all":
        migrator.revert_all_migrations()
    migrator.close()