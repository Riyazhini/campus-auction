
import { Router } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import db from "../db/index.js";
import { authenticateToken } from "../middleware/auth.js";
import upload from "../middleware/upload.js";
import { validateAuction } from "../utils/validateAuction.js";
import {
  AUCTION_CATEGORIES,
  ITEM_CONDITIONS,
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
      a.winner_id,
      a.winning_amount,
      a.outcome_note,
      a.created_at,
      u.name AS seller_name,
      winner.name AS winner_name
    FROM auctions a
    JOIN users u ON u.id = a.seller_id
    LEFT JOIN users winner ON winner.id = a.winner_id
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
  const events = db.prepare(`
    SELECT
      e.id,
      e.event_type,
      e.from_status,
      e.to_status,
      e.note,
      e.created_at,
      u.name AS actor_name
    FROM auction_events e
    LEFT JOIN users u ON u.id = e.actor_id
    WHERE e.auction_id = ?
    ORDER BY e.created_at ASC, e.id ASC
  `).all(auctionId);
  const handoverConfirmations = db.prepare(`
    SELECT
      h.user_id,
      h.confirmed_at,
      u.name
    FROM handover_confirmations h
    JOIN users u ON u.id = h.user_id
    WHERE h.auction_id = ?
    ORDER BY h.confirmed_at ASC, h.user_id ASC
  `).all(auctionId);

  return {
    ...auction,
    photos,
    events,
    handover_confirmations: handoverConfirmations,
  };
}

function recordAuctionEvent({
  auctionId,
  actorId = null,
  eventType,
  fromStatus = null,
  toStatus = null,
  note = null,
}) {
  db.prepare(`
    INSERT INTO auction_events (
      auction_id, actor_id, event_type, from_status, to_status, note
    )
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(auctionId, actorId, eventType, fromStatus, toStatus, note);
}

function settleExpiredAuction(auctionId) {
  const auction = db.prepare(`
    SELECT status, closes_at FROM auctions WHERE id = ?
  `).get(auctionId);

  if (
    !auction ||
    auction.status !== "active" ||
    Date.parse(auction.closes_at) > Date.now()
  ) {
    return auction?.status ?? null;
  }

  const closeResult = db.prepare(`
    UPDATE auctions
    SET status = 'closed'
    WHERE id = ? AND status = 'active'
      AND julianday(closes_at) <= julianday('now')
  `).run(auctionId);

  if (closeResult.changes === 0) {
    return db.prepare(`
      SELECT status FROM auctions WHERE id = ?
    `).get(auctionId)?.status ?? null;
  }

  recordAuctionEvent({
    auctionId,
    eventType: "auction_closed",
    fromStatus: "active",
    toStatus: "closed",
    note: "Bidding has ended.",
  });

  const leadingBid = db.prepare(`
    SELECT bidder_id, amount
    FROM bids
    WHERE auction_id = ?
    ORDER BY amount DESC, id ASC
    LIMIT 1
  `).get(auctionId);
  const status = leadingBid ? "pending_approval" : "unsold";
  const result = db.prepare(`
    UPDATE auctions
    SET status = ?, winner_id = ?, winning_amount = ?
    WHERE id = ? AND status = 'closed'
      AND julianday(closes_at) <= julianday('now')
  `).run(
    status,
    leadingBid?.bidder_id ?? null,
    leadingBid?.amount ?? null,
    auctionId
  );

  if (result.changes > 0) {
    recordAuctionEvent({
      auctionId,
      eventType: status === "unsold"
        ? "auction_unsold"
        : "provisional_winner_selected",
      fromStatus: "closed",
      toStatus: status,
      note: leadingBid
        ? `Provisional winner selected at ${leadingBid.amount}.`
        : "Auction closed without valid bids.",
    });
  }

  return status;
}

function closeExpiredAuctions(auctionId = null) {
  const settleExpired = db.transaction(() => {
    const expiredAuctions = db.prepare(`
      SELECT id
      FROM auctions
      WHERE status = 'active'
        AND julianday(closes_at) <= julianday('now')
        AND (? IS NULL OR id = ?)
    `).all(auctionId, auctionId);

    for (const auction of expiredAuctions) {
      settleExpiredAuction(auction.id);
    }
  });

  settleExpired.immediate();
}

function decideAuction({ auctionId, actorId, decision, note = null }) {
  const nextStatus = decision === "approve" ? "approved" : "rejected";
  return db.transaction(() => {
    const auction = db.prepare(`
      SELECT seller_id, status, winner_id, winning_amount
      FROM auctions
      WHERE id = ?
    `).get(auctionId);

    if (!auction) {
      return { status: 404, message: "Auction not found." };
    }

    if (auction.seller_id !== actorId) {
      return {
        status: 403,
        message: "Only the seller can decide the winning bid.",
      };
    }

    if (auction.status !== "pending_approval") {
      return {
        status: 409,
        message: "This auction is not waiting for seller approval.",
      };
    }

    if (!auction.winner_id || !Number.isSafeInteger(auction.winning_amount)) {
      return {
        status: 409,
        message: "This auction has no valid provisional winning bid.",
      };
    }

    const result = db.prepare(`
      UPDATE auctions
      SET status = ?, outcome_note = ?
      WHERE id = ? AND seller_id = ? AND status = 'pending_approval'
    `).run(nextStatus, note, auctionId, actorId);

    if (result.changes === 0) {
      return {
        status: 409,
        message: "This auction has already been decided.",
      };
    }

    recordAuctionEvent({
      auctionId,
      actorId,
      eventType: decision === "approve"
        ? "seller_approved_winning_bid"
        : "seller_rejected_winning_bid",
      fromStatus: "pending_approval",
      toStatus: nextStatus,
      note,
    });

    return {
      status: 200,
      message: decision === "approve"
        ? "Winning bid approved. The item is reserved for the winner."
        : "Winning bid rejected.",
      auction: getAuction(auctionId),
    };
  }).immediate();
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

        recordAuctionEvent({
          auctionId,
          actorId: req.user.id,
          eventType: "listing_created",
          toStatus: "active",
        });

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

  recordAuctionEvent({
    auctionId,
    actorId: req.user.id,
    eventType: "auction_cancelled",
    fromStatus: "active",
    toStatus: "cancelled",
    note: reason,
  });

  return res.json({
    message: "Auction listing cancelled.",
    auction: getAuction(auctionId),
  });
});

function handleSellerDecision(req, res, decision) {
  const auctionId = parseAuctionId(req.params.id);
  if (!auctionId) {
    return res.status(400).json({ message: "Invalid auction ID." });
  }

  const note = typeof req.body?.reason === "string"
    ? req.body.reason.trim()
    : "";
  if (decision === "reject" && (!note || note.length > 1000)) {
    return res.status(400).json({
      message: "Provide a rejection reason of 1 to 1000 characters.",
    });
  }

  try {
    const result = decideAuction({
      auctionId,
      actorId: req.user.id,
      decision,
      note: decision === "reject" ? note : null,
    });
    const { status, ...payload } = result;
    return res.status(status).json(payload);
  } catch (error) {
    console.error(`Auction ${decision} error:`, error);
    return res.status(500).json({
      message: `Unable to ${decision} this winning bid.`,
    });
  }
}

router.post("/:id/approve", authenticateToken, (req, res) =>
  handleSellerDecision(req, res, "approve")
);

router.post("/:id/reject", authenticateToken, (req, res) =>
  handleSellerDecision(req, res, "reject")
);

router.post("/:id/handover/confirm", authenticateToken, (req, res) => {
  const auctionId = parseAuctionId(req.params.id);
  if (!auctionId) {
    return res.status(400).json({ message: "Invalid auction ID." });
  }

  try {
    const result = db.transaction(() => {
      const auction = db.prepare(`
        SELECT seller_id, winner_id, status
        FROM auctions
        WHERE id = ?
      `).get(auctionId);

      if (!auction) {
        return { status: 404, message: "Auction not found." };
      }

      if (![auction.seller_id, auction.winner_id].includes(req.user.id)) {
        return {
          status: 403,
          message: "Only the seller and winning bidder can confirm handover.",
        };
      }

      if (auction.status !== "approved") {
        return {
          status: 409,
          message: "Only an approved auction can be handed over.",
        };
      }

      const confirmation = db.prepare(`
        INSERT OR IGNORE INTO handover_confirmations (auction_id, user_id)
        VALUES (?, ?)
      `).run(auctionId, req.user.id);
      if (confirmation.changes > 0) {
        const role = req.user.id === auction.seller_id ? "seller" : "winner";
        recordAuctionEvent({
          auctionId,
          actorId: req.user.id,
          eventType: `${role}_confirmed_handover`,
          note: "Campus handover confirmation recorded.",
        });
      }

      const confirmations = db.prepare(`
        SELECT user_id, confirmed_at
        FROM handover_confirmations
        WHERE auction_id = ?
      `).all(auctionId);
      const bothConfirmed =
        confirmations.some((item) => item.user_id === auction.seller_id) &&
        confirmations.some((item) => item.user_id === auction.winner_id);

      if (bothConfirmed) {
        const result = db.prepare(`
          UPDATE auctions
          SET status = 'completed',
            outcome_note = 'Campus handover confirmed by seller and winner.'
          WHERE id = ? AND status = 'approved'
        `).run(auctionId);
        if (result.changes > 0) {
          recordAuctionEvent({
            auctionId,
            actorId: req.user.id,
            eventType: "campus_handover_completed",
            fromStatus: "approved",
            toStatus: "completed",
            note: "Both seller and winning bidder confirmed campus handover.",
          });
        }
      }

      const completed = db.prepare(`
        SELECT status FROM auctions WHERE id = ?
      `).get(auctionId).status === "completed";
      return {
        status: 200,
        message: completed
          ? "Campus handover completed. Both parties have confirmed."
          : confirmation.changes > 0
            ? "Handover confirmation recorded. Waiting for the other party."
            : "Your handover confirmation was already recorded.",
        auction: getAuction(auctionId),
      };
    }).immediate();

    const { status, ...payload } = result;
    return res.status(status).json(payload);
  } catch (error) {
    console.error("Handover confirmation error:", error);
    return res.status(500).json({
      message: "Unable to record handover confirmation.",
    });
  }
});

function handleApprovedSaleOutcome(req, res, {
  nextStatus,
  eventType,
  message,
}) {
  const auctionId = parseAuctionId(req.params.id);
  if (!auctionId) {
    return res.status(400).json({ message: "Invalid auction ID." });
  }

  const reason = typeof req.body?.reason === "string"
    ? req.body.reason.trim()
    : "";
  if (!reason || reason.length > 1000) {
    return res.status(400).json({
      message: "Provide an outcome reason of 1 to 1000 characters.",
    });
  }

  try {
    const result = db.transaction(() => {
      const auction = db.prepare(`
        SELECT seller_id, winner_id, status
        FROM auctions
        WHERE id = ?
      `).get(auctionId);

      if (!auction) {
        return { status: 404, message: "Auction not found." };
      }

      if (![auction.seller_id, auction.winner_id].includes(req.user.id)) {
        return {
          status: 403,
          message: "Only the seller and winning bidder can record this outcome.",
        };
      }

      if (auction.status !== "approved") {
        return {
          status: 409,
          message: "Only an approved sale can receive this outcome.",
        };
      }

      const update = db.prepare(`
        UPDATE auctions
        SET status = ?, outcome_note = ?
        WHERE id = ? AND status = 'approved'
      `).run(nextStatus, reason, auctionId);
      if (update.changes === 0) {
        return {
          status: 409,
          message: "This sale already has a final outcome.",
        };
      }

      const role = req.user.id === auction.seller_id ? "Seller" : "Winning bidder";
      recordAuctionEvent({
        auctionId,
        actorId: req.user.id,
        eventType,
        fromStatus: "approved",
        toStatus: nextStatus,
        note: `${role}: ${reason}`,
      });

      return {
        status: 200,
        message,
        auction: getAuction(auctionId),
      };
    }).immediate();

    const { status, ...payload } = result;
    return res.status(status).json(payload);
  } catch (error) {
    console.error("Approved sale outcome error:", error);
    return res.status(500).json({
      message: "Unable to record the final sale outcome.",
    });
  }
}

router.post("/:id/failed-pickup", authenticateToken, (req, res) =>
  handleApprovedSaleOutcome(req, res, {
    nextStatus: "failed_pickup",
    eventType: "pickup_failed",
    message: "Failed pickup recorded.",
  })
);

router.post("/:id/transaction-cancel", authenticateToken, (req, res) =>
  handleApprovedSaleOutcome(req, res, {
    nextStatus: "cancelled",
    eventType: "approved_sale_cancelled",
    message: "Approved sale cancellation recorded.",
  })
);

router.post("/:id/bids", authenticateToken, (req, res) => {
  const auctionId = parseAuctionId(req.params.id);
  const rawAmount = req.body?.amount;
  const amountText = typeof rawAmount === "string" ? rawAmount.trim() : null;
  const amount = typeof rawAmount === "number"
    ? rawAmount
    : amountText && /^\d+$/.test(amountText)
      ? Number(amountText)
      : NaN;

  if (!auctionId) {
    return res.status(400).json({ message: "Invalid auction ID." });
  }

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return res.status(400).json({
      message: "Bid amount must be a positive whole number.",
    });
  }

  try {
    const result = db.transaction(() => {
      const auction = db.prepare(`
        SELECT id, seller_id, starting_price, min_increment, closes_at, status
        FROM auctions
        WHERE id = ?
      `).get(auctionId);

      if (!auction) {
        return { status: 404, message: "Auction not found." };
      }

      if (auction.seller_id === req.user.id) {
        return {
          status: 403,
          message: "You cannot bid on your own listing.",
        };
      }

      if (auction.status !== "active") {
        return {
          status: 409,
          message: "This auction is no longer accepting bids.",
        };
      }

      const leadingBid = db.prepare(`
        SELECT bidder_id, amount
        FROM bids
        WHERE auction_id = ?
        ORDER BY amount DESC, id ASC
        LIMIT 1
      `).get(auctionId);

      const closesAt = Date.parse(auction.closes_at);
      if (!Number.isFinite(closesAt)) {
        return {
          status: 409,
          message: "This auction has an invalid closing time.",
        };
      }

      if (closesAt <= Date.now()) {
        settleExpiredAuction(auctionId);
        return {
          status: 409,
          message: "This auction has closed and is no longer accepting bids.",
        };
      }

      const minimumBid = leadingBid
        ? leadingBid.amount + auction.min_increment
        : auction.starting_price;

      if (!Number.isSafeInteger(minimumBid)) {
        return {
          status: 409,
          message: "This auction cannot accept a higher safe bid amount.",
        };
      }

      if (amount < minimumBid) {
        return {
          status: 400,
          message: `Your bid must be at least ${minimumBid}.`,
          minimum_bid: minimumBid,
        };
      }

      const bidder = db.prepare(`
        SELECT name FROM users WHERE id = ?
      `).get(req.user.id);
      if (!bidder) {
        return {
          status: 401,
          message: "Your user account no longer exists.",
        };
      }

      const insertedBid = db.prepare(`
        INSERT INTO bids (auction_id, bidder_id, amount)
        VALUES (?, ?, ?)
      `).run(auctionId, req.user.id, amount);
      const bid = db.prepare(`
        SELECT id, amount, created_at
        FROM bids WHERE id = ?
      `).get(Number(insertedBid.lastInsertRowid));

      return {
        status: 201,
        bid: { ...bid, bidder_name: bidder.name },
      };
    }).immediate();

    if (result.status !== 201) {
      const { status, ...payload } = result;
      return res.status(status).json(payload);
    }

    return res.status(201).json({
      message: "Bid placed successfully.",
      bid: result.bid,
      current_price: result.bid.amount,
    });
  } catch (error) {
    console.error("Place bid error:", error);
    return res.status(500).json({
      message: "Unable to place bid at this time.",
    });
  }
});

router.get("/", (req, res) => {
  closeExpiredAuctions();
  const limit = req.query.limit === undefined ? 24 : Number(req.query.limit);
  const offset = req.query.offset === undefined ? 0 : Number(req.query.offset);
  const search = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const category = req.query.category ?? "";
  const condition = req.query.condition ?? "";
  const parsePrice = (value) => {
    if (value === undefined) {
      return null;
    }
    if (typeof value !== "string" || !/^\d+$/.test(value)) {
      return NaN;
    }
    return Number(value);
  };
  const minPrice = parsePrice(req.query.minPrice);
  const maxPrice = parsePrice(req.query.maxPrice);
  const closesSoon = req.query.closesSoon ?? "";
  const currentPriceSql = `COALESCE(
    (SELECT MAX(b.amount) FROM bids b WHERE b.auction_id = a.id),
    a.starting_price
  )`;

  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    (req.query.q !== undefined && typeof req.query.q !== "string") ||
    search.length > 100 ||
    (category && !AUCTION_CATEGORIES.includes(category)) ||
    (condition && !ITEM_CONDITIONS.includes(condition)) ||
    (minPrice !== null &&
      (!Number.isSafeInteger(minPrice) || minPrice < 0)) ||
    (maxPrice !== null &&
      (!Number.isSafeInteger(maxPrice) || maxPrice < 0)) ||
    (minPrice !== null && maxPrice !== null && minPrice > maxPrice) ||
    !["", "true", "false"].includes(closesSoon)
  ) {
    return res.status(400).json({
      message: "Invalid auction search or filter values.",
    });
  }

  const filters = ["a.status = 'active'"];
  const values = [];
  if (search) {
    const escapedSearch = search
      .toLowerCase()
      .replace(/[\\%_]/g, "\\$&");
    const pattern = `%${escapedSearch}%`;
    filters.push(`(
      LOWER(a.title) LIKE ? ESCAPE char(92) OR
      LOWER(COALESCE(a.description, '')) LIKE ? ESCAPE char(92) OR
      LOWER(a.category) LIKE ? ESCAPE char(92)
    )`);
    values.push(pattern, pattern, pattern);
  }
  if (category) {
    filters.push("a.category = ?");
    values.push(category);
  }
  if (condition) {
    filters.push("a.condition = ?");
    values.push(condition);
  }
  if (minPrice !== null) {
    filters.push(`${currentPriceSql} >= ?`);
    values.push(minPrice);
  }
  if (maxPrice !== null) {
    filters.push(`${currentPriceSql} <= ?`);
    values.push(maxPrice);
  }
  if (closesSoon === "true") {
    filters.push(`
      julianday(a.closes_at) > julianday('now') AND
      julianday(a.closes_at) <= julianday('now', '+1 day')
    `);
  }
  const whereClause = filters.join(" AND ");
  const total = db.prepare(`
    SELECT COUNT(*) AS count
    FROM auctions a
    WHERE ${whereClause}
  `).get(...values).count;

  const auctions = db.prepare(`
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
      a.created_at,
      u.name AS seller_name,
      COALESCE(
        (SELECT MAX(b.amount) FROM bids b WHERE b.auction_id = a.id),
        a.starting_price
      ) AS current_price,
      (SELECT p.url FROM photos p
        WHERE p.auction_id = a.id ORDER BY p.id LIMIT 1) AS primary_photo
    FROM auctions a
    JOIN users u ON u.id = a.seller_id
    WHERE ${whereClause}
    ORDER BY a.closes_at ASC, a.id DESC
    LIMIT ? OFFSET ?
  `).all(...values, limit, offset);

  return res.json({
    auctions,
    pagination: { limit, offset, total },
  });
});

router.get("/mine", authenticateToken, (req, res) => {
  closeExpiredAuctions();
  const auctions = db.prepare(`
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
      a.winner_id,
      a.winning_amount,
      a.outcome_note,
      a.created_at,
      seller.name AS seller_name,
      winner.name AS winner_name,
      COALESCE(
        (SELECT MAX(b.amount) FROM bids b WHERE b.auction_id = a.id),
        a.starting_price
      ) AS current_price,
      (SELECT p.url FROM photos p
        WHERE p.auction_id = a.id ORDER BY p.id LIMIT 1) AS primary_photo
    FROM auctions a
    JOIN users seller ON seller.id = a.seller_id
    LEFT JOIN users winner ON winner.id = a.winner_id
    WHERE a.seller_id = ? OR a.winner_id = ?
    ORDER BY a.created_at DESC, a.id DESC
  `).all(req.user.id, req.user.id);

  return res.json({ auctions });
});

router.get("/:id", (req, res) => {
  const auctionId = parseAuctionId(req.params.id);

  if (!auctionId) {
    return res.status(400).json({
      message: "Invalid auction ID.",
    });
  }

  closeExpiredAuctions(auctionId);
  const auction = getAuction(auctionId);

  if (!auction) {
    return res.status(404).json({
      message: "Auction not found.",
    });
  }

  const bids = db.prepare(`
    SELECT b.id, b.amount, b.created_at, u.name AS bidder_name
    FROM bids b
    JOIN users u ON u.id = b.bidder_id
    WHERE b.auction_id = ?
    ORDER BY b.created_at ASC, b.id ASC
  `).all(auctionId);
  const leadingBid = db.prepare(`
    SELECT b.id, b.amount, b.created_at, u.name AS bidder_name
    FROM bids b
    JOIN users u ON u.id = b.bidder_id
    WHERE b.auction_id = ?
    ORDER BY b.amount DESC, b.id ASC
    LIMIT 1
  `).get(auctionId) ?? null;

  return res.json({
    auction: {
      ...auction,
      bids,
      leading_bid: leadingBid,
      current_price: leadingBid?.amount ?? auction.starting_price,
    },
  });
});

export default router;
