import db from "../db/index.js";

export function createNotification(userId, auctionId, type, message) {
  db.prepare(`
    INSERT INTO notifications (user_id, auction_id, type, message)
    VALUES (?, ?, ?, ?)
  `).run(userId, auctionId, type, message);
}

export function notifyUsers(userIds, auctionId, type, message) {
  for (const userId of new Set(userIds.filter(Number.isSafeInteger))) {
    createNotification(userId, auctionId, type, message);
  }
}
