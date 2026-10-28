import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const databasePath = path.join(
  os.tmpdir(),
  `campus-auction-${randomUUID()}.db`
);

process.env.DATABASE_PATH = databasePath;
process.env.JWT_SECRET = "test-only-secret";

const [{ app }, { default: db }, { default: jwt }] = await Promise.all([
  import("../server.js"),
  import("../src/db/index.js"),
  import("jsonwebtoken"),
]);

test("sellers can edit and cancel listings under the documented rules", async () => {
  const seller = db.prepare(`
    INSERT INTO users (name, email, password_hash)
    VALUES (?, ?, ?)
  `).run("Seller", "seller@campus.test", "unused");
  const otherUser = db.prepare(`
    INSERT INTO users (name, email, password_hash)
    VALUES (?, ?, ?)
  `).run("Other user", "other@campus.test", "unused");
  const sellerToken = jwt.sign(
    { id: Number(seller.lastInsertRowid) },
    process.env.JWT_SECRET
  );
  const otherToken = jwt.sign(
    { id: Number(otherUser.lastInsertRowid) },
    process.env.JWT_SECRET
  );
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/auctions`;
    const auth = (token) => ({ authorization: `Bearer ${token}` });
    const createResponse = await fetch(baseUrl, {
      method: "POST",
      headers: {
        ...auth(sellerToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "Used calculator",
        category: "calculator",
        description: "Works well",
        condition: "good",
        starting_price: 100,
        min_increment: 10,
        closes_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      }),
    });
    assert.equal(createResponse.status, 201);
    const { auction: created } = await createResponse.json();

    const editResponse = await fetch(`${baseUrl}/${created.id}`, {
      method: "PATCH",
      headers: {
        ...auth(sellerToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "Scientific calculator" }),
    });
    assert.equal(editResponse.status, 200);
    assert.equal(
      (await editResponse.json()).auction.title,
      "Scientific calculator"
    );

    db.prepare("UPDATE auctions SET closes_at = ? WHERE id = ?")
      .run(
        new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        created.id
      );
    const nearCloseEdit = await fetch(`${baseUrl}/${created.id}`, {
      method: "PATCH",
      headers: {
        ...auth(sellerToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({ description: "Updated before closing" }),
    });
    assert.equal(nearCloseEdit.status, 200);

    db.prepare(`
      INSERT INTO bids (auction_id, bidder_id, amount)
      VALUES (?, ?, ?)
    `).run(created.id, Number(otherUser.lastInsertRowid), 100);

    const lockedEditResponse = await fetch(`${baseUrl}/${created.id}`, {
      method: "PATCH",
      headers: {
        ...auth(sellerToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({ starting_price: 110 }),
    });
    assert.equal(lockedEditResponse.status, 409);

    const nonOwnerResponse = await fetch(`${baseUrl}/${created.id}`, {
      method: "PATCH",
      headers: {
        ...auth(otherToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "Not your listing" }),
    });
    assert.equal(nonOwnerResponse.status, 403);

    const cancelResponse = await fetch(
      `${baseUrl}/${created.id}/cancel`,
      {
        method: "POST",
        headers: {
          ...auth(sellerToken),
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: "Item is no longer available." }),
      }
    );
    assert.equal(cancelResponse.status, 200);
    const { auction: cancelled } = await cancelResponse.json();
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.outcome_note, "Item is no longer available.");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    db.close();
    for (const suffix of ["", "-shm", "-wal"]) {
      fs.rmSync(`${databasePath}${suffix}`, { force: true });
    }
  }
});
