/**
 *
 * 1. POST /api/users  == Add a new user document
 * 2. GET /api/users/{id} == Return the user document given the id
 * 3. PUT /api/users/{id} == Update the user document
 * 4. GET /api/users/{id} == Return the updated user document given the id
 * 5. GET /api/users/{id}/role == Return the user role given the id
 * 6. GET /api/users/{id}/valid == Check if a user exists given the id
 * 7. POST /api/users/avatar == Upload/update an avatar image for the user profile
 *
 * **Need to create a temp element to play around**
 * PUT /api/users/bookmark/{elementId} == Toggle element bookmark by logged-in user
 * GET /api/users/bookmark/{elementId} == Get whether element is bookmarked by the user or no
 *
 * ** Delete element after creation **
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

describe("Users Endpoint API Testing from a Trusted User", () => {

    let generated_auth_cookie = createAuthCookie({id: 1, role: Role.TRUSTED_USER});
    let generated_auth_super_admin_cookie = createAuthCookie({id: 1, role: Role.SUPER_ADMIN});
    let generated_user_id = testData.trusted_user_id
    let generated_element_id = ""
    it("1. Should allow to create a new user", async () => {
        let user_body = testData.trusted_user
        const res = await request(app)
            .post('/api/users')
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json")
            .send(user_body);
        expect(res.statusCode).toBe(201);
        expect(res.body).toHaveProperty("message", 'User added successfully');
    });
    it("2. Should allow the user to fetch user details", async () => {
        let user_open_id_encoded = encodeURIComponent(testData.trusted_user.openid);
        const res = await request(app)
            .get('/api/users/' + user_open_id_encoded)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("openid", testData.trusted_user.openid);
        expect(res.body).toHaveProperty("first-name", testData.trusted_user.first_name);
        expect(res.body).toHaveProperty("last-name", testData.trusted_user.last_name);
        expect(res.body).toHaveProperty("email", testData.trusted_user.email);
        generated_user_id = res.body['id'];
    });
    it("3. Should allow the user to fetch their validity", async () => {
        let user_open_id_encoded = encodeURIComponent(testData.trusted_user.openid);
        const res = await request(app)
            .get('/api/users/' + user_open_id_encoded + "/valid")
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toBe(true);
    });
    it("4. Should allow the user to fetch their current role", async () => {
        let user_open_id_encoded = encodeURIComponent(testData.trusted_user.openid);
        const res = await request(app)
            .get('/api/users/' + user_open_id_encoded + "/role")
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("role", 8);
    });
    it("5. Should not allow the user to update their first_name or role information", async () => {
        let user_id = encodeURIComponent(generated_user_id);
        let updated_generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
        let updated_user_info = {
            first_name: testData.trusted_user_updated_first_name,
            role: 1,
        }
        const res = await request(app)
            .put('/api/users/' + user_id)
            .set('Cookie', updated_generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json")
            .send(updated_user_info);
        expect(res.statusCode).toBe(409);
        expect(res.body).toHaveProperty("message", 'Failed to edit user. Uneditable parameters present.');
        expect(res.body).toHaveProperty("result", false);
    });
    it("6. Should not allow any other user to update user information", async () => {
        let user_id = encodeURIComponent("1293012-sfase1382-ead");
        let updated_generated_auth_cookie = createAuthCookie({id: "1283782-random-user", role: Role.TRUSTED_USER});
        let updated_user_info = {
            display_first_name: testData.trusted_user_updated_first_name,
        }
        const res = await request(app)
            .put('/api/users/' + user_id)
            .set('Cookie', updated_generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json")
            .send(updated_user_info);
        expect(res.statusCode).toBe(403);
        expect(res.body).toHaveProperty("message", 'Failed to edit user. User does not have permission.');
        expect(res.body).toHaveProperty("result", false);
    });
    it("7. Should allow the user to update editable information", async () => {
        let user_id = encodeURIComponent(testData.trusted_user.openid);
        let updated_generated_auth_cookie = createAuthCookie({id: testData.trusted_user.openid, role: Role.TRUSTED_USER});
        let updated_user_info = {
            display_first_name: testData.trusted_user_updated_first_name,
            bio: testData.trusted_user_updated_bio,
        }
        const res = await request(app)
            .put('/api/users/' + user_id)
            .set('Cookie', updated_generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json")
            .send(updated_user_info);
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message", 'User updated successfully');
        expect(res.body).toHaveProperty("result", true);
    });
    it("8. Should allow the user to fetch the updated user details", async () => {
        let user_open_id_encoded = encodeURIComponent(testData.trusted_user.openid);
        const res = await request(app)
            .get('/api/users/' + user_open_id_encoded)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("openid", testData.trusted_user.openid);
        expect(res.body).toHaveProperty("display-first-name", testData.trusted_user_updated_first_name);
        expect(res.body).toHaveProperty("bio", testData.trusted_user_updated_bio);
        expect(res.body).toHaveProperty("email", testData.trusted_user.email);
    });
    it("9. Should allow the user to update the user's avatar", async () => {
        const file_path = path.join(__dirname, "test_avatar_image.jpg");
        const res = await request(app)
            .post('/api/users/avatar')
            .set('Cookie', generated_auth_cookie)
            .set('Content-Type', 'multipart/form-data; boundary=----WebKitFormBoundaryotgYSdiIybBwVdSB')
            .attach('file', file_path) // Use .attach() instead of FormData
            .field("id", generated_user_id); // Use .field() to send additional form data
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message", "Avatar uploaded successfully");
    });
    it("(External) Should allow to create an element to be bookmarked", async () => {
        let generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
        let user_body = testData.element_details_json
        user_body['metadata']['created_by'] = generated_user_id;
        const res = await request(app)
            .post("/api/elements")
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json")
            .send(user_body);
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message", 'Resource registered successfully');
        expect(res.body).toHaveProperty("elementId");
        generated_element_id = res.body['elementId'];
    });
    it("10. Should allow user to bookmark their created element", async () => {
        let generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
        let element_type = testData.element_details_json['resource-type']
        const res = await request(app)
            .put("/api/users/bookmark/" + generated_element_id + "?bookmark=true&elementType=" + element_type)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message", 'Toggle element bookmark success');
    });
    it("11. Should allow user to fetch if their created element is bookmarked", async () => {
        let generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
        let element_type = testData.element_details_json['resource-type']
        const res = await request(app)
            .get("/api/users/bookmark/" + generated_element_id + "?elementType=" + element_type)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toBe(true);
    });
    it("(External) Element registered should be deleted by the user", async () => {
        let generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
        let encoded_uri = encodeURIComponent(generated_element_id)
        const res = await request(app)
            .delete("/api/elements/" + encoded_uri)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message", 'Resource deleted successfully');
    });
    it("12. Should allow only SUPER_ADMIN to delete user", async () => {
        const res = await request(app)
            .delete("/api/users/" + generated_user_id)
            .set('Cookie', generated_auth_super_admin_cookie)
            .set("Accept", "*/*")
            .set('Content-Type', "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message", 'User deleted successfully')
    });
    it("13. Should create an UNTRUSTED USER for TLD based domains", async () => {
        let user_body = testData.untrusted_user_2
        const res = await request(app)
            .post('/api/users')
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json")
            .send(user_body);
        expect(res.statusCode).toBe(201);
        expect(res.body).toHaveProperty("message", 'User added successfully');
    });
    it("14. The UNTRUSTED USER should have current role as 10", async () => {
        let user_open_id_encoded = encodeURIComponent(testData.untrusted_user_2.openid);
        const res = await request(app)
            .get('/api/users/' + user_open_id_encoded + "/role")
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("role", 10);
    });
    it("15. Should allow only SUPER_ADMIN to delete untrusted user", async () => {
        let user_open_id_encoded = encodeURIComponent(testData.untrusted_user_2.openid);
        const res = await request(app)
            .delete("/api/users/" + user_open_id_encoded)
            .set('Cookie', generated_auth_super_admin_cookie)
            .set("Accept", "*/*")
            .set('Content-Type', "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message", 'User deleted successfully')
    });
    it("16. Should create an TRUSTED USER for .gov based domains", async () => {
        let user_body = testData.gov_user
        const res = await request(app)
            .post('/api/users')
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json")
            .send(user_body);
        expect(res.statusCode).toBe(201);
        expect(res.body).toHaveProperty("message", 'User added successfully');
    });
    it("17. The .gov user should have current role as 8", async () => {
        let user_open_id_encoded = encodeURIComponent(testData.gov_user.openid);
        const res = await request(app)
            .get('/api/users/' + user_open_id_encoded + "/role")
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("role", 8);
    });
    it("18. Should allow only SUPER_ADMIN to delete .gov user", async () => {
        let user_open_id_encoded = encodeURIComponent(testData.gov_user.openid);
        const res = await request(app)
            .delete("/api/users/" + user_open_id_encoded)
            .set('Cookie', generated_auth_super_admin_cookie)
            .set("Accept", "*/*")
            .set('Content-Type', "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message", 'User deleted successfully')
    });
});