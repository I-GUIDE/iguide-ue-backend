/**
 *
 * GET /api/connected-graph == Get all nodes and relations to the connected elements
 * GET /api/elements/homepage == Fetch elements to show on homepage (featured etc.)
 * GET /api/elements/titles == Fetch all titles of a given type of elements
 * POST /api/elements/thumbnail == Upload a thumbnail image
 * POST  /api/elements == Register an element
 * GET /api/elements/{id} == Retrieve ONE public element using id.
 * PUT /api/elements/{id} == Update the element with given ID
 * PUT /api/elements/{id}/visibility == Set visibility for the element with given ID
 * GET /api/elements == Retrieve elements by field and value
 * GET /api/elements/bookmark == Get all bookmarked elements by user with userId
 * NO IMPLEMENTATION FOR THE FOLLOWING APIS:
 *      GET /api/elements/{id}/neighbors = Return neighbor elements of element with given ID
 *      GET /api/duplicate = Check for duplicate in elements given field-name
 *
 */
import request from "supertest";
import app from "../../server.js";
import testData from "./test_user_data.json";
import {generateAccessToken} from "../../jwtUtils.js";
import {ElementType, Role} from "../../utils.js";
import path from "path";
import url from "node:url";
import fs from "fs";

/**
 * As the APIs involve the usage of JWT Token for the purposes of the testing we will create 2 test suites with 2 different access
 *  1. ADMIN => The token which allows the admin to insert/get/update/remove the document
 *  2. TRUSTED_USER => The token which allows the user to get the document alone
 * As the JWT Token secret is available in the ENV we will create the token using the jwtUtils functions
 */
const COOKIE_NAME = process.env.JWT_ACCESS_TOKEN_NAME || "access_token";
const target_domain = "localhost"; // Adjust based on your setup

const thumbnail_dir = path.join(process.env.UPLOAD_FOLDER, 'thumbnails');
const notebook_html_dir = path.join(process.env.UPLOAD_FOLDER, 'notebook_html');
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
    let generated_user_id = "";
    let uploaded_image_urls = {};
    let generated_auth_super_admin_cookie = createAuthCookie({id: 1, role: Role.SUPER_ADMIN});
    it("(External) Create a trusted User to perform operations", async () => {
        let generated_auth_cookie = createAuthCookie({id: 1, role: Role.TRUSTED_USER});
        let user_body = testData.elements_trusted_user
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
        let generated_auth_cookie = createAuthCookie({id: 1, role: Role.TRUSTED_USER});
        let user_open_id_encoded = encodeURIComponent(testData.elements_trusted_user.openid);
        const res = await request(app)
            .get('/api/users/' + user_open_id_encoded)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("openid", testData.elements_trusted_user.openid);
        expect(res.body).toHaveProperty("first-name", testData.elements_trusted_user.first_name);
        expect(res.body).toHaveProperty("last-name", testData.elements_trusted_user.last_name);
        expect(res.body).toHaveProperty("email", testData.elements_trusted_user.email);
        generated_user_id = res.body['id'];
    });
    it("1. Should be able to upload a thumbnail image and get the image data", async () => {
        let generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
        const file_path = path.join(__dirname, "test_avatar_image.jpg");
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
        let generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
        let user_body = testData.element_details_json
        user_body["thumbnail-image"] = uploaded_image_urls;
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
    it("3. Should be able to retrieve a public element based on Id", async () => {
        let generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
        let encoded_uri = encodeURIComponent(generated_element_id);
        const res = await request(app)
            .get("/api/elements/" + encoded_uri)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("resource-type",testData.element_details_json["resource-type"]);
        expect(res.body).toHaveProperty("contents",testData.element_details_json["contents"]);
        expect(res.body).toHaveProperty("user-uploaded-dataset", false);
    });
    it("4. Should be able to update an element based on Id", async () => {
        let generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
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
        let generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
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
        let generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
        let url_params = "field-name=contributor&match-value="+generated_user_id+"&sort-by=creation_time&order=desc&from=0&size=12&count-only=false";
        const res = await request(app)
            .get("/api/elements?" +url_params)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("elements");
    });
    it("(External) Bookmark the given element to be fetched later", async () => {
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
    it("7. Bookmarked element should be returned by the API", async () => {
        let generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
        const res = await request(app)
            .get("/api/elements/bookmark?user-id=" + generated_user_id + "&sort-by=creation_time&order=asc&from=0&size=10")
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        console.log(res.statusCode);
        console.log(res.body);
    });
    it("8. Element registered should be deleted by the user", async () => {
        let generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
        let encoded_uri = encodeURIComponent(generated_element_id)
        const res = await request(app)
            .delete("/api/elements/" + encoded_uri)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message", 'Resource deleted successfully');

        //Assertion check for Thumbnail deletion of the user
        if (uploaded_image_urls) {
            for (const type in uploaded_image_urls) {
                let thumbnail_filepath = path.join(thumbnail_dir, path.basename(uploaded_image_urls[type]));
                expect(fs.existsSync(thumbnail_filepath)).toBe(false);
            }
        }

    });
    it("(External) Should allow only SUPER_ADMIN to delete temp user", async () => {
        const res = await request(app)
            .delete("/api/users/" + generated_user_id)
            .set('Cookie', generated_auth_super_admin_cookie)
            .set("Accept", "*/*")
            .set('Content-Type', "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message", 'User deleted successfully')
    });
});


describe("Elements Endpoint testing for Notebook elements", () => {
    let generated_element_id = "";
    let generated_user_id = "";
    let uploaded_image_urls = {};
    let html_notebook_url = "";
    let generated_auth_super_admin_cookie = createAuthCookie({id: 1, role: Role.SUPER_ADMIN});
    it("(External) Create a trusted User to perform operations", async () => {
        let generated_auth_cookie = createAuthCookie({id: 1, role: Role.TRUSTED_USER});
        let user_body = testData.elements_trusted_user
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
        let generated_auth_cookie = createAuthCookie({id: 1, role: Role.TRUSTED_USER});
        let user_open_id_encoded = encodeURIComponent(testData.elements_trusted_user.openid);
        const res = await request(app)
            .get('/api/users/' + user_open_id_encoded)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("openid", testData.elements_trusted_user.openid);
        expect(res.body).toHaveProperty("first-name", testData.elements_trusted_user.first_name);
        expect(res.body).toHaveProperty("last-name", testData.elements_trusted_user.last_name);
        expect(res.body).toHaveProperty("email", testData.elements_trusted_user.email);
        generated_user_id = res.body['id'];
    });
    it("1. Should be able to upload a thumbnail image and get the image data", async () => {
        let generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
        const file_path = path.join(__dirname, "test_avatar_image.jpg");
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
        let generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
        let user_body = testData.test_notebook_details_json
        user_body["thumbnail-image"] = uploaded_image_urls;
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
    it("3. Should be able to retrieve the element and verify the notebook specific attributes", async () => {
        if (generated_element_id === "") {
            throw new Error('No element created in (2), test case (3) failed!');
        }
        let generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
        let encoded_uri = encodeURIComponent(generated_element_id);
        const res = await request(app)
            .get("/api/elements/" + encoded_uri)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("resource-type", testData.test_notebook_details_json["resource-type"]);
        expect(res.body).toHaveProperty("html-notebook");
        html_notebook_url = res.body['html-notebook'];
        expect(res.body).toHaveProperty("notebook-repo", testData.test_notebook_repo_name);
        expect(res.body).toHaveProperty("notebook-file", testData.test_notebook_file_name);
        expect(res.body).toHaveProperty("contents",testData.test_notebook_details_json["contents"]);
    });
    it("4. Element registered should be deleted by the user", async () => {
        if (generated_element_id === "") {
            throw new Error('No element created in (2), test case (4) failed!');
        }
        let generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
        let encoded_uri = encodeURIComponent(generated_element_id)
        const res = await request(app)
            .delete("/api/elements/" + encoded_uri)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message", 'Resource deleted successfully');

        //assert check for notebook_html to be deleted
        if (html_notebook_url) {
            let notebook_html_filepath = path.join(notebook_html_dir, path.basename(html_notebook_url));
            expect(fs.existsSync(notebook_html_filepath)).toBe(false);
        }

        //Assertion check for Thumbnail deletion of the user
        if (uploaded_image_urls) {
            for (const type in uploaded_image_urls) {
                let thumbnail_filepath = path.join(thumbnail_dir, path.basename(uploaded_image_urls[type]));
                expect(fs.existsSync(thumbnail_filepath)).toBe(false);
            }
        }
    });
    it("(External) Should allow only SUPER_ADMIN to delete temp user", async () => {
        const res = await request(app)
            .delete("/api/users/" + generated_user_id)
            .set('Cookie', generated_auth_super_admin_cookie)
            .set("Accept", "*/*")
            .set('Content-Type', "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("message", 'User deleted successfully')
    });
});