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
    MAP: "Map",
});
exports.ElementType = ElementType;

const Relations = Object.freeze({
    RELATED: "RELATED", // Default relation type
    CONTRIBUTED: "CONTRIBUTED", // e.g. User CONTRIBUTED Element
    LIKED: "LIKED", // e.g. User LIKED Element

    USES: "USES", // e.g. Notebook USES Dataset
});

const SortBy = Object.freeze({
    CLICK_COUNT: "click_count",
    CREATION_TIME: "created_at",
    TITLE: "title",
});
exports.SortBy = SortBy;

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

/**
 * Determine type of element given type string
 */
function parseElementType(type){
    const element_type = type[0].toUpperCase() + type.slice(1);
    switch(element_type){

    case ElementType.NOTEBOOK: return ElementType.NOTEBOOK;
    case ElementType.DATASET: return ElementType.DATASET;
    case ElementType.PUBLICATION: return ElementType.PUBLICATION;
    case ElementType.OER: return ElementType.OER;
    case ElementType.MAP: return ElementType.MAP;
    default:
	throw Error('Server Neo4j: Element type ('+ element_type  +') not implemented');
    }
}

function parseSortBy(sort_by){
    switch (sort_by){
    case SortBy.CLICK_COUNT:
    case SortBy.CLICK_COUNT.toLowerCase():
	return SortBy.CLICK_COUNT;
    case SortBy.CREATION_TIME:
    case "creation_time":
	return SortBy.CREATION_TIME;
    case SortBy.TITLE: return SortBy.TITLE;
    default:
	throw Error('Server Neo4j: SortBy ('+ sort_by  +') not implemented');
    }
}
/**
 * Neo4j always returns 64-bit numbers. Needs to be handled explicitly
 */
function parse64BitNumber(num_64){
    let res = num_64['high'];
    for (let i=0; i<32; i++) {
	res *= 2;
    }
    return num_64['low'] + res;
}
/**
 * Reference: https://stackoverflow.com/questions/62671936/javascript-neo4j-driver-how-to-convert-datetime-into-string
 * Convert neo4j date objects in to a parsed javascript date object
 * @param dateString - the neo4j date object
 * @returns Date
 */
function parseDate(neo4jDateTime){
    const { year, month, day, hour, minute, second, nanosecond } = neo4jDateTime;

    const date = new Date(
	year.toInt(),
	month.toInt() - 1, // neo4j dates start at 1, js dates start at 0
	day.toInt(),
	hour.toInt(),
	minute.toInt(),
	second.toInt(),
	nanosecond.toInt() / 1000000 // js dates use milliseconds
    );

    return date;
}
/**
 * Contributor matching can be done both on openid as well as id
 * @returns str Query string with Contributor as `c` and contributed nodes as `r` (if specified)
 */
function contributorMatchQuery(id, with_contributions=false){
    if (id.startsWith('http')){
	// query should use openid
	if (with_contributions){
	    return "MATCH (c:Contributor)-[:CONTRIBUTED]-(r) WHERE $contrib_id in c.openid";
	} else {
	    return "MATCH (c:Contributor) WHERE $contrib_id in c.openid";
	}
    } else {
	// query should use id
	if (with_contributions){
	    return "MATCH (c:Contributor{id:$contrib_id})-[:CONTRIBUTED]-(r)";
	} else {
	    return "MATCH (c:Contributor{id:$contrib_id})";
	}
    }
    // return (id.startsWith('http'))?
    // 	//"MATCH (c:Contributor{openid:$contrib_id})" :
    // 	"MATCH (c:Contributor) WHERE $contrib_id in c.openid" :
    // 	"MATCH (c:Contributor{id:$contrib_id})";
}
/********************************/
async function createLinkNotebook2Dataset(nb_id, ds_id){
    return createRelation(nb_id, ds_id, Relations.USES);
}
/**
 * [ToDo] May not be useable separately since this can be done while registering the element
 * @param {string} user_id Registered user ID
 * @param {string} element_id Contributed element ID
 */
async function createLinkUserContributedElement(user_id, element_id){
    return createRelation(user_id, element_id, Relations.CONTRIBUTED);
}
/**
 * Create relation for elements liked by user
 * @param {string} user_id Registered user ID
 * @param {string} element_id Liked element ID
 */
async function createLinkUserLikedElement(user_id, element_id){
    return createRelation(user_id, element_id, Relations.LIKED);
}
/**
 * Get single element by given ID with all related content
 * @param {string} id
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
async function getElementByID(id){
    // [Bug] If an element 'n' with given 'id' does not have any related element,
    // this query does not return anything
    // const query_str = "MATCH (c)-[:CONTRIBUTED]-(n{id:$id_param})-[:RELATED]-(r) " +
    // 	  "WITH COLLECT({id:r.id, title:r.title, element_type:LABELS(r)[0]}) as related_elems, n, c  " +
    // 	  "RETURN n{.*, related_elements: related_elems, element_type:LABELS(n)[0], created_by:c.openid}";
    // [Fixed]
    const query_str = "MATCH (c)-[:CONTRIBUTED]-(n{id:$id_param}) " +
	  "OPTIONAL MATCH (n)-[:RELATED]-(r) " +
	  "WITH COLLECT({id:r.id, title:r.title, `thumbnail-image`:r.thumbnail_image, `resource-type`:TOLOWER(LABELS(r)[0])}) as related_elems, n, c  " +
	  "RETURN n{.*, related_elements: related_elems, `resource-type`:TOLOWER(LABELS(n)[0]), contributor: {id:c.id, name:(c.first_name + ' ' + c.last_name), `avatar-url`:c.avatar_url}}";

    const session = driver.session({database: process.env.NEO4J_DB});
    const tx = await session.beginTransaction();

    try {
	const {records, summary} =
	      await tx.run(query_str,
			   {id_param: id},
			   {database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // Query returned no match for given ID
	    return {};
	} else if (records.length > 1){
	    // should never reach here since ID is unique
	    throw Error("Server Neo4j: ID should be unique, query returned multiple results for given ID: " + id);
	}

	// frontend expects separate lists for related elements
	let result = records[0]['_fields'][0];
	let {related_elements: related_elements, ...this_elem} = result;

	// set/increment click count for this element
	const this_element_type = parseElementType(result['resource-type']);
	await tx.run("MATCH(n:"+this_element_type+"{id:$id_param}) WITH n, CASE n.click_count WHEN IS NULL THEN 0 ELSE n.click_count END AS click_count SET n.click_count = click_count+1" ,
		     {id_param: id},
		     {database: process.env.NEO4J_DB});

	await tx.commit();
	// Original
	// ret['related_nb'] = []
	// ret['related_ds'] = []
	// ret['related_oer'] = []
	// ret['related_pub'] = []

	// [ToDo] should be removed
	this_elem['related-notebooks'] = []
	this_elem['related-datasets'] = []
	this_elem['related-oers'] = []
	this_elem['related-publications'] = []

	// [ToDo] Current frontend expects only IDs for every related element and
	// makes a call to get title of every related element. Should be changed
	// A better approach will be to return ID, title, and type of all related elements
	//as a result of this one query.
	// [ToDo] Change `rel_elem.id` to return everything for related elem
	for (elem of related_elements){
	    if (elem['id'] == null || elem['resource-type'] == null) continue;
	    const element_type = parseElementType(elem['resource-type']);

	    switch(element_type){
	    case ElementType.DATASET:{
		let {element_type:_, ...rel_elem} = elem;
		//this_elem['related-datasets'].push(rel_elem['id']);
		this_elem['related-datasets'].push(rel_elem);
		break;
	    }
	    case ElementType.NOTEBOOK:{
		let {element_type:_, ...rel_elem} = elem;
		//this_elem['related-notebooks'].push(rel_elem['id']);
		this_elem['related-notebooks'].push(rel_elem);
		break;
	    }
	    case ElementType.OER:{
		let {element_type:_, ...rel_elem} = elem;
		//this_elem['related-oers'].push(rel_elem['id']);
		this_elem['related-oers'].push(rel_elem);
		break;
	    }
	    case ElementType.PUBLICATION:{
		let {element_type:_, ...rel_elem} = elem;
		//this_elem['related-publications'].push(rel_elem['id']);
		this_elem['related-publications'].push(rel_elem);
		break;
	    }
	    case "Author":{
		//ignore
		break;
	    }
	    default:
		// should never reach here since error thrown in parseElementType
		throw Error("Server Neo4j: Related element type not implemented: " +
			    elem['resource-type']);
		break;
	    }
	}

	//console.log('Testing ...' + this_elem['resource-type']);
	//const this_element_type = parseElementType(this_elem['resource-type']);

	// External links for OERs
	if (this_element_type == ElementType.OER){
	    var {'oer_elink_types': oer_elink_types,
		 'oer_elink_titles': oer_elink_titles,
		 'oer_elink_urls': oer_elink_urls,
		 ...ret} = this_elem;

	    ret['oer-external-links'] = [];
	    if (Array.isArray(oer_elink_titles)) {
		for (let i=0; i<oer_elink_titles.length; ++i){
		    let oer_elink = {}
		    oer_elink['type'] = oer_elink_types[i];
		    oer_elink['title'] = oer_elink_titles[i];
		    oer_elink['url'] = oer_elink_urls[i];

		    ret['oer-external-links'].push(oer_elink);
		}
	    }
	} else if (this_element_type == ElementType.PUBLICATION) {
	    // External link for Publication
	    console.log('Fixing external link for publication');
	    var {'external_link': external_doi_link,
		 ...ret} = this_elem;
	    ret['external-link-publication'] = external_doi_link;
	} else {
	    var ret = this_elem;
	}

	// handle 64-bit numbers returned from neo4j
	if (ret['click_count']){
	    ret['click-count'] = parse64BitNumber(ret['click_count']);
	    delete ret['click_count'];
	} else {
	    // to handle corner cases, when click_count is not set. May happen for legacy elements added before summer school 2024
	    // for all such elements, this will happen the first time only
	    // Sept, 2024: Should NEVER reach here
	    ret['click-count'] = 0;
	}
	// handle datetime values for created_at and updated_at properties
	ret['created-at'] = parseDate(ret['created_at']);
	delete ret['created_at'];
	if (ret['updated_at']){
	    ret['updated-at'] = parseDate(ret['updated_at']);
	    delete ret['updated_at'];
	}

	// [ToDo] should be removed
	//ret['_id'] = ret['id']
	//delete ret['id'];
	//ret['resource-type'] = ret['element_type'].toLowerCase();
	//delete ret['element_type'];
	ret['thumbnail-image'] = ret['thumbnail_image'];
	delete ret['thumbnail_image'];

	if ('direct_download_link' in ret){
	    ret['direct-download-link'] = ret['direct_download_link'];
	    delete ret['direct_download_link'];
	}
	if ('external_link' in ret){
	    ret['external-link'] = ret['external_link'];
	    delete ret['external_link'];
	}
	if ('notebook_file' in ret){
	    ret['notebook-file'] = ret['notebook_file'];
	    delete ret['notebook_file'];
	}
	if ('notebook_repo' in ret) {
	    ret['notebook-repo'] = ret['notebook_repo'];
	    delete ret['notebook_repo'];
	}

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
 * @param {Enum}   sort_by Enum for sorting the results. Default is by title
 * @param {Enum}   order Enum for order of sorting the results. Default is DESC
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
async function getElementsByType(type, from, size, sort_by=SortBy.TITLE, order="DESC"){

    // // capitalize first letter of data type
    // const node_type = type[0].toUpperCase() + type.slice(1);
    // if (node_type == ElementType.NOTEBOOK ||
    // 	node_type == ElementType.DATASET ||
    // 	node_type == ElementType.PUBLICATION ||
    // 	node_type == ElementType.OER
    //    ){
    // 	// legit element type
    // } else {
    // 	throw Error("Server Neo4j: Element type not implemented");
    // }

    // [ToDo] Just to make things work with frontend (should be removed)
    // const query_str = "MATCH (n:"+ node_type +")-[:CONTRIBUTED]-(r) " +
    // 	  "RETURN n{_id: n.id, title:n.title, contents:n.contents, tags:n.tags, `thumbnail-image`:n.thumbnail_image, `resource-type`:LABELS(n)[0], authors:[(r.first_name + ' ' + r.last_name)] } " +
    // 	  "ORDER BY n.title " +
    // 	  "SKIP $from " +
    // 	  "LIMIT $size";

    try{
	const node_type = parseElementType(type);
	const order_by = parseSortBy(sort_by);

	const query_str = "MATCH (n:"+ node_type +")-[:CONTRIBUTED]-(c) " +
	      "RETURN n{id: n.id, title:n.title, contents:n.contents, tags:n.tags, `thumbnail-image`:n.thumbnail_image, `resource-type`:TOLOWER(LABELS(n)[0]), authors:n.authors, created_at:TOSTRING(n.created_at), click_count:n.click_count, contributor: {id:c.id, name:(c.first_name + ' ' + c.last_name), `avatar-url`:c.avatar_url}} " +
	      "ORDER BY n." + order_by + " " + order + " " +
	      "SKIP $from " +
	      "LIMIT $size";


	const {records, summary} =
	      await driver.executeQuery(query_str,
					{from: neo4j.int(from), size: neo4j.int(size)},
					{database: process.env.NEO4J_DB});

	if (records.length <= 0){
	    // No elements found
	    return [];
	}
	var ret = []
	for (record of records){
	    ret.push(record['_fields'][0]);
	    // element = record['_fields'][0];
	    // element['resource-type'] = element['resource-type'].toLowerCase();
	    // ret.push(element);
	}
	return ret;
    } catch(err){console.log('getElementsByType() Error in query: '+ err);}
    // something went wrong
    return [];
}
/**
 * Get elements count by given type
 * @param {string} type
 * @return {int} Intger count of given element type. -1 in case of error
 */
async function getElementsCountByType(type){

    // // capitalize first letter of data type
    // const node_type = type[0].toUpperCase() + type.slice(1);
    // if (node_type == ElementType.NOTEBOOK ||
    // 	node_type == ElementType.DATASET ||
    // 	node_type == ElementType.PUBLICATION ||
    // 	node_type == ElementType.OER
    //    ){
    // 	// legit element type
    // } else {
    // 	throw Error("Server Neo4j: Element type not implemented");
    // }

    try{

	const node_type = parseElementType(type);
	const query_str = "MATCH (n:"+ node_type +") " +
	      "RETURN COUNT(n)";

	const {records, summary} =
	      await driver.executeQuery(query_str, {database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // Error running query
	    return -1;
	}
	var ret = records[0]['_fields'][0]['low'];
	return ret;
    } catch(err){console.log('getElementsCountByType() Error in query: '+ err);}
    // something went wrong
    return -1;
}
/**
 * Get elements by contributor
 * @param {string} id ID of the contributor
 * @param {int}    from For pagintion, get elements from this number
 * @param {int}    size For pagintion, get this number of elements
 * @param {Enum}   sort_by Enum for sorting the results. Default is by title
 * @param {Enum}   order Enum for order of sorting the results. Default is DESC
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
async function getElementsByContributor(id, from, size, sort_by=SortBy.TITLE, order="DESC"){

    try{
	const order_by = parseSortBy(sort_by);
	//const query_str = "MATCH (c:Contributor{id:$id})-[:CONTRIBUTED]-(r) " +
	const query_str = contributorMatchQuery(id, with_contributions=true)+" " +
	      "RETURN {id:r.id, tags: r.tags, title:r.title, contents:r.contents, tags:r.tags, `resource-type`:LABELS(r)[0], `thumbnail-image`:r.thumbnail_image, contents:r.contents, authors: r.authors, created_at:TOSTRING(r.created_at), click_count:r.click_count, contributor: {id:c.id, name:(c.first_name + ' ' + c.last_name), `avatar-url`:c.avatar_url}} " +
	      "ORDER BY r." + order_by + " " + order + " " +
	      "SKIP $from " +
	      "LIMIT $size";

	const {records, summary} =
	      await driver.executeQuery(query_str,
					{contrib_id: id,
					 from: neo4j.int(from),
					 size: neo4j.int(size)},
					{database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // No elements found by contributor
	    return [];
	}
	var ret = []
	for (record of records){
	    //ret.push(record['_fields'][0]);
	    element = record['_fields'][0];
	    element['resource-type'] = element['resource-type'].toLowerCase();
	    ret.push(element);
	}
	return ret;
    } catch(err){console.log('getElementsByContributor() Error in query: '+ err);}
    // something went wrong
    return [];
}
/**
 * Get elements count by contributor
 * @param {string} id ID of the contributor
 * @return {int} Count
 */
async function getElementsCountByContributor(id){
    const query_str = contributorMatchQuery(id, with_contributions=true) + " " +
	  "RETURN COUNT(r)";
    try{
	const {records, summary} =
	      await driver.executeQuery(query_str,
					{contrib_id: id},
					{database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // Error running query
	    return -1;
	}
	var ret = records[0]['_fields'][0]['low'];
	return ret;
    } catch(err){console.log('getElementsCountByContributor() Error in query: '+ err);}
    // something went wrong
    return -1;
}
/**
 * Get elements by contributor
 * @param {string} tag Tag string for case-insensitive match
 * @param {int}    from For pagintion, get elements from this number
 * @param {int}    size For pagintion, get this number of elements
 * @param {Enum}   sort_by Enum for sorting the results. Default is by title
 * @param {Enum}   order Enum for order of sorting the results. Default is DESC
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
async function getElementsByTag(tag, from, size, sort_by=SortBy.TITLE, order="DESC"){
    // const query_str = "MATCH (n)-[:CONTRIBUTED]-(r) " +
    // 	  "WHERE ANY ( tag IN n.tags WHERE toLower(tag) = toLower($tag_str) )" +
    // 	  "RETURN n{_id: n.id, title:n.title, contents:n.contents, tags:n.tags, `thumbnail-image`:n.thumbnail_image, `resource-type`:LABELS(n)[0], authors:[(r.first_name + ' ' + r.last_name)] } " +
    // 	  "ORDER BY n.title " +
    // 	  "SKIP $from " +
    // 	  "LIMIT $size";

    try{
	const order_by = parseSortBy(sort_by);
	const query_str = "MATCH (n)-[:CONTRIBUTED]-(c) " +
	      "WHERE ANY ( tag IN n.tags WHERE toLower(tag) = toLower($tag_str) )" +
	      "RETURN n{id: n.id, title:n.title, contents:n.contents, tags:n.tags, `thumbnail-image`:n.thumbnail_image, `resource-type`:LABELS(n)[0], authors:n.authors, created_at:TOSTRING(n.created_at), click_count:n.click_count, contributor: {id:c.id, name:(c.first_name + ' ' + c.last_name), `avatar-url`:c.avatar_url} } " +
	      "ORDER BY n." + order_by + " " + order + " " +
	      "SKIP $from " +
	      "LIMIT $size";

	const {records, summary} =
	      await driver.executeQuery(query_str,
					{tag_str: tag,
					 from: neo4j.int(from),
					 size: neo4j.int(size)},
					{database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // No elements found with given tag
	    return [];
	}
	var ret = []
	for (record of records){
	    element = record['_fields'][0];
	    element['resource-type'] = element['resource-type'].toLowerCase();
	    ret.push(element);
	}
	return ret;
    } catch(err){console.log('getElementsByTag() Error in query: '+ err);}
    // something went wrong
    return [];
}
/**
 * Get elements count by contributor
 * @param {string} tag Tag to search for case-insensitive match
 * @return {int} Count
 */
async function getElementsCountByTag(tag){
    const query_str = "MATCH (n) " +
	  "WHERE ANY ( tag IN n.tags WHERE toLower(tag) = toLower($tag_str) )" +
	  "RETURN COUNT(n)";
    try{
	const {records, summary} =
	      await driver.executeQuery(query_str,
					{tag_str: tag},
					{database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // Error running query
	    return -1;
	}
	var ret = records[0]['_fields'][0]['low'];
	return ret;
    } catch(err){console.log('getElementsCountByTag() Error in query: '+ err);}
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
    // const query_str = "MATCH (n{featured:True})-[:CONTRIBUTED]-(r) " +
    // 	  "RETURN n{_id: n.id, title:n.title, `thumbnail-image`:n.thumbnail_image, `resource-type`:LABELS(n)[0], authors:[(r.first_name + ' ' + r.last_name)]}";

    // For dynamically loading featured/highlight elements
    const rel_count = 2; // threshold number of related elements for a given element to determine if it is featured
    const query_str = "CALL {MATCH(n:Notebook)-[r:RELATED]-() WITH n, COUNT(r) as rel_count WHERE rel_count>$rel_count " +
	  "RETURN n{id: n.id, title:n.title, `thumbnail-image`:n.thumbnail_image, `resource-type`:TOLOWER(LABELS(n)[0])} AS featured, rand() as random ORDER BY random LIMIT 1 " +
	  "UNION " +
	  "MATCH(n:Dataset)-[r:RELATED]-() WITH n, COUNT(r) as rel_count WHERE rel_count>$rel_count " +
	  "RETURN n{id: n.id, title:n.title, `thumbnail-image`:n.thumbnail_image, `resource-type`:TOLOWER(LABELS(n)[0])} AS featured, rand() as random ORDER BY random LIMIT 1 " +
	  "UNION " +
	  "MATCH(n:Publication)-[r:RELATED]-() WITH n, COUNT(r) as rel_count WHERE rel_count>$rel_count " +
	  "RETURN n{id: n.id, title:n.title, `thumbnail-image`:n.thumbnail_image, `resource-type`:TOLOWER(LABELS(n)[0])} AS featured, rand() as random ORDER BY random LIMIT 1 " +
	  "UNION " +
	  "MATCH(n:Oer)-[r:RELATED]-() WITH n, COUNT(r) as rel_count WHERE rel_count>$rel_count " +
	  "RETURN n{id: n.id, title:n.title, `thumbnail-image`:n.thumbnail_image, `resource-type`:TOLOWER(LABELS(n)[0])} AS featured, rand() as random ORDER BY random LIMIT 1 " +
	  "}RETURN COLLECT(featured) AS featured";

    try{
	const {records, summary} =
	      await driver.executeQuery(query_str,
					{rel_count:rel_count},
					{database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // No featured elements found
	    return [];
	}
	// var ret = []
	// for (record of records){
	//     element = record['_fields'][0];
	//     element['resource-type'] = element['resource-type'].toLowerCase();
	//     ret.push(element);
	// }
	// return ret;
	return records[0]['_fields'][0];
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return [];
}
/**
 * Get all featured elements.
 * @retrurn {Object[]} Array of featured objects. Empty array if no featrued elements found or error
 */
async function getFeaturedElementsByType(type, limit){

    try{
	const element_type = parseElementType(type);
	const rel_count = (() => {
	    if (element_type == ElementType.OER) return 0;
	    else if (element_type == ElementType.PUBLICATION) return 1;
	    else return 2;
	})();

	const query_str = (() => {
	    // since we have a limited number of OERs at this point, relax the connectivity check
	    // for featured elements for now
	    if (element_type == ElementType.OER) {
		return "MATCH(n:"+ element_type +") " +
	      "RETURN n{id: n.id, title:n.title, `thumbnail-image`:n.thumbnail_image, `resource-type`:TOLOWER(LABELS(n)[0]), contents:n.contents}, rand() as random ORDER BY random LIMIT $limit";
	    } else {
		return "MATCH(n:"+ element_type +")-[r:RELATED]-() WITH n, COUNT(r) as rel_count " +
	      "WHERE rel_count>=$rel_count " +
	      "RETURN n{id: n.id, title:n.title, `thumbnail-image`:n.thumbnail_image, `resource-type`:TOLOWER(LABELS(n)[0]), contents:n.contents}, rand() as random ORDER BY random LIMIT $limit";
	    }
	})();

	// "MATCH(n:"+ element_type +")-[r:RELATED]-() WITH n, COUNT(r) as rel_count " +
	// "WHERE rel_count>=$rel_count " +
	// "RETURN n{id: n.id, title:n.title, `thumbnail-image`:n.thumbnail_image, `resource-type`:TOLOWER(LABELS(n)[0]), contents:n.contents}, rand() as random ORDER BY random LIMIT $limit";

	const {records, summary} =
	      await driver.executeQuery(query_str,
					{rel_count:rel_count, limit:neo4j.int(limit)},
					{database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // No featured elements found
	    return [];
	}
	var ret = []
	for (record of records){
	    element = record['_fields'][0];
	    ret.push(element);
	}
	return {elements: ret};
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

    // (1) generate id (UUID).
    contributor['id'] = uuidv4();

    // (2) assign roles for new contributor
    contributor['role'] = (() => {
	// 0: super admin
	// 2: admin
	// 4: premium users
	// 6: trusted users
	// 10: untrusted user
	if (contributor['email'].endsWith('edu')) {
	    // Trusted users
	    return neo4j.int(6);
	}
	// default role i.e. Untrusted user
	return neo4j.int(10);
	})();
    const query_str = "CREATE (c: Contributor $contr_param)";
    try{
	const {_, summary} =
	      await driver.executeQuery(query_str,
					{contr_param: contributor},
					{database: process.env.NEO4J_DB});
	if (summary.counters.updates()['nodesCreated'] == 1){
	    return true;
	}
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return false;
}
/**
 * Update existing contributor
 * @param {string} id Contributor id
 * @param {Object} contributor Map with new contributor attributes (refer to schema)
 * @return {Boolean} true for successful registration. false otherwise or in case of error
 */
async function updateContributor(id, contributor_attributes){
    const query_match = contributorMatchQuery(id) + " ";
    var query_set = "";
    var query_params = {contrib_id: id};

    let i=0;
    for (const [key, value] of Object.entries(contributor_attributes)) {
	query_set += "SET c." + key + "=$attr" + i + " ";
	query_params['attr' + i] = value;
	i+=1;
    }

    const query_str = query_match + query_set;
    try{
	const {_, summary} =
	      await driver.executeQuery(query_str,
					query_params,
					{database: process.env.NEO4J_DB});
	if (summary.counters.updates()['propertiesSet'] >= 1){
	    return true;
	}
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return false;
}
/**
 * Get contributor by ID with all related content
 * @param {string} id
 * @param {string} avatar_url
 * @return {Boolean} True if avatar set successfully. False if contributor not found
 */
async function setContributorAvatar(id, avatar_url){

    const session = driver.session({database: process.env.NEO4J_DB});
    const tx = await session.beginTransaction();

    var old_url = "";
    var ret = false;
    try {
	// get exising avatar url
	let query_str = contributorMatchQuery(id)+" " +
	    "RETURN c.avatar_url";
	let {records, summ} = await tx.run(query_str,
			      {contrib_id: id},
			      {database: process.env.NEO4J_DB});
	if (records.length > 0){
	    old_url = records[0]['_fields'][0];
	}

	// update new avatar url
	query_str = contributorMatchQuery(id)+" " +
	    "SET c.avatar_url=$avatar_url";
	let {_, summary} = await tx.run(query_str,
				    {contrib_id: id, avatar_url: avatar_url},
				    {database: process.env.NEO4J_DB});
	if (summary.counters.updates()['propertiesSet'] == 1){
	    ret = true;
	}

	await tx.commit();
    } catch(err){console.log('Error in query: '+ err);}
    finally {await session.close();}

    return {result: ret, old_avatar_url:old_url};
}
/**
 * DEPRECATED. Use getContributorByID() instead
 * Get contributor profile by OpenID with all related content
 * @param {string} id
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
async function getContributorProfileByID(openid){
    // This is not working -
    // const query_str = "MATCH (c:Contributor{openid:$id_param})-[:CONTRIBUTED]-(r) " +
    // 	  "WITH COLLECT({id:r.id, title:r.title, element_type:LABELS(r)[0]}) as contributed_elems, c " +
    // 	  "RETURN c{.*, contributed_elements: contributed_elems} ";


    try {
	const {records, summary} =
	      await driver.executeQuery(query_str,
					{id_param: openid},
					{database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // Query returned no match for given ID
	    return {};
	} else if (records.length > 1){
	    // should never reach here since ID is unique
	    throw Error("Server Neo4j: ID should be unique, query returned multiple results for given ID: " + openid);
	}
	return records[0]['_fields'][0];
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return {};
}
/**
 * Get contributor by ID without any related information
 * @param {string} id
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
async function getContributorByID(id){
    const query_str = contributorMatchQuery(id)+" " +
	  "RETURN c{.*} ";
    try {
	const {records, summary} =
	      await driver.executeQuery(query_str,
					{contrib_id: id},
					{database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // Query returned no match for given ID
	    return {};
	} else if (records.length > 1){
	    // should never reach here since ID is unique
	    throw Error("Server Neo4j: ID should be unique, query returned multiple results for given ID:" + id);
	}
	const contributor = records[0]['_fields'][0];
	contributor['role'] = parse64BitNumber(contributor['role']);

	return contributor;
	//return records[0]['_fields'][0];
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return {};
}
/**
 * Check if contributor exists
 * @param {string} id
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
async function checkContributorByID(id){
    const query_str = "OPTIONAL "+contributorMatchQuery(id)+" "+
	  "RETURN c IS NOT NULL AS Predicate";

    try {
	const {records, summary} =
	      await driver.executeQuery(query_str,
					{contrib_id: id},
					{database: process.env.NEO4J_DB});
	const resp = records[0]['_fields'][0];
	return resp;
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return false;
}

async function updateElement(id, element){

    // let{metadata:_,
    // 	'resource-type': node_type,
    // 	'related-resources': related_elements,
    // 	...node
    //    } = element;

    const session = driver.session({database: process.env.NEO4J_DB});
    const tx = await session.beginTransaction();

    try{
	const {node, node_type, related_elements} =
	      await elementToNode(element, generate_id=false);

	const this_element_match = "MATCH (n:"+node_type+"{id:$id}) ";
	var this_element_set = "";
	const this_element_query_params = {id: id};

	// update this element
	let i=0;
	for (const [key, value] of Object.entries(node)) {
	    this_element_set += "SET n." + key + "=$attr" + i + " ";
	    this_element_query_params['attr' + i] = value;
	    i+=1;
	}
	// add 'updated_at' property to this element
	this_element_set += "SET n.updated_at=$updated_at ";
	this_element_query_params['updated_at'] = neo4j.types.DateTime.fromStandardDate(new Date());
	    
	// handle related elements
	var {query_match, query_merge, query_params} =
	    await generateQueryStringForRelatedElements(related_elements);

	// combine all query parameters
	query_params = {...query_params, ...this_element_query_params};

	const query_str = this_element_match + query_match + this_element_set + query_merge;

	let ret = false;
	// first remove all existing relations
	await tx.run("MATCH (n:"+node_type+"{id:$id})-[r:RELATED]-(e) DELETE r",
		     {id:id},
		     {database: process.env.NEO4J_DB}
	);
	// update node and relations
	const {_, summary} =
	      await tx.run(query_str,
			   query_params,
			   {database: process.env.NEO4J_DB});
	if (summary.counters.updates()['propertiesSet'] >= 1){
	    //return true;
	    ret = true;
	}

	await tx.commit();
	return ret;
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return false;
}

/**
 * Helper function to generate CQL query string to create relations to Element 'n'
 * @param {Object} related_elements Object map with related elements information. Every related
 *                 element is expected to have at least 'type', and 'title' values
 * @return {String, String, Object} {query_match, query_merge, query_params}
 */
async function generateQueryStringForRelatedElements(related_elements){
    let query_match = "";
    let query_merge = "";
    let query_params = {}

    // (3) create relations based on related-elements
    // [ToDo] To avoid full DB scan, if we know the type of related elements, the query
    // can be updated to search for related ID with a lable as type
    for (let [i, related_elem] of related_elements.entries()){
	// query_match += "MATCH(to"+i+"{id:$id"+i+"}) ";
	// query_merge += "MERGE (n)-[:RELATED]->(to"+i+") ";
	// query_params["id"+i] = related_elem['id'];

	// get related elements based on title
	if (related_elem['type'] == 'notebook'){
	    query_match += "MATCH(to"+i+":Notebook{title:$title"+i+"}) ";
	} else if (related_elem['type'] == 'dataset') {
	    query_match += "MATCH(to"+i+":Dataset{title:$title"+i+"}) ";
	} else if (related_elem['type'] == 'publication') {
	    query_match += "MATCH(to"+i+":Publication{title:$title"+i+"}) ";
	} else if (related_elem['type'] == 'oer') {
	    query_match += "MATCH(to"+i+":Oer{title:$title"+i+"}) ";
	}
	query_merge += "MERGE (n)-[:RELATED]->(to"+i+") ";
	query_params["title"+i] = related_elem['title'];
    }

    return {query_match:query_match, query_merge:query_merge, query_params:query_params}
}

async function elementToNode(element, generate_id=true){
    // separate common and specific element properties
    let{metadata:_,
	'thumbnail-image': thumbnail,
	'resource-type': node_type,
	'related-resources': related_elements,
	'external-link': external_link,                 // Dataset
	'direct-download-link': direct_download_link,   // Dataset
	'notebook-repo': notebook_repo,                 // Notebook
	'notebook-file': notebook_file,                 // Notebook
	size: size,                                     // Dataset
	'external-link-publication': external_link_pub, // Publication
	'oer-external-links': oer_external_links,       // OER
	...node
       } = element;

    //node_type = node_type[0].toUpperCase() + node_type.slice(1);
    node_type = parseElementType(node_type);
    node['thumbnail_image'] = thumbnail;

    // (1) generate id (UUID)
    if (generate_id) node['id'] = uuidv4();
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
	node['oer_elink_titles'] = [];
	node['oer_elink_urls'] = [];
	node['oer_elink_types'] = [];

	if (oer_external_links) {
	    for (elink of oer_external_links){
		node['oer_elink_titles'].push(elink['title']);
		node['oer_elink_urls'].push(elink['url']);
		node['oer_elink_types'].push(elink['type']);
	    }
	}
    } else {
	throw Error("Backend Neo4j: elementToNode type not implemented");
    }

    return {node:node, node_type:node_type, related_elements:related_elements};
}

/**
 * Register new element
 * @param {String} contributor_id ID of registered contributor
 * @param {Object} element Map with element attributes (refer to schema)
 * @return {Boolean, String} {true, element_id} on success OR {false, ''} on failure.
 */
async function registerElement(contributor_id, element){

    // (1) and (2)
    let {node, node_type, related_elements} = await elementToNode(element);
    // for every element initialize click_count
    node['click_count'] = neo4j.int(0);
    // for every element initialize creation time
    node['created_at'] = neo4j.types.DateTime.fromStandardDate(new Date());
    
    // (3) create relations based on related-elements
    var {query_match, query_merge, query_params} =
	  await generateQueryStringForRelatedElements(related_elements);

    // add node (element info) as parameter
    query_params = {node_param: node, ...query_params};

    // var query_match = "";
    // var query_merge = "";
    // var query_params = {node_param: node}

    // // (3) create relations based on related-elements
    // // [ToDo] To avoid full DB scan, if we know the type of related elements, the query
    // // can be updated to search for related ID with a lable as type
    // for (let [i, related_elem] of related_elements.entries()){
    // 	// query_match += "MATCH(to"+i+"{id:$id"+i+"}) ";
    // 	// query_merge += "MERGE (n)-[:RELATED]->(to"+i+") ";
    // 	// query_params["id"+i] = related_elem['id'];

    // 	// get related elements based on title
    // 	if (related_elem['type'] == 'notebook'){
    // 	    query_match += "MATCH(to"+i+":Notebook{title:$title"+i+"}) ";
    // 	} else if (related_elem['type'] == 'dataset') {
    // 	    query_match += "MATCH(to"+i+":Dataset{title:$title"+i+"}) ";
    // 	} else if (related_elem['type'] == 'publication') {
    // 	    query_match += "MATCH(to"+i+":Publication{title:$title"+i+"}) ";
    // 	} else if (related_elem['type'] == 'oer') {
    // 	    query_match += "MATCH(to"+i+":Oer{title:$title"+i+"}) ";
    // 	}
    // 	query_merge += "MERGE (n)-[:RELATED]->(to"+i+") ";
    // 	query_params["title"+i] = related_elem['title'];

    // }

    // (4) create CONTRIBUTED_BY relation with contributor_id
    query_match += contributorMatchQuery(contributor_id)+" "; //"MATCH(c:Contributor{id:$contrib_id}) ";
    query_merge += "MERGE (c)-[:CONTRIBUTED]->(n) ";
    query_params['contrib_id'] = contributor_id;

    const query_str = query_match + " CREATE (n: "+node_type+" $node_param) " + query_merge;

    try{
	const {_, summary} =
	      await driver.executeQuery(query_str,
					query_params,
					{database: process.env.NEO4J_DB});
	if (summary.counters.updates()['nodesCreated'] >= 1){
	    return {response: true, element_id: node['id']};
	    //return true;
	}
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    //return false;
    return {response: false, element_id: ''};
}

/**
 * Delete a resource given ID
 * @param {string} id
 * @return {Object} true if deleted successfully, false otherwise
 */
async function deleteElementByID(id){
    const query_str = "MATCH (n{id:$id_param}) " +
	  "DETACH DELETE n";
    try {
	const {_, summary} =
	      await driver.executeQuery(query_str,
					{id_param: id},
					{database: process.env.NEO4J_DB});
	if (summary.counters.updates()['nodesDeleted'] == 1){
	    return true;
	}
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return false;
}

/**
 * Get contributor ID for the element
 * @param {string} e_id Element ID
 * @return {Object} Contributors {id, openid}
 */
async function getContributorIdForElement(e_id){
    const query_str = "MATCH (c)-[:CONTRIBUTED]-(n{id:$id_param}) " +
	  "RETURN {id:c.id, openid:c.openid}";
    try {
	const {records, summary} =
	      await driver.executeQuery(query_str,
					{id_param: e_id},
					{database: process.env.NEO4J_DB});

	if (records.length <= 0){
	    // No contributor found for given element
	    return {id:null, openid:null};
	}
	return records[0]['_fields'][0];
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return false;
}

exports.updateElement = updateElement;
exports.getElementByID = getElementByID;
exports.registerElement = registerElement;
exports.getElementsByTag = getElementsByTag;
exports.deleteElementByID = deleteElementByID;
exports.getElementsByType = getElementsByType;
exports.updateContributor = updateContributor;
exports.getContributorByID = getContributorByID;
exports.getFeaturedElements = getFeaturedElements;
exports.registerContributor = registerContributor;
exports.setContributorAvatar = setContributorAvatar;
exports.checkContributorByID = checkContributorByID;
exports.getElementsCountByTag = getElementsCountByTag;
exports.getElementsCountByType = getElementsCountByType;
exports.setElementFeaturedForID = setElementFeaturedForID;
exports.getElementsByContributor = getElementsByContributor;
exports.getFeaturedElementsByType = getFeaturedElementsByType;
exports.createLinkNotebook2Dataset = createLinkNotebook2Dataset;
exports.getContributorIdForElement = getContributorIdForElement;
exports.getElementsCountByContributor = getElementsCountByContributor;

exports.testServerConnection = testServerConnection;

//exports.getContributorProfileByID = getContributorProfileByID;
