/****************************************************************************
 * Documentation Endpoints
 ****************************************************************************/
import express from 'express';
import cors from 'cors';
import multer from 'multer';
// local imports
import * as n4j from '../backend_neo4j.cjs'
import { jwtCORSOptions, jwtCorsOptions, jwtCorsMiddleware } from '../iguide_cors.js'
import { authenticateJWT, authorizeRole, generateAccessToken } from '../jwtUtils.js';

const router = express.Router();

/**
 * @swagger
 * /api/documentation/{id}:
 *   get:
 *     summary: Retrieve the documentation given ID
 *     tags: ['documentation']
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The URL to retrieve the title from
 *     responses:
 *       200:
 *         description: The documentation object Map with given ID
 *       404:
 *         description: Documentation not found
 *       500:
 *         description: Failed to retrieve documentation
 */
router.options('/documentation', (req, res) => {
    const method = req.header('Access-Control-Request-Method');
    if (method === 'POST') {
        res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
        res.header('Access-Control-Allow-Methods', 'POST');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        res.header('Access-Control-Allow-Credentials', 'true');
    } else {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', method);
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    }
    res.sendStatus(204); // No content
});

router.options('/documentation/:id', (req, res) => {
    const method = req.header('Access-Control-Request-Method');
    if (method === 'PUT') {
        res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
        res.header('Access-Control-Allow-Methods', 'PUT');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        res.header('Access-Control-Allow-Credentials', 'true');
    } else if (method === 'DELETE') {
        res.header('Access-Control-Allow-Origin', jwtCORSOptions.origin);
        res.header('Access-Control-Allow-Methods', 'DELETE');
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
        res.header('Access-Control-Allow-Credentials', 'true');
    }else {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Methods', method);
        res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    }
    res.sendStatus(204); // No content
});
router.get('/documentation/:id', cors(), async (req, res) => {
    const doc_id = decodeURIComponent(req.params['id']);
    try {
	const documentation = await n4j.getDocumentationByID(doc_id);
	if (JSON.stringify(documentation) === '{}'){
	    return res.status(404).json({ message: 'Documentation not found' });
	}
	res.status(200).json(documentation);
    } catch (error) {
	console.log(error);
	res.status(500).json({ error: 'Failed to retrieve documentation with id: ' + doc_id});
    }
});

/**
 * @swagger
 * /api/documentation:
 *   get:
 *     summary: Retrieve all documentation filtered by given criteria
 *     tags: ['documentation']
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
 *     responses:
 *       200:
 *         description: The list of documentation object with given ID
 *       404:
 *         description: Documentation not found
 *       500:
 *         description: Failed to retrieve title
 */
router.get('/documentation', cors(), async (req, res) => {
        let {
	  'from': from,
	  'size': size} = req.query;

    try {
	const documentation = await n4j.getAllDocumentation(from, size);
	if (documentation.length == 0){
	    return res.status(404).json({ message: 'No Documentation found' });
	}
	res.status(200).json({documentation:documentation, 'total-count': documentation.length});
    } catch (error) {
	console.log(error);
	res.status(500).json({ error: 'Failed to retrieve documentations'});
    }
});

/**
 * @swagger
 * /api/documentation:
 *   post:
 *     summary: Add a new documentation item
 *     tags: ['documentation']
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               content:
 *                 type: string
 *     responses:
 *       200:
 *         description: Documentation added successfully
 *       400:
 *         description: Error adding documentation in DB
 *       500:
 *         description: Internal server error
 */
router.post('/documentation', jwtCorsMiddleware, authenticateJWT, authorizeRole(n4j.Role.ADMIN), async (req, res) => {
    const documentation = req.body;
    try {
	const {response, documentation_id} = await n4j.registerDocumentation(documentation);

	if (response){
	    res.status(200).json({ message: 'Documentation added successfully',
				   id: documentation_id });
	} else {
	    res.status(400).json({ message: 'Error adding documentation'});
	}
    } catch (error) {
	console.error('Error adding documentation:', error);
	res.status(500).json({ message: 'Internal server error' });
    }
});
/**
 * @swagger
 * /api/documentation/{id}:
 *   put:
 *     summary: Update the user document
 *     tags: ['documentation']
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: The ID of the documentation
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               content:
 *                 type: string
 *     responses:
 *       200:
 *         description: User updated successfully
 *       400:
 *         description: Error updating documentation
 *       500:
 *         description: Internal server error
 */
router.put('/documentation/:id', jwtCorsMiddleware, authenticateJWT, authorizeRole(n4j.Role.ADMIN), async (req, res) => {
    const id = decodeURIComponent(req.params.id);
    const updates = req.body;

    try {
	const response = await n4j.updateDocumentation(id, updates);
	if (response) {
	    res.status(200).json({ message: 'Documentation updated successfully', result: response });
	} else {
	    console.log('Error updating user');
	    res.status(400).json({ message: 'Error updating documentation', result: response });
	}
    } catch (error) {
	console.error('Error updating user:', error);
	res.status(500).json({ message: 'Internal server error' });
    }
});

/**
 * @swagger
 * /api/documentation/{id}:
 *   delete:
 *     summary: Delete a documentation by ID
 *     tags: ['documentation']
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Documentation deleted successfully
 *       500:
 *         description: Internal server error
 */
router.delete('/documentation/:id', jwtCorsMiddleware, authenticateJWT, authorizeRole(n4j.Role.ADMIN), async (req, res) => {
    const doc_id = req.params['id'];

    try {
	const response = await n4j.deleteDocumentationByID(doc_id);
	if (response) {
	    res.status(200).json({ message: 'Documentation deleted successfully' });
	} else {
	    res.status(500).json({ error: 'Documentation still exists after deletion' });
	}
    } catch (error) {
	console.error('Error deleting documentation:', error.message);
	res.status(500).json({ error: error.message });
    }
});

export default router;
