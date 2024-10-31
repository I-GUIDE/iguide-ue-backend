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
    //Documentation: "Documentation",
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

/*
 * Please note following differences in terminologies
 * User: Logged in user on our platform. May or may NOT be a contributor
 * Contributor: All elements are submitted by Contributed users
 */
const Role = Object.freeze({
    SUPER_ADMIN: 1,
    ADMIN: 2,
    CONTENT_MODERATOR: 3,        // can edit any contribution
    UNRESTRICTED_CONTRIBUTOR: 4, // can contribute restricted elements such as OERs etc.
    TRUSTED_USER: 8,             // users with .edu emails
    UNTRUSTED_USER: 10,          // all other users
});
exports.Role = Role;

const Visibility = Object.freeze({
    PRIVATE: 1,
    PUBLIC: 10,
});
exports.Visibility = Visibility;

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
function parseVisibility(visibility){
    switch(visibility){

    case 'public':
    case '10':
    case 10:
	return Visibility.PUBLIC;
    case 'private':
    case '1':
    case 1:
	return Visibility.PRIVATE;
    default:
	throw Error('Server Neo4j: Visibility ('+ visibility  +') parsing not implemented');
    }
}
exports.parseVisibility = parseVisibility

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
	throw Error('Server Neo4j: Element type ('+ element_type  +') parsing not implemented');
    }
}
//exports.parseElementType = parseElementType

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
 * Frontend expects data in a particular format which may or may not be the same when
 * returned from DB. This function is to post process all data before returning to frontend
 */
function makeFrontendCompatible(element) {
    // frontend expects key names with '-', convert all '_' to '-'

    // let ret = Object.fromEntries(
    // 	Object.entries(element).map(([key, value]) => [`${key}`.replaceAll("_","-"), value])
    // );
    function replaceUnderscores(obj) {
	const keyValues = Object.entries(obj).map(([k1, v1]) => {
	    if (k1 === 'created_at' || k1 === 'updated_at')
		return [k1.replaceAll("_","-"), v1];
	    if (typeof v1 === 'object' && v1 !== null && !Array.isArray(v1)) {
		v1 = replaceUnderscores(v1);
	    } else if (Array.isArray(v1) && typeof v1[0] === 'object'){
		a = [];
		for (v of v1){
		    a.push(replaceUnderscores(v));
		}
		v1 = a;
	    }
	    return [k1.replaceAll("_","-"), v1];
	});
	return Object.fromEntries(keyValues);
    }
    let ret = replaceUnderscores(element);

    // handle 64-bit numbers returned from neo4j
    if (ret['visibility'])
	ret['visibility'] = parse64BitNumber(ret['visibility']);
    if (ret['click-count']){
	ret['click-count'] = parse64BitNumber(ret['click-count']);
    }
    // handle datetime values for created_at and updated_at properties
    //ret['created-at'] = parseDate(ret['created-at']);
    if (ret['updated-at']){
	ret['updated-at'] = parseDate(ret['updated-at']);
    }
    return ret;
}

/**
 * Contributor matching can be done both on openid as well as id
 * @returns str Query string with Contributor as `c` and contributed nodes as `r` (if specified)
 */
function contributorMatchQuery(id, with_contributions=false){
    if (id.startsWith('http')){
	// query should use openid, single user can have multiple openids e.g. multiple orgs
	if (with_contributions){
	    // [BUG] 'WHERE r.visibility=public' added after this will result in invalid query str
	    // however, since we are not using openids anymore, this should never happen
	    console.warn('[BUG] contributorMatchQuery() called with openid');
	    return "MATCH (c:Contributor)-[:CONTRIBUTED]-(r) WHERE $contrib_id in c.openid";
	} else {
	    return "MATCH (c:Contributor) WHERE $contrib_id in c.openid";
	}
    } else {
	// query should use id
	if (with_contributions){
	    // [BUG] 'WHERE r.visibility=public' added after this will result in invalid query str
	    // however, since we are not using openids anymore, this should never happen
	    console.warn('[BUG] contributorMatchQuery() called with openid');
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

/**
 * Determing if user with user_id has enough permission to edit element with element_id
 * @param {string} element_id Element to check permissions for
 * @param {string} user_id Logged-in user ID
 * @param {int} user_role Logged-in user role
 * @returns Boolean true if user can edit, false otherwise
 */
async function userCanEditElement(element_id, user_id, user_role) {
    // only allow editing if
    // (1) this element is owned by the user sending update request
    // (2) user sending update request is admin or super admin
    const element_owner = await getContributorIdForElement(element_id);
    if (user_id == element_owner['id'] || user_id == element_owner['openid']){
	console.log('This element is owned by the user');
	// this element is owned by the user sending update request
	return true;
    } else if (user_role <= n4j.Role.CONTENT_MODERATOR) {
	// user sending update request is admin or super admin
	return true;
    }
    return false;
}
exports.userCanEditElement = userCanEditElement;

/**
 * Determing if user with user_id has enough permission to access element with element_id
 * @param {string} element_id Element to check permissions for
 * @param {string} user_id Logged-in user ID
 * @param {int} user_role Logged-in user role
 * @returns Boolean true if user can access, false otherwise
 */
async function userCanViewElement(element_id, user_id, user_role) {
    const element_visibility = await getElementVisibilityForID(element_id);
    const element_owner = await getContributorIdForElement(element_id);

    if (element_visibility === Visibility.PUBLIC){
	return true;
    }
    // non-public element will never be visible to logged-out user
    if (user_id === null || user_role === null){
	console.log('User is not logged in and trying to access a private element');
	return false;
    }
    // non-public element should only be visible to owner or admin
    if (user_id == element_owner['id'] || user_id == element_owner['openid']){
	console.log('This element is owned by the user');
	// this element is owned by the user calling endpoing
	return true;
    } else if (user_role <= n4j.Role.CONTENT_MODERATOR) {
	// endpoing invoked by admin or super admin
	console.log('Admin user accessing a private element');
	return true;
    }
    return false;
}
exports.userCanViewElement = userCanViewElement;

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
 * @param {string} id Element ID
 * @param {string} user_id ID of user making this request (Logged-In user)
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
async function getElementByID(id, user_id, user_role){

    // [Update-2.0] Frontend expects all related elements in a single list
    // [Fixed] Fixes the bug where nothing is returned in case element does not have any relations
    let query_str = "MATCH (c)-[:CONTRIBUTED]-(n{id:$id_param}) " +
	"OPTIONAL MATCH (n)-[:RELATED]-(r) ";
    // add filter to get only public related elements if user is not logged in
    if (user_id == null)
	query_str += "WHERE r.visibility=$public_visibility ";
    query_str += "WITH COLLECT(r{.id, .title, .visibility, .thumbnail_image, `resource-type`:TOLOWER(LABELS(r)[0])}) as related_elems, n, c  " +
	"RETURN n{.*, created_at:TOSTRING(n.created_at), related_elements: related_elems, `resource-type`:TOLOWER(LABELS(n)[0]), contributor: c{.id, .avatar_url, name:(c.first_name + ' ' + c.last_name)}}";

    // [Upadte] Query with related elements divided into separate lists for every type
    // no need to do manual related elements separation
    // This can be a little overwhelming, so please bear with me.
    // An example of a complete query_str
    //
    // MATCH (c)-[:CONTRIBUTED]-(n{id:'d95f1b41-e068-442b-92a1-8482a34cc502'})
    // OPTIONAL MATCH (n)-[:RELATED]-(related)
    // WITH COLLECT (related) as rel_elems,n,c
    // CALL {
    //     WITH rel_elems
    //     UNWIND rel_elems as r
    //     MATCH(r) WHERE TOLOWER(LABELS(r)[0])='dataset'
    //     RETURN COLLECT({id:r.id, title:r.title, `thumbnail-image`:r.thumbnail_image, `resource-type`:TOLOWER(LABELS(r)[0])}) AS related_datasets
    // }
    // CALL {
    //     WITH rel_elems
    //     UNWIND rel_elems as r
    //     MATCH(r) WHERE TOLOWER(LABELS(r)[0])='notebook'
    //     RETURN COLLECT({id:r.id, title:r.title, `thumbnail-image`:r.thumbnail_image, `resource-type`:TOLOWER(LABELS(r)[0])}) AS related_notebooks
    // }
    // CALL {
    //     WITH rel_elems
    //     UNWIND rel_elems as r
    //     MATCH(r) WHERE TOLOWER(LABELS(r)[0])='oer'
    //     RETURN COLLECT({id:r.id, title:r.title, `thumbnail-image`:r.thumbnail_image, `resource-type`:TOLOWER(LABELS(r)[0])}) AS related_oers
    // }
    // RETURN n{.*,`resource-type`:TOLOWER(LABELS(n)[0]), contributor: {id:c.id, name:(c.first_name + ' ' + c.last_name), `avatar-url`:c.avatar_url}, related_datasets:related_datasets, related_notebooks:related_notebooks, related_oers:related_oers}
    //
    // const match_query =
    // 	  "MATCH (c)-[:CONTRIBUTED]-(n{id:$id_param}) " +
    // 	  "OPTIONAL MATCH (n)-[:RELATED]-(related) " +
    // 	  "WITH COLLECT (related) as rel_elems,n,c ";

    // // for every ElementType, create a subquery
    // var call_subquery = "";
    // var ret_query = "RETURN n{.*,`resource-type`:TOLOWER(LABELS(n)[0]), contributor: {id:c.id, name:(c.first_name + ' ' + c.last_name), `avatar-url`:c.avatar_url}";

    // for (let elem_type in ElementType){
    // 	elem_type = elem_type.toLowerCase();
    // 	// NOTE: `resource-type` may seem redundant here but it is NOT. Frontend is using it for
    // 	// showing related element types, updating elements etc.
    // 	call_subquery += "CALL { WITH rel_elems UNWIND rel_elems as r " +
    // 	    "MATCH(r) WHERE TOLOWER(LABELS(r)[0])='" + elem_type + "'" +
    // 	    "RETURN COLLECT({id:r.id, title:r.title, `thumbnail-image`:r.thumbnail_image, `resource-type`:TOLOWER(LABELS(r)[0])}) " +
    // 	    "AS related_" + elem_type + "s} ";

    // 	ret_query += ",`related-"+elem_type+"s`:related_"+elem_type+"s";
    // }
    // ret_query += "}";

    // // create one query string from multiple parts
    // const query_str = match_query + call_subquery + ret_query;

    // // uncomment following to take a look at the query string
    // //console.log(query_str);

    const session = driver.session({database: process.env.NEO4J_DB});
    const tx = await session.beginTransaction();

    try {
	const {records, summary} =
	      await tx.run(query_str,
			   {id_param: id, public_visibility: Visibility.PUBLIC},
			   {routing: 'READ', database: process.env.NEO4J_DB});
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
	//let this_elem = result;

	// set/increment click count for this element
	const this_element_type = parseElementType(result['resource-type']);
	await tx.run("MATCH(n:"+this_element_type+"{id:$id_param}) WITH n, CASE n.click_count WHEN IS NULL THEN 0 ELSE n.click_count END AS click_count SET n.click_count = click_count+1" ,
		     {id_param: id},
		     {database: process.env.NEO4J_DB});

	await tx.commit();

	// related elements can belong to different contributors with varying visibilities
	// show only public related elements or related elements owned by this user
	this_elem['related_elements'] = [];
	for (elem of related_elements){
	    if (elem['id'] == null ||
		elem['resource-type'] == null ||
		elem['visibility'] == null) continue;

	    elem['visibility'] = parse64BitNumber(elem['visibility']);
	    const can_view = await userCanViewElement(elem['id'], user_id, user_role);
	    if (can_view){
		this_elem['related_elements'].push(elem);
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
	    //console.log('Fixing external link for publication');
	    var {'external_link': external_doi_link, ...ret} = this_elem;
	    ret['external-link-publication'] = external_doi_link;
	} else if (this_element_type == ElementType.MAP) {
	    // External iframe link for Publication
	    var {'external_iframe_link': external_iframe_link, ...ret} = this_elem;
	    if (external_iframe_link) {
		ret['external-iframe-link'] = external_iframe_link;
	    } else {
		ret['external-iframe-link'] = ret['thumbnail_image'];
	    }
	} else {
	    var ret = this_elem;
	}

	return makeFrontendCompatible(ret);

	// // frontend expects key names with '-', convert all '_' to '-'
	// ret = Object.fromEntries(
	//     Object.entries(ret).map(([key, value]) =>
	// 	[`${key}`.replaceAll("_","-"), value]
	//     )
	// );

	// // handle 64-bit numbers returned from neo4j
	// if (ret['visibility'])
	//     ret['visibility'] = parse64BitNumber(ret['visibility']);
	// if (ret['click-count']){
	//     ret['click-count'] = parse64BitNumber(ret['click-count']);
	// } else {
	//     // to handle corner cases, when click_count is not set.
	//     // May happen for legacy elements added before summer school 2024
	//     // for all such elements, this will happen the first time only
	//     // Sept, 2024: Should NEVER reach here
	//     //ret['click-count'] = 0;
	//     throw Error("Server Neo4j: Every element should have click_count");
	// }
	// // handle datetime values for created_at and updated_at properties
	// ret['created-at'] = parseDate(ret['created-at']);
	// if (ret['updated-at']){
	//     ret['updated-at'] = parseDate(ret['updated-at']);
	// }
	// return ret;
	//return records[0]['_fields'][0];
    } catch(err){
	console.log('Error in query: '+ err);
    }
    finally {await session.close();}
    // something went wrong
    return {};
}



/**
 * Get related elements for a given element ID
 * @param {string} id
 * @param {int} depth Depth of related elements e.g. 2 depth would mean related of related
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
async function getRelatedElementsForID(id, depth=2){
    const query_str = "MATCH(n{id:$id_param}) " +
	  "OPTIONAL MATCH (n)-[rt2:RELATED*0.."+depth+"]-(r2) " +
	  "WHERE n.visibility=$public_visibility AND r2.visibility=$public_visibility " +
	  "UNWIND rt2 as related " +
	  "RETURN {nodes: COLLECT(DISTINCT(r2{.id, .title, .thumbnail_image, `resource-type`:TOLOWER(LABELS(r2)[0])})), neighbors: COLLECT(DISTINCT({src:startNode(related).id, dst:endNode(related).id}))}";
    try{
	const {records, summary} =
	      await driver.executeQuery(query_str,
					{id_param: id,
					 public_visibility: Visibility.PUBLIC},
					{routing: 'READ', database: process.env.NEO4J_DB});
	//console.log(records);
	if (records.length <= 0){
	    // No related elements found for the given ID
	    return {};
	}
	return makeFrontendCompatible(records[0]['_fields'][0]);
    } catch(err){console.log('getElementsByType() Error in query: '+ err);}
    // something went wrong
    return {};
}
/**
 * Get related elements for a given element ID
 * @param {string} id
 * @param {int} depth Depth of related elements e.g. 2 depth would mean related of related
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
async function getAllRelatedElements(){
    const query_str = "MATCH(n)-[rt:RELATED]-(r) " +
	  "WHERE n.visibility=$public_visibility AND r.visibility=$public_visibility " +
	  "UNWIND [n, r] as cn " +
	  "RETURN {nodes: COLLECT(DISTINCT(cn{.id, .title, .thumbnail_image, `resource-type`:TOLOWER(LABELS(cn)[0])})), neighbors: COLLECT(DISTINCT({src:startNode(rt).id, dst:endNode(rt).id}))}";
    try{
	const {records, summary} =
	      await driver.executeQuery(query_str,
					{public_visibility: Visibility.PUBLIC},
					{routing: 'READ', database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // No related elements found
	    return {};
	}
	return makeFrontendCompatible(records[0]['_fields'][0]);
    } catch(err){console.log('getElementsByType() Error in query: '+ err);}
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
    // Only called to show elements on main page filtered by type
    // Note: Private elements will never show up on main pages even for the owner
    // Owner will be able to access them in his/her own profile
    try{
	const node_type = parseElementType(type);
	const order_by = parseSortBy(sort_by);

	const query_str = "MATCH (n:"+ node_type +")-[:CONTRIBUTED]-(c) " +
	      "WHERE n.visibility=$public_visibility " +
	      "RETURN n{.id, .title, .contents, .tags, .thumbnail_image, `resource-type`:TOLOWER(LABELS(n)[0]), .authors, created_at:TOSTRING(n.created_at), .click_count, contributor: c{.id, .avatar_url, name:(c.first_name + ' ' + c.last_name)}} " +
	      "ORDER BY n." + order_by + " " + order + " " +
	      "SKIP $from " +
	      "LIMIT $size";


	const {records, summary} =
	      await driver.executeQuery(query_str,
					{from: neo4j.int(from),
					 size: neo4j.int(size),
					 public_visibility: Visibility.PUBLIC},
					{routing: 'READ', database: process.env.NEO4J_DB});

	if (records.length <= 0){
	    // No elements found
	    return [];
	}
	var ret = []
	for (record of records){
	    ret.push(makeFrontendCompatible(record.get('n')));
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

    try{
	const node_type = parseElementType(type);
	const query_str = "MATCH (n:"+ node_type +") " +
	      "WHERE n.visibility=$public_visibility " +
	      "RETURN COUNT(n) AS count";

	const {records, summary} =
	      await driver.executeQuery(query_str,
					{public_visibility: Visibility.PUBLIC},
					{routing: 'READ', database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // Error running query
	    return -1;
	}
	return parse64BitNumber(records[0].get('count'));
    } catch(err){console.log('getElementsCountByType() Error in query: '+ err);}
    // something went wrong
    return -1;
}
/**
 * Get elements by contributor
 * @param {string} id ID of the contributor
 * @param {string} user_id ID of logged-in user
 * @param {int}    from For pagintion, get elements from this number
 * @param {int}    size For pagintion, get this number of elements
 * @param {Enum}   sort_by Enum for sorting the results. Default is by title
 * @param {Enum}   order Enum for order of sorting the results. Default is DESC
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
async function getElementsByContributor(id,
					user_id,
					from,
					size,
					sort_by=SortBy.TITLE,
					order="DESC"){

    // There are two cases where this function is called
    // (1) For showing up elements on user profile page. This should return all public and private
    // (2) A user clicks on another user's profile. This should only return public elements

    const session = driver.session({database: process.env.NEO4J_DB});
    const tx = await session.beginTransaction();

    try{
	// get contributor ID and all associated openids
	const query_str1 = "MATCH(c:Contributor) " +
	      "WHERE c.id=$id_param OR $id_param IN c.openid " +
	      "RETURN c.id, c.openid"
	const contrib_results = await tx.run(query_str1,
					     {id_param: id},
					     {routing: 'READ', database: process.env.NEO4J_DB});

	const contrib_id = contrib_results.records[0].get('c.id');
	const contrib_openids = contrib_results.records[0].get('c.openid');

	const order_by = parseSortBy(sort_by);
	let query_str = "MATCH (c:Contributor)-[:CONTRIBUTED]-(r) " +
	    "WHERE c.id=$contrib_id OR $contrib_id IN c.openid ";

	// if no user logged-in OR contributor is NOT logged-in user, only return public elements
	if (user_id === null || (user_id != contrib_id && !contrib_openids.includes(user_id)))
	    query_str += "AND r.visibility=$public_visibility ";

	query_str += "RETURN r{.id, .tags, .title, .contents, .authors, .click_count, `resource-type`:TOLOWER(LABELS(r)[0]), .thumbnail_image, created_at:TOSTRING(r.created_at), contributor: c{.id, .avatar_url, name:(c.first_name + ' ' + c.last_name) }} AS element " +
	      "ORDER BY r." + order_by + " " + order + " " +
	      "SKIP $from " +
	      "LIMIT $size";

	const {records, summary} = await tx.run(query_str,
						{contrib_id: id,
						 from: neo4j.int(from),
						 size: neo4j.int(size),
						 public_visibility: Visibility.PUBLIC},
						{routing: 'READ', database: process.env.NEO4J_DB});
	await tx.commit();
	if (records.length <= 0){
	    // No elements found by contributor
	    return [];
	}
	var ret = []
	for (record of records){
	    ret.push(makeFrontendCompatible(record.get('element')));
	}
	return ret;
    } catch(err){console.log('getElementsByContributor() Error in query: '+ err);}
    finally {await session.close();}
    // something went wrong
    return [];
}
/**
 * Get elements count by contributor
 * @param {string} id ID of the contributor
 * @param {string} user_id ID of logged-in user
 * @return {int} Count
 */
async function getElementsCountByContributor(id, user_id){
    const session = driver.session({database: process.env.NEO4J_DB});
    const tx = await session.beginTransaction();
    try{
	// get contributor ID and all associated openids
	const query_str1 = "MATCH(c:Contributor) " +
	      "WHERE c.id=$id_param OR $id_param IN c.openid " +
	      "RETURN c.id, c.openid"
	const contrib_results = await tx.run(query_str1,
					     {id_param: id},
					     {routing: 'READ', database: process.env.NEO4J_DB});
	const contrib_id = contrib_results.records[0].get('c.id');
	const contrib_openids = contrib_results.records[0].get('c.openid');

	let query_str = "MATCH (c:Contributor)-[:CONTRIBUTED]-(r) " +
	    "WHERE c.id=$contrib_id OR $contrib_id IN c.openid ";

	// if no user logged-in OR contributor is NOT logged-in user, only return public elements
	if (user_id === null || (user_id != contrib_id && !contrib_openids.includes(user_id)))
	    query_str += "AND r.visibility=$public_visibility ";

	query_str += "RETURN COUNT(r) AS count";

	const {records, summary} =
	      await tx.run(query_str,
			   {contrib_id: id,
			    public_visibility: Visibility.PUBLIC},
			   {routing: 'READ', database: process.env.NEO4J_DB});
	await tx.commit();
	if (records.length <= 0){
	    // Error running query
	    return -1;
	}
	return parse64BitNumber(records[0].get('count'));
    } catch(err){console.log('getElementsCountByContributor() Error in query: '+ err);}
    finally {await session.close();}
    // something went wrong
    return -1;
}
/**
 * Get elements by tag
 * @param {string} tag Tag string for case-insensitive match
 * @param {int}    from For pagintion, get elements from this number
 * @param {int}    size For pagintion, get this number of elements
 * @param {Enum}   sort_by Enum for sorting the results. Default is by title
 * @param {Enum}   order Enum for order of sorting the results. Default is DESC
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
async function getElementsByTag(tag, from, size, sort_by=SortBy.TITLE, order="DESC"){
    try{
	const order_by = parseSortBy(sort_by);
	const query_str = "MATCH (n)-[:CONTRIBUTED]-(c) " +
	      "WHERE ANY ( tag IN n.tags WHERE toLower(tag) = toLower($tag_str) ) " +
	      "AND n.visibility=$public_visibility " +
	      "RETURN n{.id, .title, .contents, .tags, `thumbnail-image`:n.thumbnail_image, `resource-type`:TOLOWER(LABELS(n)[0]), .authors, created_at:TOSTRING(n.created_at), .click_count, contributor: {id:c.id, name:(c.first_name + ' ' + c.last_name), `avatar-url`:c.avatar_url} } " +
	      "ORDER BY n." + order_by + " " + order + " " +
	      "SKIP $from " +
	      "LIMIT $size";

	const {records, summary} =
	      await driver.executeQuery(query_str,
					{tag_str: tag,
					 from: neo4j.int(from),
					 size: neo4j.int(size),
					 public_visibility: Visibility.PUBLIC},
					{routing: 'READ', database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // No elements found with given tag
	    return [];
	}
	var ret = []
	for (record of records){
	    ret.push(makeFrontendCompatible(record['_fields'][0]));
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
	  "WHERE ANY ( tag IN n.tags WHERE toLower(tag) = toLower($tag_str) ) " +
	  "AND n.visibility=$public_visibility " +
	  "RETURN COUNT(n)";
    try{
	const {records, summary} =
	      await driver.executeQuery(query_str,
					{tag_str: tag,
					 public_visibility: Visibility.PUBLIC},
					{routing: 'READ', database: process.env.NEO4J_DB});
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
 * @deprecated Use getFeaturedElementsByType() instead
 * Get all featured elements.
 * @retrurn {Object[]} Array of featured objects. Empty array if no featrued elements found or error
 */
async function getFeaturedElements(){

    // Original query (should be used)
    // const query_str = "MATCH (n{featured:True})-[:CONTRIBUTED]-(r) " +
    // 	  "RETURN n{id: n.id, title:n.title, thumbnail_image:n.thumbnail_image, element_type:LABELS(n)[0], authors:[(r.first_name + ' ' + r.last_name)]}";

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
					{routing: 'READ', database: process.env.NEO4J_DB});
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
	    if (element_type == ElementType.OER || element_type == ElementType.MAP) {
		// since we have a limited number of OERs and Map elements at this point,
		// relax the connectivity check for featured elements for now
		return "MATCH(n:"+ element_type +") " +
		    "WHERE n.visibility=$public_visibility " +
		    "RETURN n{id: n.id, title:n.title, `thumbnail-image`:n.thumbnail_image, `resource-type`:TOLOWER(LABELS(n)[0]), contents:n.contents}, rand() as random ORDER BY random LIMIT $limit";
	    } else {
		return "MATCH(n:"+ element_type +")-[r:RELATED]-() WITH n, COUNT(r) as rel_count " +
		    "WHERE rel_count>=$rel_count " +
		    "AND n.visibility=$public_visibility " +
		    "RETURN n{id: n.id, title:n.title, `thumbnail-image`:n.thumbnail_image, `resource-type`:TOLOWER(LABELS(n)[0]), contents:n.contents}, rand() as random ORDER BY random LIMIT $limit";
	    }
	})();

	// "MATCH(n:"+ element_type +")-[r:RELATED]-() WITH n, COUNT(r) as rel_count " +
	// "WHERE rel_count>=$rel_count " +
	// "RETURN n{id: n.id, title:n.title, `thumbnail-image`:n.thumbnail_image, `resource-type`:TOLOWER(LABELS(n)[0]), contents:n.contents}, rand() as random ORDER BY random LIMIT $limit";

	const {records, summary} =
	      await driver.executeQuery(query_str,
					{rel_count:rel_count,
					 limit:neo4j.int(limit),
					 public_visibility: Visibility.PUBLIC},
					{routing: 'READ', database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // No featured elements found
	    return [];
	}
	var ret = []
	for (record of records){
	    element = record['_fields'][0];
	    ret.push(makeFrontendCompatible(element));
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
 * Check for duplicates for given field
 * @param {string} field name to check duplicates for
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
async function checkDuplicatesForField(field_name, value){

    var query_str = "";
    var query_params = {};
    if (field_name === 'doi') {
	query_str = "MATCH(p:Publication{external_link:$doi}) RETURN p.id";
	query_params['doi'] = value;
    } else {
	throw Error('Server Neo4j: Field `$field_name` not implemented for duplucate checking');
    }

    try {
	const {records, summary} =
	      await driver.executeQuery(query_str,
					query_params,
					{routing: 'READ', database: process.env.NEO4J_DB});
	if (records.length >= 1) {
	    const duplicate_element_id = records[0]['_fields'][0];
	    return {response: true, element_id: duplicate_element_id};
	}
	// no duplicates found
	return {response: false, element_id: null};
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return {response: false, element_id: null};
}

async function updateElement(id, element){

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
    finally {await session.close();}
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
	// if (related_elem['type'] == 'notebook'){
	//     query_match += "MATCH(to"+i+":Notebook{title:$title"+i+"}) ";
	// } else if (related_elem['type'] == 'dataset') {
	//     query_match += "MATCH(to"+i+":Dataset{title:$title"+i+"}) ";
	// } else if (related_elem['type'] == 'publication') {
	//     query_match += "MATCH(to"+i+":Publication{title:$title"+i+"}) ";
	// } else if (related_elem['type'] == 'oer') {
	//     query_match += "MATCH(to"+i+":Oer{title:$title"+i+"}) ";
	// }

	let element_type = parseElementType(related_elem['resource-type']);
	query_match += "MATCH(to"+i+":"+element_type+"{title:$title"+i+"}) ";

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
	'visibility': visibility,
	'external-link': external_link,                 // Dataset
	'direct-download-link': direct_download_link,   // Dataset
	'notebook-repo': notebook_repo,                 // Notebook
	'notebook-file': notebook_file,                 // Notebook
	size: size,                                     // Dataset
	'external-link-publication': external_link_pub, // Publication
	'oer-external-links': oer_external_links,       // OER
	'map-external-iframe-link': external_link_map,  // MAP
	...node
       } = element;

    node_type = parseElementType(node_type);
    node['thumbnail_image'] = thumbnail;
    node['visibility'] = parseVisibility(visibility);

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
    } else if (node_type == ElementType.MAP){
	node['external_iframe_link'] = external_link_map;
    } else {
	throw Error(`Backend Neo4j: elementToNode type ($node_type) not implemented`);
    }

    // key names from frontend use '-', convert all to '_'
    node = Object.fromEntries(
	Object.entries(node).map(([key, value]) =>
	    [`${key}`.replaceAll("-","_"), value]
	)
    );

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

    // (3) create relations based on related-elements
    query_match += contributorMatchQuery(contributor_id)+" "; //"MATCH(c:Contributor{id:$contrib_id}) ";
    // (4) create CONTRIBUTED_BY relation with contributor_id
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
	}

    } catch(err){
	if (err.code === 'Neo.ClientError.Schema.ConstraintValidationFailed') {
	    console.log('Error registering, duplicate element: '+ err);
	    // try getting information for the existing duplicate element
	    // Error Format: "Node(78) already exists with label `Publication` and property `external_link` = '...'"
	    const internal_id = err.message.match(/\d+/)[0];
	    try{
		const {records, _} =
		      await driver.executeQuery("MATCH(n) WHERE ID(n)=$duplicate_id RETURN n.id",
						{duplicate_id:neo4j.int(internal_id)},
						{database: process.env.NEO4J_DB});
		if (records.length >= 1){
		    return {response: false, element_id: records[0]['_fields'][0]};
		} else {
		    console.log('Error: Cannot get existing duplicate entry');
		}
	    } catch(err){console.log('Error in getting duplicate element info: '+ err);}
	} else {
	    console.log('Error in query while registering element: '+ err);
	}
    }
    // something went wrong
    return {response: false, element_id: null};
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
 * Set visibility for an element/resource given ID
 * @param {string} id
 * @param {Enum} visibility
 * @return {Object} true if deleted successfully, false otherwise
 */
async function setElementVisibilityForID(id, visibility){
    const query_str = "MATCH (n{id:$id_param}) " +
	  "SET n.visibility=$visibility";

    console.log(visibility);

    try {
	const {_, summary} =
	      await driver.executeQuery(query_str,
					{id_param: id, visibility:neo4j.int(visibility)},
					{database: process.env.NEO4J_DB});
	if (summary.counters.updates()['propertiesSet'] == 1){
	    return true;
	}
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return false;
}

/**
 * Get visibility for an element/resource given ID
 * @param {string} id
 * @return {Enum} Visibility value
 */
async function getElementVisibilityForID(id){
    const query_str = "MATCH (n{id:$id_param}) " +
	  "RETURN n.visibility";

    try {
	const {records, _} =
	      await driver.executeQuery(query_str,
					{id_param: id},
					{routing: 'READ', database: process.env.NEO4J_DB});
	if (records.length < 0){
	    console.log('Error: Element with id ' + id + ' not found');
	    return -1;
	}
	const visibility = parseVisibility(parse64BitNumber(records[0]['_fields'][0]));
	return visibility;
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return -1;
}
/****************************************************************************
 * Contributor/User Functions
 ****************************************************************************/

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
	if ((contributor['email'] && contributor['email'].endsWith('edu')) ||
	    (contributor['idp_name'] && contributor['idp_name'].toLowerCase().includes('university'))
	   ) {
	    return neo4j.int(Role.TRUSTED_USER);
	}
	// default role
	return neo4j.int(Role.UNTRUSTED_USER);
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
			      {routing: 'READ', database: process.env.NEO4J_DB});
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
					{routing: 'READ', database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // Query returned no match for given ID
	    return {};
	} else if (records.length > 1){
	    // should never reach here since ID is unique
	    throw Error("Server Neo4j: ID should be unique, query returned multiple results for given ID:" + id);
	}
	const contributor = records[0]['_fields'][0];
	contributor['role'] = parse64BitNumber(contributor['role']);

	return makeFrontendCompatible(contributor);
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
					{routing: 'READ', database: process.env.NEO4J_DB});
	const resp = records[0]['_fields'][0];
	return resp;
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return false;
}

/**
 * Set contrib ID for the element
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

/****************************************************************************
 * Documentation Functions
 ****************************************************************************/

/**
 * Register new documentation
 * @param {Object} documentation Map with new documentation attributes (name, content)
 * @return {Boolean, String} {true, documentation_id} on success OR {false, ''} on failure.
 */
async function registerDocumentation(documentation){
    // documentation ID will be used in URLs, so instead of random numbers, create readable id
    const name_id = documentation['name'].replace(/[^a-z0-9.]/gi, '-').toLowerCase();
    documentation['id'] = name_id; //uuidv4();

    const query_str = "CREATE (d: Documentation $doc_param)";
    try{
	const {_, summary} =
	      await driver.executeQuery(query_str,
					{doc_param: documentation},
					{database: process.env.NEO4J_DB});
	if (summary.counters.updates()['nodesCreated'] == 1){
	    return {response:true, documentation_id:documentation['id']};
	}
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return {response:false, documentation_id:''};
}

/**
 * Get documentation by ID without any related information
 * @param {string} id
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
async function getDocumentationByID(id) {
    const query_str = "MATCH (d:Documentation{id:$id}) RETURN d{.*} ";
    try {
	const {records, summary} =
	      await driver.executeQuery(query_str,
					{id: id},
					{database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // Query returned no match for given ID
	    return {};
	} else if (records.length > 1){
	    // should never reach here since ID is unique
	    console.warn(`Server Neo4j: ID should be unique, query returned multiple results for given ID: $id`);
	    //throw Error("Server Neo4j: ID should be unique, query returned multiple results for given ID:" + id);
	}
	const documentation = records[0]['_fields'][0];
	return documentation;
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return {};
}
/**
 * Get all documentation
 * @param {int}     from For pagintion, get documentation from this number
 * @param {int}     size For pagintion, get this number of documents
 * @return {Object} List of Map of document objects. Empty list if not found or error
 */
async function getAllDocumentation(from, size) {
    const query_str = "MATCH (d:Documentation) RETURN d{.*} ORDER BY d.id SKIP $from LIMIT $size";
    try {
	const {records, summary} =
	      await driver.executeQuery(query_str,
					{from: neo4j.int(from), size: neo4j.int(size)},
					{database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // Query returned no Documentation
	    return [];
	}
	var ret = []
	for (record of records){
	    ret.push(record['_fields'][0]);
	}
	return ret;
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return [];
}

/**
 * Update existing documentation
 * @param {string} id Documentation id
 * @param {Object} documentation Map with new documentation attributes (name, content)
 * @return {Boolean} true for successful registration. false otherwise or in case of error
 */
async function updateDocumentation(id, documentation_attributes) {
    const query_match = "MATCH (d:Documentation{id:$id}) ";
    var query_set = "";
    var query_params = {id: id};

    let i=0;
    for (const [key, value] of Object.entries(documentation_attributes)) {
	query_set += "SET d." + key + "=$attr" + i + " ";
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
 * Delete a documentation given ID
 * @param {string} id
 * @return {Object} true if deleted successfully, false otherwise
 */
async function deleteDocumentationByID(id){
    const query_str = "MATCH (d:Documentation{id:$id_param}) DETACH DELETE d";
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

exports.updateElement = updateElement;
exports.getElementByID = getElementByID;
exports.registerElement = registerElement;
exports.getElementsByTag = getElementsByTag;
exports.deleteElementByID = deleteElementByID;
exports.getElementsByType = getElementsByType;
exports.getFeaturedElements = getFeaturedElements;
exports.getElementsCountByTag = getElementsCountByTag;
exports.getElementsCountByType = getElementsCountByType;
exports.setElementFeaturedForID = setElementFeaturedForID;
exports.getRelatedElementsForID = getRelatedElementsForID;
exports.getElementsByContributor = getElementsByContributor;
exports.getFeaturedElementsByType = getFeaturedElementsByType;
exports.setElementVisibilityForID = setElementVisibilityForID;
exports.getElementVisibilityForID = getElementVisibilityForID;

exports.getAllRelatedElements = getAllRelatedElements
exports.checkDuplicatesForField = checkDuplicatesForField

exports.updateContributor = updateContributor;
exports.getContributorByID = getContributorByID;
exports.registerContributor = registerContributor;
exports.setContributorAvatar = setContributorAvatar;
exports.checkContributorByID = checkContributorByID;
exports.getContributorIdForElement = getContributorIdForElement;
exports.getElementsCountByContributor = getElementsCountByContributor;

exports.getAllDocumentation = getAllDocumentation;
exports.updateDocumentation = updateDocumentation;
exports.getDocumentationByID = getDocumentationByID;
exports.registerDocumentation = registerDocumentation;
exports.deleteDocumentationByID = deleteDocumentationByID;

exports.testServerConnection = testServerConnection;

//exports.getContributorProfileByID = getContributorProfileByID;
//exports.createLinkNotebook2Dataset = createLinkNotebook2Dataset;
