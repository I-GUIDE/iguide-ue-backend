/**
 * Dependencies
 * - npm i neo4j-driver
 * - npm install uuid
 */
const { v4: uuidv4 } = require('uuid');
const neo4j = require('neo4j-driver')

/**
 * Create a driver instance
 * It should be enough to have a single driver per database per application.
 */
const driver = neo4j.driver(
    process.env.NEO4J_CONNECTION_STRING,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
)

/**************
 * Helper Functions
 **************/
const Relations = Object.freeze({
    CREATED_BY: "CREATED_BY",
    USES: "USES", // e.g. Notebook USES Dataset
    CONTRIBUTED: "CONTRIBUTED", // e.g. User CONTRIBUTED Resource
    LIKED: "LIKED", // e.g. User LIKED Resource
    THURSDAY: 4,
    FRIDAY: 5,
    SATURDAY: 6
});
/**
 * Generic helper function to create relation between two resources/elements
 */
async function createRelation(from_id, to_id, relation_type){
    const query_str = "MATCH (from{id:$from_id}) " +
	  "MATCH (to{id:$to_id}) " +
	  "MERGE (from)-[:"+relation_type+"]->(to)";
	  //"CREATE (from)-[:"+relation_type+"]->(to)"; // can create duplicate relations

    try{
	const {_, summary} =
	      await driver.executeQuery(query_str,
					{from_id: from_id, to_id: to_id},
					{database: process.env.NEO4J_DB});
	if (summary.counters.updates()['relationshipsCreated'] >= 1){
	    return true;
	}
    } catch(err){
	console.log('Error in query: '+ err);
    } finally {
	await driver.close();
    }
    // something went wrong
    return false;
}
/**
 * Generic helper function to remove/delete relation between two resources/elements
 */
async function removeRelation(from_id, to_id, relation_type){
    const query_str = "MATCH (from{id:$from_id})-[rel:"+relation_type+"]-(to{id:$to_id}) " +
	  "DELETE rel";

    try{
	const {_, summary} =
	      await driver.executeQuery(query_str,
					{from_id: from_id, to_id: to_id},
					{database: process.env.NEO4J_DB});
	if (summary.counters.updates()['relationshipsDeleted'] >= 1){
	    return true;
	}
    } catch(err){
	console.log('Error in query: '+ err);
    } finally {
	await driver.close();
    }
    // something went wrong
    return false;
}
/********************************/
async function createLinkNotebook2Dataset(nb_id, ds_id){
    return createRelation(nb_id, ds_id, Relations.USES);
}
/**
 * [ToDo] May not be useable separately since this can be done while registering the resource
 * Types of resources: Notebook, Dataset, Publication, OER
 * @param {string} open_id Registered user ID (i.e. OpenID from CILogon)
 * @param {string} resource_id Contributed resource ID
 */
async function createLinkUserContributedResource(open_id, resource_id){
    return createRelation(open_id, resource_id, Relations.CONTRIBUTED);
}
/**
 * Create relation for resources liked by user
 * Types of resources: Notebook, Dataset, Publication, OER
 * @param {string} open_id Registered user ID (i.e. OpenID from CILogon)
 * @param {string} resource_id Liked resource ID
 */
async function createLinkUserLikedResource(open_id, resource_id){
    return createRelation(open_id, resource_id, Relations.LIKED);
}
/**
 * Get single resource by given ID with all related content
 * @param {string} id
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
async function getResourceByID(id){
    // [Bug]: Due to `r.id IS NOT null`, any node without any relation will return empty
    // const query_str = "MATCH (n{id:$id_param})--(r) " +
    // 	  "WHERE r.id IS NOT null " +
    // 	  "WITH COLLECT({id:r.id, title:r.title}) as related_res, COLLECT(r.name) as authors, n " +
    // 	  "RETURN n{.*, related_res: related_res, authors: authors, resource_type:LABELS(n)[0]}";

    const query_str = "MATCH (n{id:$id_param})--(r) " +
	  "WITH COLLECT({id:r.id, title:r.title}) as related_res, COLLECT(r.name) as authors, n " +
	  "RETURN n{.*, related_res: related_res, authors: authors, resource_type:LABELS(n)[0]}";

    try {
	const {records, summary} =
	      await driver.executeQuery(query_str,
					{id_param: id},
					{database: process.env.NEO4J_DB});
	console.log(records.length)
	if (records.length <= 0){
	    // Query returned no match for given ID
	    return {};
	} else if (records.length > 1){
	    // should never reach here since ID is unique
	    throw Error("Server Neo4j: ID should be unique, query returned multiple results for given ID: ${id}");
	}
	return records[0]['_fields'][0];
    } catch(err){
	console.log('Error in query: '+ err);
    } finally {
	await driver.close();
    }
    // something went wrong
    return {};
}
/**
 * Get multiple resources by given IDs in a single query call
 * @param {string[]} ids
 * @return {Object[]} Array of objects with given IDs. Empty array if ID not found or error
 */
async function getResourcesByIDs(ids){
    // [Bug]: Due to `r.id IS NOT null`, any node without any relation will be excluded
    // const query_str = "MATCH (n)--(r) " +
    // 	  "WHERE n.id IN $ids_param AND r.id IS NOT null " +
    // 	  "WITH COLLECT({id:r.id, title:r.title}) as related_nb, COLLECT(r.name) as authors, n " +
    // 	  "RETURN n{.*, related_res: related_res, authors: authors, resource_type:LABELS(n)[0]}";

    const query_str = "MATCH (n)--(r) " +
	  "WHERE n.id IN $ids_param " +
	  "WITH COLLECT({id:r.id, title:r.title}) as related_res, COLLECT(r.name) as authors, n " +
	  "RETURN n{.*, related_res: related_res, authors: authors, resource_type:LABELS(n)[0]}";
    try{
	const {records, summary} =
	      await driver.executeQuery(query_str,
					{ids_param: ids},
					{database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // Query returned no match for given IDs
	    return [];
	}
	var ret = []
	for (record of records){
	    ret.push(record['_fields'][0])
	}
	return ret;
    } catch(err){
	console.log('Error in query: '+ err);
    } finally {
	await driver.close();
    }
    // something went wrong
    return [];
}
/**
 * Get all featured resources.
 * @retrurn {Object[]} Array of featured objects. Empty array if no featrued resources found or error
 */
async function getFeaturedResources(){
    // Information required for featured resources by the frontend?
    // id, title, thumbnail, type
    const query_str = "MATCH (n{featured:True}) " +
	  "RETURN n{id: n.id, title:n.title, thumbnail_image:n.thumbnail_image, resource_type:LABELS(n)[0]}";

    try{
	const {records, summary} =
	      await driver.executeQuery(query_str, {database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // No featured resources found
	    return [];
	}
	var ret = []
	for (record of records){
	    ret.push(record['_fields'][0])
	}
	return ret;
    } catch(err){
	console.log('Error in query: '+ err);
    } finally {
	await driver.close();
    }
    // something went wrong
    return [];
}
/**
 * Set resource as featured given ID
 * @param {string} id
 * @return {Boolean} true for success. false if ID not found or other query errors
 */
async function setResourceFeaturedForID(id){
    const query_str = "MATCH (n{id:$id_param}) " +
	  "SET n.featured=True";

    try{
	const {_, summary} =
	      await driver.executeQuery(query_str,
					{id_param: id},
					{database: process.env.NEO4J_DB});
	if (summary.counters.updates()['propertiesSet'] >= 1){
	    return true;
	}
    } catch(err){
	console.log('Error in query: '+ err);
    } finally {
	await driver.close();
    }
    // something went wrong
    return false;
}
/**
 * Register new contributor
 * @param {Object} contributor Map with new contributor attributes (refer to schema)
 * @return {Boolean} true for successful registration. false otherwise or in case of error
 */
async function registerContributor(contributor){

    // (1) No need to generate id (UUID). For users, openid will be unique
    //new_id = uuidv4();
    //contributor.id = new_id;
    // (2) insert resource as a new node with id and other fileds from resource param
    const query_str = "CREATE (c: Contributor $contr_param)";
    try{
	const {_, summary} =
	      await driver.executeQuery(query_str,
					{contr_param: contributor},
					{database: process.env.NEO4J_DB});

	console.log(summary.counters.updates());
	if (summary.counters.updates()['nodesCreated'] == 1){
	    // (3) remove non-searchable properties and insert to OpenSearch
	    // [ToDo]
	    return true;
	}
    } catch(err){
	console.log('Error in query: '+ err);
    } finally {
	await driver.close();
    }
    // something went wrong
    return false;

}
/**
 * Get contributor by OpenID with all related content
 * @param {string} id
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
async function getContributorByID(openid){
    const query_str = "MATCH (n{id:$id_param})--(r) " +
	  "WHERE r.id IS NOT null " +
	  "WITH COLLECT(r.id) as related_nb, COLLECT(r.name) as authors, n " +
	  "RETURN n{.*, related_nb: related_nb, authors: authors, resource_type:LABELS(n)[0]}";

    try {
	const {records, summary} =
	      await driver.executeQuery(query_str,
					{id_param: openid},
					{database: process.env.NEO4J_DB});
	console.log(records.length)
	if (records.length <= 0){
	    // Query returned no match for given ID
	    return {};
	} else if (records.length > 1){
	    // should never reach here since ID is unique
	    throw Error("Server Neo4j: ID should be unique, query returned multiple results for given ID: ${id}");
	}
	return records[0]['_fields'][0];
    } catch(err){
	console.log('Error in query: '+ err);
    } finally {
	await driver.close();
    }
    // something went wrong
    return {};
}
/**
 * Register new resource
 * @param {String} contributor_id OpenID of registered contributor
 * @param {Object} resource Map with resource attributes (refer to schema)
 */
async function registerResource(contributor_id, resource){

    // (1) generate id (UUID)
    new_id = uuidv4();
    // (2) insert resource as a new node with id and other fileds from resource param
    resource.id = new_id;
    // (3) create relations based on related-resources
    related_ids = resource.related-resources;
    // (3.1) no need to keep in object since this will be handled by links/relations
    delete resource.related-resources;
    // (4) create CONTRIBUTED_BY relation with contributor_id

    return false;
    // const query_str = "MATCH (n{id:$id_param}) " +
    // 	  "SET n.featured=True";

    // const { records, summary, key } =
    // 	  await driver.executeQuery(query_str, {id_param: id}, {database: process.env.NEO4J_DB});
    // await driver.close();
    // return records;
}

exports.getResourceByID = getResourceByID;
exports.getResourcesByIDs = getResourcesByIDs;
exports.getFeaturedResources = getFeaturedResources
exports.setResourceFeaturedForID = setResourceFeaturedForID
exports.registerContributor = registerContributor
exports.createLinkNotebook2Dataset = createLinkNotebook2Dataset
