/*
 * Dependencies
 *  - npm i node-fetch dotenv fs '@opensearch-project/opensearch'
 */
//import fetch from 'node-fetch';
//const fetch = require('node-fetch');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const fs = require('fs/promises');

const dotenv = require('dotenv').config({path: 'os.env'});
const fs_sync = require('fs');

const os = require('@opensearch-project/opensearch')

/*********** OpenSearch ***************/
const os_node = process.env.OPENSEARCH_NODE;
const os_usr = process.env.OPENSEARCH_USERNAME;
const os_pswd = process.env.OPENSEARCH_PASSWORD;
const os_index = 'neo4j-elements'; //process.env.OPENSEARCH_INDEX;

const options = {
    key: fs_sync.readFileSync(process.env.SSL_KEY),
    cert: fs_sync.readFileSync(process.env.SSL_CERT)
};

const client = new os.Client({
    node: os_node, // OpenSearch endpoint
    auth: {
	username: os_usr,
	password: os_pswd,
    },
    ssl: {
	rejectUnauthorized: false, // Use this only if you encounter SSL certificate issues
    },
});

console.log('Connectd to OpenSearch: ' + os_node);
console.log('\t- Using OpenSearch User: ' + os_usr);
//console.log('\t- Using OpenSearch Index: ' + os_index);

async function getUsers() {
    const response = await client.search({
	index: 'users_dev_backup',
	body: {
	    from: 0,
	    size: 100,
            query: {
		match_all: { }
            }
	}
    });
    const users = response.body.hits.hits.map(hit => {
	const { _id, _source } = hit;
	return _source;//{ _id, ..._source };
    });

    return users;
}

async function getElements() {
    const response = await client.search({
	index: 'elements', //'resources_dev',
	body: {
	    from: 0,
	    size: 100,
            query: {
		match_all: { }
            }
	}
    });
    let elements = response.body.hits.hits.map(hit => {
      const { _id, _source } = hit;
      //const { metadata, ...rest } = _source; // Remove metadata
      return { _id, ..._source };
    });

    //let count = 0;
    //for (e of elements){
    //	if ('metadata' in e) count+=1;
    // console.log(e);
    //}
    //console.log('Elements with openid: ' + count);
    // const authors = new Set();
    // for (e of elements){
    // 	if (e['authors'].length > 1) continue;
    // 	authors.add(e['authors'][0]);
    // }

    // console.log(authors);
    
    //elements = elements.filter(e => (!('metadata.created_by' in e)));
    //await fs.writeFile('./os_elements_july-29-24.json', JSON.stringify(elements, null, 2), { flag: 'a+' }, err => {});
    return elements;
}

async function insertElement(os_element) {

    const insert_index = 'neo4j-elements-dev';
    console.log('Inserting to OpenSearch index: ' + insert_index);
    
    const {'id': element_id, ...element} = os_element;
    const response = await client.index({
	id: element_id,
	index: insert_index,
	body: element,
	refresh: true,
    });
    return response['body']['result'];
}

async function emptyIndex(index_to_empty) {
    // console.log('Clearing index: ' + index_to_empty);
    // const response = await client.delete({
    // 	index: index_to_empty,
    // 	body: {
    //         query: {
    // 		match_all: { }
    //         }
    // 	}
    // });
    // return response['body']['result'];
}
/***********
 * OS query to create index
 ***********
PUT neo4j-elements-dev
{
  "mappings": {
    "properties": {
      "id":    { "type" : "keyword" },
      "title": { 
        "type": "text",
        "fields": {
          "keyword": {
            "type": "keyword"
          }
        }
      },
      "authors": { 
        "type": "text",
        "fields": {
          "keyword": {
            "type": "keyword"
          }
        }
      },
      "contents":{ "type" : "text" },
      "tags": { "type": "text" },
      "contributor" : { "type": "text" },
      "resource-type": { "type": "keyword" },
      "thumbnail-image": { "type": "keyword" }
    }
  }
}
************/

/*********** Local file ***************/
async function loadUsersFromFile() {

    const data = await fs.readFile('/code/os_users_sample_cleaned.json', { encoding: 'utf8' });
    const users_data = JSON.parse(data);
    console.log('Users loaded from file:' + users_data.length);

    return users_data;
}

async function loadElementsFromFile() {
    const elements_file_path = '/backend/neo4j/data/os_resources_july_29-24_cleaned.json';
    // '/code/os_elements_sample.json'
    
    const data = await fs.readFile(elements_file_path, {encoding: 'utf8' });
    const ret = JSON.parse(data);
    console.log('Elements loaded from file:' + ret.length);

    return ret;
}

//exports.elementRetriever = elementRetriever;
//exports.fetchResourcesByField = fetchResourcesByField;
//exports.fetchUserByOpenID = fetchUserByOpenID;

exports.getUsers = getUsers;
exports.getElements = getElements;
exports.insertElement = insertElement;

exports.loadUsersFromFile = loadUsersFromFile;
exports.loadElementsFromFile = loadElementsFromFile;

exports.emptyIndex = emptyIndex;
