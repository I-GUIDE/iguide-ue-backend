/**
 * Dependencies
 * - npm i neo4j-driver
 * - npm install uuid
 */
import neo4j from 'neo4j-driver';
import { v4 as uuidv4 } from 'uuid';
// local imports
import * as utils from './utils.js';

// For deployment on JetStream VM
import dotenv from 'dotenv';
import {checkUniversityDomain} from "./routes/domain_utils.js";
dotenv.config();
console.log(process.env.NEO4J_CONNECTION_STRING);

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
export async function testServerConnection() {
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
	    // if (k1 === 'created_at' || k1 === 'updated_at')
	    // 	return [k1.replaceAll("_","-"), v1];
	    if (k1 === 'thumbnail_image') {
		return [k1.replaceAll("_","-"), utils.generateMultipleResolutionImagesFor(v1)];
	    } else if (k1 === 'avatar_url') {
		return [k1.replaceAll("_","-"),
			utils.generateMultipleResolutionImagesFor(v1, null, true)];
	    } else if (k1 === 'click_count') {
		return [k1.replaceAll("_","-"), utils.parse64BitNumber(v1)];
	    } else if (k1 === 'updated_at') {
		return [k1.replaceAll("_","-"), utils.parseDate(v1)];
	    }

	    if (typeof v1 === 'object' && v1 !== null && !Array.isArray(v1)) {
		v1 = replaceUnderscores(v1);
	    } else if (Array.isArray(v1) && typeof v1[0] === 'object'){
		let a = [];
		for (let v of v1){
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
    // if (ret['visibility'])
    // 	ret['visibility'] = parse64BitNumber(ret['visibility']);
    // if (ret['click-count']){
    // 	ret['click-count'] = utils.parse64BitNumber(ret['click-count']);
    // }
    // handle datetime values for created_at and updated_at properties
    //ret['created-at'] = parseDate(ret['created-at']);
    // if (ret['updated-at']){
    // 	ret['updated-at'] = utils.parseDate(ret['updated-at']);
    // }
    // convert thumbnail
    // if (ret['thumbnail-image']){
    // 	const image_urls = utils.generateMultipleResolutionImagesFor(ret['thumbnail-image']);
    // 	ret['thumbnail-image'] = image_urls;
    // }
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

/********************************/
/**
 * Get single element by given ID with all related content
 * @param {string} id Element ID
 * @param {string} user_id ID of user making this request (Logged-In user)
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
export async function getElementByID(id, user_id=null, user_role=null){

    // [Update-2.0] Frontend expects all related elements in a single list
    // [Fixed] Fixes the bug where nothing is returned in case element does not have any relations
    let query_str = "MATCH (c)-[:CONTRIBUTED]-(n{id:$id_param}) ";
    // if user is not logged in, make sure this element is public
    if (user_id == null)
	query_str += "WHERE n.visibility=$public_visibility ";

    query_str += "OPTIONAL MATCH (n)-[:RELATED]-(r) ";
    // if user is not logged in, make sure all related elements are public
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
			   {id_param: id, public_visibility: utils.Visibility.PUBLIC},
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
	const this_element_type = utils.parseElementType(result['resource-type']);
	await tx.run("MATCH(n:"+this_element_type+"{id:$id_param}) WITH n, CASE n.click_count WHEN IS NULL THEN 0 ELSE n.click_count END AS click_count SET n.click_count = click_count+1" ,
		     {id_param: id},
		     {database: process.env.NEO4J_DB});

	await tx.commit();

	// related elements can belong to different contributors with varying visibilities
	// show only public related elements or related elements owned by this user
	this_elem['related_elements'] = [];
	for (let elem of related_elements){
	    if (elem['id'] == null ||
		elem['resource-type'] == null ||
		elem['visibility'] == null) continue;

	    //elem['visibility'] = parse64BitNumber(elem['visibility']);
	    const can_view = await utils.userCanViewElement(elem['id'], user_id, user_role);
	    if (can_view){
		this_elem['related_elements'].push(elem);
	    }
	}

	//console.log('Testing ...' + this_elem['resource-type']);
	//const this_element_type = parseElementType(this_elem['resource-type']);

	// External links for OERs
	if (this_element_type == utils.ElementType.OER){
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
	} else if (this_element_type == utils.ElementType.PUBLICATION) {
	    // External link for Publication
	    //console.log('Fixing external link for publication');
	    var {'external_link': external_doi_link, ...ret} = this_elem;
	    ret['external-link-publication'] = external_doi_link;
	} else if (this_element_type == utils.ElementType.MAP) {
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
    } catch(err){
	console.log('getElementByID() - Error in query: '+ err);
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
export async function getRelatedElementsForID(id, depth=2){
    const query_str = "MATCH(n{id:$id_param}) " +
	  "WHERE n.visibility=$public_visibility " +
	  "OPTIONAL MATCH (n)-[rt2:RELATED*0.."+depth+"]-(r2) " +
	  "WHERE r2.visibility=$public_visibility " +
	  "UNWIND rt2 as related " +
	  "RETURN {nodes: COLLECT(DISTINCT(r2{.id, .title, .thumbnail_image, `resource-type`:TOLOWER(LABELS(r2)[0])})), neighbors: COLLECT(DISTINCT({src:startNode(related).id, dst:endNode(related).id}))}";
    try{
	const {records, summary} =
	      await driver.executeQuery(query_str,
					{id_param: id,
					 public_visibility: utils.Visibility.PUBLIC},
					{routing: 'READ', database: process.env.NEO4J_DB});
	//console.log(records);
	if (records.length <= 0){
	    // No related elements found for the given ID
	    return {};
	}
	// [BUG] This is the only case where 'thumbnail-image' is nested and not
	// properly handled for frontent. Doing it manually here but can introduce
	// bugs in future
	let related_elements = records[0]['_fields'][0];
	for (let node of related_elements['nodes'] ) {
	    if (node['thumbnail-image']) {
		node['thumbnail-image'] =
	    	    utils.generateMultipleResolutionImagesFor(node['thumbnail_image']);
		delete node['thumbnail_image'];
	    }
	}
	return related_elements;
	//return makeFrontendCompatible(records[0]['_fields'][0]);
    } catch(err){console.log('getRelatedElementsForID() Error in query: '+ err);}
    // something went wrong
    return {};
}
/**
 * Get related elements for a given element ID
 * @param {string} id
 * @param {int} depth Depth of related elements e.g. 2 depth would mean related of related
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
export async function getAllRelatedElements(){
    const query_str = "MATCH(n)-[rt:RELATED]-(r) " +
	  "WHERE n.visibility=$public_visibility AND r.visibility=$public_visibility " +
	  "UNWIND [n, r] as cn " +
	  "RETURN {nodes: COLLECT(DISTINCT(cn{.id, .title, .thumbnail_image, `resource-type`:TOLOWER(LABELS(cn)[0])})), neighbors: COLLECT(DISTINCT({src:startNode(rt).id, dst:endNode(rt).id}))}";
    try{
	const {records, summary} =
	      await driver.executeQuery(query_str,
					{public_visibility: utils.Visibility.PUBLIC},
					{routing: 'READ', database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // No related elements found
	    return {};
	}
	// [BUG] This is the only case where 'thumbnail-image' is nested and not
	// properly handled for frontent. Doing it manually here but can introduce
	// bugs in future
	let related_elements = records[0]['_fields'][0];
	for (let node of related_elements['nodes'] ) {
	    if (node['thumbnail_image']) {
		node['thumbnail-image'] =
	    	    utils.generateMultipleResolutionImagesFor(node['thumbnail_image']);
		delete node['thumbnail_image'];
	    }
	}
	return related_elements;
	//return makeFrontendCompatible(records[0]['_fields'][0]);
    } catch(err){console.log('getAllRelatedElements() Error in query: '+ err);}
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
export async function getElementsByType(type,
					from,
					size,
					sort_by=utils.SortBy.TITLE,
					order="DESC",
					count_only=false){
    // Only called to show elements on main page filtered by type
    // Note: Private elements will never show up on main pages even for the owner
    // Owner will be able to access them in his/her own profile
    const session = driver.session({database: process.env.NEO4J_DB});
    const tx = await session.beginTransaction();
    try{
	const node_type = utils.parseElementType(type);
	let query_str = "MATCH (n:" + node_type + ")-[:CONTRIBUTED]-(c) " +
	    "WHERE n.visibility=$public_visibility ";

	let count_query_str = query_str;
	var ret = [];
	if (!count_only) {
	    const order_by = utils.parseSortBy(sort_by);
	    query_str += "RETURN n{.id, .title, .contents, .tags, .thumbnail_image, `resource-type`:TOLOWER(LABELS(n)[0]), .authors, created_at:TOSTRING(n.created_at), .click_count, contributor: c{.id, .avatar_url, name:(c.first_name + ' ' + c.last_name)}} " +
	    "ORDER BY n." + order_by + " " + order + ", n.id " + order + " " +
	    "SKIP $from " +
	    "LIMIT $size";

	    const {records, summary} = await tx.run(query_str,
						    {from: neo4j.int(from),
						     size: neo4j.int(size),
						     public_visibility: utils.Visibility.PUBLIC},
						    {routing: 'READ', database: process.env.NEO4J_DB});
	    for (let record of records){
		ret.push(makeFrontendCompatible(record.get('n')));
	    }
	}

	count_query_str += "RETURN COUNT(n) AS count";
	const {records, summary} = await tx.run(count_query_str,
						{public_visibility: utils.Visibility.PUBLIC},
						{routing: 'READ', database: process.env.NEO4J_DB});

	await tx.commit();
	return {elements: ret,
		'total-count':utils.parse64BitNumber(records[0].get('count'))};
    } catch(err){console.log('getElementsByType() - Error in query: '+ err);}
    // something went wrong
    return {elements:[], 'total-count':-1};
}
/**
 * Get elements count by given type
 * @param {string} type
 * @return {int} Intger count of given element type. -1 in case of error
 */
export async function getElementsCountByType(type){

    const response = await getElementsByType(type,
					     null,
					     null,
					     null,
					     null,
					     true);
    return response['total-count'];
    // try{
    // 	const node_type = utils.parseElementType(type);
    // 	const query_str = "MATCH (n:"+ node_type +") " +
    // 	      "WHERE n.visibility=$public_visibility " +
    // 	      "RETURN COUNT(n) AS count";

    // 	const {records, summary} =
    // 	      await driver.executeQuery(query_str,
    // 					{public_visibility: utils.Visibility.PUBLIC},
    // 					{routing: 'READ', database: process.env.NEO4J_DB});
    // 	if (records.length <= 0){
    // 	    // Error running query
    // 	    return -1;
    // 	}
    // 	return utils.parse64BitNumber(records[0].get('count'));
    // } catch(err){console.log('getElementsCountByType() - Error in query: '+ err);}
    // // something went wrong
    // return -1;
}

/**
 * Get elements bookmarked by contributor (including those from other contributors)
 * @param {string}  id ID of the contributor
 * @param {string}  user_id ID of logged-in user
 * @param {int}     from For pagintion, get elements from this number
 * @param {int}     size For pagintion, get this number of elements
 * @param {Enum}    sort_by Enum for sorting the results. Default is by title
 * @param {Enum}    order Enum for order of sorting the results. Default is DESC
 * @param {boolean} private_only Only return private elements contributed by the user
 * @param {boolean} count_only Only return elements count contributed by the user
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
export async function getElementsBookmarkedByContributor(id,
							 from,
							 size,
							 sort_by=utils.SortBy.TITLE,
							 order="DESC",
							 private_only=false,
							 count_only=false
				       			){
    const session = driver.session({database: process.env.NEO4J_DB});
    const tx = await session.beginTransaction();

    try{
	let query_params = {contrib_id: id};
	let query_str = "MATCH (c:Contributor)-[:CONTRIBUTED]-(r)-[:BOOKMARKED]-(u:Contributor) " +
	    "WHERE (u.id=$contrib_id OR $contrib_id IN u.openid) ";

	if (private_only){
	    query_str += "AND r.visibility=$visibility ";
	    query_params['visibility'] = utils.Visibility.PRIVATE;
	}
	else {
	    query_str += "AND r.visibility=$visibility ";
	    query_params['visibility'] = utils.Visibility.PUBLIC;
	}

	let count_query_str = query_str;
	var ret = [];
	if (!count_only) {
	    // add paginated query to get elements with limit to the transaction
	    const order_by = utils.parseSortBy(sort_by);
	    query_params['from'] = neo4j.int(from);
	    query_params['size'] = neo4j.int(size);

	    query_str += "RETURN r{.id, .tags, .title, .contents, .authors, .click_count, .visibility, `resource-type`:TOLOWER(LABELS(r)[0]), .thumbnail_image, created_at:TOSTRING(r.created_at), contributor: c{.id, .avatar_url, name:(c.first_name + ' ' + c.last_name) }} AS element " +
		"ORDER BY r." + order_by + " " + order + " " +
		"SKIP $from " +
		"LIMIT $size";

	    const {records, summary} = await tx.run(query_str,
						    query_params,
						    {routing: 'READ',
						     database: process.env.NEO4J_DB}
						   );
	    for (let record of records){
		ret.push(makeFrontendCompatible(record.get('element')));
	    }
	}

	count_query_str += "RETURN COUNT(r) AS count";
	const {records, summary} = await tx.run(count_query_str,
						query_params,
						{routing: 'READ', database: process.env.NEO4J_DB});

	await tx.commit();
	return {elements: ret,
		'total-count':utils.parse64BitNumber(records[0].get('count'))};
    } catch(err){console.log('getElementsBookmarkedByContributor() - Error in query: '+ err);}
    finally {await session.close();}
    // something went wrong
    return {elements:[], 'total-count':-1};
}

/**
 * Get elements by contributor
 * @param {string}  id ID of the contributor
 * @param {string}  user_id ID of logged-in user
 * @param {int}     from For pagintion, get elements from this number
 * @param {int}     size For pagintion, get this number of elements
 * @param {Enum}    sort_by Enum for sorting the results. Default is by title
 * @param {Enum}    order Enum for order of sorting the results. Default is DESC
 * @param {boolean} private_only Only return private elements contributed by the user
 * @param {boolean} count_only Only return elements count contributed by the user
 * @return {Object} List of element objects contributed by the contributor with given ID.
 */
export async function getElementsByContributor(id,
					       from,
					       size,
					       sort_by=utils.SortBy.TITLE,
					       order="DESC",
					       private_only=false,
					       count_only=false
				       	      ){

    // There are two cases where this function is called
    // (1) For showing up elements on user profile page. This should return all public and private
    // (2) A user clicks on another user's profile. This should only return public elements

    const session = driver.session({database: process.env.NEO4J_DB});
    const tx = await session.beginTransaction();

    try{
	let query_params = {contrib_id: id};

	let query_str = "MATCH (c:Contributor)-[:CONTRIBUTED]-(r) " +
	    "WHERE (c.id=$contrib_id OR $contrib_id IN c.openid) ";

	if (private_only){
	    query_str += "AND r.visibility=$visibility ";
	    query_params['visibility'] = utils.Visibility.PRIVATE;
	}
	else {
	    query_str += "AND r.visibility=$visibility ";
	    query_params['visibility'] = utils.Visibility.PUBLIC;
	}

	let count_query_str = query_str;
	var ret = [];
	if (!count_only) {
	    // add paginated query to get elements with limit to the transaction
	    const order_by = utils.parseSortBy(sort_by);
	    query_params['from'] = neo4j.int(from);
	    query_params['size'] = neo4j.int(size);

	    query_str += "RETURN r{.id, .tags, .title, .contents, .authors, .click_count, .visibility, `resource-type`:TOLOWER(LABELS(r)[0]), .thumbnail_image, created_at:TOSTRING(r.created_at), contributor: c{.id, .avatar_url, name:(c.first_name + ' ' + c.last_name) }} AS element " +
		"ORDER BY r." + order_by + " " + order + " " +
		"SKIP $from " +
		"LIMIT $size";

	    const {records, summary} = await tx.run(query_str,
						    query_params,
						    {routing: 'READ',
						     database: process.env.NEO4J_DB}
						   );
	    for (let record of records){
		ret.push(makeFrontendCompatible(record.get('element')));
	    }
	}

	count_query_str += "RETURN COUNT(r) AS count";
	const {records, summary} = await tx.run(count_query_str,
						query_params,
						{routing: 'READ', database: process.env.NEO4J_DB});

	await tx.commit();
	return {elements: ret,
		'total-count':utils.parse64BitNumber(records[0].get('count'))};
    } catch(err){console.log('getElementsByContributor() - Error in query: '+ err);}
    finally {await session.close();}
    // something went wrong
    return {elements:[], 'total-count':-1};
}
/**
 * Get elements count by contributor
 * @param {string} id ID of the contributor
 * @param {string} user_id ID of logged-in user
 * @return {int} Count
 */
export async function getElementsCountByContributor(id, private_only=false){
    const response = await getElementsByContributor(id,
						    undefined,
						    undefined,
						    undefined,
						    undefined,
						    private_only,
						    true
						   );
    return response['total-count'];
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
export async function getElementsByTag(tag, from, size, sort_by=utils.SortBy.TITLE, order="DESC"){
    try{
	const order_by = utils.parseSortBy(sort_by);
	const query_str = "MATCH (n)-[:CONTRIBUTED]-(c) " +
	      "WHERE ANY ( tag IN n.tags WHERE toLower(tag) = toLower($tag_str) ) " +
	      "AND n.visibility=$public_visibility " +
	      "RETURN n{.id, .title, .contents, .tags, `thumbnail-image`:n.thumbnail_image, `resource-type`:TOLOWER(LABELS(n)[0]), .authors, created_at:TOSTRING(n.created_at), .click_count, contributor: c{.id, name:(c.first_name + ' ' + c.last_name), .avatar_url} } " +
	      "ORDER BY n." + order_by + " " + order + " " +
	      "SKIP $from " +
	      "LIMIT $size";

	const {records, summary} =
	      await driver.executeQuery(query_str,
					{tag_str: tag,
					 from: neo4j.int(from),
					 size: neo4j.int(size),
					 public_visibility: utils.Visibility.PUBLIC},
					{routing: 'READ', database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // No elements found with given tag
	    return [];
	}
	var ret = []
	for (let record of records){
	    ret.push(makeFrontendCompatible(record['_fields'][0]));
	}
	return ret;
    } catch(err){console.log('getElementsByTag() - Error in query: '+ err);}
    // something went wrong
    return [];
}
/**
 * Get elements count by contributor
 * @param {string} tag Tag to search for case-insensitive match
 * @return {int} Count
 */
export async function getElementsCountByTag(tag){
    const query_str = "MATCH (n) " +
	  "WHERE ANY ( tag IN n.tags WHERE toLower(tag) = toLower($tag_str) ) " +
	  "AND n.visibility=$public_visibility " +
	  "RETURN COUNT(n)";
    try{
	const {records, summary} =
	      await driver.executeQuery(query_str,
					{tag_str: tag,
					 public_visibility: utils.Visibility.PUBLIC},
					{routing: 'READ', database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // Error running query
	    return -1;
	}
	var ret = records[0]['_fields'][0]['low'];
	return ret;
    } catch(err){console.log('getElementsCountByTag() - Error in query: '+ err);}
    // something went wrong
    return -1;
}
/**
 * @deprecated Use getFeaturedElementsByType() instead
 * Get all featured elements.
 * @retrurn {Object[]} Array of featured objects. Empty array if no featrued elements found or error
 */
export async function getFeaturedElements(){

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
	// for (let record of records){
	//     element = record['_fields'][0];
	//     element['resource-type'] = element['resource-type'].toLowerCase();
	//     ret.push(element);
	// }
	// return ret;
	return records[0]['_fields'][0];
    } catch(err){console.log('getFeaturedElements() - Error in query: '+ err);}
    // something went wrong
    return [];
}
/**
 * Get all featured elements.
 * @retrurn {Object[]} Array of featured objects. Empty array if no featrued elements found or error
 */
export async function getFeaturedElementsByType(type, limit){

    try{
	const element_type = utils.parseElementType(type);
	const rel_count = (() => {
	    if (element_type == utils.ElementType.OER) return 0;
	    else if (element_type == utils.ElementType.PUBLICATION) return 1;
	    else return 2;
	})();

	const query_str = (() => {
	    if (element_type == utils.ElementType.OER || element_type == utils.ElementType.MAP) {
		// since we have a limited number of OERs and Map elements at this point,
		// relax the connectivity check for featured elements for now
		return "MATCH(n:"+ element_type +") " +
		    "WHERE n.visibility=$public_visibility " +
		    "RETURN n{.id, .title, .thumbnail_image, `resource-type`:TOLOWER(LABELS(n)[0]), contents:n.contents}, rand() as random ORDER BY random LIMIT $limit";
	    } else {
		return "MATCH(n:"+ element_type +")-[r:RELATED]-() WITH n, COUNT(r) as rel_count " +
		    "WHERE rel_count>=$rel_count " +
		    "AND n.visibility=$public_visibility " +
		    "RETURN n{.id, .title, .thumbnail_image, `resource-type`:TOLOWER(LABELS(n)[0]), contents:n.contents}, rand() as random ORDER BY random LIMIT $limit";
	    }
	})();

	// "MATCH(n:"+ element_type +")-[r:RELATED]-() WITH n, COUNT(r) as rel_count " +
	// "WHERE rel_count>=$rel_count " +
	// "RETURN n{id: n.id, title:n.title, `thumbnail-image`:n.thumbnail_image, `resource-type`:TOLOWER(LABELS(n)[0]), contents:n.contents}, rand() as random ORDER BY random LIMIT $limit";

	const {records, summary} =
	      await driver.executeQuery(query_str,
					{rel_count:rel_count,
					 limit:neo4j.int(limit),
					 public_visibility: utils.Visibility.PUBLIC},
					{routing: 'READ', database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    // No featured elements found
	    return [];
	}
	var ret = []
	for (let record of records){
	    ret.push(makeFrontendCompatible(record.get('n')));
	}
	return {elements: ret};
    } catch(err){console.log('getFeaturedElementsByType() - Error in query: '+ err);}
    // something went wrong
    return [];
}
/**
 * Set element as featured given ID
 * @param {string} id
 * @return {Boolean} true for success. false if ID not found or other query errors
 */
export async function setElementFeaturedForID(id){
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
    } catch(err){console.log('setElementFeaturedForID() - Error in query: '+ err);}
    // something went wrong
    return false;
}

/**
 * Check for duplicates for given field
 * @param {string} field name to check duplicates for
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
export async function checkDuplicatesForField(field_name, value){

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
    } catch(err){console.log('checkDuplicatesForField() - Error in query: '+ err);}
    // something went wrong
    return {response: false, element_id: null};
}

export async function updateElement(id, element){

    const session = driver.session({database: process.env.NEO4J_DB});
    const tx = await session.beginTransaction();

    try{
	const {node, node_type, related_elements} =
	      await elementToNode(element, false);

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
    } catch(err){console.log('updateElement() - Error in query: '+ err);}
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
export async function generateQueryStringForRelatedElements(related_elements){
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

	let element_type = utils.parseElementType(related_elem['resource-type']);
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
	//'visibility': visibility,
	'external-link': external_link,                 // Dataset
	'direct-download-link': direct_download_link,   // Dataset
	'notebook-repo': notebook_repo,                 // Notebook
	'notebook-file': notebook_file,                 // Notebook
	size: size,                                     // Dataset
	'external-link-publication': external_link_pub, // Publication
	'oer-external-links': oer_external_links,       // OER
	'map-external-iframe-link': external_link_map,  // MAP
	'github-repo-link': github_repo_link,           // Code
	'github-repo-readme': github_repo_readme,       // Code
	...node
       } = element;

    node_type = utils.parseElementType(node_type);
    node['thumbnail_image'] = thumbnail['original'];
    //node['visibility'] = parseVisibility(visibility);

    // (1) generate id (UUID)
    if (generate_id) node['id'] = uuidv4();
    // (2) insert element as a new node with id and other fields
    if (node_type == utils.ElementType.NOTEBOOK){
	node['notebook_repo'] = notebook_repo;
	node['notebook_file'] = notebook_file;
    } else if (node_type == utils.ElementType.DATASET){
	node['external_link'] = external_link;
	node['direct_download_link'] = direct_download_link;
	node['size'] = size;
    } else if (node_type == utils.ElementType.PUBLICATION){
	node['external_link'] = external_link_pub;
    } else if (node_type == utils.ElementType.OER){
	node['oer_elink_titles'] = [];
	node['oer_elink_urls'] = [];
	node['oer_elink_types'] = [];

	if (oer_external_links) {
	    for (let elink of oer_external_links){
		node['oer_elink_titles'].push(elink['title']);
		node['oer_elink_urls'].push(elink['url']);
		node['oer_elink_types'].push(elink['type']);
	    }
	}
    } else if (node_type == utils.ElementType.MAP){
	node['external_iframe_link'] = external_link_map;
    } else if (node_type == utils.ElementType.CODE){
	node['github_repo_link'] = github_repo_link;
	node['github_repo_readme'] = github_repo_readme;
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
export async function registerElement(contributor_id, element){

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
export async function deleteElementByID(id){
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
    } catch(err){console.log('deleteElementByID() - Error in query: '+ err);}
    // something went wrong
    return false;
}

/**
 * Set visibility for an element/resource given ID
 * @param {string} id
 * @param {Enum} visibility
 * @return {Object} true if deleted successfully, false otherwise
 */
export async function setElementVisibilityForID(id, visibility){
    const query_str = "MATCH (n{id:$id_param}) " +
	  "SET n.visibility=$visibility";

    //console.log(visibility);

    try {
	const {_, summary} =
	      await driver.executeQuery(query_str,
					{id_param: id, visibility:visibility},
					{database: process.env.NEO4J_DB});
	if (summary.counters.updates()['propertiesSet'] == 1){
	    return true;
	}
    } catch(err){console.log('setElementVisibilityForID() - Error in query: '+ err);}
    // something went wrong
    return false;
}

/**
 * Get visibility for an element/resource given ID
 * @param {string} id
 * @return {Enum} Visibility value
 */
export async function getElementVisibilityForID(id){
    const query_str = "MATCH (n{id:$id_param}) " +
	  "RETURN n.visibility AS visibility";

    try {
	const {records, _} =
	      await driver.executeQuery(query_str,
					{id_param: id},
					{routing: 'READ', database: process.env.NEO4J_DB});
	if (records.length <= 0){
	    console.log('Error: Element with id ' + id + ' not found');
	    return -1;
	}
	//const visibility = parseVisibility(parse64BitNumber(records[0]['_fields'][0]));
	return records[0].get('visibility');
    } catch(err){console.log('getElementVisibilityForID() - Error in query: '+ err);}
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
export async function registerContributor(contributor){

    // (1) generate id (UUID).
    contributor['id'] = uuidv4();

    // (2) assign roles for new contributor
    contributor['role'] = (() => {
		let contributor_domain = contributor['email'] && contributor['email'].substring(contributor['email'].lastIndexOf("@"));
		if ((contributor['email'] && contributor_domain && checkUniversityDomain(contributor_domain)) ||
	    	(contributor['idp_name'] && contributor['idp_name'].toLowerCase().includes('university'))
	   	) {
	    	return neo4j.int(utils.Role.TRUSTED_USER);
		}
		// default role
		return neo4j.int(utils.Role.UNTRUSTED_USER);
    })();
    // (3) get avatar URL
    //contributor['avatar_url'] = contributor['avatar_url']['original'];
    const query_str = "CREATE (c: Contributor $contr_param)";
    try{
	const {_, summary} =
	      await driver.executeQuery(query_str,
					{contr_param: contributor},
					{database: process.env.NEO4J_DB});
	if (summary.counters.updates()['nodesCreated'] == 1){
	    return true;
	}
    } catch(err){console.log('registerContributor() - Error in query: '+ err);}
    // something went wrong
    return false;
}
/**
 * Update existing contributor
 * @param {string} id Contributor id
 * @param {Object} contributor Map with new contributor attributes (refer to schema)
 * @return {Boolean} true for successful registration. false otherwise or in case of error
 */
export async function updateContributor(id, contributor_attributes){
    const query_match = contributorMatchQuery(id) + " ";
    var query_set = "";
    var query_params = {contrib_id: id};

    let i=0;
    for (const [key, value] of Object.entries(contributor_attributes)) {
	query_set += "SET c." + key + "=$attr" + i + " ";
	if (key === 'avatar_url') {
	    query_params['attr' + i] = value['original'];
	} else {
	    query_params['attr' + i] = value;
	}
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
    } catch(err){console.log('updateContributor() - Error in query: '+ err);}
    // something went wrong
    return false;
}
/**
 * Set contributor avatar given ID
 * @param {string} id
 * @param {string} avatar_url
 * @return {Boolean} True if avatar set successfully. False if contributor not found
 */
export async function setContributorAvatar(id, avatar_url){

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
    } catch(err){console.log('setContributorAvatar() - Error in query: '+ err);}
    finally {await session.close();}

    return {result: ret, old_avatar_url:old_url};
}

/**
 * Get contributor by ID without any related information
 * @param {string} id
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
export async function getContributorByID(id){
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
	contributor['role'] = utils.parse64BitNumber(contributor['role']);

	return makeFrontendCompatible(contributor);
    } catch(err){console.log('getContributorByID() - Error in query: '+ err);}
    // something went wrong
    return {};
}

/**
 * Get all Contributors with all information
 * @returns {Object} Map of objects with serial Ids. If no users found returns empty
 */
export async function getAllContributors(){
	const query_str = "MATCH (c:Contributor) return c{.*}";
	try {
		const {records, summary} =
			await driver.executeQuery(query_str,
				{},
				{routing: 'READ', database: process.env.NEO4J_DB})
		if (records?.length <= 0) {
			return {};
		}
		let contributor_list = [];
		records?.map((contributor) => {
			if (contributor['_fields']?.length > 0) {
				let temp_contributor = contributor['_fields'][0]
				temp_contributor['role'] = utils.parse64BitNumber(temp_contributor['role']);
				contributor_list.push(temp_contributor);
			}
		});
		return makeFrontendCompatible(contributor_list)

	} catch (err) {
		console.log('getAllContributors() - Error in query: ' + err);
	}
	return {};
}

/**
 * Update the given user id's role with the updated_role
 * @param id
 * @param updated_role
 * @returns {Promise<boolean>}
 */
export async function updateRoleById(id, updated_role) {
	let query_str = "MATCH (c:Contributor{id: $id}) SET c.role = $role";
	let query_params = {id: id, role: neo4j.int(updated_role)};
	try {
		const {records, summary} =
			await driver.executeQuery(query_str,
					query_params,
				{routing: 'WRITE', database: process.env.NEO4J_DB});
		if (summary.counters.updates()['propertiesSet'] === 1){
	    	return true;
		} else {
			console.error('UpdateRoleById() - Updated multiple records');
			return false;
		}
	} catch (error) {
		console.log('updateRoleById() - Error in query: ' + error);
		return false;
	}

}
/**
 * Check if contributor exists
 * @param {string} id
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
export async function checkContributorByID(id){
    const query_str = "OPTIONAL "+contributorMatchQuery(id)+" "+
	  "RETURN c IS NOT NULL AS Predicate";

    try {
	const {records, summary} =
	      await driver.executeQuery(query_str,
					{contrib_id: id},
					{routing: 'READ', database: process.env.NEO4J_DB});
	const resp = records[0]['_fields'][0];
	return resp;
    } catch(err){console.log('checkContributorByID() - Error in query: '+ err);}
    // something went wrong
    return false;
}

/**
 * Get contrib ID for the element
 * @param {string} e_id Element ID
 * @return {Object} Contributors {id, openid}
 */
export async function getContributorIdForElement(e_id){
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
    } catch(err){console.log('getContributorIdForElement() - Error in query: '+ err);}
    // something went wrong
    return false;
}

/**
 * Toggle element bookmark by user
 * @param {string} contributor_id Looged-in user/contributor ID
 * @param {string} element_id Element ID
 * @param {string} element_type If provided will make DB querying more efficient
 * @param {boolean} bookmark
 * @return {boolean} true if bookmark status updated, false otherwise
 */
export async function toggleElementBookmarkByContributor(contributor_id,
							 element_id,
							 element_type,
							 bookmark){
    try {
	let query_str = "MATCH(c:Contributor) " +
	    "WHERE (c.id=$contrib_id OR $contrib_id IN c.openid) ";
	if (bookmark === 'true'){
	    // create a new BOOKMARKED relation between contributor and element
	    if (element_type){
		query_str += "MATCH (e:" + element_type + "{id:$elem_id}) ";
	    }
	    else {
		// inefficient query
		query_str += "MATCH (e{id:$elem_id}) ";
	    }
	    query_str += "MERGE (c)-[s:BOOKMARKED]-(e)";
	    const {_, summary} =
		  await driver.executeQuery(query_str,
					    {contrib_id: contributor_id, elem_id: element_id},
					    {database: process.env.NEO4J_DB});
	    if (summary.counters.updates()['relationshipsCreated'] == 1){
		return true;
	    }
	} else {
	    // remove relation between contributor and element
	    if (element_type) {
		query_str += "MATCH(c)-[s:BOOKMARKED]-(e:" + element_type +"{id:$elem_id}) ";
	    } else {
		// inefficient query
		console.warn('toggleElementBookmarkByContributor() - Inefficient query');
		query_str += "MATCH(c)-[s:BOOKMARKED]-(e{id:$elem_id}) ";
	    }
	    query_str += "DELETE s";
	    const {_, summary} =
		  await driver.executeQuery(query_str,
					    {contrib_id: contributor_id, elem_id: element_id},
					    {database: process.env.NEO4J_DB});
	    if (summary.counters.updates()['relationshipsDeleted'] == 1){
		return true;
	    }
	}
    } catch(err){console.log('toggleElementBookmarkByContributor() - Error in query: '+ err);}
    // something went wrong
    return false;
}

/**
 * Get if element bookmarked by contrib
 * @param {string} contributor_id Looged-in user/contributor ID
 * @param {string} element_id Element ID
 * @param {string} element_type If provided will make DB querying more efficient
 * @return {boolean} true if element bookmarked by user, false otherwise
 */
export async function getIfElementBookmarkedByContributor(contributor_id,
							  element_id,
							  element_type){
    try {
	let query_str = "MATCH(c:Contributor) " +
	    "WHERE (c.id=$contrib_id OR $contrib_id IN c.openid) ";
	if (element_type){
	    query_str += "MATCH (e:" + element_type + "{id:$elem_id}) ";
	}
	else {
	    // inefficient query
	    console.warn('getIfElementBookmarkedByContributor() - Inefficient query');
	    query_str += "MATCH (e{id:$elem_id}) ";
	}
	query_str += "RETURN EXISTS ((c)-[:BOOKMARKED]-(e)) as status";
	const {records, _} =
	      await driver.executeQuery(query_str,
					{contrib_id: contributor_id, elem_id: element_id},
					{database: process.env.NEO4J_DB});
	return records[0].get('status');
    } catch(err){console.log('getIfElementBookmarkedByContributor() - Error in query: '+ err);}
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
export async function registerDocumentation(documentation){
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
    } catch(err){console.log('registerDocumentation() - Error in query: '+ err);}
    // something went wrong
    return {response:false, documentation_id:''};
}

/**
 * Get documentation by ID without any related information
 * @param {string} id
 * @return {Object} Map of object with given ID. Empty map if ID not found or error
 */
export async function getDocumentationByID(id) {
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
    } catch(err){console.log('getDocumentationByID() - Error in query: '+ err);}
    // something went wrong
    return {};
}
/**
 * Get all documentation
 * @param {int}     from For pagintion, get documentation from this number
 * @param {int}     size For pagintion, get this number of documents
 * @return {Object} List of Map of document objects. Empty list if not found or error
 */
export async function getAllDocumentation(from, size) {
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
	for (let record of records){
	    ret.push(record['_fields'][0]);
	}
	return ret;
    } catch(err){console.log('getAllDocumentation() - Error in query: '+ err);}
    // something went wrong
    return [];
}

/**
 * Update existing documentation
 * @param {string} id Documentation id
 * @param {Object} documentation Map with new documentation attributes (name, content)
 * @return {Boolean} true for successful registration. false otherwise or in case of error
 */
export async function updateDocumentation(id, documentation_attributes) {
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
    } catch(err){console.log('updateDocumentation() - Error in query: '+ err);}
    // something went wrong
    return false;
}

/**
 * Delete a documentation given ID
 * @param {string} id
 * @return {Object} true if deleted successfully, false otherwise
 */
export async function deleteDocumentationByID(id){
    const query_str = "MATCH (d:Documentation{id:$id_param}) DETACH DELETE d";
    try {
	const {_, summary} =
	      await driver.executeQuery(query_str,
					{id_param: id},
					{database: process.env.NEO4J_DB});
	if (summary.counters.updates()['nodesDeleted'] == 1){
	    return true;
	}
    } catch(err){console.log('deleteDocumentationByID() - Error in query: '+ err);}
    // something went wrong
    return false;
}
