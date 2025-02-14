/**
 *
 * GET /api/connected-graph == Get all nodes and relations to the connected elements
 * GET /api/elements/homepage == Fetch elements to show on homepage (featured etc.)
 * GET /api/elements/titles == Fetch all titles of a given type of elements
 *
 * POST /api/elements/thumbnail == Upload a thumbnail image
 * POST  /api/elements == Register an element
 * GET /api/elements/{id} == Retrieve ONE public element using id.
 * PUT /api/elements/{id} == Update the element with given ID
 * PUT /api/elements/{id}/visibility == Set visibility for the element with given ID
 * GET /api/elements == Retrieve elements by field and value
 *
 * GET /api/elements/bookmark == Get all bookmarked elements by user with userId
 * GET /api/elements/{id}/neighbors = Return neighbor elements of element with given ID
 *
 *

 *
 * GET /api/duplicate = Check for duplicate in elements given field-name
 *
 */
import request from "supertest";
import app from "../../server.js";
import testData from "./testUserData.json";
import {generateAccessToken} from "../../jwtUtils.js";
import {ElementType, Role} from "../../utils.js";
import path from "path";
import url from "node:url";

/**
 * As the APIs involve the usage of JWT Token for the purposes of the testing we will create 2 test suites with 2 different access
 *  1. ADMIN => The token which allows the admin to insert/get/update/remove the document
 *  2. TRUSTED_USER => The token which allows the user to get the document alone
 * As the JWT Token secret is available in the ENV we will create the token using the jwtUtils functions
 */
const COOKIE_NAME = process.env.JWT_ACCESS_TOKEN_NAME || "access_token";
const target_domain = "localhost"; // Adjust based on your setup

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Helper function to create an admin cookie
const createAuthCookie = (user) => {
    const token = generateAccessToken(user);
    return `${COOKIE_NAME}=${token}; Domain=${target_domain}; Path=/; HttpOnly; Secure`;
};

describe("Elements Endpoint testing for general APIs", () => {
    it("1. Should fetch the connected graph for any user", async () => {
        const res = await request(app)
            .get('/api/connected-graph')
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("neighbors");
    });
    it("2. Should fetch the homepage elements for DATASET", async () => {
        const res = await request(app)
            .get('/api/elements/homepage?element-type=' + ElementType.NOTEBOOK + "&limit=4")
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("elements");
    });
    it("3. Should fetch the homepage elements for MAP", async () => {
        const res = await request(app)
            .get('/api/elements/homepage?element-type=' + ElementType.MAP + "&limit=4")
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("elements");
    });
    it("4. Should fetch the homepage elements for OER", async () => {
        const res = await request(app)
            .get('/api/elements/homepage?element-type=' + ElementType.OER + "&limit=4")
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("elements");
    });
    it("5. Should fetch the homepage elements for PUBLICATION", async () => {
        const res = await request(app)
            .get('/api/elements/homepage?element-type=' + ElementType.PUBLICATION + "&limit=4")
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("elements");
    });
    it("6. Should fetch the homepage elements for NOTEBOOK", async () => {
        const res = await request(app)
            .get('/api/elements/homepage?element-type=' + ElementType.NOTEBOOK + "&limit=4")
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("elements");
    });
    it("7. Should fetch all the element titles for DATASET", async () => {
        const res = await request(app)
            .get('/api/elements/titles?element-type=' + ElementType.DATASET.toLowerCase())
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
    });
    it("8. Should fetch all the element titles for PUBLICATION", async () => {
        const res = await request(app)
            .get('/api/elements/titles?element-type=' + ElementType.PUBLICATION.toLowerCase())
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
    });
    it("9. Should fetch all the element titles for NOTEBOOK", async () => {
        const res = await request(app)
            .get('/api/elements/titles?element-type=' + ElementType.NOTEBOOK.toLowerCase())
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
    });
     it("10. Should fetch all the element titles for OER", async () => {
        const res = await request(app)
            .get('/api/elements/titles?element-type=' + ElementType.OER.toLowerCase())
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
    });
});

describe("Elements Endpoint testing for Element based APIs", () => {
    let generated_element_id = "";
    let uploaded_image_urls = {};
    it("1. Should be able to upload a thumbnail image and get the image data", async () => {
        let generated_auth_cookie = createAuthCookie({id: testData.trusted_user_id, role: Role.TRUSTED_USER});
        const file_path = path.join(__dirname, "test-avatar-image.jpg");
        const res = await request(app)
            .post('/api/elements/thumbnail')
            .set('Cookie', generated_auth_cookie)
            .set('Content-Type', 'multipart/form-data; boundary=----WebKitFormBoundaryotgYSdiIybBwVdSB')
            .attach('file', file_path) // Use .attach() instead of FormData
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message", "Thumbnail uploaded successfully");
        expect(res.body).toHaveProperty("image-urls");
        uploaded_image_urls = res.body['image-urls'];
    });
    it("2. Element should be registered for a given user", async () => {
        let generated_auth_cookie = createAuthCookie({id: testData.trusted_user_id, role: Role.TRUSTED_USER});
        let user_body = testData.element_details_json
        user_body["thumbnail-image"] = uploaded_image_urls;
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
    it("3. Should be able to retrieve a public element based on Id", async () => {
        let generated_auth_cookie = createAuthCookie({id: testData.trusted_user_id, role: Role.TRUSTED_USER});
        let encoded_uri = encodeURIComponent(generated_element_id);
        const res = await request(app)
            .get("/api/elements/" + encoded_uri)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("resource-type",testData.element_details_json["resource-type"]);
        expect(res.body).toHaveProperty("contents",testData.element_details_json["contents"]);
    });
    it("4. Should be able to update an element based on Id", async () => {
        let generated_auth_cookie = createAuthCookie({id: testData.trusted_user_id, role: Role.TRUSTED_USER});
        let user_body = testData.element_details_json;
        user_body['title'] = testData.element_update_title;
        let encoded_uri = encodeURIComponent(generated_element_id);
        const res = await request(app)
            .put("/api/elements/" + encoded_uri)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json")
            .send(user_body);
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message",'Element updated successfully');
        expect(res.body).toHaveProperty("result",true);
    });
    it("5. Should be able to set the visibility of an element based on Id", async () => {
        let generated_auth_cookie = createAuthCookie({id: testData.trusted_user_id, role: Role.TRUSTED_USER});
        let encoded_uri = encodeURIComponent(generated_element_id)
        const res = await request(app)
            .put("/api/elements/" + encoded_uri + "/visibility?visibility=private")
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message", "Element visibility updated successfully");
    });
    it("6. Should be able to retrieve all the elements created by user for user profile", async () => {
        let generated_auth_cookie = createAuthCookie({id: testData.trusted_user_id, role: Role.TRUSTED_USER});
        let url_params = "field-name=contributor&match-value="+testData.trusted_user_id+"&sort-by=creation_time&order=desc&from=0&size=12&count-only=false";
        const res = await request(app)
            .get("/api/elements?" +url_params)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toHaveProperty(200);
        expect(res.body).toHaveProperty("elements");
        expect(res.body).toHaveProperty("total_count");
    });
    it("7. Element registered should be deleted by the user", async () => {
        let generated_auth_cookie = createAuthCookie({id: testData.trusted_user_id, role: Role.TRUSTED_USER});
        let encoded_uri = encodeURIComponent(generated_element_id)
        const res = await request(app)
            .delete("/api/elements/" + encoded_uri)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message", 'Resource deleted successfully');
    });
});

