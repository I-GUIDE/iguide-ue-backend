import swaggerJsdoc from 'swagger-jsdoc';
import swaggerUi from 'swagger-ui-express';
import dotenv from 'dotenv';
dotenv.config();

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
        url: 'http://backend-dev.i-guide.io:5001',
      },
      {
        url: 'https://backend-dev.i-guide.io:5000',
      },
    ],
  },
  apis: ['./server_dev.js'], // Path to the API docs
};

const specs = swaggerJsdoc(options);

export { specs };

