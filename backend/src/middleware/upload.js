
import multer from "multer";
import path from "path";
import crypto from "crypto";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDirectory = path.resolve(__dirname, "../../uploads");

fs.mkdirSync(uploadDirectory, { recursive: true });

const allowedMimeTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
];

const storage = multer.diskStorage({
  destination: (_req, _file, callback) => {
    callback(null, uploadDirectory);
  },

  filename: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const uniqueName = `${crypto.randomUUID()}${extension}`;
    callback(null, uniqueName);
  },
});

const fileFilter = (_req, file, callback) => {
  if (!allowedMimeTypes.includes(file.mimetype)) {
    const error = new Error("Only JPEG, PNG, and WebP images are allowed.");
    error.status = 400;
    return callback(error);
  }

  callback(null, true);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 3 * 1024 * 1024,
    files: 5,
  },
});

export default upload;
