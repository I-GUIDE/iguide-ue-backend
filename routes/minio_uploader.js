import {
    AbortMultipartUploadCommand,
    CompleteMultipartUploadCommand,
    CreateMultipartUploadCommand, DeleteObjectCommand,
    S3Client,
    UploadPartCommand, ListObjectsV2Command,
    CopyObjectCommand
} from '@aws-sdk/client-s3';
import multerS3 from 'multer-s3';
import multer from 'multer';
import dotenv from 'dotenv';
import {ElementType, parseElementType} from "../utils/utils.js";
import * as crypto from "node:crypto";

dotenv.config();
/****************************************************************************
 * Constant variables and S3 Client
 ****************************************************************************/

export const MAX_FILE_SIZE = 2 * 1024 * 1025 * 1024; // 2 GB
const CHUNK_SIZE = 5 * 1024 * 1024; // 50 MB
const BUFFER_CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB
const MIN_CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
export const ALLOWED_MIME_TYPES = [
    "application/x-shapefile",              // .shp
    "application/octet-stream",             // .shx
    "application/dbf",                      // .dbf
    "application/x-prj",                    // .prj (no official standard; fallback to octet-stream if needed)
    "application/geo+json",                 // .geojson
    "application/json",                     // .json
    "application/vnd.google-earth.kml+xml", // .kml
    "application/vnd.google-earth.kmz",     // .kmz
    "application/geopackage+sqlite3",       // .gpkg (sometimes application/x-sqlite3)
    "application/x-filegdb",                // .gdb (Esri File Geodatabase)
    "image/vnd.dxf",                        // .dxf
    "image/vnd.dwg",                        // .dwg
    "text/csv",                             // .csv
    "application/zip",                      // .zip
    "application/x-zip-compressed"          // Compressed .zip
];
const FILE_SEPARATOR = "---"
/**
 * In-memory store for multipart uploads [Use Database or other Redis later]
 * @type {Map<any, any>}
 */
const multipartUploads = new Map();

/**
 * Create the S3Client for MinIO Upload
 * @type {S3Client}
 */
const s3 = new S3Client({
    endpoint: process.env.MINIO_ENDPOINT,
    region: process.env.MINIO_AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.MINIO_AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.MINIO_AWS_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
});

/**
 * multer function for single file upload
 * @type {Multer}
 */
export const upload = multer({
    storage: multerS3({
        s3: s3,
        bucket: process.env.MINIO_AWS_BUCKET_NAME,
        acl: 'public-read',
        key: (req, file, cb) => cb(null, file.originalname),
    }),
    fileFilter(req, file, cb) {
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
            return cb(new Error('Invalid file type'), false);
        }
        cb(null, true);
    },
});

/**
 * multer instance for creating a multi chunk upload
 * @type {Multer}
 */
export const multiChunkUpload = multer({
    storage: multer.memoryStorage(),
    limits: {
       fileSize: CHUNK_SIZE + BUFFER_CHUNK_SIZE,
    },
    fileFilter(req, file, cb) {
    if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      return cb(new Error('Invalid file type'), false);
    }
    cb(null, true);
  },
});

/**
 * Get the upload progress for a chunk upload with uploadId
 * @param uploadId
 * @returns {{filename, uploadId, totalParts: number, fileSize: *, progress: number, completedParts: number, elapsedTime: number}|null}
 */
export function getUploadProgress(uploadId) {
    const uploadInfo = multipartUploads.get(uploadId);
    if (!uploadInfo) return null;

    const completedParts = uploadInfo.parts.filter(part => part !== undefined).length;
    const totalParts = Math.ceil(uploadInfo.fileSize / (50 * 1024 * 1024)); // 50MB chunks

    const progress = (completedParts / totalParts) * 100;

    const elapsedTime = Date.now() - uploadInfo.createdAt;

    return {
        uploadId: uploadId,
        filename: uploadInfo.filename,
        fileSize: uploadInfo.fileSize,
        completedParts: completedParts,
        totalParts: totalParts,
        progress: progress,
        elapsedTime: elapsedTime,
    };
}

/**
 * Get the upload details to verify if the uploadId exists.
 * @param uploadId
 * @returns {*}
 */
export function getUploadDetails(uploadId) {
    return multipartUploads.get(uploadId);
}

/**
 * Extracting the fileKey from the url
 * @param url
 * @returns {string|null}
 */
function extractFileKeyFromUrl(url) {
    try {
        const urlObj = new URL(url);

        // For MinIO URLs, the path typically contains the bucket and key
        // Format: http://localhost:9000/bucket-name/object-key
        const pathParts = urlObj.pathname.split('/').filter(part => part.length > 0);

        if (pathParts.length < 2) {
            return null;
        }

        // Skip the bucket name (first part) and get the rest as the key
        return pathParts.slice(1).join('/');
  } catch (error) {
        console.log('extractFileKeyFromUrl() - Invalid URL format:', error);
        return null;
  }
}

/**
 * Complete the chunk upload using uploadId and using all the uploadData parts
 * @param uploadId
 * @returns {Promise<{bucket: *, filename, message: string, url, key}|null>}
 */
export async function completeMultipartUpload(uploadId) {
    const uploadData = getUploadDetails(uploadId);
    if (!uploadData) {
        return null;
    }
    // Prepare parts for completion (filter out undefined parts)
    const parts = uploadData.parts
        .filter(part => part !== undefined)
        .map(part => ({
            ETag: part.ETag,
            PartNumber: part.PartNumber,
            buffer: part.buffer,
        }))
        .sort((a, b) => a.PartNumber - b.PartNumber);

    // Checksum generation
    const hash = crypto.createHash('sha256');
    for(const part of parts) {
        hash.update(part.buffer);
    }

    const checksum = hash.digest('hex');

    // Complete multipart upload
    const completeCommand = new CompleteMultipartUploadCommand({
        Bucket: process.env.MINIO_AWS_BUCKET_NAME,
        Key: uploadData.key,
        UploadId: uploadData.s3UploadId,
        MultipartUpload: {
            Parts: parts,
        },
    });

    const result = await s3.send(completeCommand);

    // Clean up
    multipartUploads.delete(uploadId);

    return {
        message: 'Dataset uploaded successfully',
        url: result.Location,
        bucket: process.env.MINIO_AWS_BUCKET_NAME,
        key: uploadData.key,
        filename: uploadData.filename,
        checksum: checksum,
    };
}

/**
 * Abort the multi chunk upload process for uploadId
 * @param uploadId
 * @returns {Promise<boolean>}
 */
export async function abortMultipartUpload(uploadId) {
    try {
        const uploadData = multipartUploads.get(uploadId);
        if (!uploadData) {
            return false;
        }

        const abortCommand = new AbortMultipartUploadCommand({
            Bucket: process.env.MINIO_AWS_BUCKET_NAME,
            Key: uploadData.key,
            UploadId: uploadData.s3UploadId,
        });

        await s3.send(abortCommand);

        // Clean up
        multipartUploads.delete(uploadId);

        return true;
    } catch (error) {
        console.error('Error aborting multipart upload:', error);
        return false;
    }
}

/**
 * Function to process a chunk for the uploadId based on the request received
 * @param uploadId
 * @param uploadData
 * @param chunkNumber
 * @param totalChunks
 * @param request
 * @returns {Promise<{chunkNumber: number, success: boolean, etag}>}
 */
export async function processChunkBasedOnUploadId(uploadId, uploadData, chunkNumber, totalChunks, request) {
    const partNumber = parseInt(chunkNumber) + 1; // S3 part numbers start from 1

    // Upload chunk to S3
    const chunkCommand = new UploadPartCommand({
        Bucket: process.env.MINIO_AWS_BUCKET_NAME,
        Key: uploadData.key,
        PartNumber: partNumber,
        UploadId: uploadData.s3UploadId,
        Body: request.file.buffer,
      });

      const result = await s3.send(chunkCommand);

      // Store part info
      uploadData.parts[parseInt(chunkNumber)] = {
          ETag: result.ETag,
          PartNumber: partNumber,
          buffer: request.file.buffer,
      };

      multipartUploads.set(uploadId, uploadData);

      return {
        success: true,
        chunkNumber: parseInt(chunkNumber),
        etag: result.ETag,
      };
}

/**
 * Function to initialize chunk upload process for a file details
 * @param fileName
 * @param fileSize
 * @param mimeType
 * @param userId
 * @returns {Promise<{result: boolean, uploadId: `${string}-${string}-${string}-${string}-${string}`, chunkSize: number, s3UploadId, key: string}>}
 */
export async function initializeChunkUpload(fileName, fileSize, mimeType, userId) {
    const uploadId = crypto.randomUUID();
    const fileKey = `temp/${uploadId}${FILE_SEPARATOR}${fileName}`;

    const multiPartCommand = new CreateMultipartUploadCommand({
        Bucket: process.env.MINIO_AWS_BUCKET_NAME,
        Key: fileKey,
        ContentType: mimeType,
        ACL: 'public-read',
        Metadata: {
            'uploaded-by': userId,
        }
    });

    const result = await s3.send(multiPartCommand);

    multipartUploads.set(uploadId, {
        s3UploadId: result.UploadId,
        key: fileKey,
        filename: fileName,
        fileSize: fileSize,
        mimeType: mimeType,
        parts: [],
        createdAt: new Date(),
    });

    return {
        uploadId: uploadId,
        s3UploadId: result.UploadId,
        key: fileKey,
        chunkSize: CHUNK_SIZE,
        result: true,
    };
}

/**
 * Function exposed to delete the dataset based on the element
 * @param resource
 * @returns {Promise<{success: boolean, message: string}|{success: boolean, message: string}|{success: boolean, message: string}|boolean>}
 */
export async function performDatasetDeletion(resource) {
    if (resource['resource-type'] && parseElementType(resource['resource-type']) === ElementType.DATASET) {
        if (resource['direct-download-link'] && String(resource['direct-download-link']).startsWith(process.env.MINIO_ENDPOINT)) {
            const result = await deleteElementData(resource['direct-download-link']);
            return result;
        } else {
            return true;
        }
    } else {
        return true;
    }
}

/**
 * Function to delete the dataset from the MinIO Instance
 * @param datasetUrl
 * @returns {Promise<{success: boolean, message: string}>}
 */
export async function deleteElementData(datasetUrl) {
    try {
        const fileKey = extractFileKeyFromUrl(datasetUrl);
        if (!fileKey) {
            return {
                success: false,
                message: 'Invalid file URL format. Unable to extract object key.'
            };
        }

        const deleteCommand = new DeleteObjectCommand({
            Bucket: process.env.MINIO_AWS_BUCKET_NAME,
            Key: fileKey,
        });
        await s3.send(deleteCommand);

        return {
            success: true,
            message: 'File deleted successfully.'
        };
    } catch (error) {
        console.log('deleteElementData() - Error in deleting file from MinIO: ', error);
        return {
            success: false,
            message: `Failed to delete file: ${error.message}`,
        };
    }
}

export function getRawFileNameFromUrl(dataset_url) {
    let fileKey = extractFileKeyFromUrl(dataset_url);
    let fileKeyArray = fileKey.split("/");
    let rawFileName = fileKeyArray[fileKeyArray.length - 1].split(FILE_SEPARATOR)[1];
    return rawFileName;
}

export async function moveDatasetToElement(dataset_url, element_id) {
    try {
        const rawFileName = getRawFileNameFromUrl(dataset_url);
        const currentFileKey = extractFileKeyFromUrl(dataset_url);
        const newFileKey = `${element_id}/${rawFileName}`;
        const bucketName = process.env.MINIO_AWS_BUCKET_NAME;
        const copyFileCommand = new CopyObjectCommand({
            Bucket: bucketName,
            CopySource: `/${bucketName}/${currentFileKey}`,
            Key: newFileKey,
            ACL: 'public-read',
        });

        await s3.send(copyFileCommand);

        const deleteFileCommand = new DeleteObjectCommand({
            Bucket: bucketName,
            Key: currentFileKey,
        });

        await s3.send(deleteFileCommand);

        let newFilePath = `${process.env.MINIO_ENDPOINT}/${process.env.MINIO_AWS_BUCKET_NAME}/${newFileKey}`
        return newFilePath;
    } catch (error) {
        console.log('moveDatasetToElement() - Error: ', error);
        return "";
    }
}
/**
 * Function to clean up old uploads periodically
 */
function cleanupOldUploads() {
  const cutoffTime = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

  for (const [uploadId, uploadData] of multipartUploads.entries()) {
    if (uploadData.createdAt < cutoffTime) {
      // Abort the S3 multipart upload
      const abortPeriodicCommand = new AbortMultipartUploadCommand({
        Bucket: process.env.MINIO_AWS_BUCKET_NAME,
        Key: uploadData.key,
        UploadId: uploadData.s3UploadId,
      });

      s3.send(abortPeriodicCommand).catch(console.error);
      multipartUploads.delete(uploadId);
    }
  }
}

/**
 * Function to clean up all files in the `temp/` directory
 */
async function cleanupTempDirectory() {
  try {
    const listCommand = new ListObjectsV2Command({
      Bucket: process.env.MINIO_AWS_BUCKET_NAME,
      Prefix: "temp/",
    });

    const response = await s3.send(listCommand);

    if (!response?.Contents || response?.Contents?.length === 0) {
      console.log("No files found in temp/ directory.");
      return;
    }

    for (const object of response.Contents) {
      const deleteCommand = new DeleteObjectCommand({
        Bucket: process.env.MINIO_AWS_BUCKET_NAME,
        Key: object.Key,
      });

      await s3.send(deleteCommand);
      console.log(`Deleted: ${object.Key}`);
    }
  } catch (err) {
    console.error("Error cleaning temp directory:", err);
  }
}

/**
 * Run cleanup for /temp folder every 3 hours
 */
setInterval(cleanupTempDirectory, 3 * 60 * 60 * 1000);

/**
 * Running the cleanup of hashmap every hour
 */
setInterval(cleanupOldUploads, 60 * 60 * 1000);