const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const multer = require('multer');

const MAX_FILES = 6;
const MAX_FILE_SIZE = 15 * 1024 * 1024;
const SUPPORTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/quicktime',
]);
const MIME_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
};

function createUploadMiddleware(uploadDirectory) {
  const stagingDirectory = path.join(uploadDirectory, 'staging');
  const privateDirectory = path.join(uploadDirectory, 'private');
  const storage = multer.diskStorage({
    destination(request, file, callback) {
      fs.mkdir(stagingDirectory, { recursive: true })
        .then(() => callback(null, stagingDirectory), callback);
    },
    filename(request, file, callback) {
      callback(null, crypto.randomUUID());
    },
  });
  const upload = multer({
    storage,
    limits: {
      fileSize: MAX_FILE_SIZE,
      files: MAX_FILES,
      fields: 24,
      fieldSize: 16 * 1024,
      parts: 30,
    },
  });

  return {
    privateDirectory,
    middleware(request, response, next) {
      if (!request.is('multipart/form-data')) {
        request.files = [];
        next();
        return;
      }
      upload.array('attachments', MAX_FILES)(request, response, next);
    },
  };
}

async function inspectUploads(files) {
  const { fileTypeFromFile } = await import('file-type');
  const inspected = [];

  for (const file of files) {
    const detected = await fileTypeFromFile(file.path);
    if (!detected || !SUPPORTED_MIME_TYPES.has(detected.mime)) {
      const error = new Error('Attachments must be JPG, PNG, WebP, MP4 or MOV files.');
      error.status = 400;
      error.fields = { attachments: error.message };
      throw error;
    }
    inspected.push({
      file,
      mimeType: detected.mime,
      storageKey: `${crypto.randomUUID()}${MIME_EXTENSIONS[detected.mime]}`,
      originalName: path.win32.basename(file.originalname).slice(0, 255),
    });
  }
  return inspected;
}

async function persistUploads(client, inspected, submissionType, submissionId, privateDirectory) {
  const movedFiles = [];
  if (inspected.length) await fs.mkdir(privateDirectory, { recursive: true });

  try {
    for (const item of inspected) {
      const destination = path.join(privateDirectory, item.storageKey);
      await fs.rename(item.file.path, destination);
      movedFiles.push(destination);

      const relationColumn = submissionType === 'booking' ? 'booking_id' : 'enquiry_id';
      await client.query(
        `INSERT INTO submission_attachments (
          id, ${relationColumn}, storage_key, original_name, mime_type, size_bytes
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          crypto.randomUUID(),
          submissionId,
          item.storageKey,
          item.originalName,
          item.mimeType,
          item.file.size,
        ],
      );
    }
    return movedFiles;
  } catch (error) {
    await removeFiles(movedFiles);
    throw error;
  }
}

async function removeFiles(files) {
  const results = await Promise.allSettled(files.map((file) => fs.unlink(file)));
  const failures = results
    .filter((result) => result.status === 'rejected' && result.reason.code !== 'ENOENT')
    .map((result) => result.reason);
  if (failures.length) {
    throw new AggregateError(failures, 'Could not clean up temporary upload files.');
  }
}

async function removeStagedUploads(files) {
  await removeFiles(files.map((file) => file.path));
}

module.exports = {
  MAX_FILES,
  MAX_FILE_SIZE,
  createUploadMiddleware,
  inspectUploads,
  persistUploads,
  removeFiles,
  removeStagedUploads,
};
