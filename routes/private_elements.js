import express from 'express';
import cors from 'cors';
// local imports
import * as utils from '../utils/utils.js';
import * as n4j from '../backend_neo4j.js';
import { jwtCORSOptions, jwtCorsOptions, jwtCorsMiddleware } from '../iguide_cors.js';
import { authenticateJWT, authorizeRole, generateAccessToken } from '../utils/jwtUtils.js';
import {privateElementsRateLimiter} from "../ip_policy.js";

const router = express.Router();

//Addition of rate limiter
router.use(privateElementsRateLimiter);

/**
 * @swagger
 * /api/elements/private/{elementId}:
 *   get:
 *     summary: Retrieve ONE private element using id.
 *     tags: ['private-elements']
 *     parameters:
 *       - in: path
 *         name: elementId
 *         required: true
 *         schema:
 *           type: string
 *         description: The element ID to fetch
 *     responses:
 *       200:
 *         description: JSON Map object for element with given ID
 *       403:
 *         description: Insufficient permission to view this element
 *       404:
 *         description: No element found with given ID
 *       500:
 *         description: Internal server error
 */
router.options('/elements/private/:elementId', jwtCorsMiddleware);
router.get('/elements/private/:elementId', jwtCorsMiddleware, authenticateJWT, async (req, res) => {

	const element_id = decodeURIComponent(req.params['elementId']);
	const {user_id, user_role} = (() => {
	if (!req.user || req.user == null || typeof req.user === 'undefined'){
		return {user_id:null, user_role:null};
	}
	return {user_id:req.user.id, user_role:req.user.role}
	})();

	// 'http://cilogon.org/serverA/users/48835826'
	// const {user_id, user_role} = {user_id: '62992f5f-fd30-41d6-bc19-810cbba752e9',
	// 				  user_role: n4j.Role.TRUSTED_USER};
	try {
	const can_view = await utils.userCanViewElement(element_id, user_id, user_role);
	if (!can_view){
		res.status(403).json({ message: 'Forbidden: You do not have permission to view this element.' });
		return;
	}

	const element = await n4j.getElementByID(element_id, user_id, user_role);
	if (JSON.stringify(element) === '{}'){
		res.status(404).json({ message: 'Element not found' });
		return;
	}

	res.status(200).json(element);
	} catch (error) {
	console.error('/api/resources/:id Error querying:', error);
	res.status(500).json({ message: 'Internal server error' });
	}
});

/**
 * @swagger
 * /api/elements/private:
 *   get:
 *     summary: Retrieve private elements for given user ID
 *     tags: ['private-elements']
 *     parameters:
 *       - in: query
 *         name: user-id
 *         required: true
 *         schema:
 *           type: string
 *         description: The user ID to get private elements for
 *       - in: query
 *         name: sort-by
 *         required: false
 *         schema:
 *           type: string
 *           enum: [click_count, creation_time, title]
 *         description: The field to sort the elements by
 *       - in: query
 *         name: order
 *         required: false
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *         description: Sort order of returned elements
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
 *     responses:
 *       200:
 *         description: List of JSON Map objects for private elements
 *       404:
 *         description: No private elements found for given user ID
 *       500:
 *         description: Internal server error
 */
router.options('/elements/private', jwtCorsMiddleware);
router.get('/elements/private', jwtCorsMiddleware, authenticateJWT, async (req, res) => {

	//const contributor_id = decodeURIComponent(req.params['id']);
	let {'user-id': contributor_id,
	 'sort-by': sort_by,
	 'order': order,
	 'from': from,
	 'size': size} = req.query;

	try {
	const response = await n4j.getElementsByContributor(contributor_id,
								from,
								size,
								sort_by,
								order,
								true
							   );
	if (response['total-count'] === 0){
		res.status(404).json({ message: 'Element not found' });
		return;
	}
	res.status(200).json({elements:response['elements'],
				  'total-count': response['total-count']});
	} catch (error) {
	console.error('Error querying:', error);
	res.status(500).json({ message: 'Internal server error' });
	}
});

export default router;
