import path from 'path';
import sharp from 'sharp';
// local imports
import * as n4j from './backend_neo4j.js'
import neo4j from "neo4j-driver";
import {checkUniversityDomain} from "./routes/domain_utils.js";

/**************
 * Enums
 **************/
export const ElementType = Object.freeze({
    NOTEBOOK: "Notebook",
    DATASET: "Dataset",
    PUBLICATION: "Publication",
    OER: "Oer", // Open Educational Content
    MAP: "Map",
    CODE: "Code",
    //Documentation: "Documentation",
});

export const Relations = Object.freeze({
    RELATED: "RELATED", // Default relation type
    CONTRIBUTED: "CONTRIBUTED", // e.g. User CONTRIBUTED Element
    BOOKMARKED: "BOOKMARKED", // e.g. User BOOKMARKED Element

    USES: "USES", // e.g. Notebook USES Dataset
});

export const SortBy = Object.freeze({
    CLICK_COUNT: "click_count",
    CREATION_TIME: "created_at",
    TITLE: "title",
    FIRST_NAME: "first_name",
    LAST_NAME: "last_name",
});

/*
 * Please note following differences in terminologies
 * User: Logged in user on our platform. May or may NOT be a contributor
 * Contributor: All elements are submitted by Contributed users
 */
export const Role = Object.freeze({
    SUPER_ADMIN: 1,
    ADMIN: 2,
    CONTENT_MODERATOR: 3,        // can edit any contribution
    UNRESTRICTED_CONTRIBUTOR: 4, // can contribute restricted elements such as OERs etc.
    TRUSTED_USER_PLUS: 5,               // Allow to use HPC instances through ACCESS CI Accounts
    TRUSTED_USER: 8,             // users with .edu emails
    UNTRUSTED_USER: 10,          // all other users
});
//exports.Role = Role;

export const Visibility = Object.freeze({
    PRIVATE: 'private',
    PUBLIC: 'public',
});

export const UnEditableParameters = Object.freeze({
    FIRST_NAME: 'first_name',
    LAST_NAME: 'last_name',
    EMAIL: 'email',
    OPENID: 'openid',
    AFFILIATION: 'affiliation',
    // ID: 'id',
    CREATED_AT: 'created_at',
    ROLE: 'role'
});

export const EditableParameters = Object.freeze({
    AVATAR_URL: 'avatar_url',
    GITHUB_LINK: 'gitHubLink',
    PERSONAL_WEBSITE_LINK: 'personalWebsiteLink',
    LINKEDIN_LINK: 'linkedInLink',
    DISPLAY_FIRST_NAME: 'display_first_name',
    DISPLAY_LAST_NAME: 'display_last_name',
    GOOGLE_SCHOLAR_LINK: 'googleScholarLink',
    BIO: 'bio'
});
//exports.Visibility = Visibility;

/**************/

/**
 * Determine type of element given type string
 */
export function parseVisibility(visibility){
    switch(visibility){

    case 'public':
    case '10':
    case 10:
	return Visibility.PUBLIC;
    case 'private':
    case '1':
    case 1:
	return Visibility.PRIVATE;
    default:
	throw Error('Server Neo4j: Visibility ('+ visibility  +') parsing not implemented');
    }
}
//exports.parseVisibility = parseVisibility

/**
 * Determine type of element given type string
 */
export function parseElementType(type){
    const element_type = type[0].toUpperCase() + type.slice(1);
    switch(element_type){

    case ElementType.NOTEBOOK: return ElementType.NOTEBOOK;
    case ElementType.DATASET: return ElementType.DATASET;
    case ElementType.PUBLICATION: return ElementType.PUBLICATION;
    case ElementType.OER: return ElementType.OER;
    case ElementType.MAP: return ElementType.MAP;
    case ElementType.CODE: return ElementType.CODE;
    default:
	throw Error('Server Neo4j: Element type ('+ element_type  +') parsing not implemented');
    }
}

/**
 * Parse the role type for a given string or int value with respect to the Server defined roles
 * @param role
 * @returns {number}
 */
export function parseRole(role) {
    switch(role) {
        case '10':
        case 10: return Role.UNTRUSTED_USER;
        case '8':
        case 8: return Role.TRUSTED_USER;
        case '5':
        case 5: return Role.TRUSTED_USER_PLUS;
        case '4':
        case 4: return Role.UNRESTRICTED_CONTRIBUTOR;
        case '3':
        case 3: return Role.CONTENT_MODERATOR;
        case '2':
        case 2: return Role.ADMIN;
        case '1':
        case 1: return Role.SUPER_ADMIN;
        default:
            throw Error('Server Neo4j: Role type (' + role + ') parsing not implemented');
    }
}

export function parseSortBy(sort_by){
    switch (sort_by){
    case SortBy.CLICK_COUNT:
    case SortBy.CLICK_COUNT.toLowerCase():
	    return SortBy.CLICK_COUNT;
    case SortBy.CREATION_TIME:
    case SortBy.CREATION_TIME.toLowerCase():
    case "creation_time":
	    return SortBy.CREATION_TIME;
    case SortBy.TITLE: return SortBy.TITLE;
    case SortBy.FIRST_NAME:
    case SortBy.FIRST_NAME.toLowerCase(): return SortBy.FIRST_NAME;
    case SortBy.LAST_NAME:
    case SortBy.LAST_NAME.toLowerCase(): return SortBy.LAST_NAME;
    default:
	throw Error('Server Neo4j: SortBy ('+ sort_by  +') not implemented');
    }
}
/**
 * Neo4j always returns 64-bit numbers. Needs to be handled explicitly
 */
export function parse64BitNumber(num_64){
    let res = num_64['high'];
    for (let i=0; i<32; i++) {
	res *= 2;
    }
    return num_64['low'] + res;
}
/**
 * Reference: https://stackoverflow.com/questions/62671936/javascript-neo4j-driver-how-to-convert-datetime-into-string
 * Convert neo4j date objects in to a parsed javascript date object
 * @param dateString - the neo4j date object
 * @returns Date
 */
export function parseDate(neo4jDateTime){
    const { year, month, day, hour, minute, second, nanosecond } = neo4jDateTime;
    if (year === undefined || day === undefined || month === undefined ||
        hour === undefined || minute === undefined || second === undefined || nanosecond === undefined) {
        return neo4jDateTime;
    }
    const date = new Date(
	year.toInt(),
	month.toInt() - 1, // neo4j dates start at 1, js dates start at 0
	day.toInt(),
	hour.toInt(),
	minute.toInt(),
	second.toInt(),
	nanosecond.toInt() / 1000000 // js dates use milliseconds
    );

    return date;
}

// Sizes for different image versions
const IMAGE_SIZES = {
    thumbnail: [
        { width: 300, suffix: '-300px', name: 'low' },
        { width: 765, suffix: '-765px', name: 'medium' },
        { width: 1024, suffix: '-1024px', name:'high' },
    ],
    avatar: [
        { width: 150, suffix: '-150px', name: 'low' },
        { width: 765, suffix: '-765px', name: 'high' },
    ]
};

/**
 * To improve interactivity frontend expects multiple resoulutions for images. This function
 * generates multiple resolution images and urls for them.
 *
 * [BUG] Regardless of what is stored in and returned from the DB, this function will
 * always return URLs of 'thumbnail-image' with respect to current server address. This
 * may or may not be ideal and can result in possible bugs
 *
 * @param {string} Image file name or path or URL
 * @param {string} Upload directory path. If null, generate URLs without creating images
 * @returns {Object} {low: {string}, medium: {string}, high: {string}, original: {string}}
 */
export function generateMultipleResolutionImagesFor(image_file_str,
                                                    upload_dir_path = null,
                                                    is_avatar = false,
                                                    callback = null) {  // Callback is optional
    if (image_file_str === null || image_file_str === '') {
        // If the callback is provided, call it with an error
        if (callback) {
            callback('Invalid image file string', null);
        }
        return null;
    }

    const image_filename = path.basename(image_file_str);
    const filename_without_ext = image_filename.replace(/\.[^/.]+$/, '');
    const file_ext = path.extname(image_filename);
    const image_urls = {};

    let url_prefix = `https://${process.env.DOMAIN}:${process.env.PORT}/user-uploads`;
    let size_array = [];
    if (is_avatar) {
        url_prefix = `${url_prefix}/avatars`;
        size_array = IMAGE_SIZES.avatar;
    } else {
        url_prefix = `${url_prefix}/thumbnails`;
        size_array = IMAGE_SIZES.thumbnail;
    }

    image_urls['original'] = `${url_prefix}/${image_filename}`;
    let pending = size_array.length;
    let responseSent = false;  // Flag to prevent multiple responses

    function checkDone() {
        if (pending === 0 && !responseSent) {
            if (callback) {
                callback(null, image_urls);  // Send success callback
            }
            responseSent = true;  // Mark response as sent
        }
    }

    for (const size of size_array) {
        const resized_filename = `${filename_without_ext}${size.suffix}${file_ext}`;

        if (upload_dir_path) {
            sharp(path.join(upload_dir_path, image_filename))
                .resize(size.width)
                .toFile(path.join(upload_dir_path, resized_filename), (err, info) => {
                    if (err) {
                        console.error("Error processing image with sharp:", err);
                        image_urls['error'] = 'Unsupported image format or other error';
                        if (!responseSent && callback) {
                            callback('Unsupported image format', null);  // Call callback with error
                            responseSent = true;
                        }
                    } else {
                        console.log("Image resized successfully:", info);
                        image_urls[size.name] = `${url_prefix}/${resized_filename}`;
                    }
                    pending -= 1;
                    checkDone();
                });
        } else {
            image_urls[size.name] = `${url_prefix}/${resized_filename}`;
            pending -= 1;
            checkDone();
        }
    }

    // If no callback is provided, just return the image URLs
    if (!callback) {
        return image_urls;
    }
}


/**
 * Determing if user with user_id has enough permission to edit element with element_id
 * @param {string} element_id Element to check permissions for
 * @param {string} user_id Logged-in user ID
 * @param {int} user_role Logged-in user role
 * @returns Boolean true if user can edit, false otherwise
 */
export async function userCanEditElement(element_id, user_id, user_role) {
    // only allow editing if
    // (1) this element is owned by the user sending update request
    // (2) user sending update request is admin or super admin
    const element_owner = await n4j.getContributorIdForElement(element_id);
    if (user_id == element_owner['id'] || user_id == element_owner['openid']){
	console.log('This element is owned by the user');
	// this element is owned by the user sending update request
	return true;
    } else if (user_role <= Role.CONTENT_MODERATOR) {
	// user sending update request is admin or super admin
	return true;
    }
    return false;
}
//exports.userCanEditElement = userCanEditElement;

/**
 * Determing if user with user_id has enough permission to access element with element_id
 * @param {string} element_id Element to check permissions for
 * @param {string} user_id Logged-in user ID
 * @param {int} user_role Logged-in user role
 * @returns Boolean true if user can access, false otherwise
 */
export async function userCanViewElement(element_id, user_id, user_role) {
    const element_visibility = await n4j.getElementVisibilityForID(element_id);
    const element_owner = await n4j.getContributorIdForElement(element_id);

    if (element_visibility === Visibility.PUBLIC){
	return true;
    }
    // non-public element will never be visible to logged-out user
    if (user_id === null || user_role === null){
	console.log('User is not logged in and trying to access a private element');
	return false;
    }
    // non-public element should only be visible to owner or admin
    if (user_id == element_owner['id'] || user_id == element_owner['openid']){
	console.log('This element is owned by the user');
	// this element is owned by the user calling endpoing
	return true;
    } else if (user_role <= Role.CONTENT_MODERATOR) {
	// endpoing invoked by admin or super admin
	console.log('Admin user accessing a private element');
	return true;
    }
    return false;
}

/**
 * Get the Update action to be performed for OpenSearch based on the visibility parameter
 * @param old_visibility
 * @param new_visibility
 * @returns {string}
 */
export function updateOSBasedtOnVisibility(old_visibility, new_visibility) {
    /**
     * If the element's visibility has not changed
     *      and is an PUBLIC element then we need to update OS with new entries => TRUE (Update)
     *      or is an PRIVATE element no insertion/update required as no entry would be present in OS => FALSE
     * If the element's visibility has changed
     *      and the new visibility is PUBLIC then we need to insert into OS with a new entry of the element => TRUE (Insert)
     *      or the new visibility is PRIVATE then we need to delete the current OS entry for the element => FALSE (special case)
     */
    if (old_visibility === new_visibility) {
        if (old_visibility === Visibility.PUBLIC) {
            return "UPDATE";
        } else {
            return "NONE";
        }
    } else {
        if (new_visibility === Visibility.PUBLIC) {
            return "INSERT";
        } else {
            return "DELETE";
        }
    }
}

export function checkUpdateParameters(updates) {
    let updated_check = true;
    Object.values(UnEditableParameters).map((param) => {
        if (updates[param] !== undefined) {
            updated_check = false;
        }
    });
    return updated_check;
}

export function hasTrustedTLD(contributor_domain) {
    if (!contributor_domain) {
        return false;
    }
    const lowerDomain = contributor_domain.toLowerCase();
    /**
     * Regex to match .edu or .gov as TLD (with optional 2-letter country code)
     * Pattern explanation:
     *  \.edu(\.[a-z]{2})?$ - matches .edu or .edu.XX (where XX is 2 letters) at end (eg: .edu.uk)
     *  \.gov(\.[a-z]{2})?$ - matches .gov or .gov.XX (where XX is 2 letters) at end (eg: .gov.uk, gov.in)
     */
    const trustedTLDPattern = /\.(edu|gov)(\.[a-z]{2})?$/;

    return trustedTLDPattern.test(lowerDomain);
}

export function generateUserRole(contributor) {
    // (2) assign roles for new contributor
    let contributor_domain = contributor['email'] && contributor['email'].toLowerCase()
        .substring(contributor['email'].toLowerCase().lastIndexOf("@")+1);

    if (contributor['email'] && contributor_domain) {
        // Check trusted Top Level Domain
        if (hasTrustedTLD(contributor_domain)) {
            return neo4j.int(Role.TRUSTED_USER);
        }

        // Check university domain
        if (checkUniversityDomain(contributor_domain)) {
            return neo4j.int(Role.TRUSTED_USER);
        }
    }

    // Check IDP name
    if (contributor['idp_name'] && contributor['idp_name'].toLowerCase().includes('university')) {
        return neo4j.int(Role.TRUSTED_USER);
    }

    // default role
    return neo4j.int(Role.UNTRUSTED_USER);
}

export const HPC_ACCESS_AFFILIATION = "ACCESS";
export async function checkHPCAccessGrant(user_id) {
    try {
        const user_details = await n4j.getContributorByID(user_id);
        if (user_details['affiliation'] && user_details['affiliation'] === HPC_ACCESS_AFFILIATION) {
            return true;
        }
        return false;
    } catch (error) {
        console.log("checkHPCAccessGrant() - Error: ", error);
        return false;
    }
}