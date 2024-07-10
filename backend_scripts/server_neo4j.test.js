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

// n4j_server.getResourceByID('nb1')
//     .then(res => {console.log(res);})
//     .catch(error => console.error(error));

//n4j_server.getResourcesByIDs(['ds1', 'nb2'])
    .then(res => {console.log(res);})
    .catch(error => console.error(error));

//n4j_server.getFeaturedResources()
//    .then(res => {console.log(res);})
//    .catch(error => console.error(error));

//n4j_server.setResourceFeaturedForID('ds2')
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
    // 	//for(res of resources) {
    // 	//    console.log(res)
    // 	    //console.log(res['_fields'])
    // 	//console.log(res.get('properties'))
    // 	//}
    // })
    // .catch(error => console.error(error));


// test("getResourceByID('nb1')", () => {
//     return n4j_server.getResourceByID("nb1").then(data => {
// 	expect(data).toBe(nb1);
//     });
//     //expect(n4j_server.getResourceByID("nb1").then).toBe(nb1);
// });
