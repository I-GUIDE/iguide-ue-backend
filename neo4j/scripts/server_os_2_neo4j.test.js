const os_server = require("./server_opensearch");
const os2neo4j_server = require("./server_os_2_neo4j")

async function moveDataFromOS2Neo4j() {

    // read data from OS filedump
    //const user_data = await os_server.loadUsersFromFile();
    // read users data from OpenSearch
    const user_data = await os_server.getUsers();
    const users = [];
    for (c of user_data){
	let user = c; //c['_source'];
	// default role of every user
	user['role'] = 'user';
	user['version'] = '1';

	// insert missing data
	if (!('first_name' in user)) {
	    switch(user['openid']){
	    case 'http://cilogon.org/serverA/users/33101641':
		user['first_name'] = 'Alexander Christopher';
		user['last_name'] = 'Michels';
		break;
	    case 'http://cilogon.org/serverA/users/11826461':
		user['first_name'] = 'Rebecca (Becky)';
		user['last_name'] = 'Vandewalle';
		break;
	    case 'http://cilogon.org/serverE/users/8927':
		user['first_name'] = 'Wei';
		user['last_name'] = 'Hu';
		break;
	    case 'http://cilogon.org/serverA/users/10128':
		user['first_name'] = 'Anand';
		user['last_name'] = 'Padmanabhan';
		break;
	    case 'http://cilogon.org/serverE/users/177985':
		user['first_name'] = 'Forrest J.';
		user['last_name'] = 'Bowlick';
		break;
	    case 'http://cilogon.org/serverE/users/204626':
		user['first_name'] = 'Mike';
		user['last_name'] = 'Hasinoff';
		break;
	    case 'http://cilogon.org/serverA/users/51535406':
		user['first_name'] = 'Joynal';
		user['last_name'] = 'Abedin';
		break;
	    case 'http://cilogon.org/serverE/users/205109':
		user['first_name'] = 'Zhuping';
		user['last_name'] = 'Sheng';
		break;
	    case 'http://cilogon.org/serverE/users/203474':
		user['first_name'] = 'Mahbub';
		user['last_name'] = 'Hasan';
		break;
	    case 'http://cilogon.org/serverE/users/194200':
		user['first_name'] = 'Di';
		user['last_name'] = 'Liu';
		break;
	    case 'http://cilogon.org/serverE/users/26909':
		user['first_name'] = 'Yi';
		user['last_name'] = 'Qi';
		break;
	    case 'http://cilogon.org/serverE/users/204627':
		user['first_name'] = 'Antonio';
		user['last_name'] = 'Medrano';
		break;
	    case 'http://cilogon.org/serverE/users/204625':
		user['first_name'] = 'Derek Van';
		user['last_name'] = 'Berkel';
		break;
	    case 'http://cilogon.org/serverE/users/205061':
		user['first_name'] = 'Jiahua';
		user['last_name'] = 'Chen';
		break;
	    case 'http://cilogon.org/serverE/users/202370':
		user['first_name'] = 'Xin';
		user['last_name'] = 'Zhou';
		break;
	    case 'http://cilogon.org/serverE/users/52965':
		user['first_name'] = 'Bikram';
		user['last_name'] = 'Parajuli';
		break;
	    case 'http://cilogon.org/serverE/users/204087':
		user['first_name'] = 'Wanjing';
		user['last_name'] = 'Yang';
		break;
	    case 'http://cilogon.org/serverE/users/137206':
		user['first_name'] = 'Yunfan';
		user['last_name'] = 'Kang';
		break;
	    default:
		console.log('Missing info for: ' + user['openid']);
	    }
	}
	users.push(user);
    }

    // manually add Fangzheng
    fangzheng = {};
    fangzheng['first_name'] = 'Fangzheng';
    fangzheng['last_name'] = 'Lyu';
    fangzheng['openid'] = 'http://cilogon.org/serverE/users/209193';
    fangzheng['affiliation'] = 'University of Illinois Urbana Champaign';
    fangzheng['bio'] = '';
    fangzheng['role'] = 'user';
    fangzheng['version'] = '1';
    
    users.push(fangzheng);
    
    // read elements data from OS filedump
    //const data = await os_server.loadElementsFromFile();
    //const elements = [];
    // create all nodes with contributors
    //for (c of data){
	//let e = c['_source'];
	//if ('metadata.created_by' in c)
	//    elements.push(c);
    //}

    // read elements data from OS
    let elements = await os_server.getElements();

    // filter elements with invalid data
    elements = elements.filter(e => ((e['title'])));
    const elements_without_contrib = elements.filter(e => (!('metadata' in e)));
    // filter elements having contributor information
    elements = elements.filter(e => (('metadata' in e)));

    for (let e of elements_without_contrib){
	e['metadata'] = {};
	e['metadata']['created_by'] = 'http://cilogon.org/serverE/users/209193';
	//console.log(e['authors']);
	elements.push(e);
    }
    
    // write data to Neo4j
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

/**********
 * DANGER
 **********/
// os_server.emptyIndex('neo4j-elements-dev')
//     .then(d => console.log(d))
//     .catch(error => console.error(error));
