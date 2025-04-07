import jwt from 'jsonwebtoken';
import { Client } from '@opensearch-project/opensearch';

const os_node = process.env.OPENSEARCH_NODE;
const os_usr = process.env.OPENSEARCH_USERNAME;
const os_pswd = process.env.OPENSEARCH_PASSWORD;
const os_index = process.env.OPENSEARCH_INDEX;

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

export const authenticateJWT = (req, res, next) => {
  // updated to new variable name 
  const token = req.cookies[process.env.JWT_ACCESS_TOKEN_NAME]
  // Special case to handle JWT APIs
  if (checkJWTTokenBypass(req)) {
    next();
  }
  else if (token) {
    jwt.verify(token, process.env.JWT_ACCESS_TOKEN_SECRET, (err, user) => {
      if (err) {
        if (err.name === 'TokenExpiredError') {
          return res.status(401).json({ message: 'Token expired' });
        }
        return res.sendStatus(403); // Forbidden if token is invalid
      }

      req.user = user;
      next();
    });
  } else {
    return res.status(403).json({ message: 'Token not available' });
  }
};


// Middleware to check if the user has the required role
export const authorizeRole = (requiredRole) => (req, res, next) => {
  // Special case to handle JWT APIs
  if (checkJWTTokenBypass(req)) {
    next();
  }
  else if (req.user && req.user.role <= requiredRole) {
    // User's role is less than or equal to the required role
    next();
  } else {
    // User does not have sufficient permissions
    res.status(403).json({ message: 'Forbidden' });
  }
};


// Store refresh token in OpenSearch
export const storeRefreshToken = async (token, user_id) => {
  await client.index({
    index: 'refresh_tokens',
    body: {
      token,
      user_id,
      created_at: new Date()
    }
  });
};

/**
 * This function bypasses JWT Token check for Dev environment testing
 * @param req
 * @returns {boolean}
 */
export const checkJWTTokenBypass = (req) => {
  if (process.env.NODE_ENV !== "development") {
    return false;
  }
  const api_key = process.env.JWT_API_KEY_VALUE ? process.env.JWT_API_KEY_VALUE : "";
  if (api_key === "") {
    return false;
  }
  const header_key = process.env.JWT_API_KEY ? req.header(process.env.JWT_API_KEY) : "";
  if (api_key === header_key) {
    return true;
  } else {
    return false;
  }
}
// Generate an access token
export const generateAccessToken = (user) => {
  return jwt.sign(user, process.env.JWT_ACCESS_TOKEN_SECRET, { expiresIn: '1h' });
};

