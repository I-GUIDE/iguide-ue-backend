const n4j_server = require("./server_neo4j")

/*****************************************************
 * Functions to move data from OpenSearch
 *****************************************************/

async function createdRelationFromOpenSearch(elem_data){

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
	const {_, summary} =
	      await n4j_server.driver.executeQuery(query_str,
						   query_params,
						   {database: process.env.NEO4J_DB});

	//console.log(summary.counters.updates());
	if (summary.counters.updates()['relationshipsCreated'] >= 1){
	    return true;
	}
    } catch(err){console.log('Error in query: '+ err);}
    // something went wrong
    return false;
}

/**
 * @deprecated Only used when migrating from OpenSearch
 * Register new element only without relationships. Once all elements are added
 * @param {String} contributor_id OpenID of registered contributor
 * @param {Object} element Map with element attributes (refer to schema)
 */
async function registerElementFromOpenSearch(contributor_id, element, ignore_relations){

    let{'id':relation_id,
	'thumbnail-image': thumbnail,
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
    // insert element as a new node with id and other fields
    if (node_type == n4j_server.ElementType.NOTEBOOK){
	node['notebook_repo'] = notebook_repo;
	node['notebook_file'] = notebook_file;
    } else if (node_type == n4j_server.ElementType.DATASET){
	node['external_link'] = external_link;
	node['direct_download_link'] = direct_download_link;
	node['size'] = size;
    } else if (node_type == n4j_server.ElementType.PUBLICATION){
	node['external_link'] = external_link_pub;
    } else if (node_type.localeCompare(n4j_server.ElementType.OER)){
	node['external_link'] = external_link_oer;
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
	const {_, summary} =
	      await n4j_server.driver.executeQuery(query_str,
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

exports.registerContributor = n4j_server.registerContributor
exports.createdRelationFromOpenSearch = createdRelationFromOpenSearch
exports.registerElementFromOpenSearch = registerElementFromOpenSearch
