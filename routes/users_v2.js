import express from 'express';
import cors from 'cors';
import * as n4j from '../backend_neo4j.js';
import { jwtCORSOptions, jwtCorsOptions, jwtCorsMiddleware } from '../iguide_cors.js';
import {authenticateAuth, authenticateJWT, authorizeRole} from '../jwtUtils.js';
import {parse64BitNumber, performUserCheck, Role} from "../utils.js";
import {
	checkAliasIsPrimary,
	checkIfAliasExists,
	getPrimaryAliasById,
} from "../backend_neo4j.js";

const router = express.Router();


/**
 * @swagger
 * /api/v2/users:
 *   get:
 *     summary: Return all users
 *     tags: ['users']
 *     parameters:
 *       - in: query
 *         name: from
 *         required: true
 *         schema:
 *           type: integer
 *         description: The offset value for pagination
 *       - in: query
 *         name: size
 *         required: true
 *         schema:
 *           type: integer
 *         description: The limit value for pagination
 *       - in: query
 *         name: sort-by
 *         required: true
 *         schema:
 *           type: string
 *           enum: [first_name, last_name]
 *           default: first_name
 *         description: Sorting order for the values
 *       - in: query
 *         name: sort-order
 *         required: false
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: asc
 *         description: Sorting order for the values
 *       - in: query
 *         name: filter-name
 *         required: true
 *         schema:
 *           type: string
 *           enum: [none, role-no, affiliation, first-name, last-name]
 *           default: none
 *         description: Filter attribute for the values
 *       - in: query
 *         name: filter-value
 *         required: false
 *         schema:
 *           type: string
 *         description: Filter attribute value for the values
 *     responses:
 *       200:
 *         description: All user documents found
 *       500:
 *         description: Error fetching the user list
 */
router.options('/api/v2/users', cors());
router.get('/api/v2/users',
		jwtCorsMiddleware,
		authenticateJWT,
		authorizeRole(Role.SUPER_ADMIN),
		async (req, res) => {
    try {
		const {
	    	'from': from,
	    	'size': size,
			'sort-by': sort_by,
			'sort-order': sort_order,
			'filter-name': filter_key,
			'filter-value': filter_value
		} = req.query;

		const response = await n4j.getAllContributorsV2(from, size, sort_by, sort_order, filter_key, filter_value);
		res.status(200).json(response);
    } catch (error) {
		console.error('Error fetching user list:', error);
		res.status(500).json({ message: 'Error fetching the user list' });
    }
});

/**
 * @swagger
 * /api/v2/users/{id}/role:
 *   get:
 *     summary: Return the user role given the id
 *     tags: ['users']
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the user
 *     responses:
 *       200:
 *         description: The user role i.e. admin, user
 *       404:
 *         description: User not found
 *       500:
 *         description: Error fetching the user
 */
router.options('/api/v2/users/:id/role', cors());
router.get('/api/v2/users/:id/role',
		jwtCorsMiddleware,
		authenticateJWT,
		async (req, res) => {
    const id = decodeURIComponent(req.params.id);
	if (performUserCheck(req, id) === false) {
		res.status(403).json({message: 'User is not permitted to perform this action.'});
		return;
	}
    try {
		const response = await n4j.getContributorByIDv2(id);
		if (response?.size){
	    	return res.status(404).json({ message: 'User not found' });
		}
		let ret = {'role' : response['role']};
		res.json(ret);
    } catch (error) {
		console.error('Error fetching user:', error);
		res.status(500).json({ message: 'Error fetching the user' });
    }
});

/**
 * @swagger
 * /api/v2/users/{id}/valid:
 *   get:
 *     summary: Check if a user exists given the id/openId
 *     tags: ['users']
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the user
 *     responses:
 *       200:
 *         description: True if user exists, false otherwise
 *       500:
 *         description: Error checking the user
 */
router.options('/api/v2/users/:id/valid', cors());
router.get('/api/v2/users/:id/valid', cors(), async (req, res) => {
    const id = decodeURIComponent(req.params.id);

    console.log('Check user ...' + id);
    try {
		const response = await n4j.checkContributorByIDV2(id);
		res.status(200).json(response);
    } catch (error) {
		console.error('Error checking user:', error);
		res.status(500).json({ message: 'Error checking the user' });
    }
});

/**
 * @swagger
 * /api/v2/auth/users:
 *   post:
 *     summary: Add a new user document for authorized server
 *     tags: ['users']
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *     responses:
 *       200:
 *         description: User added successfully or already presented user provided
 *       500:
 *         description: Internal server error
 */
router.options('/api/v2/auth/users', jwtCorsMiddleware);
router.post('/api/v2/auth/users',
	jwtCorsMiddleware,
	authenticateAuth,
	async (req, res) => {

	const user = req.body;
    console.log('Adding new user');

    try {
		const id = user['id'];
		let existing_user = {}
		if (id !== undefined) {
			existing_user = await n4j.getContributorByIDv2(id);
		}
		if (existing_user !== {} && existing_user['id'] !== undefined) {
			res.status(200).json({ message: 'User already exists', user: {id: existing_user.id, role: existing_user.role} });
		} else {
			const response = await n4j.registerContributorAuthV2(user);

			if (response['id'] !== undefined) {
				res.status(200).json({message: 'User created successfully', user: {id: response.id, role: response.role}});
			} else {
				res.status(500).json({message: 'Error in creating user'});
			}
		}

    } catch (error) {
		console.error('Error adding user:', error);
		res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/v2/users:
 *   post:
 *     summary: Add a new user document version 2 with Alias
 *     tags: ['users']
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *               name:
 *                 type: string
 *               email:
 *                 type: string
 *     responses:
 *       201:
 *         description: User added successfully
 *       500:
 *         description: Internal server error
 */
router.options('/api/v2/users',
	jwtCorsMiddleware
);
router.post('/api/v2/users',
	jwtCorsMiddleware,
	authenticateJWT,
	async (req, res) => {

    const user = req.body;
    console.log('Adding new user');
    //console.log(user);

    try {
		const id = user['id'];
		const response = await n4j.registerContributorV2(user);
		if (response){
	    	res.status(201).json({ message: 'User added successfully', id: id });
		} else {
	    	res.status(201).json({ message: 'User already exists', id: id });
	    	console.log('User already exists with id: ' + id);
		}
		// [ToDo] Add contributor name to OpenSearch

		// const response = await os.client.index({
		//     index: 'users',
		//     id: user.openid,
		//     body: user,
		//     refresh:'wait-for'
		// });
		//res.status(201).json({ message: 'User added successfully', id: response.body._id });
    } catch (error) {
		console.error('Error adding user:', error);
		res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/v2/users/{userId}:
 *   get:
 *     summary: Get user information with aliases
 *     tags: ['users']
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: The userId of the user
 *     responses:
 *       200:
 *         description: Return the user document with all aliases
 *       404:
 *         description: User not found
 *       500:
 *         description: Internal server error
 */
router.options('api/v2/users/:id', cors());
router.get('/api/v2/users/:id', cors(), async (req, res) => {
    const id = decodeURIComponent(req.params.id);
    try {
		const response = await n4j.getContributorByIDv2(id);
		if (response.size === 0){
	    	return res.status(404).json({ message: 'User not found' });
		}
		// remove role attribute
		delete response['role'];
		res.status(200).json(response);
    } catch (error) {
		console.error('Error fetching user:', error);
		res.status(500).json({ message: 'Error fetching the user' });
    }
});

/**
 * @swagger
 * /api/v2/users/alias/{userId}:
 *   put:
 *     summary: Add a new alias for the given userId
 *     tags: ['users']
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: The userId of the user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - openid
 *               - email
 *               - affiliation
 *             properties:
 *               openid:
 *                 type: string
 *                 description: The OpenID for the alias
 *                 example: "http://cilogon.org/serverTest/users/22364"
 *               email:
 *                 type: string
 *                 format: email
 *                 description: The email associated with the alias
 *                 example: "iguide.test@example.com"
 *               affiliation:
 *                 type: string
 *                 description: Affiliation of the user for this alias
 *                 example: "University of Illinois at Urbana-Champaign"
 *     responses:
 *       200:
 *         description: User alias successfully added with the alias document
 *       500:
 *         description: Internal server error in adding alias
 */


router.options('/api/v2/users/alias/:id', (req, res) => {
	res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
    res.header('Access-Control-Allow-Methods', jwtCorsOptions.methods);
	res.header('Access-Control-Allow-Headers', jwtCorsOptions.allowedHeaders);
	res.header('Access-Control-Allow-Credentials', 'true');
    res.sendStatus(204); // No content
});
router.put('/api/v2/users/alias/:id',
		jwtCorsMiddleware,
		authenticateJWT,
		async (req, res) => {
	try {
		const user_id = decodeURIComponent(req.params.id);
		if (performUserCheck(req, user_id)) {
			res.status(403).json({message: 'User is not permitted to perform this action.'});
			return;
		}
    	const alias_body = req.body;
		const response = await n4j.createAliasById(user_id, alias_body.open_id, alias_body.email, alias_body.affiliation, false);
		res.status(200).json(response);
	} catch (error) {
		console.error('Error in creating user alias: ', error);
		res.status(500).json({message: 'Error in adding user alias.'});
	}
});

/**
 * @swagger
 * /api/v2/users/alias/{userId}/primary:
 *   get:
 *     summary: get user's primary alias for the given user_id
 *     tags: ['users']
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: The userId of the user
 *     responses:
 *       200:
 *         description: User's primary alias successfully retrieved.
 *       500:
 *         description: Internal server error in updating primary alias
 */
router.options('/api/v2/users/alias/:id/primary', (req, res) => {
	res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
    res.header('Access-Control-Allow-Methods', jwtCorsOptions.methods);
	res.header('Access-Control-Allow-Headers', jwtCorsOptions.allowedHeaders);
	res.header('Access-Control-Allow-Credentials', 'true');
    res.sendStatus(204); // No content
});
router.get('/api/v2/users/alias/:id/primary', cors(),
		async (req, res) => {
	try {
		const user_id = decodeURIComponent(req.params.id);
		if (performUserCheck(req, user_id)) {
			res.status(403).json({message: 'User is not permitted to perform this action.'});
			return;
		}
		const curr_alias = await getPrimaryAliasById(user_id);
		res.status(200).json(curr_alias);
	} catch (error) {
		console.error('Error in updating user role: ', error);
		res.status(500).json({message: 'Error in updating user primary alias'});
	}
});

/**
 * @swagger
 * /api/v2/users/alias/{userId}/primary:
 *   post:
 *     summary: Update user's primary alias for the given openId
 *     tags: ['users']
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: The userId of the user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               openid:
 *                 type: string
 *                 description: The OpenID to set as primary
 *                 example: "http://cilogon.org/serverTest/users/22364"
 *     responses:
 *       200:
 *         description: User's primary alias successfully updated.
 *       404:
 *         description: Given OpenId does not exist for the user.
 *       409:
 *         description: Given OpenId is already a primary alias for the user.
 *       500:
 *         description: Internal server error in updating primary alias
 */
router.post('/api/v2/users/alias/:id/primary',
		jwtCorsMiddleware,
		authenticateJWT,
		async (req, res) => {
	try {
		const user_id = decodeURIComponent(req.params.id);
		if (performUserCheck(req, user_id)) {
			res.status(403).json({message: 'User is not permitted to perform this action.'});
			return;
		}
    	const alias_body = req.body;
		const alias_exists = await checkIfAliasExists(user_id, alias_body.openid);
		if (!alias_exists) {
			res.status(404).json({message: "Given OpenId does not exist."});
			return;
		}
		const curr_alias = await getPrimaryAliasById(user_id);
		if (curr_alias?.openid && curr_alias?.openid === alias_body.openid) {
			res.status(409).json({message: 'Given OpenId is already the primary alias.'});
			return;
		}
		const response = await n4j.setAliasAsPrimary(user_id, curr_alias.openid, alias_body.openid);
		if (response === null) {
			res.status(500).json({message: 'Error in updating user primary alias.'})
		} else {
			res.status(200).json(response);
		}
	} catch (error) {
		console.error('Error in updating user role: ', error);
		res.status(500).json({message: 'Error in updating user primary alias'});
	}
});

/**
 * @swagger
 * /api/v2/users/alias/{userId}:
 *   delete:
 *     summary: Delete a user's alias
 *     tags: ['users']
 *     parameters:
 *       - in: path
 *         name: userId
 *         required: true
 *         schema:
 *           type: string
 *         description: The userId of the user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               openid:
 *                 type: string
 *                 description: The OpenID alias to delete
 *                 example: "http://cilogon.org/serverTest/users/22364"
 *     responses:
 *       200:
 *         description: Given alias for user is successfully deleted.
 *       409:
 *         description: Given OpenId is a primary alias for the user. Hence, cannot be deleted.
 *       500:
 *         description: Internal server error in removing alias
 */
router.delete('/api/v2/users/alias/:id',
		jwtCorsMiddleware,
		authenticateJWT,
		async (req, res) => {
	try {
		const user_id = decodeURIComponent(req.params.id);
		if (performUserCheck(req, user_id)) {
			res.status(403).json({message: 'User is not permitted to perform this action.'});
			return;
		}
    	const alias_body = req.body;
		const is_primary = await checkAliasIsPrimary(user_id, alias_body.openid)
		if (is_primary) {
			console.log("Cannot delete alias which is primary");
			res.status(409).json({message: 'Cannot delete alias as it is primary email'});
			return;
		}
		const response = await n4j.deleteAliasByOpenId(user_id, alias_body.open_id)
		res.status(200).json(response);
	} catch (error) {
		console.error('Error in updating user role: ', error);
		res.status(500).json({message: 'Error in updating user role'});
	}
});

router.post('/api/v2/users/merge',
	jwtCorsMiddleware,
	authenticateJWT,
	authorizeRole(Role.SUPER_ADMIN),
	async (req, res) => {
	try {

	} catch (error) {
		console.error('Error in merging accounts: ', error);
		res.status(500).json({message: 'Error in merging accounts'});
	}

});

export default router;