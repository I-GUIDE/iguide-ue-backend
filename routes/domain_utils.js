
import fs from "fs";
import rawDataJSON from "../sources/world_universities_and_domains.json" with {type: "json"};
const domainData = {}

export function generateOptimizedDomainList() {
    // const rawData = fs.readFileSync("../sources/world_universities_and_domains.json", "utf-8");
    // const rawDataJSON = JSON.parse(rawData);
    rawDataJSON.forEach((entry) => {
       if (entry?.domains !== undefined && entry?.domains?.length > 0) {
           entry?.domains.forEach((domain) => {
              domainData[domain.toLowerCase()] = entry;
           });
       }
    });
}

export function checkUniversityDomain(domain) {
    let domain_modified = domain.toLowerCase();
    if (domain_modified in domainData) {
        return true;
    } else {
        return false;
    }
}

export function provideDomainUniversityInfo(domain) {
    let domain_modified = domain.toLowerCase();
    if (domain_modified in domainData) {
        return domainData[domain_modified];
    } else {
        return {};
    }
}