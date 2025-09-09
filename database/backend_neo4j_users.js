import * as utils from "../utils/utils.js";
import dotenv from "dotenv";
import neo4j from "neo4j-driver";
import {makeFrontendCompatible} from "./backend_neo4j.js";
import {generateUserRole} from "../utils/utils.js";
import { v4 as uuidv4 } from 'uuid';
dotenv.config();
console.log(process.env.NEO4J_CONNECTION_STRING);

/**
 * Create a driver instance
 * It should be enough to have a single driver per database per application.
 */
const driver = neo4j.driver(
    process.env.NEO4J_CONNECTION_STRING,
    neo4j.auth.basic(process.env.NEO4J_USER, process.env.NEO4J_PASSWORD)
)
const NEO4J_DB = process.env.NEO4J_DB;
/**
 * Get all Contributors with all information based on a pagination criteria
 * from and size are optional parameters by default set to return 1st 100 records
 * @returns {Object} Map of objects with serial Ids. If no users found returns empty
 */
export async function getAllContributorsV2(
		from=0,
		size=100,
		sort_by=utils.SortBy.FIRST_NAME,
		sort_order="asc",
		filter_key='none',
		filter_value=''){
	let query_str = "MATCH (a:Alias)-[:ALIAS_OF]->(c:Contributor)";
	let query_params = {};
	/**
	 * Set the filter by value if required
	 */
	switch (filter_key) {
		case "role-no":
			filter_key = "role"
			filter_value = neo4j.int(filter_value)
			query_str += " WHERE c." + filter_key + ' = $filter_val'
			query_params['filter_val'] = filter_value
			break
		case "affiliation":
			filter_key = "affiliation"
			query_str += " WHERE toLower(a." + filter_key + ") CONTAINS toLower($filter_val)"
			query_params['filter_val'] = filter_value
			break
		case "first-name":
			filter_key = "first_name"
			query_str += " WHERE toLower(c." + filter_key + ") CONTAINS toLower($filter_val)"
			query_params['filter_val'] = filter_value
			break
		case "last-name":
			filter_key = "last_name"
			query_str += " WHERE toLower(c." + filter_key + ") CONTAINS toLower($filter_val)"
			query_params['filter_val'] = filter_value
			break
		default:
			filter_key = "none"
	}
	/**
	 * Set the return parameter
	 */
	let count_query_str = query_str + " return COUNT(c) AS count"
	query_str += " WITH c, collect(DISTINCT a{.*}) AS aliases"
	/**
	 * Set the default value for sort_by parameter
	 */
	sort_by = utils.parseSortBy(sort_by)
	if (sort_by && sort_by !== "") {
		query_str += " ORDER BY c." + sort_by + " " + sort_order
	}
	/**
	 * Set the pagination condition
	 */
	let pagination_str = " SKIP $from LIMIT $size";
	query_str += pagination_str;
	query_params['from'] = neo4j.int(from);
	query_params['size'] = neo4j.int(size);

	query_str += " RETURN c{.*} AS contributor, aliases";

	try {
		let records, summary;
		({records, summary} = await driver.executeQuery(query_str,
			query_params,
			{routing: 'READ', database: NEO4J_DB}));
		if (records?.length <= 0) {
			return {"total-users":-1, "users": []};
		}
		let contributor_list = [];
		records?.map((contributor) => {
			if (contributor['_fields']?.length > 0) {
				let temp_contributor = contributor['_fields'][0];
				let aliases = contributor['_fields'][1];
				// let total_contr = utils.parse64BitNumber(contributor['_fields'][2]);
				let primary_alias = {}
				if (aliases?.length > 0) {
					aliases.map((alias) => {
						if (alias?.is_primary) {
							primary_alias = alias;
						}
					});
					temp_contributor['openid'] = primary_alias['openid'];
					temp_contributor['email'] = primary_alias['email'];
					temp_contributor['affiliation'] = primary_alias['affiliation'];
					temp_contributor['first_name'] = primary_alias['first_name'];
					temp_contributor['last_name'] = primary_alias['last_name'];
					temp_contributor['aliases'] = aliases;
					// temp_contributor['total_contributions'] = total_contr;
				}
				if (temp_contributor["role"] !== undefined && temp_contributor["role"]?.low) { // to only convert from neo4jInt when the same is returned
					temp_contributor["role"] = utils.parse64BitNumber(temp_contributor["role"]);
				}
				contributor_list.push(temp_contributor);
			}
		});
		({records, summary} = await driver.executeQuery(
				count_query_str,
				query_params,
				{routing: 'READ', database: NEO4J_DB}));
		let total_count = utils.parse64BitNumber(records[0].get('count'));
		let contributor_final_list = Object.values(makeFrontendCompatible(contributor_list));
		return {"total-users": total_count, "users": contributor_final_list}

	} catch (err) {
		console.log('getAllContributorsV2() - Error in query: ' + err);
	}
	return {"total-users": -1, "users": []};
}

/**
 * Get Contributor details with Aliases
 * @param id
 * @returns {Promise<{}|{[p: string]: null|{}|undefined}>}
 */
export async function getContributorByIDv2(id) {
	let query_str = "";
	if (String(id).startsWith("http")) {
		query_str = "MATCH (a1:Alias{openid: $id})-[:ALIAS_OF]->(c:Contributor) MATCH (a:Alias)-[:ALIAS_OF]->(c)"
	} else {
		query_str = "MATCH (a:Alias)-[:ALIAS_OF]->(c:Contributor{id: $id})"
	}
	query_str = query_str + " RETURN c{.*} AS contributor, collect(DISTINCT a{.*}) AS aliases";
	try {
		const {records, summary} =
			await driver.executeQuery(query_str,
				{id: id},
				{routing: 'READ', database: NEO4J_DB});

		if (records.length <= 0) {
			return {};
		} else if (records.length > 1) {
			throw Error("Server Neo4j: ID should be unique, query returned multiple results for given ID:" + id);
		}
		let response = {
			Contributor: records[0]['_fields'][0],
			Aliases: records[0]['_fields'][1],
			// TotalContributions: records[0]['_fields'][2]
		};
		let primary_alias = {}
		if (response?.Aliases) {
			response?.Aliases.map((alias) => {
				if (alias?.is_primary === true) {
					primary_alias = alias;
				}
			});
		}
		let contributor = response?.Contributor;
		contributor["openid"] = primary_alias["openid"];
		contributor["email"] = primary_alias["email"];
		contributor["affiliation"] = primary_alias["affiliation"];
		contributor["first_name"] = primary_alias["first_name"];
		contributor["last_name"] = primary_alias["last_name"];
		contributor["aliases"] = response?.Aliases;
		if (contributor["role"] !== undefined && contributor["role"]?.low) { // to only convert from neo4jInt when the same is returned
			contributor["role"] = utils.parse64BitNumber(contributor["role"]);
		}
		// contributor["total_contributions"] = utils.parse64BitNumber(response?.TotalContributions);
		return makeFrontendCompatible(contributor)
	} catch (error) {
		console.log("getContributorByIDv2 - Error in query: " + error);
	}
	return {};
}

/**
 * Check if the openID/userID belongs to any contributor
 * @param id
 * @returns {Promise<*|boolean>}
 */
export async function checkContributorByIDV2(id) {
	let query_str = "OPTIONAL "
    if (String(id).startsWith("http")) {
        /**
         * Provided id is an OpenID hence check aliases
         */
        query_str = query_str + "MATCH (a:Alias{openid: $id})-[:ALIAS_OF]->(c:Contributor)";
    } else {
        /**
         * Provided id is a user-id hence check contributor
         */
        query_str = query_str + "MATCH (c:Contributor{id: $id})";
    }
	query_str = query_str + " RETURN c IS NOT NULL AS Predicate";
	try {
		const {records, _} =
			await driver.executeQuery(query_str,
				{id: id},
				{routing: 'READ', database: process.env.NEO4J_DB});
		return records[0]['_fields'][0];
	} catch (error) {
		console.log('checkContributorByIDV2() - Error in query: ' + error);
		return false;
	}
}

/**
 * Register new contributor for AUTH purposes V2
 * @param {Object} contributor Map with new contributor attributes (refer to schema)
 * @return {Object} user object for successful creation. empty object in case it fails
 */
export async function registerContributorAuthV2(contributor){

	// (1) generate id (UUID).
    contributor['id'] = uuidv4();

    // (2) assign roles for new contributor
	contributor['role'] = generateUserRole(contributor);
    // (3) get avatar URL
    //contributor['avatar_url'] = contributor['avatar_url']['original'];
    const query_str = "CREATE (c: Contributor $contr_param) " +
		"CREATE (a:Alias $alias_param) " +
		"CREATE (a)-[:ALIAS_OF]->(c) " +
		"RETURN c{.*} as contributor, a{.*} as alias";
    try{
		let alias_param = {
			openid: contributor["openid"],
			email: contributor["email"],
			affiliation: contributor["affiliation"],
			first_name: contributor["first_name"],
			last_name: contributor["last_name"],
			is_primary: true
		};
		let contr_param = {
			id: contributor['id'],
			bio: contributor["bio"],
			role: contributor["role"],
			display_first_name: contributor["first_name"],
			display_last_name: contributor["last_name"],
		};
		const {records, summary} =
	      	await driver.executeQuery(query_str,
					{contr_param: contr_param, alias_param: alias_param},
					{routing: 'WRITE', database: process.env.NEO4J_DB});
		if (summary.counters.updates()['nodesCreated'] == 2){
	    	let response = {
				Contributor: records[0]['_fields'][0],
				Aliases: records[0]['_fields'][1]
			};
			let primary_alias = response?.Aliases;
			let contributor = response?.Contributor;
			contributor["openid"] = primary_alias["openid"];
			contributor["email"] = primary_alias["email"];
			contributor["first_name"] = primary_alias["first_name"];
			contributor["last_name"] = primary_alias["last_name"];
			contributor["affiliation"] = primary_alias["affiliation"];
			contributor["aliases"] = [primary_alias];
			contributor["role"] = utils.parse64BitNumber(contributor["role"]);
			return makeFrontendCompatible(contributor);
		}
    } catch(err){
		console.log('registerContributor() - Error in query: '+ err);
	}

	// something went wrong
    return {};

}

/**
 * Create a contributor with alias
 * @param contributor
 * @returns {Promise<boolean>}
 */
export async function registerContributorV2(contributor){

    // (1) generate id (UUID).
    contributor['id'] = uuidv4();

    // (2) assign roles for new contributor
	contributor['role'] = generateUserRole(contributor);
    // (3) get avatar URL
    //contributor['avatar_url'] = contributor['avatar_url']['original'];
    const query_str = "CREATE (c: Contributor $contr_param) " +
		"CREATE (a:Alias $alias_param) " +
		"CREATE (a)-[:ALIAS_OF]->(c) " +
		"RETURN c{.*} as contributor, a{.*} as alias";
    try{
		let alias_param = {
			openid: contributor["openid"],
			email: contributor["email"],
			affiliation: contributor["affiliation"],
			first_name: contributor["first_name"],
			last_name: contributor["last_name"],
			is_primary: true
		};
		let contr_param = {
			id: contributor['id'],
			display_first_name: contributor["first_name"],
			display_last_name: contributor["last_name"],
			bio: contributor["bio"],
			role: contributor["role"],
		};
		const {_, summary} =
	      	await driver.executeQuery(query_str,
					{contr_param: contr_param, alias_param: alias_param},
					{routing: 'WRITE', database: process.env.NEO4J_DB});
		if (summary.counters.updates()['nodesCreated'] == 2){
	    	return true;
		}
    } catch(err){
		console.log('registerContributor() - Error in query: '+ err);
	}
    return false;
}

/**
 * Delete user and its aliases based on user_id
 * @param user_id
 * @returns {Promise<boolean>}
 */
export async function deleteUserByIdV2(user_id) {
	const query_str = "MATCH (a:Alias)-[:ALIAS_OF]->(c:Contributor{id:$id_param}) " +
	  "DETACH DELETE c, a";
	try {
		const {_, summary} =
		  	await driver.executeQuery(query_str,
						{id_param: user_id},
						{database: process.env.NEO4J_DB});
		if (summary.counters.updates()['nodesDeleted'] > 1){
			return true;
		}
	} catch(err){
		console.log('deleteUserByOpenId() - Error in query: '+ err);
	}
	// something went wrong
	return false;
}

/**
 * Update existing contributor
 * @param {string} id Contributor id
 * @param {Object} contributor Map with new contributor attributes (refer to schema)
 * @return {Boolean} true for successful registration. false otherwise or in case of error
 */
export async function updateContributorV2(id, contributor_attributes) {
	let query_match = ""
	if (String(id).startsWith("http")) {
        /**
         * Provided id is an OpenID hence check aliases
         */
        query_match = query_match + "MATCH (a:Alias{openid: $id})-[:ALIAS_OF]->(c:Contributor) ";
    } else {
        /**
         * Provided id is a user-id hence check contributor
         */
        query_match = query_match + "MATCH (c:Contributor{id: $id}) ";
    }
	var query_set = "";
	var query_params = {id: id};

	let i = 0;
	for (const [key, value] of Object.entries(contributor_attributes)) {
		query_set += "SET c." + key + "=$attr" + i + " ";
		if (key === 'avatar_url') {
			query_params['attr' + i] = value['original'];
		} else {
			query_params['attr' + i] = value;
		}
		i += 1;
	}

	const query_str = query_match + query_set;
	try {
		const {_, summary} =
			await driver.executeQuery(query_str,
				query_params,
				{database: process.env.NEO4J_DB});
		if (summary.counters.updates()['propertiesSet'] >= 1) {
			return true;
		}
	} catch (err) {
		console.log('updateContributorV2() - Error in query: ' + err);
	}
	// something went wrong
	return false;
}

/**
 * Set contributor avatar given ID
 * @param {string} id
 * @param {string} avatar_url
 * @return {Boolean} True if avatar set successfully. False if contributor not found
 */
export async function setContributorAvatarV2(id, avatar_url) {

	const session = driver.session({database: process.env.NEO4J_DB});
	const tx = await session.beginTransaction();
	let query_match = ""
	if (String(id).startsWith("http")) {
        /**
         * Provided id is an OpenID hence check aliases
         */
        query_match = query_match + "MATCH (a:Alias{openid: $id})-[:ALIAS_OF]->(c:Contributor)";
    } else {
        /**
         * Provided id is a user-id hence check contributor
         */
        query_match = query_match + "MATCH (c:Contributor{id: $id})";
    }
	var old_url = "";
	var ret = false;
	try {
		// get exising avatar url
		let query_str = query_match + " " +
			"RETURN c.avatar_url";
		let {records, summ} = await tx.run(query_str,
			{id: id},
			{routing: 'READ', database: process.env.NEO4J_DB});
		if (records.length > 0) {
			old_url = records[0]['_fields'][0];
		}

		// update new avatar url
		query_str = query_match + " " +
			"SET c.avatar_url=$avatar_url";
		let {_, summary} = await tx.run(query_str,
			{id: id, avatar_url: avatar_url},
			{database: process.env.NEO4J_DB});
		if (summary.counters.updates()['propertiesSet'] == 1) {
			ret = true;
		}

		await tx.commit();
	} catch (err) {
		console.log('setContributorAvatar() - Error in query: ' + err);
	} finally {
		await session.close();
	}

	return {result: ret, old_avatar_url: old_url};
}

export async function mergeSecondaryAliasesToPrimary(primary_user_id, secondary_user_id) {
	// convert [a1]-r1->[u1] , [a2]-r2->[u2] to [a1]-r1->[u1]<-r3-[a2]-r2->[u2]
	try {
		let query_str =
			"MATCH (c1:Contributor{id: $primary_user_id})<-[r1:ALIAS_OF]-(a1:Alias) " +
			"MATCH (c2:Contributor{id: $secondary_user_id})<-[r2:ALIAS_OF]-(a2:Alias) " +
			"CREATE (a2)-[r3:ALIAS_OF]->(c1) " +
			"SET a2.is_primary = false"
	} catch (error) {
		console.log('mergeSecondaryAliasesToPrimary() - Error in query: ' + error);
		return false;
	}
}

export async function revertMergeSecondaryAliasesToPrimary(primary_user_id, secondary_user_id) {
	// convert [a1]-r1->[u1]<-r3-[a2]-r2->[u2] to [a1]-r1->[u1] , [a2]-r2->[u2]
	// Just delete the newly created r3..n
	try {
		let query_str =
			"MATCH"
	} catch (error) {
		console.log('revertMergeSecondaryAliasesToPrimary() - Error in query: ' + error);
		return false;
	}
}