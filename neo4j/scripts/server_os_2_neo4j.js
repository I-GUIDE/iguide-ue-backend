const n4j_server = require("./backend_neo4j")

/*****************************************************
 * Functions to move data from OpenSearch
 *****************************************************/

async function createdRelationFromOpenSearch(tx, elem_data){

    let{'id':element_id,
	'resource-type': node_type,
	'related-resources': related_elements,
	'related-notebooks': related_notebooks,         // [Deprecated]
	'related-datasets': related_datasets,           // [Deprecated]
	'related-publications': related_publications,   // [Deprecated]
	'related-oer': related_oer,                     // [Deprecated]
	..._
       } = elem_data;

    node_type = node_type[0].toUpperCase() + node_type.slice(1);

    // Combine all related material in single list
    if (related_elements === undefined){
	related_elements = []
    }

    if (related_notebooks) related_elements.push(...related_notebooks);
    if (related_datasets) related_elements.push(...related_datasets);
    if (related_publications) related_elements.push(...related_publications);
    if (related_oer) related_elements.push(...related_oer);

    if (related_elements.length == 0){
	// no relationship to create
	return true;
    }

    var query_match = "";
    var query_merge = "";
    var query_params = {};

    query_match += "MATCH(n:"+ node_type+"{relation_id:$elem_id}) ";
    query_params['elem_id'] = element_id;

    // create relations based on related-elements
    for (let [i, related_elem] of related_elements.entries()){
	query_match += "MATCH(to"+i+"{relation_id:$id"+i+"}) ";
	query_merge += "MERGE (n)-[:RELATED]-(to"+i+") ";
	query_params["id"+i] = related_elem;
    }
    const query_str = query_match + query_merge;

    //console.log(query_str);
    //console.log(query_params);

    try{
	await tx.run(query_str,
		     query_params,
		     {database: process.env.NEO4J_DB});
    } catch(err){console.log('Error in query: '+ err);}
}

/**
 * Register new element only without relationships. Once all elements are added
 * @param {String} contributor_id OpenID of registered contributor
 * @param {Object} element Map with element attributes (refer to schema)
 * @param {Transaction} tx Transaction to add this query to
 */
async function registerElementFromOpenSearch(tx, contributor_id, element){

    let{'id':relation_id,
	'thumbnail-image': thumbnail_image,
	'resource-type': node_type,
	'related-resources': related_elements,
	'related-notebooks': related_notebooks,         // [Deprecated]
	'related-datasets': related_datasets,           // [Deprecated]
	'related-publications': related_publications,   // [Deprecated]
	'related-oer': related_oer,                     // [Deprecated]
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

    // generate id (UUID)
    node['id'] = n4j_server.uuidv4();
    node['relation_id'] = relation_id; // will be deleted after creating relations
    node['thumbnail_image'] = thumbnail_image; // to change `-` to `_`
    // insert element as a new node with id and other fields
    if (node_type == n4j_server.ElementType.NOTEBOOK){
	// This needs to be merged
	node['notebook_repo'] = notebook_repo;
	node['notebook_file'] = notebook_file;
    } else if (node_type == n4j_server.ElementType.DATASET){
	node['external_link'] = external_link;
	node['direct_download_link'] = direct_download_link;
	node['size'] = size;
    } else if (node_type == n4j_server.ElementType.PUBLICATION){
	node['external_link'] = external_link_pub;
    } else if (node_type == n4j_server.ElementType.OER){
	node['external_link'] = external_link_oer;
	// this needs to be separated ...
	//node['class, slides, '] = '';
    } else {
	throw Error("Server Neo4j: Register element type " + node_type +" not implemented");
    }

    var query_match = "";
    var query_merge = "";
    var query_params = {node_param: node}

    // create CONTRIBUTED_BY relation with contributor_id
    query_match += "MATCH(c:Contributor{openid:$contrib_id}) ";
    query_merge += "MERGE (c)-[:CONTRIBUTED]->(n) ";
    query_params['contrib_id'] = contributor_id;

    const query_str = query_match + " CREATE (n: "+node_type+" $node_param) " + query_merge;

    try{
	const {_, summary} = await tx.run(query_str,
					  query_params,
					  {database: process.env.NEO4J_DB});
	if (summary.counters.updates()['nodesCreated'] >= 1){
	    // (3) remove non-searchable properties and insert to OpenSearch
	    let os_node = {};
	    os_node['id'] = node['id'];
	    os_node['title'] = node['title'];
	    os_node['contents'] = node['contents'];
	    os_node['authors'] = node['authors'];
	    os_node['tags'] = node['tags'];
	    os_node['resource-type'] = node_type.toLowerCase();
	    os_node['thumbnail-image'] = thumbnail_image;
	    os_node['contributor'] = ''; // [ToDo] get contributor first and last name
	    
	    return {response: true, os_node: os_node};
	}
    } catch(err){console.log('Error in query: '+ err);}
    return {response: false, os_node:{}};
}

/**
 * Register new contributor
 * @param {Object} contributor Map with new contributor attributes (refer to schema)
 * @param {Transaction} tx Transaction to add this query to
 */
async function registerContributor(tx, contributor){
    const query_str = "CREATE (c: Contributor $contr_param)";
    try{
	await tx.run(query_str,
		     {contr_param: contributor},
		     {database: process.env.NEO4J_DB});
    } catch(err){console.log('Error in query: '+ err);}
}

/**
 * [ToDo] Use `WITH` and `UNWIND` to batch create queries
 */
async function registerDataFromOpenSearchBatch(users, elements){

    const session = n4j_server.driver.session({database: process.env.NEO4J_DB});
    const tx = await session.beginTransaction();

    try{
	// register contributors
	for (u of users){
	    registerContributor(tx, u);
	}
	
	// register elements
	const os_elements = [];
	for (e of elements){
	    authors = e['authors'];
	    if (authors.includes('Fangzheng Lyu')){
		// Fangzheng Lyu openid not available. Make Shaowen as contributor
		contributor_id = "http://cilogon.org/serverB/users/47466092";
	    } else if (authors.includes('Wei Hu')){
		contributor_id = "http://cilogon.org/serverE/users/8927";
	    } else {
		// Make Anand as default contributor
		contributor_id = "http://cilogon.org/serverA/users/10128";
	    }
	    const {response, os_node} =
		  await registerElementFromOpenSearch(tx, contributor_id, e);
	    if (response){
		os_elements.push(os_node);
	    }
	}

	// create relations between elements
	for (e of elements){
	    createdRelationFromOpenSearch(tx, e);
	}

	try{
	    await tx.commit();
	} catch(err){console.log('Error in transaction: '+ err);}

	return {response: true, os_elements: os_elements};
    } catch(err){
	console.log('Error in transaction: '+ err);
    } finally {
	await session.close();
	await n4j_server.driver.close();
    }
    return {response: false, os_elements:[]};
}

exports.testServerConnection = n4j_server.testServerConnection
//exports.registerContributor = n4j_server.registerContributor
//exports.createdRelationFromOpenSearch = createdRelationFromOpenSearch
//exports.registerElementFromOpenSearch = registerElementFromOpenSearch
exports.registerDataFromOpenSearchBatch = registerDataFromOpenSearchBatch
