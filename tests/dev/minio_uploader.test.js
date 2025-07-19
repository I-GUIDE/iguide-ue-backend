import request from "supertest";
import app from "../../server.js";
import testData from "./test_user_data.json";
import {generateAccessToken} from "../../jwtUtils.js";
import {ElementType, Role} from "../../utils.js";
import path from "path";
import url from "node:url";
import fs from "fs";
import axios from "axios";
import * as crypto from "node:crypto";

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

async function verifyUploadedFile(uploadedUrl, originalFilePath) {
  const originalHash = crypto.createHash("sha256").update(fs.readFileSync(originalFilePath)).digest("hex");
  const uploadedData = await axios.get(uploadedUrl, { responseType: "arraybuffer" });
  const uploadedHash = crypto.createHash("sha256").update(uploadedData.data).digest("hex");

  return originalHash === uploadedHash;
}


// Setup fake file data (e.g., CSV)
const filename = 'test_upload_file.csv';
const testFilePath = path.join(__dirname, filename);
const fakeFileBuffer = Buffer.alloc(5 * 1024 * 1024, 'a'); // 1MB chunk filled with "a"
fs.writeFileSync(testFilePath, fakeFileBuffer); // Create the test file

describe("Endpoint testing for MinIO Uploader APIs", () => {
    let uploadId = "";
    let generated_user_id = "";
    let generated_auth_super_admin_cookie = createAuthCookie({id: 1, role: Role.SUPER_ADMIN});
    it("(External) Create a trusted User to perform operations", async () => {
        let generated_auth_cookie = createAuthCookie({id: 1, role: Role.TRUSTED_USER});
        let user_body = testData.minio_trusted_user
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
        let user_open_id_encoded = encodeURIComponent(testData.minio_trusted_user.openid);
        const res = await request(app)
            .get('/api/users/' + user_open_id_encoded)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("openid", testData.minio_trusted_user.openid);
        expect(res.body).toHaveProperty("first-name", testData.minio_trusted_user.first_name);
        expect(res.body).toHaveProperty("last-name", testData.minio_trusted_user.last_name);
        expect(res.body).toHaveProperty("email", testData.minio_trusted_user.email);
        generated_user_id = res.body['id'];
    });
    it("1. Should be able to start the chunk upload", async () => {
        let generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
        const req_body = {
            filename: filename,
            fileSize: fakeFileBuffer.length,
            mimeType: 'text/csv',
        };
        const res = await request(app)
            .post('/api/elements/datasets/init-upload')
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "/*")
            .set("Content-Type", "application/json")
            .send(req_body);
        expect(res.statusCode).toBe(200);
        expect(res.body.uploadId).toBeDefined();
        expect(res.body.result).toBe(true);
        uploadId = res.body.uploadId;
    });
    it("2. Should be able to upload a chunk data", async () => {
        let generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
        let encoded_upload_id = encodeURIComponent(uploadId);
        const res = await request(app)
            .post(`/api/elements/datasets/upload-chunk/${encoded_upload_id}`)
            .set('Cookie', generated_auth_cookie)
            .set('Content-Type', 'multipart/form-data; boundary=----WebKitFormBoundaryotgYSdiIybBwVdSB')
            .field('chunkNumber', 0)
            .field('chunk', 1)
            .attach('chunk', testFilePath);
        expect(res.statusCode).toBe(200);
        expect(res.body.chunkNumber).toBe(0);
        expect(res.body.success).toBe(true);
    });
    it("3. Should be able to return the upload progress", async () => {
        let generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
        let encoded_upload_id = encodeURIComponent(uploadId);
        const res = await request(app)
            .get(`/api/elements/datasets/upload-progress/${encoded_upload_id}`)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set('Content-Type', "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body.uploadId).toBeDefined();
        expect(res.body.filename).toBe(filename);
        expect(res.body.totalParts).toBeDefined();
        expect(res.body.progress).toBeDefined();
    });
    it("4. Should be able to complete the upload", async () => {
        let generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
        let encoded_upload_id = encodeURIComponent(uploadId);
        const res = await request(app)
            .post(`/api/elements/datasets/complete-upload/${encoded_upload_id}`)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "*/*")
            .set('Content-Type', "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('message','Dataset uploaded successfully');
        expect(res.body).toHaveProperty('bucket', process.env.MINIO_AWS_BUCKET_NAME);
        expect(res.body.filename).toBeDefined();
    });
    it("(External) Should be able to start the chunk upload (to abort in next step)", async () => {
        let generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
        const req_body = {
            filename: filename,
            fileSize: fakeFileBuffer.length,
            mimeType: 'text/csv',
        };
        const res = await request(app)
            .post('/api/elements/datasets/init-upload')
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "/*")
            .set("Content-Type", "application/json")
            .send(req_body);
        expect(res.statusCode).toBe(200);
        expect(res.body.uploadId).toBeDefined();
        expect(res.body.result).toBe(true);
        uploadId = res.body.uploadId;
    });
    it("5. Should be able to stop the chunk upload", async () => {
        let generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
        let encoded_upload_id = encodeURIComponent(uploadId);
        const res = await request(app)
            .delete(`/api/elements/datasets/abort-upload/${encoded_upload_id}`)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty('message','Upload aborted successfully');
    });
    it("6. Should return appropriate message for invalid chunk upload", async () => {
        let generated_auth_cookie = createAuthCookie({id: generated_user_id, role: Role.TRUSTED_USER});
        let encoded_upload_id = encodeURIComponent("invalid-upload-id");
        const res = await request(app)
            .delete(`/api/elements/datasets/abort-upload/${encoded_upload_id}`)
            .set('Cookie', generated_auth_cookie)
            .set("Accept", "/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(404);
        expect(res.body).toHaveProperty('message','Upload not found');
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

    afterAll(() => {
        fs.unlinkSync(testFilePath); // cleanup
    });
});