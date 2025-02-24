import request from "supertest";
import app from "../../server.js";
import testData from "./testUserData.json";
import {generateAccessToken} from "../../jwtUtils.js";
import {Role} from "../../utils.js";

/**
 * As the APIs involve the usage of JWT Token for the purposes of the testing we will create 2 test suites with 2 different access
 *  1. ADMIN => The token which allows the admin to insert/get/update/remove the document
 *  2. TRUSTED_USER => The token which allows the user to get the document alone
 * As the JWT Token secret is available in the ENV we will create the token using the jwtUtils functions
 */
const COOKIE_NAME = process.env.JWT_ACCESS_TOKEN_NAME || "access_token";
const target_domain = "localhost"; // Adjust based on your setup

// Helper function to create an admin cookie
const createAuthCookie = (user) => {
  const token = generateAccessToken(user);
  return `${COOKIE_NAME}=${token}; Domain=${target_domain}; Path=/; HttpOnly; Secure`;
};
/**
 *
 * APIs to be tested:
 *  1. Add a new documentation item == POST /api/documentation
 *  2. Retrieve all documentation filtered by given criteria == GET /api/documentation
 *  3. Retrieve the documentation given ID == GET /api/documentation/{id}
 *  4. Update the user document == PUT /api/documentation/{id}
 *  5. Delete a documentation by ID == DELETE /api/documentation/{id}
 *
 */
describe('Documentation Endpoint API Testing from Admin', () => {
    let created_doc_id = ""
    const authCookie = createAuthCookie({ id: 1, role: Role.ADMIN });
    it("1. Should allow ADMIN to add a new documentation", async () => {
        const res = await request(app)
            .post('/api/documentation')
            .set('Cookie',authCookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json")
            .send({"name": testData.docName, "content": testData.docContent});
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message",'Documentation added successfully');
        if (res.body["id"]) {
            created_doc_id = res.body["id"]
        }
    });
    it("2. Should allow ADMIN to view the created documentation", async() => {
       const res = await request(app)
           .get('/api/documentation/' + created_doc_id)
           .set('Cookie', authCookie)
           .set("Accept", "*/*")
           .set("Content-Type", "application/json");
       expect(res.statusCode).toBe(200);
       expect(res.body).toHaveProperty("id",created_doc_id)
       expect(res.body).toHaveProperty("content",testData.docContent);
    });
    it("3. Should allow ADMIN to view all created documentation in range", async() => {
       const res = await request(app)
           .get('/api/documentation'+"?from=0&size=10")
           .set('Cookie', authCookie)
           .set("Accept", "*/*")
           .set("Content-Type", "application/json")
       expect(res.statusCode).toBe(200);
    });
    it("4. Should allow ADMIN to view update any created documentation", async() => {
       const res = await request(app)
           .put('/api/documentation/' + created_doc_id)
           .set('Cookie', authCookie)
           .set("Accept", "*/*")
           .set("Content-Type", "application/json")
           .send({"name": testData.docNewName,"content": testData.docNewContent});
       expect(res.statusCode).toBe(200);
       expect(res.body).toHaveProperty("message", 'Documentation updated successfully')
       expect(res.body).toHaveProperty("result",true);
    });
    it("5. Should return the updated document with the new content", async() => {
       const res = await request(app)
           .get('/api/documentation/' + created_doc_id)
           .set('Cookie', authCookie)
           .set("Accept", "*/*")
           .set("Content-Type", "application/json");
       expect(res.statusCode).toBe(200);
       expect(res.body).toHaveProperty("id",created_doc_id)
       expect(res.body).toHaveProperty("content",testData.docNewContent);
    });
    it("6. Should allow ADMIN to delete the created documentation", async() => {
        const res = await request(app)
            .delete('/api/documentation/' + created_doc_id)
            .set('Cookie', authCookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message",'Documentation deleted successfully');
    })
});

describe('Documentation Endpoint API Testing from Trusted User', () => {
    let created_doc_id = ""
    const authAdminCookie = createAuthCookie({ id: 1, role: Role.ADMIN });
    const authCookie = createAuthCookie({ id: 1, role: Role.TRUSTED_USER });
    /**
     * Create a document as Admin and delete after using
     */
    it("(External) Should create a temp documentation for testing as ADMIN", async () => {
       const res = await request(app)
           .post('/api/documentation')
           .set('Cookie',authAdminCookie)
           .set("Accept", "*/*")
           .set("Content-Type", "application/json")
           .send({"name": testData.docName, "content": testData.docContent});
        if (res.body["id"]) {
            created_doc_id = res.body["id"]
        }
    });
    it("1. Should not allow TRUSTED_USER to add a new documentation", async () => {
        const res = await request(app)
            .post('/api/documentation')
            .set('Cookie',authCookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json")
            .send({"name": testData.docName, "content": testData.docContent});
        expect(res.statusCode).toBe(403);
    });
    it("2. Should allow TRUSTED_USER to view the created documentation", async() => {
       const res = await request(app)
           .get('/api/documentation/' + created_doc_id)
           .set('Cookie', authCookie)
           .set("Accept", "*/*")
           .set("Content-Type", "application/json");
       expect(res.statusCode).toBe(200);
       expect(res.body).toHaveProperty("id",created_doc_id)
       expect(res.body).toHaveProperty("content",testData.docContent);
    });
    it("3. Should allow TRUSTED_USER to view all created documentation in range", async() => {
       const res = await request(app)
           .get('/api/documentation'+"?from=0&size=10")
           .set('Cookie', authCookie)
           .set("Accept", "*/*")
           .set("Content-Type", "application/json")
       expect(res.statusCode).toBe(200);
    });
    it("4. Should now allow TRUSTED_USER update any created documentation", async() => {
       const res = await request(app)
           .put('/api/documentation/' + created_doc_id)
           .set('Cookie', authCookie)
           .set("Accept", "*/*")
           .set("Content-Type", "application/json")
           .send({"name": "New document name","content": "This is new updated content"});
       expect(res.statusCode).toBe(403);
       // expect(res.body).toHaveProperty("message", 'Documentation updated successfully')
       // expect(res.body).toHaveProperty("result",true);
    });
    it("(External) Should delete the temp created documentation as ADMIN", async() => {
        const res = await request(app)
            .delete('/api/documentation/' + created_doc_id)
            .set('Cookie', authAdminCookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message",'Documentation deleted successfully');
    })
});





