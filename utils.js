import path from 'path';
import sharp from 'sharp';
// local imports
import * as n4j from './backend_neo4j.js'

/**************
 * Enums
 **************/
export const ElementType = Object.freeze({
    NOTEBOOK: "Notebook",
    DATASET: "Dataset",
    PUBLICATION: "Publication",
    OER: "Oer", // Open Educational Content
    MAP: "Map",
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
    TRUSTED_USER: 8,             // users with .edu emails
    UNTRUSTED_USER: 10,          // all other users
});
//exports.Role = Role;

export const Visibility = Object.freeze({
    PRIVATE: 'private',
    PUBLIC: 'public',
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
    default:
	throw Error('Server Neo4j: Element type ('+ element_type  +') parsing not implemented');
    }
}

export function parseSortBy(sort_by){
    switch (sort_by){
    case SortBy.CLICK_COUNT:
    case SortBy.CLICK_COUNT.toLowerCase():
	return SortBy.CLICK_COUNT;
    case SortBy.CREATION_TIME:
    case "creation_time":
	return SortBy.CREATION_TIME;
    case SortBy.TITLE: return SortBy.TITLE;
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
						    upload_dir_path=null,
						    is_avatar=false){
    if (image_file_str === null || image_file_str === '') return null;
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
    for (const size of size_array) {
        const resized_filename = `${filename_without_ext}${size.suffix}${file_ext}`;

	if (upload_dir_path) {
	    sharp(path.join(upload_dir_path, image_filename))
		.resize(size.width)
		.toFile(path.join(upload_dir_path, resized_filename));
	}

	image_urls[size.name] = `${url_prefix}/${resized_filename}`;
    }
    //console.log(image_urls);
    return image_urls;
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
