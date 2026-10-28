
import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import db from "../db/index.js";
import { authenticateToken } from "../middleware/auth.js";
import upload from "../middleware/upload.js";
import { validateAuction } from "../utils/validateAuction.js";
import {
  MAX_PHOTOS,
} from "../constants/auction.js";

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadDirectory = path.resolve(__dirname, "../../uploads");

function removeUploadedFiles(files) {
  for (const file of files) {
    try {
      fs.unlinkSync(file.path);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

function parseAuctionId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function getAuction(auctionId) {
  const auction = db.prepare(`
    SELECT
      a.id,
      a.seller_id,
      a.title,
      a.category,
      a.description,
      a.condition,
      a.starting_price,
      a.min_increment,
      a.closes_at,
      a.status,
      a.outcome_note,
      a.created_at,
      u.name AS seller_name
    FROM auctions a
    JOIN users u ON u.id = a.seller_id
    WHERE a.id = ?
  `).get(auctionId);

  if (!auction) {
    return null;
  }

  const photos = db.prepare(`
    SELECT id, url
    FROM photos
    WHERE auction_id = ?
    ORDER BY id
  `).all(auctionId);

  return { ...auction, photos };
}

router.post(
  "/",
  authenticateToken,
  upload.array("photos", MAX_PHOTOS),
  (req, res) => {
    const files = req.files ?? [];

    try {
      const { errors, value } = validateAuction(req.body);

      if (Object.keys(errors).length > 0) {
        removeUploadedFiles(files);
        return res.status(400).json({
          message: "Please correct the listing details.",
          errors,
        });
      }

      const createAuction = db.transaction(() => {
        const result = db.prepare(`
          INSERT INTO auctions (
            seller_id,
            title,
            category,
            description,
            condition,
            starting_price,
            min_increment,
            closes_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          req.user.id,
          value.title,
          value.category,
          value.description || null,
          value.condition,
          value.starting_price,
          value.min_increment,
          value.closes_at
        );

        const auctionId = Number(result.lastInsertRowid);

        const insertPhoto = db.prepare(`
          INSERT INTO photos (auction_id, url)
          VALUES (?, ?)
        `);

        for (const file of files) {
          insertPhoto.run(
            auctionId,
            `/uploads/${file.filename}`
          );
        }

        return auctionId;
      });

      const auctionId = createAuction();

      return res.status(201).json({
        message: "Auction listing created successfully.",
        auction: {
          id: auctionId,
          ...value,
          seller_id: req.user.id,
          status: "active",
          photos: files.map(
            (file) => `/uploads/${file.filename}`
          ),
        },
      });
    } catch (error) {
      removeUploadedFiles(files);
      console.error("Create auction error:", error);

      return res.status(500).json({
        message: "Unable to create auction listing.",
      });
    }
  }
);

router.patch(
  "/:id",
  authenticateToken,
  upload.array("photos", MAX_PHOTOS),
  (req, res) => {
    const files = req.files ?? [];

    try {
      const auctionId = parseAuctionId(req.params.id);
      if (!auctionId) {
        removeUploadedFiles(files);
        return res.status(400).json({ message: "Invalid auction ID." });
      }

      const auction = db.prepare(`
        SELECT id, seller_id, status, closes_at
        FROM auctions
        WHERE id = ?
      `).get(auctionId);

      if (!auction) {
        removeUploadedFiles(files);
        return res.status(404).json({ message: "Auction not found." });
      }

      if (auction.seller_id !== req.user.id) {
        removeUploadedFiles(files);
        return res.status(403).json({
          message: "Only the seller can edit this listing.",
        });
      }

      if (
        auction.status !== "active" ||
        Date.parse(auction.closes_at) <= Date.now()
      ) {
        removeUploadedFiles(files);
        return res.status(409).json({
          message: "Only active listings can be edited.",
        });
      }

      const bidCount = db.prepare(`
        SELECT COUNT(*) AS count
        FROM bids
        WHERE auction_id = ?
      `).get(auctionId).count;
      const current = db.prepare(`
        SELECT title, category, description, condition,
          starting_price, min_increment, closes_at
        FROM auctions
        WHERE id = ?
      `).get(auctionId);
      const mergedValues = {
        ...current,
        ...req.body,
      };
      const closingTimeChanged =
        Object.hasOwn(req.body, "closes_at") &&
        Date.parse(req.body.closes_at) !== Date.parse(current.closes_at);
      const { errors, value } = validateAuction(mergedValues, {
        validateClosingWindow: closingTimeChanged,
      });

      if (Object.keys(errors).length > 0) {
        removeUploadedFiles(files);
        return res.status(400).json({
          message: "Please correct the listing details.",
          errors,
        });
      }

      if (bidCount > 0) {
        const lockedFields = [
          ["starting_price", "Starting price"],
          ["min_increment", "Minimum bid increment"],
          ["closes_at", "Closing time"],
        ];
        const changedLockedField = lockedFields.find(([field]) => {
          if (field === "closes_at") {
            return Date.parse(value[field]) !== Date.parse(current[field]);
          }
          return value[field] !== current[field];
        });

        if (changedLockedField) {
          removeUploadedFiles(files);
          return res.status(409).json({
            message: `${changedLockedField[1]} cannot be changed after the first bid.`,
          });
        }
      }

      let keepPhotoIds;
      if (Object.hasOwn(req.body, "keep_photo_ids")) {
        try {
          keepPhotoIds = JSON.parse(req.body.keep_photo_ids);
        } catch {
          removeUploadedFiles(files);
          return res.status(400).json({
            message: "Photo selection is invalid.",
          });
        }

        if (
          !Array.isArray(keepPhotoIds) ||
          keepPhotoIds.some((id) => !Number.isSafeInteger(Number(id)) || Number(id) <= 0)
        ) {
          removeUploadedFiles(files);
          return res.status(400).json({
            message: "Photo selection is invalid.",
          });
        }

        keepPhotoIds = keepPhotoIds.map(Number);
      } else {
        keepPhotoIds = db.prepare(`
          SELECT id FROM photos WHERE auction_id = ?
        `).all(auctionId).map((photo) => photo.id);
      }

      const existingPhotos = db.prepare(`
        SELECT id, url FROM photos WHERE auction_id = ?
      `).all(auctionId);
      const existingPhotoIds = new Set(
        existingPhotos.map((photo) => photo.id)
      );

      if (
        keepPhotoIds.some((id) => !existingPhotoIds.has(id)) ||
        keepPhotoIds.length + files.length > MAX_PHOTOS
      ) {
        removeUploadedFiles(files);
        return res.status(400).json({
          message: "Choose up to 5 photos belonging to this listing.",
        });
      }

      const removePhoto = db.transaction(() => {
        db.prepare(`
          UPDATE auctions
          SET title = ?, category = ?, description = ?, condition = ?,
            starting_price = ?, min_increment = ?, closes_at = ?
          WHERE id = ?
        `).run(
          value.title,
          value.category,
          value.description || null,
          value.condition,
          value.starting_price,
          value.min_increment,
          value.closes_at,
          auctionId
        );

        if (Object.hasOwn(req.body, "keep_photo_ids")) {
          if (keepPhotoIds.length === 0) {
            db.prepare("DELETE FROM photos WHERE auction_id = ?")
              .run(auctionId);
          } else {
            const placeholders = keepPhotoIds.map(() => "?").join(", ");
            db.prepare(`
              DELETE FROM photos
              WHERE auction_id = ? AND id NOT IN (${placeholders})
            `).run(auctionId, ...keepPhotoIds);
          }
        }

        const insertPhoto = db.prepare(`
          INSERT INTO photos (auction_id, url) VALUES (?, ?)
        `);
        for (const file of files) {
          insertPhoto.run(auctionId, `/uploads/${file.filename}`);
        }
      });

      removePhoto();
      const keptIds = new Set(keepPhotoIds);
      for (const photo of existingPhotos) {
        if (!keptIds.has(photo.id)) {
          const filename = path.basename(photo.url);
          const photoPath = path.resolve(uploadDirectory, filename);
          if (photoPath.startsWith(`${uploadDirectory}${path.sep}`)) {
            try {
              fs.unlinkSync(photoPath);
            } catch (error) {
              if (error.code !== "ENOENT") {
                console.error("Unable to remove listing photo:", error);
              }
            }
          }
        }
      }

      return res.json({
        message: "Auction listing updated successfully.",
        auction: getAuction(auctionId),
      });
    } catch (error) {
      removeUploadedFiles(files);
      console.error("Update auction error:", error);
      return res.status(500).json({
        message: "Unable to update auction listing.",
      });
    }
  }
);

router.post("/:id/cancel", authenticateToken, (req, res) => {
  const auctionId = parseAuctionId(req.params.id);
  const reason = typeof req.body?.reason === "string"
    ? req.body.reason.trim()
    : "";

  if (!auctionId) {
    return res.status(400).json({ message: "Invalid auction ID." });
  }

  if (!reason || reason.length > 1000) {
    return res.status(400).json({
      message: "Provide a cancellation reason of 1 to 1000 characters.",
    });
  }

  const auction = db.prepare(`
    SELECT seller_id, status, closes_at FROM auctions WHERE id = ?
  `).get(auctionId);

  if (!auction) {
    return res.status(404).json({ message: "Auction not found." });
  }

  if (auction.seller_id !== req.user.id) {
    return res.status(403).json({
      message: "Only the seller can cancel this listing.",
    });
  }

  if (
    auction.status !== "active" ||
    Date.parse(auction.closes_at) <= Date.now()
  ) {
    return res.status(409).json({
      message: "Only active listings can be cancelled.",
    });
  }

  const result = db.prepare(`
    UPDATE auctions
    SET status = 'cancelled', outcome_note = ?
    WHERE id = ? AND seller_id = ? AND status = 'active'
      AND julianday(closes_at) > julianday('now')
  `).run(reason, auctionId, req.user.id);

  if (result.changes === 0) {
    return res.status(409).json({
      message: "This listing is no longer active.",
    });
  }

  return res.json({
    message: "Auction listing cancelled.",
    auction: getAuction(auctionId),
  });
});

router.get("/:id", (req, res) => {
  const auctionId = parseAuctionId(req.params.id);

  if (!auctionId) {
    return res.status(400).json({
      message: "Invalid auction ID.",
    });
  }

  const auction = getAuction(auctionId);

  if (!auction) {
    return res.status(404).json({
      message: "Auction not found.",
    });
  }

  return res.json({
    auction,
  });
});

export default router;
