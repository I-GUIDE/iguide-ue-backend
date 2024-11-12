import express from 'express';

export const jwtCORSOptions = { credentials: true, origin: `${process.env.FRONTEND_DOMAIN}` }

export const jwtCorsOptions = {
    origin: `${process.env.FRONTEND_DOMAIN}`,
    methods: 'GET, POST, PUT, DELETE, OPTIONS',
    allowedHeaders: 'Origin, X-Requested-With, Content-Type, Accept, Authorization'
};

export const jwtCorsMiddleware = (req, res, next) => {
    res.header('Access-Control-Allow-Credentials', true);
    res.header('Access-Control-Allow-Methods', jwtCorsOptions.methods);
    res.header('Access-Control-Allow-Headers', jwtCorsOptions.allowedHeaders);

    /*const isDev = process.env.NODE_ENV === 'development';

    if (isDev) {
        // Accept any origin in development
        res.header('Access-Control-Allow-Origin', req.headers.origin);
    } else {
        // Use the FRONTEND_DOMAIN in production
        res.header('Access-Control-Allow-Origin', process.env.FRONTEND_DOMAIN);
    }

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }*/
    res.header('Access-Control-Allow-Origin', process.env.FRONTEND_DOMAIN);

    next();
};
