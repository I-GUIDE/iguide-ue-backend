const os_server = require("./server_opensearch");
const os2neo4j_server = require("./server_os_2_neo4j")

async function moveUsersFromOS2Neo4j() {
    const data = await os_server.loadUsersFromFile();
    for (c of data){
	resp = await os2neo4j_server.registerContributor(c['_source']);
	if (!resp){
	    console.log('Error in moveUsersFromOS2Neo4j()');
	}
    }
    return true;
}

async function moveElementsFromOS2Neo4j() {
    const data = await os_server.loadElementsFromFile();

    // create all nodes with contributors
    for (c of data){
	let e = c['_source'];
	authors = e['authors'];
	if (authors.includes('Fangzheng Lyu')){
	    // Fangzheng Lyu openid not available. Make Shaowen as contributor
	    contributor_id = "http://cilogon.org/serverB/users/47466092";
	} else if ('Wei Hu' in authors){
	    contributor_id = "http://cilogon.org/serverE/users/8927";
	} else {
	    // Make Anand as default contributor
	    contributor_id = "http://cilogon.org/serverA/users/10128";
	}

	try {
	    const resp = await os2neo4j_server.registerElementFromOpenSearch(contributor_id, e, true);
	    if (!resp) {
		console.log('Error in moveElementsFromOS2Neo4j(): ' + e);
	    }
	} catch(err){console.log('Error:'+ err);};
    }

    // create relations for created nodes
    for (c of data){
	let elem_data = c['_source'];
	try {
	    const resp = await os2neo4j_server.createdRelationFromOpenSearch(elem_data);
	    if (!resp) {
		console.log('Error in creating relations moveElementsFromOS2Neo4j(): ' + elem_data);
	    }
	} catch(err){console.log('Error:'+ err);};
    }
}

async function moveDataFromOS2Neo4j() {
    let resp = moveUsersFromOS2Neo4j();
    if (resp){
	resp = moveElementsFromOS2Neo4j();
    } else {return false;}

    if (resp){
	//
    }

    return true;
}


// moveDataFromOS2Neo4j()
//     .then(d => console.log(d))
//     .catch(error => console.error(error));

os_server.getUsers()
    .then(d => console.log('Users Count: ' + d.length))
    .catch(error => console.error(error));

os_server.getElements()
    .then(d => console.log('Elements Count: ' + d.length))
    .catch(error => console.error(error));
