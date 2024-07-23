/**
 * Dependencies
 * - npm i neo4j-driver
 * - npm install uuid
 */
const { v4: uuidv4 } = require('uuid');
const neo4j = require('neo4j-driver')

// For deployment on JetStream VM
const dotenv = require('dotenv');
dotenv.config({path: 'neo4j.env'});
console.log(process.env.NEO4J_CONNECTION_STRING);

/**
 * Create a driver instance
 * It should be enough to have a single driver per database per application.
 */
const driver = neo4j.driver(
    process.env.NEO4J_CONNECTION_STRING,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
)
exports.driver = driver;
exports.uuidv4 = uuidv4;

/**************
 * Helper Functions
 **************/
const ElementType = Object.freeze({
    NOTEBOOK: "Notebook",
    DATASET: "Dataset",
    PUBLICATION: "Publication",
    OER: "Oer", // Open Educational Content
});
exports.ElementType = ElementType;

const Relations = Object.freeze({
    RELATED: "RELATED", // Default relation type
    CONTRIBUTED: "CONTRIBUTED", // e.g. User CONTRIBUTED Element
    LIKED: "LIKED", // e.g. User LIKED Element

    USES: "USES", // e.g. Notebook USES Dataset
});

async function testServerConnection() {
    try {
	const serverInfo = await driver.getServerInfo();
	console.log('Connection estabilished');
	console.log(serverInfo);
	return true;
    } catch(err) {
	console.log(`Connection error\n${err}\nCause: ${err.cause}`)
	await driver.close()
	return false
    }
}
/**
 * Generic helper function to create relation between two elements
 * NOTE: MATCH without LABEL does not use index and results in full DB scan
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
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return false;
}
/**
 * Generic helper function to remove/delete relation between two elements
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
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return false;
}
/********************************/
async function createLinkNotebook2Dataset(nb_id, ds_id){
    return createRelation(nb_id, ds_id, Relations.USES);
}
/**
 * [ToDo] May not be useable separately since this can be done while registering the element
 * @param {string} open_id Registered user ID (i.e. OpenID from CILogon)
 * @param {string} element_id Contributed element ID
 */
async function createLinkUserContributedElement(open_id, element_id){
    return createRelation(open_id, element_id, Relations.CONTRIBUTED);
}
/**
 * Create relation for elements liked by user
 * @param {string} open_id Registered user ID (i.e. OpenID from CILogon)
 * @param {string} element_id Liked element ID
 */
async function createLinkUserLikedElement(open_id, element_id){
    return createRelation(open_id, element_id, Relations.LIKED);
}
/**
 * Get single element by given ID with all related content
 * @param {string} id
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
async function getElementByID(id){
    const query_str = "MATCH (c)-[:CONTRIBUTED]-(n{id:$id_param})-[:RELATED]-(r) " +
	  "WITH COLLECT({id:r.id, title:r.title, element_type:LABELS(r)[0]}) as related_elems, n, c  " +
	  "RETURN n{.*, related_elements: related_elems, element_type:LABELS(n)[0], created_by:c.openid}";

    try {
	const {records, summary} =
	      await driver.executeQuery(query_str,
					{id_param: id},
					{database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // Query returned no match for given ID
	    return {};
	} else if (records.length > 1){
	    // should never reach here since ID is unique
	    throw Error("Server Neo4j: ID should be unique, query returned multiple results for given ID: ${id}");
	}
	// frontend expects separate lists for related elements
	let result = records[0]['_fields'][0];
	let {related_elements: related_elements, ...ret} = result;

	// Original
	// ret['related_nb'] = []
	// ret['related_ds'] = []
	// ret['related_oer'] = []
	// ret['related_pub'] = []

	// [ToDo] should be removed
	ret['related-notebooks'] = []
	ret['related-datasets'] = []
	ret['related-oers'] = []
	ret['related-publications'] = []

	for (elem of related_elements){
	    switch(elem['element_type']){
	    case ElementType.DATASET:{
		let {element_type:_, ...ret_elem} = elem;
		ret['related-datasets'].push(ret_elem);
		break;
	    }
	    case ElementType.NOTEBOOK:{
		let {element_type:_, ...ret_elem} = elem;
		ret['related-notebooks'].push(ret_elem);
		break;
	    }
	    case ElementType.OER:{
		let {element_type:_, ...ret_elem} = elem;
		ret['related-oers'].push(ret_elem);
		break;
	    }
	    case ElementType.PUBLICATION:{
		let {element_type:_, ...ret_elem} = elem;
		ret['related-publications'].push(ret_elem);
		break;
	    }
	    case "Author":{
		//ignore
		break;
	    }
	    default:
		throw Error("Server Neo4j: Related element type not implemented");
		break;
	    }
	}

	// [ToDo] should be removed
	ret['thumbnail-image'] = ret['thumbnail_image'];
	delete ret['thumbnail_image'];
	ret['direct-download-link'] = ret['direct_download_link'];
	delete ret['direct_download_link'];

	return ret;
	//return records[0]['_fields'][0];
    } catch(err){
	console.log('Error in query: '+ err);
    }
    // something went wrong
    return {};
}
/**
 * Get elements by given type
 * @param {string} type
 * @param {int}    from For pagintion, get elements from this number
 * @param {int}    size For pagintion, get this number of elements
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
async function getElementsByType(type, from, size){

    // capitalize first letter of data type
    const node_type = type[0].toUpperCase() + type.slice(1);
    if (node_type == ElementType.NOTEBOOK ||
	node_type == ElementType.DATASET ||
	node_type == ElementType.PUBLICATION ||
	node_type == ElementType.OER
       ){
	// legit element type
    } else {
	throw Error("Server Neo4j: Element type not implemented");
    }

    // [ToDo] Just to make things work with frontend (should be removed)
    const query_str = "MATCH (n:"+ node_type +")-[:CONTRIBUTED]-(r) " +
	  "RETURN n{_id: n.id, title:n.title, `thumbnail-image`:n.thumbnail_image, `resource-type`:LABELS(n)[0], authors:[(r.first_name + ' ' + r.last_name)] }" +
	  "ORDER BY n.title " +
	  "SKIP $from " +
	  "LIMIT $size";

    try{
	const {records, summary} =
	      await driver.executeQuery(query_str,
					{from: neo4j.int(from), size: neo4j.int(size)},
					{database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // No featured elements found
	    return [];
	}
	var ret = []
	for (record of records){
	    ret.push(record['_fields'][0])
	}
	return ret;
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return [];
}
/**
 * Get elements count by given type
 * @param {string} type
 * @return {int} Intger count of given element type. -1 in case of error
 */
async function getElementsCountByType(type){

    // capitalize first letter of data type
    const node_type = type[0].toUpperCase() + type.slice(1);
    if (node_type == ElementType.NOTEBOOK ||
	node_type == ElementType.DATASET ||
	node_type == ElementType.PUBLICATION ||
	node_type == ElementType.OER
       ){
	// legit element type
    } else {
	throw Error("Server Neo4j: Element type not implemented");
    }

    // Just to make things work with frontend (should be removed)
    const query_str = "MATCH (n:"+ node_type +") " +
	  "RETURN COUNT(n)";

    try{
	const {records, summary} =
	      await driver.executeQuery(query_str, {database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // Error running query
	    return -1;
	}
	var ret = records[0]['_fields'][0]['low'];
	return ret;
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return -1;
}
/**
 * Get all featured elements.
 * @retrurn {Object[]} Array of featured objects. Empty array if no featrued elements found or error
 */
async function getFeaturedElements(){
    // Information required for featured elements by the frontend?
    // id, title, thumbnail, type

    // Original query (should be used)
    // const query_str = "MATCH (n{featured:True})-[:CONTRIBUTED]-(r) " +
    // 	  "RETURN n{id: n.id, title:n.title, thumbnail_image:n.thumbnail_image, element_type:LABELS(n)[0], authors:[(r.first_name + ' ' + r.last_name)]}";

    // [ToDo] Just to make things work with frontend (should be removed)
    const query_str = "MATCH (n{featured:True})-[:CONTRIBUTED]-(r) " +
	  "RETURN n{_id: n.id, title:n.title, `thumbnail-image`:n.thumbnail_image, `resource-type`:LABELS(n)[0], authors:[(r.first_name + ' ' + r.last_name)]}";

    try{
	const {records, summary} =
	      await driver.executeQuery(query_str, {database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // No featured elements found
	    return [];
	}
	var ret = []
	for (record of records){
	    ret.push(record['_fields'][0])
	}
	return ret;
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return [];
}
/**
 * Set element as featured given ID
 * @param {string} id
 * @return {Boolean} true for success. false if ID not found or other query errors
 */
async function setElementFeaturedForID(id){
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
    } catch(err){console.log('Error in query: '+ err);}
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
    // (2) insert element as a new node with id and other fileds from element param

    const query_str = "CREATE (c: Contributor $contr_param)";
    try{
	const {_, summary} =
	      await driver.executeQuery(query_str,
					{contr_param: contributor},
					{database: process.env.NEO4J_DB});

	//console.log(summary.counters.updates());
	if (summary.counters.updates()['nodesCreated'] == 1){
	    // (3) remove non-searchable properties and insert to OpenSearch
	    // [ToDo]
	    return true;
	}
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return false;

}
/**
 * Get contributor by OpenID with all related content
 * @param {string} id
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
async function getContributorByID(openid){
    const query_str = "MATCH (n:Contributor{id:$id_param})--(r) " +
	  "WHERE r.id IS NOT null " +
	  "WITH COLLECT(r.id) as related_elems, COLLECT(r.name) as authors, n " +
	  "RETURN n{.*, related_elements: related_elems, authors: authors, element_type:LABELS(n)[0]}";

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
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return {};
}
/**
 * Register new element
 * @param {String} contributor_id OpenID of registered contributor
 * @param {Object} element Map with element attributes (refer to schema)
 */
async function registerElement(contributor_id, element){

    // separate common and specific element properties
    let{metadata:_,
	thumbnail: thumbnail,
	'resource-type': node_type,
	'related-resources': related_elements,
	'external-link': external_link,                 // Dataset
	'direct-download-link': direct_download_link,   // Dataset
	'notebook-repo': notebook_repo,                 // Notebook
	'notebook-file': notebook_file,                 // Notebook
	size: size,                                     // Dataset
	'external-link-publication': external_link_pub, // Publication
	'external-link-oer': external_link_oer,         // OER
	...node
       } = element;

    node_type = node_type[0].toUpperCase() + node_type.slice(1);

    // (1) generate id (UUID)
    node['id'] = uuidv4();
    // (2) insert element as a new node with id and other fields
    if (node_type == ElementType.NOTEBOOK){
	node['notebook_repo'] = notebook_repo;
	node['notebook_file'] = notebook_file;
    } else if (node_type == ElementType.DATASET){
	node['external_link'] = external_link;
	node['direct_download_link'] = direct_download_link;
	node['size'] = size;
    } else if (node_type == ElementType.PUBLICATION){
	node['external_link'] = external_link_pub;
    } else if (node_type == ElementType.OER){
	node['external_link'] = external_link_oer
    } else {
	throw Error("Server Neo4j: Register element type not implemented");
    }

    //console.log(node);

    var query_match = "";
    var query_merge = "";
    var query_params = {node_param: node}

    // (3) create relations based on related-elements
    // [ToDo] To avoid full DB scan, if we know the type of related elements, the query
    // can be updated to search for related ID with a lable as type
    for (let [i, related_elem] of related_elements.entries()){
	query_match += "MATCH(to"+i+"{id:$id"+i+"}) ";
	query_merge += "MERGE (n)-[:RELATED]->(to"+i+") ";
	query_params["id"+i] = related_elem['id'];
    }
    // (4) create CONTRIBUTED_BY relation with contributor_id
    query_match += "MATCH(c:Contributor{openid:$contrib_id}) ";
    query_merge += "MERGE (c)-[:CONTRIBUTED]->(n) ";
    query_params['contrib_id'] = contributor_id;

    const query_str = query_match + " CREATE (n: "+node_type+" $node_param) " + query_merge;

    //console.log(query_str);
    //console.log(query_params);
    //return false;

    try{
	const {_, summary} =
	      await driver.executeQuery(query_str,
					query_params,
					{database: process.env.NEO4J_DB});

	//console.log(summary.counters.updates());
	if (summary.counters.updates()['nodesCreated'] >= 1){
	    // (3) remove non-searchable properties and insert to OpenSearch
	    // [ToDo]
	    return true;
	}
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return false;
}

exports.getElementByID = getElementByID;
exports.registerElement = registerElement;
exports.getElementsByType = getElementsByType
exports.getFeaturedElements = getFeaturedElements
exports.registerContributor = registerContributor
exports.getElementsCountByType = getElementsCountByType
exports.setElementFeaturedForID = setElementFeaturedForID
exports.createLinkNotebook2Dataset = createLinkNotebook2Dataset

exports.testServerConnection = testServerConnection;

/**************
 * Backup Query Strings
 **************/

    // MATCH (n{id:"ds1"})--(r)
    // WITH COLLECT(r.id) as related_nb, COLLECT(r.name) as authors, n
    // RETURN n{.*, related_nb: related_nb, authors: authors}

    // MATCH (n{id:"ds1"})--(nb:Notebook)
    // WITH COLLECT(nb.id) as related_nb, n
    // RETURN {id: n.id, title: n.title, related_nb: related_nb}

    // Get any node by given id
    // const { records, summary, key } = await driver.executeQuery(
    // 	'MATCH (n{id:$id_param}) RETURN PROPERTIES(n)',
    // 	{ id_param: id },
    // 	{ database: 'neo4j' }
    // )
/**************
 * Backup Functions
 **************/

    // try {
    // 	//driver = neo4j.driver(URI,  neo4j.auth.basic(USER, PASSWORD))
    // 	const serverInfo = await driver.getServerInfo()
    // 	console.log('Connection estabilished')
    // 	console.log(serverInfo)
    // } catch(err) {
    // 	console.log(`Connection error\n${err}\nCause: ${err.cause}`)
    // 	await driver.close()
    // 	return
    // }

// async function getRelatedResourcesForID(id){
//     const { records, summary, key } = await driver.executeQuery(
// 	'MATCH (n{id:$id_param})-[r]-(b) RETURN b.id',
// 	{ id_param: id },
// 	{ database: 'neo4j' }
//     )
//     await driver.close();

//     for (rec of records){
// 	console.log(rec['_fields'])
//     }
//     console.log('---------------------------')
//     return records;
// }

// /**
//  * Get multiple elements by given IDs in a single query call
//  * @param {string[]} ids
//  * @return {Object[]} Array of objects with given IDs. Empty array if ID not found or error
//  */
// async function getElementsByIDs(ids){
//     // [Bug]: Due to `r.id IS NOT null`, any node without any relation will be excluded
//     // const query_str = "MATCH (n)--(r) " +
//     // 	  "WHERE n.id IN $ids_param AND r.id IS NOT null " +
//     // 	  "WITH COLLECT({id:r.id, title:r.title}) as related_nb, COLLECT(r.name) as authors, n " +
//     // 	  "RETURN n{.*, related_res: related_res, authors: authors, element_type:LABELS(n)[0]}";

//     const query_str = "MATCH (n)--(r) " +
// 	  "WHERE n.id IN $ids_param " +
// 	  "WITH COLLECT({id:r.id, title:r.title, element_type:LABELS(r)[0]}) as related_elems, COLLECT(r.name) as authors, n " +
// 	  "RETURN n{.*, related_elements: related_elems, authors: authors, element_type:LABELS(n)[0]}";
//     try{
// 	const {records, summary} =
// 	      await driver.executeQuery(query_str,
// 					{ids_param: ids},
// 					{database: process.env.NEO4J_DB});
// 	if (records.length <= 0){
// 	    // Query returned no match for given IDs
// 	    return [];
// 	}
// 	var ret = []
// 	for (record of records){
// 	    ret.push(record['_fields'][0])
// 	}
// 	return ret;
//     } catch(err){
// 	console.log('Error in query: '+ err);
//     } finally {
// 	await driver.close();
//     }
//     // something went wrong
//     return [];
// }
