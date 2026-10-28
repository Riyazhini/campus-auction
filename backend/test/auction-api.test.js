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

test("auction APIs enforce management, browsing, and bid rules", async () => {
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
    `).run(created.id, Number(otherUser.lastInsertRowid), 150);

    const listResponse = await fetch(baseUrl);
    assert.equal(listResponse.status, 200);
    const { auctions } = await listResponse.json();
    assert.equal(auctions.length, 1);
    assert.equal(auctions[0].current_price, 150);

    const detailResponse = await fetch(`${baseUrl}/${created.id}`);
    assert.equal(detailResponse.status, 200);
    const { auction: detail } = await detailResponse.json();
    assert.equal(detail.current_price, 150);
    assert.equal(detail.leading_bid.bidder_name, "Other user");
    assert.equal(detail.bids.length, 1);
    assert.equal("email" in detail.bids[0], false);

    const textbookResponse = await fetch(baseUrl, {
      method: "POST",
      headers: {
        ...auth(sellerToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "Biology field guide",
        category: "books",
        description: "Compact field guide for class",
        condition: "fair",
        starting_price: 50,
        min_increment: 5,
        closes_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      }),
    });
    assert.equal(textbookResponse.status, 201);

    const filteredResponse = await fetch(
      `${baseUrl}?q=biology&category=books&condition=fair&minPrice=40&maxPrice=60&closesSoon=true`
    );
    assert.equal(filteredResponse.status, 200);
    const filtered = await filteredResponse.json();
    assert.equal(filtered.pagination.total, 1);
    assert.equal(filtered.auctions[0].title, "Biology field guide");

    const currentPriceResponse = await fetch(
      `${baseUrl}?minPrice=140&maxPrice=160`
    );
    const currentPriceResult = await currentPriceResponse.json();
    assert.deepEqual(
      currentPriceResult.auctions.map((item) => item.title),
      ["Scientific calculator"]
    );

    const invalidFilterResponse = await fetch(`${baseUrl}?minPrice=not-a-price`);
    assert.equal(invalidFilterResponse.status, 400);

    const selfBidResponse = await fetch(`${baseUrl}/${created.id}/bids`, {
      method: "POST",
      headers: {
        ...auth(sellerToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({ amount: 160 }),
    });
    assert.equal(selfBidResponse.status, 403);

    const lowBidResponse = await fetch(`${baseUrl}/${created.id}/bids`, {
      method: "POST",
      headers: {
        ...auth(otherToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({ amount: 159 }),
    });
    assert.equal(lowBidResponse.status, 400);
    assert.equal((await lowBidResponse.json()).minimum_bid, 160);

    const simultaneousBids = await Promise.all([170, 170].map((amount) =>
      fetch(`${baseUrl}/${created.id}/bids`, {
        method: "POST",
        headers: {
          ...auth(otherToken),
          "content-type": "application/json",
        },
        body: JSON.stringify({ amount }),
      })
    ));
    assert.deepEqual(
      simultaneousBids.map((result) => result.status).sort(),
      [201, 400]
    );
    const afterBidsResponse = await fetch(`${baseUrl}/${created.id}`);
    const { auction: afterBids } = await afterBidsResponse.json();
    assert.equal(afterBids.current_price, 170);
    assert.equal(afterBids.bids.length, 2);

    const textbookId = (await textbookResponse.json()).auction.id;
    db.prepare("UPDATE auctions SET closes_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), textbookId);
    const lateBidResponse = await fetch(`${baseUrl}/${textbookId}/bids`, {
      method: "POST",
      headers: {
        ...auth(otherToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({ amount: 50 }),
    });
    assert.equal(lateBidResponse.status, 409);
    assert.equal(
      db.prepare("SELECT status FROM auctions WHERE id = ?")
        .get(textbookId).status,
      "unsold"
    );

    const pendingApprovalCreate = await fetch(baseUrl, {
      method: "POST",
      headers: {
        ...auth(sellerToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "Desk lamp",
        category: "hostel_items",
        description: "",
        condition: "good",
        starting_price: 20,
        min_increment: 5,
        closes_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      }),
    });
    const pendingAuctionId =
      (await pendingApprovalCreate.json()).auction.id;
    db.prepare(`
      INSERT INTO bids (auction_id, bidder_id, amount)
      VALUES (?, ?, ?)
    `).run(pendingAuctionId, Number(otherUser.lastInsertRowid), 20);
    db.prepare("UPDATE auctions SET closes_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), pendingAuctionId);
    const expiredWithBidResponse = await fetch(
      `${baseUrl}/${pendingAuctionId}/bids`,
      {
        method: "POST",
        headers: {
          ...auth(otherToken),
          "content-type": "application/json",
        },
        body: JSON.stringify({ amount: 25 }),
      }
    );
    assert.equal(expiredWithBidResponse.status, 409);
    const pendingAuction = db.prepare(`
      SELECT status, winner_id, winning_amount
      FROM auctions WHERE id = ?
    `).get(pendingAuctionId);
    assert.equal(pendingAuction.status, "pending_approval");
    assert.equal(pendingAuction.winner_id, Number(otherUser.lastInsertRowid));
    assert.equal(pendingAuction.winning_amount, 20);
    const pendingDetailResponse = await fetch(
      `${baseUrl}/${pendingAuctionId}`
    );
    const pendingDetail = (await pendingDetailResponse.json()).auction;
    assert.equal(pendingDetail.winner_name, "Other user");
    assert.equal(
      pendingDetail.events.at(-2).event_type,
      "auction_closed"
    );
    assert.equal(
      pendingDetail.events.at(-1).event_type,
      "provisional_winner_selected"
    );
    assert.equal(pendingDetail.events.at(-2).to_status, "closed");
    assert.equal(pendingDetail.events.at(-1).to_status, "pending_approval");

    const noBidCreateResponse = await fetch(baseUrl, {
      method: "POST",
      headers: {
        ...auth(sellerToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "Unused notebook",
        category: "books",
        description: "",
        condition: "new",
        starting_price: 10,
        min_increment: 1,
        closes_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      }),
    });
    const noBidAuctionId =
      (await noBidCreateResponse.json()).auction.id;
    db.prepare("UPDATE auctions SET closes_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), noBidAuctionId);
    const readToCloseResponse = await fetch(`${baseUrl}/${noBidAuctionId}`);
    const readToCloseAuction = (await readToCloseResponse.json()).auction;
    assert.equal(readToCloseAuction.status, "unsold");
    assert.equal(readToCloseAuction.winner_id, null);
    assert.equal(readToCloseAuction.winning_amount, null);
    assert.equal(readToCloseAuction.events.at(-1).event_type, "auction_unsold");
    assert.equal(readToCloseAuction.events.at(-1).from_status, "closed");

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
    assert.equal(cancelled.events.at(-1).event_type, "auction_cancelled");

    const remainingResponse = await fetch(baseUrl);
    const remaining = await remainingResponse.json();
    assert.deepEqual(remaining.auctions, []);
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
