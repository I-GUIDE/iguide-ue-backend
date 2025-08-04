import ip from 'ip';
import rateLimit from "express-rate-limit";

// UIUC allowed CIDR ranges
const allowedCIDRs = [
  '72.36.64.0/18',
  '128.174.0.0/16',
  '130.126.0.0/16',
  '192.17.0.0/16',
  '2620:0:e00::/44',
  '10.192.0.0/10', 
  '172.16.0.0/13' 
];

function getClientIP(req) {
  const forwarded = req.headers['x-forwarded-for'];
  let ipAddr = forwarded ? forwarded.split(',')[0].trim() : req.connection.remoteAddress;

  // Handle IPv4-mapped IPv6 addresses (e.g., "::ffff:130.126.255.73")
  if (ipAddr.startsWith('::ffff:')) {
    ipAddr = ipAddr.replace('::ffff:', '');
  }

  return ipAddr;
}

export function restrictToUIUC(req, res, next) {
  const clientIP = getClientIP(req);

  const isAllowed = allowedCIDRs.some(cidr => ip.cidrSubnet(cidr).contains(clientIP));

  if (isAllowed) {
    next();
  } else {
    console.log(`Access denied for IP: ${clientIP}`);
    res.status(403).send("Access restricted to UIUC campus network.");
  }
}

const rateLimiterConfig = {
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 500, // maximum 100 requests per Ip
  message: 'Too many requests from this IP, please try again later.',
  headers: true,
}
// Rate Limiter Configuration for documentation.js
export const documentationRateLimiter = rateLimit(rateLimiterConfig);

// Rate Limiter Configuration for elements.js
export const elementsRateLimiter = rateLimit(rateLimiterConfig);

// Rate Limiter Configuration for private_elements.js
export const privateElementsRateLimiter = rateLimit(rateLimiterConfig);

// Rate Limiter Configuration for search_routes.js
export const searchRoutesRateLimiter = rateLimit(rateLimiterConfig);

// Rate Limiter Configuration for spatial_search_routes.js
export const spatialSearchRoutesRateLimiter = rateLimit(rateLimiterConfig);

// Rate Limiter Configuration for users.js
export const usersRateLimiter = rateLimit(rateLimiterConfig);