const os_server = require("./server_opensearch");
const os2neo4j_server = require("./server_os_2_neo4j")

async function moveDataFromOS2Neo4j() {

    const user_data = await os_server.loadUsersFromFile();
    const users = [];
    for (c of user_data){
	users.push(c['_source']);
    }
    
    const data = await os_server.loadElementsFromFile();
    const elements = [];
    // create all nodes with contributors
    for (c of data){
	let e = c['_source'];
	elements.push(e);
    }

    try {
        const {response, os_elements} =
	      await os2neo4j_server.registerDataFromOpenSearchBatch(users, elements);
        if (!response) {
	    console.log('Error in moveElementsFromOS2Neo4j(): ' + e);
        }
	console.log(response);
	console.log('Number of elements to be added to OS: ' + os_elements.length);
	for (let os_elem of os_elements){
	    const os_resp = await os_server.insertElement(os_elem);
	    console.log(os_resp);
	}
    } catch(err){console.log('Error:'+ err);};

    return true;
}

moveDataFromOS2Neo4j()
    .then(d => console.log(d))
    .catch(error => console.error(error));

// os2neo4j_server.testServerConnection()
//     .then(resp => console.log(resp))
//     .catch(error => console.error(error));

// os_server.getUsers()
//     .then(d => console.log('Users Count: ' + d.length))
//     .catch(error => console.error(error));

// os_server.getElements()
//     .then(d => console.log('Elements Count: ' + d.length))
//     .catch(error => console.error(error));
