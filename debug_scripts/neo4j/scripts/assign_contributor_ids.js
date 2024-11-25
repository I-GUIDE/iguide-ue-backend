const n4j_server = require("./../../backend_scripts/backend_neo4j.cjs");
const { v4: uuidv4 } = require('uuid');

async function assignIDs() {
    const session = n4j_server.driver.session({database: process.env.NEO4J_DB});
    const tx = await session.beginTransaction();
    
    try{
	const query_str = "MATCH(c:Contributor) RETURN c.openid";
	const {records, _} = await tx.run(query_str,
					  {database: process.env.NEO4J_DB});

	for (record of records){
	    let openid = record['_fields'][0];
	    const query_str2 = "MATCH(c:Contributor{openid:$id_param}) SET c.id=$new_id";
	    await tx.run(query_str2,
			 {id_param: openid, new_id: uuidv4()},
			 {database: process.env.NEO4J_DB});
	}

	await tx.commit();
    } catch(err){console.log('createdRelationFromOpenSearch() Error in query: '+ err);}
}

assignIDs()
    .then(d => console.log(d))
    .catch(error => console.error(error));
