export function migrateDatabase(db) {
  const auctionColumns = db.prepare("PRAGMA table_info(auctions)").all();
  if (!auctionColumns.some((column) => column.name === "starts_at")) {
    db.exec(`
      ALTER TABLE auctions
      ADD COLUMN starts_at TEXT NOT NULL
        DEFAULT '1970-01-01T00:00:00.000Z'
    `);
  }
}
