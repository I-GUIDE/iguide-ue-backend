/****************************************************************************
 * User/Contributor Endpoints
 ****************************************************************************/
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
// local imports
import * as utils from '../utils.js';
import * as n4j from '../backend_neo4j.js';
import * as os from '../backend_opensearch.js';
import { jwtCORSOptions, jwtCorsOptions, jwtCorsMiddleware } from '../iguide_cors.js';
import {authenticateAuth, authenticateJWT, authorizeRole, generateAccessToken} from '../jwtUtils.js';
import {checkHPCAccessGrant, checkUpdateParameters, EditableParameters, Role} from "../utils.js";
import {getAllContributors, registerContributorAuth} from "../backend_neo4j.js";
import {performReIndexElementsBasedOnUserId} from "./elements_utils.js";

const router = express.Router();

// Ensure required directories exist
const avatar_dir = path.join(process.env.UPLOAD_FOLDER, 'avatars');
fs.mkdirSync(avatar_dir, { recursive: true });
// Serve static files from the thumbnails directory
router.use('/user-uploads/avatars', express.static(avatar_dir));
// Configure storage for avatars
const avatarStorage = multer.diskStorage({
    destination: (req, file, cb) => {
	cb(null, avatar_dir);
    },
    filename: (req, file, cb) => {
	// It's a good practice to sanitize the original file name
	const sanitizedFilename = file.originalname.replace(/[^a-z0-9.]/gi, '_').toLowerCase();
	cb(null, `${Date.now()}-${sanitizedFilename}`);
    }
});
const uploadAvatar = multer({ storage: avatarStorage });

/**
 * @swagger
 * /api/users/{id}:
 *   get:
 *     summary: Return the user document given the id
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
 *         description: The user document
 *       404:
 *         description: User not found
 *       500:
 *         description: Error fetching the user
 */
//router.options('/users/:id', cors());
router.get('/api/users/:id', cors(), async (req, res) => {
    const id = decodeURIComponent(req.params.id);
    try {
	const response = await n4j.getContributorByID(id);
	if (response.size == 0){
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
 * /api/users:
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
 *           enum: [first_name, last_name, created_at]
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
router.get('/api/users',
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

		const response = await n4j.getAllContributors(from, size, sort_by, sort_order, filter_key, filter_value);
		res.status(200).json(response);
    } catch (error) {
		console.error('Error fetching user list:', error);
		res.status(500).json({ message: 'Error fetching the user list' });
    }
});

/**
 * @swagger
 * /api/users/{id}/role:
 *   put:
 *     summary: Update the user's role
 *     tags: ['users']
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *            properties:
 *               role:
 *                 type: integer
 *     responses:
 *       200:
 *         description: User role updated successfully
 *       404:
 *         description: Provided role id or user id does not exist
 *       500:
 *         description: Error in updating user role
 */
// Handle OPTIONS requests for both methods
router.options('/api/users/:id/role', (req, res) => {
    const method = req.header('Access-Control-Request-Method');
    if (method === 'PUT') {
        res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
        res.header('Access-Control-Allow-Methods', 'PUT');
        res.header('Access-Control-Allow-Headers', jwtCorsOptions.allowedHeaders);
        res.header('Access-Control-Allow-Credentials', 'true');
    } else if (method === 'GET') {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET');
        res.header('Access-Control-Allow-Headers', jwtCorsOptions.allowedHeadersWithoutAuth);
    }
    res.sendStatus(204); // No content
});
router.put('/api/users/:id/role',
		jwtCorsMiddleware,
		authenticateJWT,
		authorizeRole(Role.SUPER_ADMIN),
		async (req, res) => {
	try {
 		const id = decodeURIComponent(req.params.id);
    	const updated_role_body = req.body;

		if (updated_role_body['role'] !== undefined) {
			console.log('Updating user role for userId: ' + id);
			//Check if the new role is a valid role and if the role is till the TRUSTED USER
			let valid_role = true
			let allowed_role = true
			let parsed_role = 0
			try {
				parsed_role = utils.parseRole(updated_role_body['role']);
			} catch (err) {
				console.log('Unrecognized Role found: ', err);
				valid_role = false;
			}
			if (parsed_role <= Role.ADMIN) {
				allowed_role = false
			}
			if (parsed_role === Role.TRUSTED_USER_PLUS) {
				allowed_role = await checkHPCAccessGrant(id);
				if (!allowed_role) {
					res.status(404).json(
						{message: 'Cannot update user role for TRUSTED_USER_PLUS, user should be ACCESS CI (XSEDE) logged in'});
					return;
				}
			}
			if (valid_role && allowed_role) {
				const response = await n4j.updateRoleById(id, parsed_role);
				if (response) {
					res.status(200).json({message: 'User role updated successfully'});
				} else {
					res.status(500).json({message: 'Error in updating user role'});
				}
			} else {
				if (valid_role === false) {
					res.status(404).json({message: 'Provided role id does not exist'});
				} else {
					res.status(404).json({message: 'Cannot update user role above TRUSTED USER'});
				}
			}
		} else {
			res.status(404).json({message: 'User body not containing required attribute'});
		}
	} catch (error) {
		console.error('Error in updating user role: ', error);
		res.status(500).json({message: 'Error in updating user role'});
	}
});

/**
 * @swagger
 * /api/users/{id}/role:
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
router.options('/api/users/:id/role', cors());
router.get('/api/users/:id/role', cors(), async (req, res) => {
    const id = decodeURIComponent(req.params.id);
    try {
	const response = await n4j.getContributorByID(id);
	if (response.size == 0){
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
 * /api/users/{id}/valid:
 *   get:
 *     summary: Check if a user exists given the id
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
router.options('/api/users/:id/valid', cors());
router.get('/api/users/:id/valid', cors(), async (req, res) => {
    const id = decodeURIComponent(req.params.id);

    console.log('Check user ...' + id);
    // [ToDo] Return {true, version_num} OR {false, -1}
    try {
	const response = await n4j.checkContributorByID(id);
	res.status(200).json(response);
    } catch (error) {
	console.error('Error checking user:', error);
	res.status(500).json({ message: 'Error checking the user' });
    }
});

/**
 * @swagger
 * /api/users/avatar:
 *   post:
 *     summary: Upload/update an avatar image for the user profile
 *     tags: ['users']
 *     consumes:
 *       - multipart/form-data
 *     parameters:
 *       - in: formData
 *         name: file
 *         type: file
 *         description: The avatar file to upload
 *       - in: formData
 *         name: id
 *         type: string
 *         description: The user ID
 *     responses:
 *       200:
 *         description: Avatar uploaded successfully
 *       400:
 *         description: No file uploaded
 */
router.options('/api/users/avatar', jwtCorsMiddleware);
router.post('/api/users/avatar', jwtCorsMiddleware, authenticateJWT, uploadAvatar.single('file'), async (req, res) => {
    // if (!req.file) {
    // 	return res.status(400).json({ message: 'No file uploaded' });
    // }

    // const filePath = `https://${process.env.DOMAIN}:${process.env.PORT}/user-uploads/avatars/${req.file.filename}`;

    // res.json({
    // 	message: 'Avatar uploaded successfully',
    // 	url: filePath,
    // });

    try {
	const body = JSON.parse(JSON.stringify(req.body));
	const id = body.id;
	const new_avatar_file = req.file;

	if (!id || !new_avatar_file) {
	    return res.status(400).json({ message: 'ID and new avatar file are required' });
	}

	// Update the user's avatar URL with the new file URL
	// const newAvatarUrl = `https://${process.env.DOMAIN}:${process.env.PORT}/user-uploads/avatars/${newAvatarFile.filename}`;

	const new_avatar_images =
	      utils.generateMultipleResolutionImagesFor(new_avatar_file.filename,
							avatar_dir,
							true);

	// DB only stores the original image
	const new_avatar_image = (new_avatar_images === null) ?
	      null :
	      new_avatar_images['original'];

	const {result, old_avatar_url} =
	      await n4j.setContributorAvatar(id, new_avatar_image);
	if (result == false){
	    return res.status(404).json({ message: 'User not found' });
	}
	if (old_avatar_url) {
	    // Delete the old avatar file
	    const old_avatar_filepath = path.join(avatar_dir, path.basename(old_avatar_url));
	    if (fs.existsSync(old_avatar_filepath)) {
		fs.unlinkSync(old_avatar_filepath);
	    }
	    var ret_message = 'Avatar updated successfully'
	} else {
	    var ret_message = 'Avatar uploaded successfully'
	}

	res.json({
	    message: ret_message,
	    'image-urls': new_avatar_images,
	});
    } catch (error) {
	console.error('Error updating avatar:', error);
	res.status(500).json({ message: 'Internal server error' });
    }

});

/**
 * @swagger
 * /api/users:
 *   post:
 *     summary: Add a new user document
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
router.options('/api/users', jwtCorsMiddleware);
router.post('/api/users', jwtCorsMiddleware, authenticateJWT, async (req, res) => {
    const user = req.body;
    console.log('Adding new user');
    //console.log(user);

    try {
	const id = user['id'];
	console.log("user body while adding user: ", user);
	const response = await n4j.registerContributor(user);
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
 * /api/auth/users:
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
router.options('/api/auth/users', jwtCorsMiddleware);
router.post('/api/auth/users', jwtCorsMiddleware, authenticateAuth, async (req, res) => {

	const user = req.body;
    console.log('Adding new user through auth API');
	console.log("user body while adding user: ", user);
    try {
		const id = user['id'];
		let existing_user = {}
		if (id !== undefined) {
			existing_user = await n4j.getContributorByID(id);
		}
		if (existing_user !== {} && existing_user['id'] !== undefined) {
			res.status(200).json({ message: 'User already exists', user: {id: existing_user.id, role: existing_user.role} });
		} else {
			const response = await n4j.registerContributorAuth(user);

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
 * /api/users/{id}:
 *   put:
 *     summary: Update the user document
 *     tags: ['users']
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the user
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: User updated successfully
 *       403:
 *         description: Failed to edit user. User does not have permission
 *       409:
 *         description: Failed to edit user. Uneditable parameters present
 *       500:
 *         description: Internal server error
 */
// Handle OPTIONS requests for both methods
router.options('/api/users/:id', (req, res) => {
    const method = req.header('Access-Control-Request-Method');
    if (method === 'PUT') {
        res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
        res.header('Access-Control-Allow-Methods', 'PUT');
        res.header('Access-Control-Allow-Headers', jwtCorsOptions.allowedHeaders);
        res.header('Access-Control-Allow-Credentials', 'true');
    } else if (method === 'GET') {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET');
        res.header('Access-Control-Allow-Headers', jwtCorsOptions.allowedHeadersWithoutAuth);
    } else if (method === 'DELETE') {
		res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
        res.header('Access-Control-Allow-Methods', 'DELETE');
        res.header('Access-Control-Allow-Headers', jwtCorsOptions.allowedHeaders);
        res.header('Access-Control-Allow-Credentials', 'true');
	}
    res.sendStatus(204); // No content
});
router.put('/api/users/:id',
	jwtCorsMiddleware,
	authenticateJWT,
	async (req, res) => {
    const id = decodeURIComponent(req.params.id);
    const updates = req.body;

	const {user_id, user_role} = (() => {
		if (!req.user || typeof req.user === 'undefined'){
	    	return {user_id:null, user_role:null};
		}
		return {user_id:req.user.id, user_role:req.user.role}
    })();
	let current_user_details = await n4j.getContributorByID(user_id);

	console.log("user detail from cookie: ", user_id, " detail from db: ", current_user_details['id']);
	let user_permission = true
	if (String(id).startsWith("http")) {
		user_permission = id === current_user_details['openid']
	} else {
		user_permission = id === current_user_details['id']
	}
	if (!user_permission) {
		res.status(403).json({message: 'Failed to edit user. User does not have permission.', result: false});
		return;
	}
	let reindex_os = false;
	let total_public_elements = 0
	/**
	 * Check if the user has contributions and has changed his display_first/last_name then perform the reindexing or else no need.
	 */
	if (updates[EditableParameters.DISPLAY_FIRST_NAME] !== current_user_details['display-first-name'] ||
		updates[EditableParameters.DISPLAY_LAST_NAME] !== current_user_details['display-last-name']) {
		total_public_elements = await n4j.getElementsCountByContributor(user_id);
		if (total_public_elements > 0) {
			reindex_os = true;
		}
	}

    console.log('Updating user ...');
	if (!checkUpdateParameters(updates)) {
		res.status(409).json({message: 'Failed to edit user. Uneditable parameters present.', result: false});
		return;
	}
	/**
	 * To make sure it does not update the id of the contributor
	 */
	if (updates['id']) {
		delete updates['id']
	}
    try {
		const response = await n4j.updateContributor(id, updates);
		if (response) {
			if (reindex_os) {
				let reindex_response = await performReIndexElementsBasedOnUserId(user_id, total_public_elements);
				console.log('Reindex response: ', reindex_response);
			}
		}
		if (response) {
	    	res.json({ message: 'User updated successfully', result: response });
		} else {
	    	console.log('Error updating user');
	    	res.json({ message: 'Error updating user', result: response });
		}
    } catch (error) {
		console.error('Error updating user:', error);
		res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/users/bookmark/{elementId}:
 *   put:
 *     summary: Toggle element bookmark by logged-in user
 *     tags: ['users']
 *     parameters:
 *       - in: path
 *         name: elementId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the element user is trying to (un)bookmark
 *       - in: query
 *         name: bookmark
 *         required: true
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: elementType
 *         required: false
 *         schema:
 *           type: string
 *           enum: [dataset, notebook, publication, oer, map]
 *         description: Type of the element to bookmark. Will make DB querying efficient

 *     responses:
 *       200:
 *         description: Element bookmark set by user successfully
 *       401:
 *         description: Error setting element bookmark. Can be due to multiple reasons i.e. (1) Element does not exists, (2) Invalid contributor ID, (3) Bookamrked relation already exists.
 *       500:
 *         description: Internal server error
 */
router.options('/api/users/bookmark/:elementId', jwtCorsMiddleware);
router.put('/api/users/bookmark/:elementId',
	   jwtCorsMiddleware,
	   authenticateJWT,
	   async (req, res) => {
    const element_id = decodeURIComponent(req.params['elementId']);
    const bookmark = req.query['bookmark'];
    const element_type = (() => {
	if (req.query['elementType']){
	    return utils.parseElementType(req.query['elementType']);
	}
	return null;
    })();
    
    const {user_id, user_role} = (() => {
	if (!req.user || req.user == null || typeof req.user === 'undefined'){
	    return {user_id:null, user_role:null};
	}
	return {user_id:req.user.id, user_role:req.user.role}
    })();

    // 'http://cilogon.org/serverA/users/48835826'
    // const {user_id, user_role} = {user_id: '62992f5f-fd30-41d6-bc19-810cbba752e9',
    // 				  user_role: utils.Role.TRUSTED_USER};

    console.log('User: ' + user_id +
		' setting element: ' + element_id +
		' bookmark: ' + bookmark );
    try {
	const response = await n4j.toggleElementBookmarkByContributor(user_id,
								      element_id,
								      element_type,
								      bookmark);
	if (response) {
	    //res.status(200).json({ message: 'Toggle element bookmark success' });
	    res.json({ message: 'Toggle element bookmark success' });
	} else {
	    console.log('Error setting element bookmark');
	    res.status(401).json({ message: 'Error setting element bookmark' });
	}
    } catch (error) {
	console.error('Error setting element bookmark:', error);
	res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/users/bookmark/{elementId}:
 *   get:
 *     summary: Get whether element is bookmarked by the user or not
 *     tags: ['users']
 *     parameters:
 *       - in: path
 *         name: elementId
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the bookmark element
 *       - in: query
 *         name: elementType
 *         required: false
 *         schema:
 *           type: string
 *           enum: [dataset, notebook, publication, oer, map]
 *         description: Type of the element to bookmark. Will make DB querying efficient

 *     responses:
 *       200:
 *         description: True if element bookmarked by user, False otherwise 
 *       500:
 *         description: Internal server error
 */
router.options('/api/users/bookmark/:elementId', jwtCorsMiddleware);
router.get('/api/users/bookmark/:elementId',
	   jwtCorsMiddleware,
	   authenticateJWT,
	   async (req, res) => {
    const element_id = decodeURIComponent(req.params['elementId']);
    //const user_id = decodeURIComponent(req.params['userId']);
    const element_type = (() => {
	if (req.query['elementType']){
	    return utils.parseElementType(req.query['elementType']);
	}
	return null;
    })();
    
    const {user_id, user_role} = (() => {
	if (!req.user || req.user == null || typeof req.user === 'undefined'){
	    return {user_id:null, user_role:null};
	}
	return {user_id:req.user.id, user_role:req.user.role}
    })();

    // // 'http://cilogon.org/serverA/users/48835826'
    // const {user_id, user_role} = {user_id: '62992f5f-fd30-41d6-bc19-810cbba752e9',
    // 				  user_role: utils.Role.TRUSTED_USER};

    try {
	const response = await n4j.getIfElementBookmarkedByContributor(user_id,
								       element_id,
								       element_type);
	res.status(200).json(response);
    } catch (error) {
	console.error('Error updating user:', error);
	res.status(500).json({ message: 'Internal server error' });
    }
});

// Commenting the swagger definition makes sure the API is not visible in the Swagger Definition
// /**
//  * @swagger
//  * /api/users/{id}:
//  *   delete:
//  *     summary: Delete the user document
//  *     tags: ['users']
//  *     parameters:
//  *       - in: path
//  *         name: id
//  *         required: true
//  *         schema:
//  *           type: string
//  *         description: The OpenID of the user
//  *     responses:
//  *       200:
//  *         description: User deleted successfully
//  *       403:
//  *         description: User cannot be deleted as user has contributions
//  *       409:
//  *         description: User cannot delete another Super Admin
//  *       500:
//  *         description: Internal server error
//  */
router.delete('/api/users/:id',
	jwtCorsMiddleware,
	authenticateJWT,
	authorizeRole(utils.Role.SUPER_ADMIN),
	async (req, res) => {
		let id = decodeURIComponent(req.params.id);

		try {
			/**
			 * Get the all the public elements created by user
			 */
			let public_elements_cnt_resp = await n4j.getElementsCountByContributor(id);
			/**
			 * Get the all the public elements created by user
			 */
			let private_elements_cnt_resp = await n4j.getElementsCountByContributor(id, true);
			if (public_elements_cnt_resp + private_elements_cnt_resp > 0) {
				res.status(409).json({message: 'Failed to delete user. User has public or private contributions.'});
				return;
			}
			/**
			 * Get user details to check SUPER_ADMIN Privileges
			 */
			const user_details = await n4j.getContributorByID(id);
			if (user_details['role'] === 1) {
				res.status(409).json({message: 'Failed to delete user. User cannot delete a Super Admin User'});
				return;
			}
			/**
			 * Delete the user from neo4J
			 */
			// Check to allow deletion from openId
			if (id.startsWith('http')) {
				id = user_details['id']
			}
			const del_resp = await n4j.deleteUserById(id)
			if (del_resp) {
				console.log("Deleting user's avatar image");
				try {
					let avatar_url = user_details['avatar-url'];
					if (avatar_url) {
						for(const type in avatar_url) {
							let avatar_filepath = path.join(avatar_dir, path.basename(avatar_url[type]));
							if (fs.existsSync(avatar_filepath)) {
								fs.unlinkSync(avatar_filepath);
							}
						}
					}
				} catch (error) {
					console.log('Users Delete API - Error in deleting avatar: ' + error);
				}
				res.status(200).json({message: 'User deleted successfully', result: del_resp});
			} else {
				res.status(200).json({message: 'Error in deleting user', result: del_resp});
			}
		} catch (error) {
			console.error('Error deleting user:', error);
			res.status(500).json({message: 'Internal server error'});
		}
	});

export default router;
