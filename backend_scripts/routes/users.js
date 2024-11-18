/****************************************************************************
 * User/Contributor Endpoints
 ****************************************************************************/
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
// local imports
import * as n4j from '../backend_neo4j.js';
import * as os from '../backend_opensearch.js';
import { jwtCORSOptions, jwtCorsOptions, jwtCorsMiddleware } from '../iguide_cors.js';
import { authenticateJWT, authorizeRole, generateAccessToken } from '../jwtUtils.js';

const router = express.Router();

// Ensure required directories exist
const avatar_dir = path.join(process.env.UPLOAD_FOLDER, 'avatars');
console.log(avatar_dir);

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
	res.json(response);
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
	const newAvatarFile = req.file;

	if (!id || !newAvatarFile) {
	    return res.status(400).json({ message: 'ID and new avatar file are required' });
	}

	// Update the user's avatar URL with the new file URL
	const newAvatarUrl = `https://${process.env.DOMAIN}:${process.env.PORT}/user-uploads/avatars/${newAvatarFile.filename}`;

	const {result, oldAvatarUrl} = await n4j.setContributorAvatar(id, newAvatarUrl);
	if (result == false){
	    return res.status(404).json({ message: 'User not found' });
	}
	if (oldAvatarUrl) {
	    // Delete the old avatar file
	    const oldAvatarFilePath = path.join(avatar_dir, path.basename(oldAvatarUrl));
	    if (fs.existsSync(oldAvatarFilePath)) {
		fs.unlinkSync(oldAvatarFilePath);
	    }
	    var ret_message = 'Avatar updated successfully'
	} else {
	    var ret_message = 'Avatar uploaded successfully'
	}

	res.json({
	    message: ret_message,
	    url: newAvatarUrl,
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
 *       500:
 *         description: Internal server error
 */
// Handle OPTIONS requests for both methods
router.options('/api/users/:id', (req, res) => {
    const method = req.header('Access-Control-Request-Method');
    if (method === 'PUT') {
        res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
        res.header('Access-Control-Allow-Methods', 'PUT');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        res.header('Access-Control-Allow-Credentials', 'true');
    } else if (method === 'GET') {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', 'GET');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    }
    res.sendStatus(204); // No content
});
router.put('/api/users/:id', jwtCorsMiddleware, authenticateJWT, async (req, res) => {
    const id = decodeURIComponent(req.params.id);
    const updates = req.body;

    console.log('Updating user ...');

    try {
	const response = await n4j.updateContributor(id, updates);
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
//  *       500:
//  *         description: Internal server error
//  */
// router.delete('/users/:id', async (req, res) => {
//   const openid = decodeURIComponent(req.params.id);

//   try {
//   throw Error('Neo4j: Delete user is not implemented');
//   // const response = await os.client.delete({
//   //     index: 'users',
//   //     id: openid
//   // });

//   // res.json({ message: 'User deleted successfully', result: response.body.result });
//   } catch (error) {
//   console.error('Error deleting user:', error);
//   res.status(500).json({ message: 'Internal server error' });
//   }
// });

export default router;
