/****************** NEO4J ********************/
const n4j_server = require("./server_neo4j")

const user= {
  openid: 'OpenID',
  first_name: 'First',
  last_name: 'Last',
  email: 'emal@gmail.com',
  affiliation: 'Affiliation',
  bio: 'Bio',
  avatar_url: ''
}

const element={
    metadata: { created_by: 'OpenID' },
    'resource-type': 'notebook',
    title: 'Notebook title',
    authors: [ 'Furqan Baig' ],
    tags: [ 'test-tag' ],
    contents: 'This is a test notebook element.',
    'notebook-repo': '',
    'notebook-file': '',
    'external-link': '',
    'direct-download-link': '',
    size: '',
    'external-link-publication': '',
    'external-link-oer': '',
    thumbnail: {},
    'thumbnail-image': '',
    'related-resources': [{id:'nb5', type:'notebook'}, {id:'ds3', type:'dataset'}],
    'external-links': [],
    'external-link-tags': [],
    'external-link-titles': []
}

// n4j_server.testServerConnection()
//     .then(res => {console.log(res);})
//     .catch(error => console.error(error));

// n4j_server.registerElement('OpenID', element)
//     .then(res => {console.log(res);})
//     .catch(error => console.error(error));

const id="46f44df1-46d3-415c-8a73-5e48690edc8a"
// n4j_server.getElementByID(id)
//     .then(res => {console.log(res);})
//     .catch(error => console.error(error));

//n4j_server.getElementsByIDs(['ds1', 'nb2'])
//    .then(res => {console.log(res);})
//    .catch(error => console.error(error));

//n4j_server.getFeaturedElements()
//    .then(res => {console.log(res);})
//    .catch(error => console.error(error));

//n4j_server.setElementFeaturedForID('ds2')
//    .then(res => {console.log(res);})
//    .catch(error => console.error(error));

//n4j_server.registerContributor(user)
//    .then(res => {console.log(res);})
//    .catch(error => console.error(error));

//n4j_server.createLinkNotebook2Dataset('nb1', 'ds5')
//    .then(res => {console.log(res);})
//    .catch(error => console.error(error));


//removeRelation('nb1', 'ds5', Relations.USES)
    // .then(res => {
    // 	console.log(res);
    // 	//for(res of elements) {
    // 	//    console.log(res)
    // 	    //console.log(res['_fields'])
    // 	//console.log(res.get('properties'))
    // 	//}
    // })
    // .catch(error => console.error(error));


// test("getElementByID('nb1')", () => {
//     return n4j_server.getElementByID("nb1").then(data => {
// 	expect(data).toBe(nb1);
//     });
//     //expect(n4j_server.getElementByID("nb1").then).toBe(nb1);
// });

/****************** OpenSearch ********************/
// const os_server = require("./server_opensearch")

// os_server.fetchResourcesByField('_id',  ['bkrVhJABQn4vdKPaPTsv'])
//     .then(data => console.log(data))
//     .catch(error => console.error(error));

// os_server.fetchUserByOpenID('http://cilogon.org/serverA/users/48835826')
//     .then(data => console.log(data))
//     .catch(error => console.error(error));

// os_server.elementRetriever({
//     //field_name: 'title',
//     //match_value: ['twitter'],
//     //element_type: ['notebook'],
//     from: '20',
// })
//     .then(data => {
// 	console.log(data.length);
// 	var count = 0;
// 	const contributors = new Set();
// 	for (d of data){
// 	    if ("metadata" in d){
// 		console.log(d);
// 		break;
// 		//contributor_id = d['metadata']['created_by']
// 		//contributor_name = d['authors'];
// 		//contributors.add({id: contributor_id, name: contributor_name});
// 		// try{
// 		//     n4j_server.registerElementFromOpenSearch(contributor_id, d);

// 		// }catch(err) {
// 		//     console.log('Error writing to Neo4j: '+ err);
// 		//     break;
// 		// }
// 	    }
// 	}
// 	console.log(count);
// 	console.log(contributors);
//     })
//     .catch(error => console.error(error));

/* Distinct list of contributors
Set(14) {
  '',
  'http://cilogon.org/serverA/users/33101641',
  'http://cilogon.org/serverA/users/11826461',
  'yunfan',
  'http://cilogon.org/serverB/users/47466092',
  'http://cilogon.org/serverE/users/8927',
  'http://cilogon.org/serverA/users/10128',
  'http://cilogon.org/serverE/users/177985',
  'http://cilogon.org/serverE/users/204622',
  'http://cilogon.org/serverE/users/204621',
  'http://cilogon.org/serverE/users/204625',
  'http://cilogon.org/serverE/users/26909',
  'http://cilogon.org/serverE/users/204627',
  'http://cilogon.org/serverE/users/204626'
}
 */
