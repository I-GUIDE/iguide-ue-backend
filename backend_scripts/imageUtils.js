import fs from 'fs'; // Import the fs module for file system operations
import path from 'path'; // Import the path module for handling file paths
import sharp from 'sharp'; // Import the sharp library for image processing



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

// Common helper to filter files
const shouldIgnoreFile = (fileName) => {
    // Ignore files ending with px.* (e.g., px.png, px.jpg)
    return /px\.[a-zA-Z0-9]+$/.test(fileName);
};

// Thumbnail mod function
const updateThumbnailInDatabase = async (url) => {
    const fileNameWithoutExt = url.replace(/\.[^/.]+$/, '');
    const fileExt = url.slice(url.lastIndexOf('.'));

    for (const size of IMAGE_SIZES.thumbnail) {
        const resizedFileName = `${fileNameWithoutExt}${size.suffix}${fileExt}`;
        
        await sharp(url)
            .resize(size.width)
            .toFile(resizedFileName);
    }
};

// Avatar mod function
const updateAvatarInDatabase = async (url) => {
    const fileNameWithoutExt = url.replace(/\.[^/.]+$/, '');
    const fileExt = url.slice(url.lastIndexOf('.'));

    for (const size of IMAGE_SIZES.avatar) {
        const resizedFileName = `${fileNameWithoutExt}${size.suffix}${fileExt}`;
        
        await sharp(url)
            .resize(size.width)
            .toFile(resizedFileName);
    }
};

// Delete invalid files
const deleteInvalidFile = (filePath) => {
    try {
        fs.unlinkSync(filePath);
        console.log(`Deleted invalid file: ${filePath}`);
    } catch (error) {
        console.error(`Error deleting file: ${filePath}`, error);
    }
};

const processImages = async (folderPath, imageSizes, type) => {
    try {
        const files = fs.readdirSync(folderPath);

        for (const file of files) {
            const filePath = path.join(folderPath, file);

            if (!shouldIgnoreFile(file)) {
                const fileNameWithoutExt = file.replace(/\.[^/.]+$/, '');
                const fileExt = file.slice(file.lastIndexOf('.'));

                for (const size of imageSizes) {
                    const resizedFileName = `${fileNameWithoutExt}${size.suffix}${fileExt}`;
                    const resizedFilePath = path.join(folderPath, resizedFileName);

                    try {
                        await sharp(filePath)
                            .resize(size.width)
                            .toFile(resizedFilePath);
                    } catch (error) {
                        console.error(`Error resizing ${type} image: ${filePath}`, error);
                        deleteInvalidFile(filePath); // Delete invalid file and continue
                        break; // Exit the loop for this file
                    }
                }
            }
        }
        console.log(`All ${type} images have been processed successfully.`);
    } catch (error) {
        console.error(`Error processing ${type} images:`, error);
    }
};

const updateThumbnailInFolder = async (folderPath) => {
    await processImages(folderPath, IMAGE_SIZES.thumbnail, "thumbnail");
};

const updateAvatarInFolder = async (folderPath) => {
    await processImages(folderPath, IMAGE_SIZES.avatar, "avatar");
};



updateThumbnailInFolder("/media/volume/dwn-backend-data/user-uploads/thumbnails");
updateAvatarInFolder("/media/volume/dwn-backend-data/user-uploads/avatars");
