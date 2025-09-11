/**
 * private-elements
 *
 * GET =/api/elements/private/{elementId} = Retrieve ONE private element using id.
 *
 * GET /api/elements/private = Retrieve private elements for given user ID
 */

import request from "supertest";
import app from "../../server.js";
import {generateAccessToken} from "../../utils/jwtUtils.js";
import testData from "./test_user_data.json";
import {Role} from "../../utils/utils.js";

const COOKIE_NAME = process.env.JWT_ACCESS_TOKEN_NAME || "access_token";
const target_domain = "localhost"; // Adjust based on your setup

// Helper function to create an the auth cookie
const createAuthCookie = (user) => {
    const token = generateAccessToken(user);
    return `${COOKIE_NAME}=${token}; Domain=${target_domain}; Path=/; HttpOnly; Secure`;
};

describe("Private Elements fetch APIs endpoint testing", () => {
    let generated_private_element_id = ""
    let generated_user_id = ""
    it("(External) Create a trusted User to perform operations", async () => {
        let generated_auth_cookie = createAuthCookie({id: testData.private_trusted_user.openid, role: Role.TRUSTED_USER});
        let user_body = testData.private_trusted_user
        const res = await request(app)
            .post('/api/users')
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json")
            .send(user_body);
        expect(res.statusCode).toBe(201);
        expect(res.body).toHaveProperty("message", 'User added successfully');
    });
    it("(External) Should allow to fetch user details", async () => {
        let generated_auth_cookie = createAuthCookie({id: testData.private_trusted_user.openid, role: Role.TRUSTED_USER});
        let user_open_id_encoded = encodeURIComponent(testData.private_trusted_user.openid);
        const res = await request(app)
            .get('/api/users/' + user_open_id_encoded)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("openid", testData.private_trusted_user.openid);
        expect(res.body).toHaveProperty("first-name", testData.private_trusted_user.first_name);
        expect(res.body).toHaveProperty("last-name", testData.private_trusted_user.last_name);
        expect(res.body).toHaveProperty("email", testData.private_trusted_user.email);
        generated_user_id = res.body['id'];
    });
    it("(External) Should allow existing user to create an private element", async () => {
        let generated_auth_cookie = createAuthCookie({id: testData.private_trusted_user.openid, role: Role.TRUSTED_USER});
        let user_body = testData.element_details_json
        // Setting the visibilty as PRIVATE TO test the private_elements routes
        user_body["visibility"] = "private";
        user_body['metadata']['created_by'] = generated_user_id
        const res = await request(app)
            .post("/api/elements")
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json")
            .send(user_body);
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message", 'Resource registered successfully');
        expect(res.body).toHaveProperty("elementId");
        generated_private_element_id = res.body['elementId'];
    });
    it("1. Should allow the existing user to fetch the created private element based on the id", async () => {
        let generated_auth_cookie = createAuthCookie({id: testData.private_trusted_user.openid, role: Role.TRUSTED_USER});
        const res = await request(app)
            .get("/api/elements/private/" + generated_private_element_id)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("id", generated_private_element_id);
    });
    it("2. Should not allow any other user to fetch the created private element based on the id", async () => {
        let generated_auth_cookie = createAuthCookie({id: testData.trusted_user.openid, role: Role.TRUSTED_USER});
        const res = await request(app)
            .get("/api/elements/private/" + generated_private_element_id)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(403);
        expect(res.body).toHaveProperty("message", 'Forbidden: You do not have permission to view this element.');
    });
    it("3. Should allow to fetch all private elements for a given user ID", async () => {
        let generated_auth_cookie = createAuthCookie({id: testData.private_trusted_user.openid, role: Role.TRUSTED_USER});
        const res = await request(app)
            .get("/api/elements/private?user-id="+generated_user_id+"&sort-by=creation_time&order=desc&from=0&size=12")
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("elements");
        //It should be only one as we have only created one private element
        expect(res.body).toHaveProperty("total-count",1);
    });
    it("(External) Should allow existing user to delete the created private element", async () => {
        let generated_auth_cookie = createAuthCookie({id: testData.private_trusted_user.openid, role: Role.TRUSTED_USER});
        let encoded_uri = encodeURIComponent(generated_private_element_id)
        const res = await request(app)
            .delete("/api/elements/" + encoded_uri)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message", 'Resource deleted successfully');
    });
    it("(External) Should allow only SUPER_ADMIN to delete temp user", async () => {
        let generated_auth_super_admin_cookie = createAuthCookie({id: 1, role: Role.SUPER_ADMIN});
        const res = await request(app)
            .delete("/api/users/" + generated_user_id)
            .set('Cookie', generated_auth_super_admin_cookie)
            .set("Accept", "*/*")
            .set('Content-Type', "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message", 'User deleted successfully')
    });
});