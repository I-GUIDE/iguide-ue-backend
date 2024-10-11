const n4j_server = require("./../../backend_scripts/backend_neo4j.cjs");
const {Client} = require("@opensearch-project/opensearch");
const dotenv = require('dotenv');

//const yaml = require('js-yaml');
const fs = require('fs');

//import fs from 'fs';
//import yaml from 'js-yaml';
//import * as n4j_server from "./../../backend_scripts/backend_neo4j.cjs";
//import { Client } from '@opensearch-project/opensearch';

//import dotenv from 'dotenv';
dotenv.config();
const os_node = process.env.OPENSEARCH_NODE;
const os_usr = process.env.OPENSEARCH_USERNAME;
const os_pswd = process.env.OPENSEARCH_PASSWORD;
const os_index = process.env.OPENSEARCH_INDEX; //'neo4j-elements-dev';
const target_domain = process.env.JWT_TARGET_DOMAIN;

const SSLOptions = {
    key: fs.readFileSync(process.env.SSL_KEY),
    cert: fs.readFileSync(process.env.SSL_CERT)
};

const client = new Client({
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
console.log('\t- Using OpenSearch Index: ' + os_index);

async function readData(yaml_file){
    //let map_objs = yaml.load(fs.readFileSync(yaml_file, {encoding: 'utf-8'}));
    //import map_objs from yaml_file assert { type: 'json' };

    var map_objs = JSON.parse(fs.readFileSync(yaml_file, 'utf8'));

    console.log(map_objs.length);
    var i = 0;
    for (let map of map_objs) {

	let map_element = {};
	// (1) upload thumbnail
	//let thumbnail_url = map['image'].replace('/assets/maps/', 'https://backend-dev.i-guide.io:3500/user-uploads/thumbnails/');
	let thumbnail_url = 'https://backend.i-guide.io:443/user-uploads/thumbnails/' + map['image'];
	//let thumbnail_url = 'https://backend-dev.i-guide.io:3500/user-uploads/thumbnails/' + map['image'];

	// (2) create json object
	// These map elements are created by Alex
	// Alex id (dev): 063883de-1e64-4ad6-9898-1573ae5fbfa7
	// Alex id (prod): 4e0cf74d-46b8-4c4b-b6c7-a8099aaaa854
	map_element['metadata'] = {'created_by':'4e0cf74d-46b8-4c4b-b6c7-a8099aaaa854'};
	map_element['thumbnail-image'] = thumbnail_url;
	map_element['resource-type'] = 'map';

	map_element['title'] = map['title'];
	map_element['authors'] = map['authors'];
	map_element['tags'] = map['tags'];
	map_element['contents'] = map['description'];
	map_element['related-resources'] = [];
	map_element['map-external-iframe-link'] = map['link'];

	// spatial-temporal
	map_element['spatial-coverage'] = map['spatial_coverage'];
	map_element['spatial-geometry'] = map['geometry'];
	map_element['spatial-bounding-box'] = map['bounding_box'];
	map_element['spatial-centroid'] = map['centroid'];
	map_element['spatial-georeferenced'] = map['georeferenced'];
	map_element['spatial-temporal-coverage'] = map['temporal_coverage'];
	map_element['spatial-index-year'] = map['index_year'];

	//console.log(map_element);
	//break;

	// (3) insert to neo4j
	const contributor_id = map_element['metadata']['created_by'];
	const {response, element_id} =
	      await n4j_server.registerElement(contributor_id, map_element);

	// (4) insert/index searchable part to OpenSearch
        if (response) {
            let os_element = {
                title: map_element['title'],
                contents: map_element['contents'],
                authors: map_element['authors'],
                tags: map_element['tags'],
                'resource-type': map_element['resource-type'],
                'thumbnail-image': map_element['thumbnail-image'],
		// spatial-temporal
		'spatial-coverage': map_element['spatial-coverage'],
		'spatial-geometry': map_element['spatial-geometry'],
		'spatial-bounding-box': map_element['spatial-bounding-box'],
		'spatial-centroid': map_element['spatial-centroid'],
		'spatial-georeferenced': map_element['spatial-georeferenced'],
		'spatial-temporal-coverage': map_element['spatial-temporal-coverage'],
		'spatial-index-year': map_element['spatial-index-year']
            };

            // Set contributor name
            let contributor = await n4j_server.getContributorByID(contributor_id);
            let contributor_name = '';
            if ('first_name' in contributor || 'last_name' in contributor) {
                contributor_name = `${contributor['first_name']} ${contributor['last_name']}`;
            }
            os_element['contributor'] = contributor_name;

            console.log('Indexing element: ' + os_element);
            const response = await client.index({
                id: element_id,
                index: os_index,
                body: os_element,
                refresh: true,
            });
            console.log(response['body']['result']);
	} else {
	    console.error('Error inserting map element to neo4j');
	}
	i+=1;
	console.log('Created ' + i + ' map elements ...');
	//break;
    }
}

async function insert_map_from_neo4j_to_OS() {
    let sort_by = 'title';
    let order = 'asc';

    let resources = await n4j_server.getElementsByType('map', 0, 100, sort_by, order);
    for (let map_element of resources){
	console.log(map_element['id']);

	let os_element = {
            title: map_element['title'],
            contents: map_element['contents'],
            authors: map_element['authors'],
            tags: map_element['tags'],
            'resource-type': map_element['resource-type'],
            'thumbnail-image': map_element['thumbnail-image']
        };

	os_element['contributor'] = 'Alexander Christopher Michels';

	console.log('Indexing element: ' + os_element);
        const response = await client.index({
            id: map_element['id'],
            index: os_index,
            body: os_element,
            refresh: true,
        });
        console.log(response['body']['result']);
    }
}

// function test_role() {
//     let role = n4j_server.Role.TRUSTED_USER;
//     console.log(role);

//     let user_role = 1;

//     if (user_role <= n4j_server.Role.ADMIN) {
// 	console.log('user is admin ...');
//     } else {
// 	console.log('non-admin user');
//     }
// }

//test_role();

//readData('../data/map_elements.yml')
readData('../data/maps-2024-10-07.json')
    .then(d => console.log(d))
    .catch(error => console.error(error));

// insert_map_from_neo4j_to_OS()
//     .then(d => console.log(d))
//     .catch(error => console.error(error));
