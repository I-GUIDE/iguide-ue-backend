/**
 * 1. POST /api/v2/users => Add a new user document version 2 with Alias
 * 2. GET /api/v2/users/{userId} => Get user information with aliases
 * 3. GET /api/v2/users/{id}/role => Return the user role given the id
 * 4. GET /api/v2/users/{id}/valid => Check if a user exists given the id/openId
 * 5. GET /api/v2/users/alias/{userId}/primary => get user's primary alias for the given user_id
 * 6. GET /api/v2/users => Return all users (with filter for user)
 * 7. POST /api/v2/auth/users => Add a new user document for authorized server
 * 8. DELETE /api/users => Delete user document created through authorized server
 * 9. MERGE 2 users
 */

import request from "supertest";
import app from "../../server.js";
import testData from "./test_user_data.json";
import {generateAccessToken} from "../../jwtUtils.js";
import {Role} from "../../utils.js";
import * as url from "node:url";
import path from "path";

/**
 * As the APIs involve the usage of JWT Token for the purposes of the testing we will create 2 test suites with 2 different access
 *  1. ADMIN => The token which allows the admin to insert/get/update/remove the document
 *  2. TRUSTED_USER => The token which allows the user to get the document alone
 * As the JWT Token secret is available in the ENV we will create the token using the jwtUtils functions
 */
const COOKIE_NAME = process.env.JWT_ACCESS_TOKEN_NAME || "access_token";
const target_domain = "localhost"; // Adjust based on your setup

// Convert __dirname to ESM equivalent
const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


// Helper function to create an admin cookie
const createAuthCookie = (user) => {
    const token = generateAccessToken(user);
    return `${COOKIE_NAME}=${token}; Domain=${target_domain}; Path=/; HttpOnly; Secure`;
};

describe("Users V2 Endpoint API Testing", () => {
    let generated_user_id = ""
    it("1. Should allow to create a new user", async () => {
        let user_body = testData.trusted_user
        let generated_auth_cookie = createAuthCookie({id: testData.trusted_user.openid, role: Role.TRUSTED_USER});
        const res = await request(app)
            .post('/api/v2/users')
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json")
            .send(user_body);
        expect(res.statusCode).toBe(201);
        expect(res.body).toHaveProperty("message", 'User added successfully');
    });
    it("2. Should be able to get user details based on provided open_id", async () => {
        let generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
        let encoded_openid = encodeURIComponent(testData.trusted_user.openid);
        const res = await request(app)
            .get('/api/v2/users/' + encoded_openid)
            .set('Cookie', generated_auth_cookie)
           .set('Accept', '*/*')
           .set('Content-Type',"application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("openid", testData.trusted_user.openid);
        expect(res.body).toHaveProperty("first-name", testData.trusted_user.first_name);
        expect(res.body).toHaveProperty("last-name", testData.trusted_user.last_name);
        expect(res.body).toHaveProperty("email", testData.trusted_user.email);
        expect(res.body).toHaveProperty("aliases");
        generated_user_id = res.body['id'];
    });
    it("3. Should allow user to fetch the user's role", async () => {
        let encoded_id = encodeURIComponent(testData.trusted_user.openid);
        let generated_auth_cookie = createAuthCookie({id: testData.trusted_user.openid, role: Role.TRUSTED_USER});
        const res = await request(app)
            .get('/api/v2/users/' + encoded_id + '/role')
            .set('Cookie', generated_auth_cookie)
            .set('Accept', '*/*')
            .set('Content-Type',"application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('role', Role.TRUSTED_USER);
    });
    it("4. Should not allow any other random user to fetch user's role", async () => {
        let encoded_id = encodeURIComponent(testData.trusted_user.openid);
        let generated_auth_cookie = createAuthCookie({id: "radnom-e123-user", role: Role.TRUSTED_USER});
        const res = await request(app)
            .get('/api/v2/users/' + encoded_id + '/role')
            .set('Cookie', generated_auth_cookie)
            .set('Accept', '*/*')
            .set('Content-Type',"application/json");
        expect(res.statusCode).toBe(403);
        expect(res.body).toHaveProperty('message', 'User is not permitted to perform this action.');
    });
    it("5. Should allow user to check if the user is valid", async () => {
        let encoded_id = encodeURIComponent(testData.trusted_user.openid);
        let generated_auth_cookie = createAuthCookie({id: testData.trusted_user.openid, role: Role.TRUSTED_USER});
        const res = await request(app)
            .get('/api/v2/users/' + encoded_id + '/valid')
            .set('Cookie', generated_auth_cookie)
            .set('Accept', '*/*')
            .set('Content-Type',"application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toBe(true);
    });
    it("6. Should return user details if it already exists in /auth/users API", async () => {
        let user_body = testData.trusted_user
        user_body['id'] = generated_user_id;
        const res = await request(app)
            .post('/api/v2/auth/users')
            .set(process.env.AUTH_API_KEY, process.env.AUTH_API_KEY_VALUE)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json")
            .send(user_body);
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message", 'User already exists');
        expect(res.body).toHaveProperty('user', {id: generated_user_id, role: Role.TRUSTED_USER});
    });
    let temp_created_user_id = ""
    it("7. Should create user details if it does not exist in /auth/users API", async () => {
        let user_body = testData.elements_trusted_user
        const res = await request(app)
            .post('/api/v2/auth/users')
            .set(process.env.AUTH_API_KEY, process.env.AUTH_API_KEY_VALUE)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json")
            .send(user_body);
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message", 'User created successfully');
        expect(res.body).toHaveProperty('user');
        temp_created_user_id = res.body['user']['id'];
    });
    it("(External) Delete the newly created user through SUPER_ADMIN", async () => {
        let generated_auth_super_admin_cookie = createAuthCookie({id: 1, role: Role.SUPER_ADMIN});
        const res = await request(app)
            .delete("/api/users/" + temp_created_user_id)
            .set('Cookie', generated_auth_super_admin_cookie)
            .set("Accept", "*/*")
            .set('Content-Type', "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message", 'User deleted successfully')
    });
    it("8. Should allow only SUPER_ADMIN to delete user", async () => {
        let generated_auth_super_admin_cookie = createAuthCookie({id: 1, role: Role.SUPER_ADMIN});
        const res = await request(app)
            .delete("/api/users/" + generated_user_id)
            .set('Cookie', generated_auth_super_admin_cookie)
            .set("Accept", "*/*")
            .set('Content-Type', "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message", 'User deleted successfully')
    });
    it("9. SUPER_ADMIN should be allowed to view all users", async () => {
       let generated_auth_cookie = createAuthCookie({id: 1, role: Role.SUPER_ADMIN});
       let request_params = '?from=0&size=10'
       const res = await request(app)
           .get('/api/v2/users' + request_params)
           .set('Cookie', generated_auth_cookie)
           .set('Accept', '*/*')
           .set('Content-Type',"application/json");
       expect(res.statusCode).toBe(200);
       expect(res.body).toHaveProperty('total-users');
       expect(res.body).toHaveProperty('users');
    });
});