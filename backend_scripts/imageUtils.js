import sharp from 'sharp';

const IMAGE_SIZES = {
    thumbnail: [
        { width: 300, suffix: '-300px', name: 'low' },
        { width: 765, suffix: '-756px', name: 'medium' },
        { width: 1024, suffix: '-1024px', name:'high' },
    ],
    avatar: [
        { width: 96, suffix: '-150px', name: 'low' },
    ]
};

// Thumbnail mod function
export const updateThumbnailInDatabase = async (url) => {
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
export const updateAvatarInDatabase = async (url) => {
    const fileNameWithoutExt = url.replace(/\.[^/.]+$/, '');
    const fileExt = url.slice(url.lastIndexOf('.'));

    for (const size of IMAGE_SIZES.avatar) {
        const resizedFileName = `${fileNameWithoutExt}${size.suffix}${fileExt}`;
        
        await sharp(url)
            .resize(size.width)
            .toFile(resizedFileName);
    }
};