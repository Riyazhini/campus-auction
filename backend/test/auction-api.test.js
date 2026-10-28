import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_PATH = ":memory:";
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
  const outsider = db.prepare(`
    INSERT INTO users (name, email, password_hash)
    VALUES (?, ?, ?)
  `).run("Outside user", "outside@campus.test", "unused");
  const sellerToken = jwt.sign(
    { id: Number(seller.lastInsertRowid) },
    process.env.JWT_SECRET
  );
  const otherToken = jwt.sign(
    { id: Number(otherUser.lastInsertRowid) },
    process.env.JWT_SECRET
  );
  const outsiderToken = jwt.sign(
    { id: Number(outsider.lastInsertRowid) },
    process.env.JWT_SECRET
  );
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise((resolve) => server.once("listening", resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/auctions`;
    const notificationsUrl =
      `http://127.0.0.1:${server.address().port}/api/notifications`;
    const auth = (token) => ({ authorization: `Bearer ${token}` });
    const createApprovedSale = async (title) => {
      const createResponse = await fetch(baseUrl, {
        method: "POST",
        headers: {
          ...auth(sellerToken),
          "content-type": "application/json",
        },
        body: JSON.stringify({
          title,
          category: "stationery",
          description: "",
          condition: "good",
          starting_price: 10,
          min_increment: 1,
          starts_at: new Date(Date.now() + 60 * 1000).toISOString(),
          closes_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
        }),
      });
      assert.equal(createResponse.status, 201);
      const auctionId = (await createResponse.json()).auction.id;
      db.prepare("UPDATE auctions SET starts_at = ? WHERE id = ?")
        .run(new Date(Date.now() - 1000).toISOString(), auctionId);
      db.prepare(`
        INSERT INTO bids (auction_id, bidder_id, amount)
        VALUES (?, ?, ?)
      `).run(auctionId, Number(otherUser.lastInsertRowid), 10);
      db.prepare("UPDATE auctions SET closes_at = ? WHERE id = ?")
        .run(new Date(Date.now() - 1000).toISOString(), auctionId);
      await fetch(`${baseUrl}/${auctionId}`);
      const approvalResponse = await fetch(
        `${baseUrl}/${auctionId}/approve`,
        {
          method: "POST",
          headers: {
            ...auth(sellerToken),
            "content-type": "application/json",
          },
        }
      );
      assert.equal(approvalResponse.status, 200);
      return auctionId;
    };
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
        starts_at: new Date(Date.now() + 60 * 1000).toISOString(),
        closes_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      }),
    });
    assert.equal(createResponse.status, 201);
    const { auction: created } = await createResponse.json();
    db.prepare("UPDATE auctions SET starts_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), created.id);

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

    const notificationAuctionResponse = await fetch(baseUrl, {
      method: "POST",
      headers: {
        ...auth(sellerToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "Notification test item",
        category: "books",
        description: "",
        condition: "good",
        starting_price: 10,
        min_increment: 1,
        starts_at: new Date(Date.now() + 60 * 1000).toISOString(),
        closes_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      }),
    });
    const notificationAuctionId =
      (await notificationAuctionResponse.json()).auction.id;
    db.prepare("UPDATE auctions SET starts_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), notificationAuctionId);
    const firstNotificationBid = await fetch(
      `${baseUrl}/${notificationAuctionId}/bids`,
      {
        method: "POST",
        headers: {
          ...auth(otherToken),
          "content-type": "application/json",
        },
        body: JSON.stringify({ amount: 10 }),
      }
    );
    assert.equal(firstNotificationBid.status, 201);
    const secondNotificationBid = await fetch(
      `${baseUrl}/${notificationAuctionId}/bids`,
      {
        method: "POST",
        headers: {
          ...auth(outsiderToken),
          "content-type": "application/json",
        },
        body: JSON.stringify({ amount: 11 }),
      }
    );
    assert.equal(secondNotificationBid.status, 201);
    const outbidNotificationsResponse = await fetch(notificationsUrl, {
      headers: auth(otherToken),
    });
    assert.equal(outbidNotificationsResponse.status, 200);
    const outbidNotifications = await outbidNotificationsResponse.json();
    assert.equal(outbidNotifications.unread_count, 1);
    assert.equal(outbidNotifications.notifications.length, 1);
    const [outbidNotification] = outbidNotifications.notifications;
    assert.equal(outbidNotification.type, "outbid");
    assert.equal(outbidNotification.auction_id, notificationAuctionId);
    assert.equal(outbidNotification.is_read, 0);
    assert.match(outbidNotification.message, /Notification test item/);
    const unrelatedNotificationsResponse = await fetch(notificationsUrl, {
      headers: auth(outsiderToken),
    });
    const unrelatedNotifications = await unrelatedNotificationsResponse.json();
    assert.equal(unrelatedNotifications.unread_count, 0);
    assert.equal(unrelatedNotifications.notifications.length, 0);
    const forbiddenNotificationRead = await fetch(
      `${notificationsUrl}/${outbidNotification.id}`,
      {
        method: "PATCH",
        headers: {
          ...auth(outsiderToken),
          "content-type": "application/json",
        },
        body: JSON.stringify({ is_read: true }),
      }
    );
    assert.equal(forbiddenNotificationRead.status, 404);
    const markNotificationRead = await fetch(
      `${notificationsUrl}/${outbidNotification.id}`,
      {
        method: "PATCH",
        headers: {
          ...auth(otherToken),
          "content-type": "application/json",
        },
        body: JSON.stringify({ is_read: true }),
      }
    );
    assert.equal(markNotificationRead.status, 200);
    assert.equal((await markNotificationRead.json()).unread_count, 0);
    const markNotificationUnread = await fetch(
      `${notificationsUrl}/${outbidNotification.id}`,
      {
        method: "PATCH",
        headers: {
          ...auth(otherToken),
          "content-type": "application/json",
        },
        body: JSON.stringify({ is_read: false }),
      }
    );
    assert.equal(markNotificationUnread.status, 200);
    assert.equal((await markNotificationUnread.json()).unread_count, 1);
    const cleanupNotificationAuction = await fetch(
      `${baseUrl}/${notificationAuctionId}/cancel`,
      {
        method: "POST",
        headers: {
          ...auth(sellerToken),
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: "Notification test complete." }),
      }
    );
    assert.equal(cleanupNotificationAuction.status, 200);

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
        starts_at: new Date(Date.now() + 60 * 1000).toISOString(),
        closes_at: new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString(),
      }),
    });
    assert.equal(textbookResponse.status, 201);
    const textbookId = (await textbookResponse.json()).auction.id;
    db.prepare("UPDATE auctions SET starts_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), textbookId);

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
    const editAfterBidsResponse = await fetch(`${baseUrl}/${created.id}`, {
      method: "PATCH",
      headers: {
        ...auth(sellerToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({ description: "Updated with full detail response" }),
    });
    assert.equal(editAfterBidsResponse.status, 200);
    const editedAfterBids =
      (await editAfterBidsResponse.json()).auction;
    assert.equal(editedAfterBids.description, "Updated with full detail response");
    assert.equal(editedAfterBids.bids.length, 2);
    assert.equal(editedAfterBids.leading_bid.amount, 170);
    assert.equal(editedAfterBids.current_price, 170);
    assert.deepEqual(editedAfterBids.handover_confirmations, []);

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
        starts_at: new Date(Date.now() + 60 * 1000).toISOString(),
        closes_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      }),
    });
    const pendingAuctionId =
      (await pendingApprovalCreate.json()).auction.id;
    db.prepare("UPDATE auctions SET starts_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), pendingAuctionId);
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
    const sellerCloseNotifications = (
      await (await fetch(notificationsUrl, { headers: auth(sellerToken) })).json()
    ).notifications.filter((notification) =>
      notification.auction_id === pendingAuctionId
    );
    const winnerCloseNotifications = (
      await (await fetch(notificationsUrl, { headers: auth(otherToken) })).json()
    ).notifications.filter((notification) =>
      notification.auction_id === pendingAuctionId
    );
    const outsiderCloseNotifications = (
      await (await fetch(notificationsUrl, { headers: auth(outsiderToken) })).json()
    ).notifications.filter((notification) =>
      notification.auction_id === pendingAuctionId
    );
    assert.deepEqual(
      sellerCloseNotifications.map((notification) => notification.type),
      ["auction_closed"]
    );
    assert.deepEqual(
      winnerCloseNotifications.map((notification) => notification.type),
      ["provisional_winner"]
    );
    assert.deepEqual(outsiderCloseNotifications, []);

    const forbiddenApproval = await fetch(
      `${baseUrl}/${pendingAuctionId}/approve`,
      {
        method: "POST",
        headers: {
          ...auth(otherToken),
          "content-type": "application/json",
        },
      }
    );
    assert.equal(forbiddenApproval.status, 403);
    const approvedResponse = await fetch(
      `${baseUrl}/${pendingAuctionId}/approve`,
      {
        method: "POST",
        headers: {
          ...auth(sellerToken),
          "content-type": "application/json",
        },
      }
    );
    assert.equal(approvedResponse.status, 200);
    const { auction: approvedAuction } = await approvedResponse.json();
    assert.equal(approvedAuction.status, "approved");
    assert.equal(approvedAuction.winner_id, Number(otherUser.lastInsertRowid));
    assert.equal(approvedAuction.winning_amount, 20);
    assert.equal(approvedAuction.events.at(-1).to_status, "approved");
    const approvalNotifications = (
      await (await fetch(notificationsUrl, { headers: auth(otherToken) })).json()
    ).notifications.filter((notification) =>
      notification.auction_id === pendingAuctionId
    );
    assert.deepEqual(
      approvalNotifications.map((notification) => notification.type),
      ["winning_bid_approved", "provisional_winner"]
    );
    const sellerHandoverConfirmation = await fetch(
      `${baseUrl}/${pendingAuctionId}/handover/confirm`,
      {
        method: "POST",
        headers: {
          ...auth(sellerToken),
          "content-type": "application/json",
        },
      }
    );
    assert.equal(sellerHandoverConfirmation.status, 200);
    const sellerConfirmationResult =
      await sellerHandoverConfirmation.json();
    assert.equal(
      sellerConfirmationResult.auction.status,
      "approved"
    );
    assert.equal(
      sellerConfirmationResult.auction.handover_confirmations.length,
      1
    );
    assert.match(
      sellerConfirmationResult.message,
      /Waiting for the other party/
    );
    const repeatedSellerConfirmation = await fetch(
      `${baseUrl}/${pendingAuctionId}/handover/confirm`,
      {
        method: "POST",
        headers: {
          ...auth(sellerToken),
          "content-type": "application/json",
        },
      }
    );
    assert.equal(repeatedSellerConfirmation.status, 200);
    assert.equal(
      (await repeatedSellerConfirmation.json()).auction.events.filter(
        (event) => event.event_type === "seller_confirmed_handover"
      ).length,
      1
    );
    const unauthorizedConfirmation = await fetch(
      `${baseUrl}/${pendingAuctionId}/handover/confirm`,
      {
        method: "POST",
        headers: {
          ...auth(outsiderToken),
          "content-type": "application/json",
        },
      }
    );
    assert.equal(unauthorizedConfirmation.status, 403);
    const winnerHandoverConfirmation = await fetch(
      `${baseUrl}/${pendingAuctionId}/handover/confirm`,
      {
        method: "POST",
        headers: {
          ...auth(otherToken),
          "content-type": "application/json",
        },
      }
    );
    assert.equal(winnerHandoverConfirmation.status, 200);
    const completedAuction =
      (await winnerHandoverConfirmation.json()).auction;
    assert.equal(completedAuction.status, "completed");
    assert.equal(
      completedAuction.outcome_note,
      "Campus handover confirmed by seller and winner."
    );
    assert.equal(completedAuction.handover_confirmations.length, 2);
    assert.equal(
      completedAuction.events.at(-1).event_type,
      "campus_handover_completed"
    );
    assert.equal(completedAuction.events.at(-1).from_status, "approved");
    assert.equal(completedAuction.events.at(-1).to_status, "completed");
    for (const token of [sellerToken, otherToken]) {
      const participantNotifications = (
        await (await fetch(notificationsUrl, { headers: auth(token) })).json()
      ).notifications.filter((notification) =>
        notification.auction_id === pendingAuctionId
      );
      assert.equal(
        participantNotifications.filter(
          (notification) => notification.type === "handover_completed"
        ).length,
        1
      );
    }
    const latePickupReport = await fetch(
      `${baseUrl}/${pendingAuctionId}/failed-pickup`,
      {
        method: "POST",
        headers: {
          ...auth(otherToken),
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: "The pickup did not happen." }),
      }
    );
    assert.equal(latePickupReport.status, 409);

    const duplicateApproval = await fetch(
      `${baseUrl}/${pendingAuctionId}/approve`,
      {
        method: "POST",
        headers: {
          ...auth(sellerToken),
          "content-type": "application/json",
        },
      }
    );
    assert.equal(duplicateApproval.status, 409);

    const rejectListingResponse = await fetch(baseUrl, {
      method: "POST",
      headers: {
        ...auth(sellerToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "Desk organizer",
        category: "stationery",
        description: "",
        condition: "good",
        starting_price: 15,
        min_increment: 2,
        starts_at: new Date(Date.now() + 60 * 1000).toISOString(),
        closes_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      }),
    });
    const rejectAuctionId =
      (await rejectListingResponse.json()).auction.id;
    db.prepare("UPDATE auctions SET starts_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), rejectAuctionId);
    db.prepare(`
      INSERT INTO bids (auction_id, bidder_id, amount)
      VALUES (?, ?, ?)
    `).run(rejectAuctionId, Number(otherUser.lastInsertRowid), 15);
    db.prepare("UPDATE auctions SET closes_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), rejectAuctionId);
    await fetch(`${baseUrl}/${rejectAuctionId}`);
    const missingRejectReason = await fetch(
      `${baseUrl}/${rejectAuctionId}/reject`,
      {
        method: "POST",
        headers: {
          ...auth(sellerToken),
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: " " }),
      }
    );
    assert.equal(missingRejectReason.status, 400);
    const rejectedResponse = await fetch(
      `${baseUrl}/${rejectAuctionId}/reject`,
      {
        method: "POST",
        headers: {
          ...auth(sellerToken),
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: "The item cannot be handed over." }),
      }
    );
    assert.equal(rejectedResponse.status, 200);
    const { auction: rejectedAuction } = await rejectedResponse.json();
    assert.equal(rejectedAuction.status, "rejected");
    assert.equal(
      rejectedAuction.outcome_note,
      "The item cannot be handed over."
    );
    assert.equal(rejectedAuction.events.at(-1).event_type, "seller_rejected_winning_bid");
    assert.equal(rejectedAuction.events.at(-1).note, "The item cannot be handed over.");
    const rejectionNotifications = (
      await (await fetch(notificationsUrl, { headers: auth(otherToken) })).json()
    ).notifications.filter((notification) =>
      notification.auction_id === rejectAuctionId
    );
    assert.deepEqual(
      rejectionNotifications.map((notification) => notification.type),
      ["winning_bid_rejected", "provisional_winner"]
    );

    const failedPickupAuctionId =
      await createApprovedSale("Failed pickup calculator");
    const missingPickupReason = await fetch(
      `${baseUrl}/${failedPickupAuctionId}/failed-pickup`,
      {
        method: "POST",
        headers: {
          ...auth(otherToken),
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: " " }),
      }
    );
    assert.equal(missingPickupReason.status, 400);
    const outsiderPickupReport = await fetch(
      `${baseUrl}/${failedPickupAuctionId}/failed-pickup`,
      {
        method: "POST",
        headers: {
          ...auth(outsiderToken),
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: "Pickup failed." }),
      }
    );
    assert.equal(outsiderPickupReport.status, 403);
    const failedPickupResponse = await fetch(
      `${baseUrl}/${failedPickupAuctionId}/failed-pickup`,
      {
        method: "POST",
        headers: {
          ...auth(otherToken),
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: "The winner could not attend." }),
      }
    );
    assert.equal(failedPickupResponse.status, 200);
    const failedPickup = (await failedPickupResponse.json()).auction;
    assert.equal(failedPickup.status, "failed_pickup");
    assert.equal(
      failedPickup.outcome_note,
      "The winner could not attend."
    );
    assert.equal(failedPickup.events.at(-1).event_type, "pickup_failed");
    assert.equal(
      failedPickup.events.at(-1).note,
      "Winning bidder: The winner could not attend."
    );
    for (const [token, expectedTypes] of [
      [sellerToken, ["auction_closed", "pickup_failed"]],
      [otherToken, [
        "pickup_failed",
        "provisional_winner",
        "winning_bid_approved",
      ]],
    ]) {
      const participantNotifications = (
        await (await fetch(notificationsUrl, { headers: auth(token) })).json()
      ).notifications.filter((notification) =>
        notification.auction_id === failedPickupAuctionId
      );
      assert.deepEqual(
        participantNotifications
          .map((notification) => notification.type)
          .sort(),
        expectedTypes.sort()
      );
    }
    const outsiderFailedPickupNotifications = (
      await (await fetch(notificationsUrl, { headers: auth(outsiderToken) })).json()
    ).notifications.filter((notification) =>
      notification.auction_id === failedPickupAuctionId
    );
    assert.deepEqual(outsiderFailedPickupNotifications, []);
    const duplicatePickupReport = await fetch(
      `${baseUrl}/${failedPickupAuctionId}/failed-pickup`,
      {
        method: "POST",
        headers: {
          ...auth(sellerToken),
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: "The seller could not attend." }),
      }
    );
    assert.equal(duplicatePickupReport.status, 409);

    const cancelledSaleId = await createApprovedSale("Cancelled campus sale");
    const cancelledSaleResponse = await fetch(
      `${baseUrl}/${cancelledSaleId}/transaction-cancel`,
      {
        method: "POST",
        headers: {
          ...auth(sellerToken),
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: "Both parties agreed to cancel." }),
      }
    );
    assert.equal(cancelledSaleResponse.status, 200);
    const cancelledSale = (await cancelledSaleResponse.json()).auction;
    assert.equal(cancelledSale.status, "cancelled");
    assert.equal(
      cancelledSale.outcome_note,
      "Both parties agreed to cancel."
    );
    assert.equal(
      cancelledSale.events.at(-1).event_type,
      "approved_sale_cancelled"
    );

    const myAuctionsResponse = await fetch(`${baseUrl}/mine`, {
      headers: auth(otherToken),
    });
    assert.equal(myAuctionsResponse.status, 200);
    const myAuctions = await myAuctionsResponse.json();
    assert.deepEqual(
      myAuctions.auctions.map((item) => item.id).sort((a, b) => a - b),
      [
        pendingAuctionId,
        rejectAuctionId,
        failedPickupAuctionId,
        cancelledSaleId,
      ].sort((a, b) => a - b)
    );

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
        starts_at: new Date(Date.now() + 60 * 1000).toISOString(),
        closes_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      }),
    });
    const noBidAuctionId =
      (await noBidCreateResponse.json()).auction.id;
    db.prepare("UPDATE auctions SET starts_at = ? WHERE id = ?")
      .run(new Date(Date.now() - 1000).toISOString(), noBidAuctionId);
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

    const scheduledStart = new Date(Date.now() + 60 * 60 * 1000);
    const scheduledClose = new Date(Date.now() + 4 * 60 * 60 * 1000);
    const scheduledPayload = {
      title: "Scheduled campus lamp",
      category: "electronics",
      description: "",
      condition: "good",
      starting_price: 40,
      min_increment: 5,
      starts_at: scheduledStart.toISOString(),
      closes_at: scheduledClose.toISOString(),
    };
    const { starts_at: omittedStart, ...listingWithoutStart } =
      scheduledPayload;
    assert.ok(omittedStart);
    const missingStartResponse = await fetch(baseUrl, {
      method: "POST",
      headers: {
        ...auth(sellerToken),
        "content-type": "application/json",
      },
      body: JSON.stringify(listingWithoutStart),
    });
    assert.equal(missingStartResponse.status, 400);
    assert.ok((await missingStartResponse.json()).errors.starts_at);

    const invalidStartResponse = await fetch(baseUrl, {
      method: "POST",
      headers: {
        ...auth(sellerToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...scheduledPayload,
        starts_at: new Date(Date.now() - 1000).toISOString(),
      }),
    });
    assert.equal(invalidStartResponse.status, 400);
    assert.ok(
      (await invalidStartResponse.json()).errors.starts_at
    );

    const invalidCloseResponse = await fetch(baseUrl, {
      method: "POST",
      headers: {
        ...auth(sellerToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...scheduledPayload,
        closes_at: new Date(scheduledStart.getTime() - 1000).toISOString(),
      }),
    });
    assert.equal(invalidCloseResponse.status, 400);
    assert.match(
      (await invalidCloseResponse.json()).errors.closes_at,
      /after the auction start/
    );
    const shortClosingWindow = await fetch(baseUrl, {
      method: "POST",
      headers: {
        ...auth(sellerToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...scheduledPayload,
        starts_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        closes_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      }),
    });
    assert.equal(shortClosingWindow.status, 400);
    assert.match(
      (await shortClosingWindow.json()).errors.closes_at,
      /at least 1 hour/
    );

    const scheduledResponse = await fetch(baseUrl, {
      method: "POST",
      headers: {
        ...auth(sellerToken),
        "content-type": "application/json",
      },
      body: JSON.stringify(scheduledPayload),
    });
    assert.equal(scheduledResponse.status, 201);
    const scheduledAuction = (await scheduledResponse.json()).auction;
    const scheduledId = scheduledAuction.id;
    assert.equal(scheduledAuction.starts_at, scheduledStart.toISOString());

    const hiddenBrowse = await fetch(baseUrl);
    const hiddenListings = (await hiddenBrowse.json()).auctions;
    assert.equal(
      hiddenListings.some((item) => item.id === scheduledId),
      false
    );
    assert.equal(
      db.prepare("SELECT status FROM auctions WHERE id = ?")
        .get(scheduledId).status,
      "active"
    );
    assert.equal((await fetch(`${baseUrl}/${scheduledId}`)).status, 404);
    const sellerDetail = await fetch(`${baseUrl}/${scheduledId}`, {
      headers: auth(sellerToken),
    });
    assert.equal(sellerDetail.status, 200);
    const mineResponse = await fetch(`${baseUrl}/mine`, {
      headers: auth(sellerToken),
    });
    assert.ok(
      (await mineResponse.json()).auctions.some((item) => item.id === scheduledId)
    );

    const preStartBid = await fetch(`${baseUrl}/${scheduledId}/bids`, {
      method: "POST",
      headers: {
        ...auth(otherToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({ amount: 40 }),
    });
    assert.equal(preStartBid.status, 409);
    assert.match((await preStartBid.json()).message, /not started yet/);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM bids WHERE auction_id = ?")
        .get(scheduledId).count,
      0
    );

    const editedStart = new Date(Date.now() + 90 * 60 * 1000).toISOString();
    const scheduledEdit = await fetch(`${baseUrl}/${scheduledId}`, {
      method: "PATCH",
      headers: {
        ...auth(sellerToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({ starts_at: editedStart }),
    });
    assert.equal(scheduledEdit.status, 200);
    assert.equal(
      (await scheduledEdit.json()).auction.starts_at,
      editedStart
    );

    db.prepare("UPDATE auctions SET starts_at = ? WHERE id = ?")
      .run(new Date().toISOString(), scheduledId);
    const boundaryBrowse = await fetch(baseUrl);
    assert.ok(
      (await boundaryBrowse.json()).auctions.some((item) => item.id === scheduledId)
    );
    const boundaryDetail = await fetch(`${baseUrl}/${scheduledId}`);
    assert.equal(boundaryDetail.status, 200);
    const boundaryBid = await fetch(`${baseUrl}/${scheduledId}/bids`, {
      method: "POST",
      headers: {
        ...auth(otherToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({ amount: 40 }),
    });
    assert.equal(boundaryBid.status, 201);
    const lockedStartEdit = await fetch(`${baseUrl}/${scheduledId}`, {
      method: "PATCH",
      headers: {
        ...auth(sellerToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        starts_at: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
      }),
    });
    assert.equal(lockedStartEdit.status, 409);

    const unstartedListingResponse = await fetch(baseUrl, {
      method: "POST",
      headers: {
        ...auth(sellerToken),
        "content-type": "application/json",
      },
      body: JSON.stringify({
        ...scheduledPayload,
        title: "Unstarted cancellable listing",
        starts_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        closes_at: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(),
      }),
    });
    const unstartedId =
      (await unstartedListingResponse.json()).auction.id;
    const unstartedCancellation = await fetch(
      `${baseUrl}/${unstartedId}/cancel`,
      {
        method: "POST",
        headers: {
          ...auth(sellerToken),
          "content-type": "application/json",
        },
        body: JSON.stringify({ reason: "I no longer have this item." }),
      }
    );
    assert.equal(unstartedCancellation.status, 200);
    assert.equal(
      (await unstartedCancellation.json()).auction.status,
      "cancelled"
    );
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
    db.close();
  }
});
