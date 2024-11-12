import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import dotenv from 'dotenv';
dotenv.config();

const HOST = process.env.DOMAIN;
const PORT = process.env.PORT;
const HTTP_PORT = parseInt(PORT, 10)+1;

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'I-GUIDE Platform Backend API Documentation',
      version: '0.1.0',
      description: `API documentation for the i-guide platform ${process.env.SERV_TAG} backend`,
    },
    servers: [
      {
          url: `https://${HOST}:${PORT}`,
      },
	{
          url: `http://${HOST}:${HTTP_PORT}`, 
      },
    ],
  },
  apis: [
      './server_neo4j.js'
      //, './routes/*.js'
      , './routes/search_routes.js'
      , './routes/private_elements.js'
      , './routes/users.js'
      , './routes/documentation.js'
  ], // Path to the API docs
};

const specs = swaggerJsdoc(options);

export { specs };

