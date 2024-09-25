//const n4j_server = require("./../../backend_scripts/backend_neo4j.cjs");
//const yaml = require('js-yaml');
//const fs = require('fs');

import fs from 'fs';
import yaml from 'js-yaml';
import * as n4j_server from "./../../backend_scripts/backend_neo4j.cjs";
import { Client } from '@opensearch-project/opensearch';

import dotenv from 'dotenv';
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
    let map_objs = yaml.load(fs.readFileSync(yaml_file, {encoding: 'utf-8'}));
    for (let map of map_objs) {

	let map_element = {};
	// (1) upload thumbnail
	let thumbnail_url = map['image'].replace('/assets/maps/', 'https://backend-dev.i-guide.io:3500/user-uploads/thumbnails/');
	// (2) create json object
	// These map elements are created by Alex
	map_element['metadata'] = {'created_by':'063883de-1e64-4ad6-9898-1573ae5fbfa7'};
	map_element['thumbnail-image'] = thumbnail_url;
	map_element['resource-type'] = 'map';

	map_element['title'] = map['title'];
	map_element['authors'] = map['authors'];
	map_element['contents'] = map['description'];
	map_element['related-resources'] = [];
	map_element['map-external-iframe-link'] = map['link'];

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
                'thumbnail-image': map_element['thumbnail-image']
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
	}
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

function test_role() {
    let role = n4j_server.Role.TRUSTED_USER;
    console.log(role);

    let user_role = 1;
    
    if (user_role <= n4j_server.Role.ADMIN) {
	console.log('user is admin ...');
    } else {
	console.log('non-admin user');
    }
}

test_role();

// readData('../data/map_elements.yml')
//     .then(d => console.log(d))
//     .catch(error => console.error(error));

// insert_map_from_neo4j_to_OS()
//     .then(d => console.log(d))
//     .catch(error => console.error(error));
