import express from 'express';

export const jwtCORSOptions = { credentials: true, origin: `${process.env.FRONTEND_DOMAIN}` }

const allowedOrigins = process.env.ALLOWED_DOMAIN_LIST ? JSON.parse(process.env.ALLOWED_DOMAIN_LIST) : [`${process.env.FRONTEND_DOMAIN}`]

export const jwtCorsOptions = {
    origin: `${process.env.FRONTEND_DOMAIN}`,
    methods: 'GET, POST, PUT, DELETE, OPTIONS',
    allowedHeaders: 'Origin, X-Requested-With, Content-Type, Accept, Authorization, JWT-API-KEY',
    allowedHeadersWithoutAuth: 'Origin, X-Requested-With, Content-Type, Accept, JWT-API-KEY'
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
    if (allowedOrigins.length > 1) {
        const origin = req.headers.origin;
        if (!origin || allowedOrigins.includes(origin)) {
            res.header('Access-Control-Allow-Origin', origin);
        } else {
            res.header('Access-Control-Allow-Origin', process.env.FRONTEND_DOMAIN);
        }
    } else {
        res.header('Access-Control-Allow-Origin', process.env.FRONTEND_DOMAIN);
    }

    next();
};
