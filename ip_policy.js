import ip from 'ip';

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