/**
 * Advanced Search
 *
 * GET /api/search == Search for elements
 *
 * GET /api/top-keywords == Retrieve the most searched keywords within a specified time window
 */

import request from "supertest";
import app from "../../server.js";

describe("Search Routes Endpoints API testing for /search Route",() => {
    let element_type = "any"
    it("Should search for the elements and provide the data for ANY Element Type", async () => {
       const res = await request(app)
            .get('/api/search?keyword=test&element-type='+element_type+'&sort-by=_score&order=desc&from=0&size=12')
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("total_count");
        expect(res.body).toHaveProperty("elements");
        expect(res.body).toHaveProperty("total_count_by_types");
    });
    element_type = "dataset"
    it("Should search for the elements and provide the data for Dataset Element Type", async () => {
       const res = await request(app)
            .get('/api/search?keyword=test&element-type='+element_type+'&sort-by=_score&order=desc&from=0&size=12')
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("total_count");
        /**
         *  Check if all the elements are of DATASET element type
         */
        const res_body_elements = res.body["elements"];
        res_body_elements.map((element) => {
            expect(element["resource-type"]).toBe(element_type);
        });
        expect(res.body).toHaveProperty("elements");
        expect(res.body).toHaveProperty("total_count_by_types");
    });
    element_type = "oer"
    it("Should search for the elements and provide the data for OER Element Type", async () => {
       const res = await request(app)
            .get('/api/search?keyword=test&element-type='+element_type+'&sort-by=_score&order=desc&from=0&size=12')
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("total_count");
        /**
         *  Check if all the elements are of OER element type
         */
        const res_body_elements = res.body["elements"];
        res_body_elements.map((element) => {
            expect(element["resource-type"]).toBe(element_type);
        });
        expect(res.body).toHaveProperty("elements");
        expect(res.body).toHaveProperty("total_count_by_types");
    });
    element_type = "notebook"
    it("Should search for the elements and provide the data for NOTEBOOK Element Type", async () => {
       const res = await request(app)
            .get('/api/search?keyword=test&element-type='+element_type+'&sort-by=_score&order=desc&from=0&size=12')
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("total_count");
        /**
         *  Check if all the elements are of NOTEBOOK element type
         */
        const res_body_elements = res.body["elements"];
        res_body_elements.map((element) => {
            expect(element["resource-type"]).toBe(element_type);
        });
        expect(res.body).toHaveProperty("elements");
        expect(res.body).toHaveProperty("total_count_by_types");
    });
    element_type = "publication"
    it("Should search for the elements and provide the data for PUBLICATION Element Type", async () => {
       const res = await request(app)
            .get('/api/search?keyword=test&element-type='+element_type+'&sort-by=_score&order=desc&from=0&size=12')
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("total_count");
        /**
         *  Check if all the elements are of PUBLICATION element type
         */
        const res_body_elements = res.body["elements"];
        res_body_elements.map((element) => {
            expect(element["resource-type"]).toBe(element_type);
        });
        expect(res.body).toHaveProperty("elements");
        expect(res.body).toHaveProperty("total_count_by_types");
    });
    element_type = "map"
    it("Should search for the elements and provide the data for MAP Element Type", async () => {
       const res = await request(app)
            .get('/api/search?keyword=test&element-type='+element_type+'&sort-by=_score&order=desc&from=0&size=12')
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("total_count");
        /**
         *  Check if all the elements are of MAP element type
         */
        const res_body_elements = res.body["elements"];
        res_body_elements.map((element) => {
            expect(element["resource-type"]).toBe(element_type);
        });
        expect(res.body).toHaveProperty("elements");
        expect(res.body).toHaveProperty("total_count_by_types");
    });
});

describe("Search Routes Endpoints API testing for /top-keywords Route ", () => {
   it("Should return the top keywords for default values k = 10 and t = 24", async () => {
       const res = await request(app)
            .get('/api/top-keywords')
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("top_keywords");
        /**
         *  Check to make sure the K keyword condition is satisfied
         */
        const total_keywords = res.body["top_keywords"];
        let keyword_property_satisfied = total_keywords?.length <= 10;
        expect(keyword_property_satisfied).toBe(true);
   });
   it("Should return the top keywords for specified values k = 2 and t = 72", async () => {
       let total_k_count = 2;
       const res = await request(app)
            .get('/api/top-keywords?k='+total_k_count+'&t=72')
            .set("Accept", "*/*")
            .set("Content-Type", "application/json");
        expect(res.statusCode).toBe(200);
        expect(res.body).toHaveProperty("top_keywords");
        /**
         *  Check to make sure the K keyword condition is satisfied
         */
        const total_keywords = res.body["top_keywords"];
        let keyword_property_satisfied = total_keywords?.length <= total_k_count;
        expect(keyword_property_satisfied).toBe(true);
   });
});