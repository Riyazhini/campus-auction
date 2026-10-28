import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { test } from "node:test";
import { migrateDatabase } from "../src/db/migrations.js";

test("adds a default start time to existing auctions safely and idempotently", () => {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE auctions (
      id INTEGER PRIMARY KEY,
      title TEXT NOT NULL
    );
    INSERT INTO auctions (title) VALUES ('Existing listing');
  `);

  migrateDatabase(db);
  migrateDatabase(db);

  const migrated = db.prepare(`
    SELECT starts_at FROM auctions WHERE id = 1
  `).get();
  assert.equal(migrated.starts_at, "1970-01-01T00:00:00.000Z");
  assert.equal(
    db.prepare("PRAGMA table_info(auctions)").all()
      .filter((column) => column.name === "starts_at").length,
    1
  );
  db.close();
});
