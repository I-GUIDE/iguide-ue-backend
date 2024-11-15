import dotenv from 'dotenv';
import fs from 'fs';
import { Client } from '@opensearch-project/opensearch';

const os_node = process.env.OPENSEARCH_NODE;
const os_usr = process.env.OPENSEARCH_USERNAME;
const os_pswd = process.env.OPENSEARCH_PASSWORD;

export const os_index = process.env.OPENSEARCH_INDEX; //'neo4j-elements-dev';
export const client = new Client({
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
