import { Router } from "express";
import db from "../db/index.js";
import { authenticateToken } from "../middleware/auth.js";

const router = Router();

router.get("/", authenticateToken, (req, res) => {
  const notifications = db.prepare(`
    SELECT
      n.id,
      n.auction_id,
      n.type,
      n.message,
      n.is_read,
      n.created_at,
      a.title AS auction_title
    FROM notifications n
    LEFT JOIN auctions a ON a.id = n.auction_id
    WHERE n.user_id = ?
    ORDER BY n.created_at DESC, n.id DESC
    LIMIT 50
  `).all(req.user.id);
  const unreadCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM notifications
    WHERE user_id = ? AND is_read = 0
  `).get(req.user.id).count;

  return res.json({ notifications, unread_count: unreadCount });
});

router.patch("/:id", authenticateToken, (req, res) => {
  const notificationId = Number(req.params.id);
  const isRead = req.body?.is_read;
  if (
    !Number.isSafeInteger(notificationId) ||
    notificationId < 1 ||
    typeof isRead !== "boolean"
  ) {
    return res.status(400).json({
      message: "Provide a valid notification ID and read status.",
    });
  }

  const result = db.prepare(`
    UPDATE notifications
    SET is_read = ?
    WHERE id = ? AND user_id = ?
  `).run(isRead ? 1 : 0, notificationId, req.user.id);
  if (result.changes === 0) {
    return res.status(404).json({ message: "Notification not found." });
  }

  const unreadCount = db.prepare(`
    SELECT COUNT(*) AS count
    FROM notifications
    WHERE user_id = ? AND is_read = 0
  `).get(req.user.id).count;

  return res.json({ message: "Notification updated.", unread_count: unreadCount });
});

export default router;
