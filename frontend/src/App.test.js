import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import AuctionForm from "./AuctionForm";

const auction = {
  id: 1,
  seller_id: 7,
  title: "Graphing calculator",
  category: "calculator",
  description: "Works well and includes its case.",
  condition: "good",
  starting_price: 400,
  min_increment: 25,
  current_price: 450,
  starts_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
  closes_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  status: "active",
  winner_id: 8,
  winner_name: "Sam",
  winning_amount: 450,
  handover_confirmations: [],
  created_at: new Date().toISOString(),
  seller_name: "Riya",
  primary_photo: "/uploads/test-photo.jpg",
  photos: [],
  leading_bid: {
    id: 2,
    amount: 450,
    bidder_name: "Sam",
    created_at: new Date().toISOString(),
  },
  bids: [{
    id: 2,
    amount: 450,
    bidder_name: "Sam",
    created_at: new Date().toISOString(),
  }],
};

function response(payload) {
  return {
    ok: true,
    text: async () => JSON.stringify(payload),
  };
}

let fetchMock;
let currentAuction;
let currentAuctions;
let currentNotifications;

beforeEach(() => {
  window.localStorage.clear();
  currentAuction = auction;
  currentAuctions = [auction];
  currentNotifications = [];
  fetchMock = jest.fn(async (url, options = {}) => {
    const path = new URL(url).pathname;
    if (/\/notifications\/\d+$/.test(path) && options.method === "PATCH") {
      const notificationId = Number(path.split("/").pop());
      const { is_read: isRead } = JSON.parse(options.body);
      currentNotifications = currentNotifications.map((notification) =>
        notification.id === notificationId
          ? { ...notification, is_read: Number(isRead) }
          : notification
      );
      return response({
        message: "Notification updated.",
        unread_count: currentNotifications.filter((item) => !item.is_read).length,
      });
    }
    if (path.endsWith("/notifications")) {
      return response({
        notifications: currentNotifications,
        unread_count: currentNotifications.filter((item) => !item.is_read).length,
      });
    }
    if (path.endsWith("/mine")) {
      return response({ auctions: [currentAuction] });
    }
    if (path.endsWith("/approve")) {
      currentAuction = { ...currentAuction, status: "approved" };
      return response({ auction: currentAuction });
    }
    if (path.endsWith("/reject")) {
      currentAuction = {
        ...currentAuction,
        status: "rejected",
        outcome_note: "The item cannot be handed over.",
      };
      return response({ auction: currentAuction });
    }
    if (path.endsWith("/handover/confirm")) {
      const currentAuth = JSON.parse(
        window.localStorage.getItem("campus-auction-auth")
      );
      const userId = currentAuth.user.id;
      const handoverConfirmations = [
        ...currentAuction.handover_confirmations,
      ];
      if (!handoverConfirmations.some((item) => item.user_id === userId)) {
        handoverConfirmations.push({ user_id: userId, name: currentAuth.user.name });
      }
      const bothConfirmed =
        handoverConfirmations.some(
          (item) => item.user_id === currentAuction.seller_id
        ) &&
        handoverConfirmations.some(
          (item) => item.user_id === currentAuction.winner_id
        );
      currentAuction = {
        ...currentAuction,
        handover_confirmations: handoverConfirmations,
        ...(bothConfirmed
          ? {
              status: "completed",
              outcome_note: "Campus handover confirmed by seller and winner.",
            }
          : {}),
      };
      return response({
        message: bothConfirmed
          ? "Campus handover completed. Both parties have confirmed."
          : "Handover confirmation recorded. Waiting for the other party.",
        auction: currentAuction,
      });
    }
    if (path.endsWith("/failed-pickup")) {
      const { reason } = JSON.parse(options.body);
      currentAuction = {
        ...currentAuction,
        status: "failed_pickup",
        outcome_note: reason,
      };
      return response({ message: "Failed pickup recorded.", auction: currentAuction });
    }
    if (path.endsWith("/transaction-cancel")) {
      const { reason } = JSON.parse(options.body);
      currentAuction = {
        ...currentAuction,
        status: "cancelled",
        outcome_note: reason,
      };
      return response({
        message: "Approved sale cancellation recorded.",
        auction: currentAuction,
      });
    }
    if (path.endsWith("/bids")) {
      return response({ message: "Bid placed successfully." });
    }
    if (path.endsWith("/cancel")) {
      return response({
        auction: {
          ...auction,
          status: "cancelled",
          outcome_note: "Item is no longer available.",
        },
      });
    }
    if (/\/api\/auctions\/\d+$/.test(path)) {
      return response({ auction: currentAuction });
    }
    return response({
      auctions: currentAuctions,
      pagination: { total: currentAuctions.length },
    });
  });
  global.fetch = fetchMock;
});

test("shows current campus auctions", async () => {
  render(<App />);

  expect(await screen.findByRole("heading", { name: "Open auctions" }))
    .toBeInTheDocument();
  expect(screen.getByText("Graphing calculator")).toBeInTheDocument();
  expect(screen.getByText("450")).toBeInTheDocument();
  const listingImage = document.querySelector(".card-image img");
  expect(listingImage).not.toBeNull();
  expect(listingImage).toHaveAttribute("src", expect.stringContaining("test-photo.jpg"));
  expect(listingImage.parentElement).toHaveClass("card-image-button");
});

test("groups home auctions by category while keeping them browsable", async () => {
  currentAuctions = [
    auction,
    { ...auction, id: 2, category: "books", title: "Course textbook" },
  ];
  render(<App />);

  const calculatorSection = await screen.findByRole("region", {
    name: "calculator auctions",
  });
  const booksSection = screen.getByRole("region", { name: "books auctions" });
  expect(calculatorSection).toHaveTextContent("Graphing calculator");
  expect(calculatorSection).not.toHaveTextContent("Course textbook");
  expect(booksSection).toHaveTextContent("Course textbook");
});

test("notification bell displays unread notifications and marks them read", async () => {
  currentNotifications = [{
    id: 12,
    auction_id: 1,
    auction_title: "Graphing calculator",
    type: "outbid",
    message: "You have been outbid.",
    is_read: 0,
    created_at: new Date().toISOString(),
  }];
  window.localStorage.setItem("campus-auction-auth", JSON.stringify({
    token: "test-token",
    user: { id: 8, name: "Sam" },
  }));
  render(<App />);

  const bell = await screen.findByRole("button", {
    name: "Notifications, 1 unread",
  });
  await userEvent.click(bell);
  expect(await screen.findByText("You have been outbid.")).toBeInTheDocument();

  await userEvent.click(screen.getByRole("button", { name: "Mark as read" }));
  expect(await screen.findByRole("button", { name: "Mark as unread" }))
    .toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Notifications" }))
    .toBeInTheDocument();
});

test("listing form converts both local date-time fields to UTC ISO", () => {
  const onSubmit = jest.fn();
  const startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  startsAt.setSeconds(0, 0);
  const closesAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);
  const toInputValue = (date) => new Date(
    date.getTime() - date.getTimezoneOffset() * 60000
  ).toISOString().slice(0, 16);
  const { container } = render(
    <AuctionForm onSubmit={onSubmit} onCancel={() => {}} submitting={false} />
  );

  fireEvent.change(screen.getByLabelText("Item title"), {
    target: { value: "Course calculator" },
  });
  fireEvent.change(screen.getByLabelText("Category"), {
    target: { value: "calculator" },
  });
  fireEvent.change(screen.getByLabelText("Condition"), {
    target: { value: "good" },
  });
  fireEvent.change(screen.getByLabelText("Starting price"), {
    target: { value: "100" },
  });
  fireEvent.change(screen.getByLabelText("Minimum bid increment"), {
    target: { value: "10" },
  });
  fireEvent.change(screen.getByLabelText("Auction starts"), {
    target: { value: toInputValue(startsAt) },
  });
  fireEvent.change(screen.getByLabelText("Auction closes"), {
    target: { value: toInputValue(closesAt) },
  });
  fireEvent.submit(container.querySelector("form"));

  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit.mock.calls[0][0].get("starts_at")).toBe(
    startsAt.toISOString()
  );
  expect(onSubmit.mock.calls[0][0].get("closes_at")).toBe(
    closesAt.toISOString()
  );
});

test("scheduled auction detail shows its start and disables bidding", async () => {
  currentAuction = {
    ...auction,
    starts_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    closes_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    bids: [],
    leading_bid: null,
    current_price: auction.starting_price,
  };
  render(<App />);

  fireEvent.click(await screen.findByRole("button", {
    name: "View Graphing calculator",
  }));
  expect(await screen.findByText("scheduled")).toBeInTheDocument();
  expect(screen.getByText(/Auction starts/)).toBeInTheDocument();
  expect(screen.getByText(/Bidding opens/)).toBeInTheDocument();
  expect(screen.queryByRole("heading", { name: "Place a bid" }))
    .not.toBeInTheDocument();
});

test("seller can open a scheduled listing from My auctions", async () => {
  currentAuction = {
    ...auction,
    starts_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    closes_at: new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString(),
    bids: [],
    leading_bid: null,
  };
  window.localStorage.setItem("campus-auction-auth", JSON.stringify({
    token: "seller-token",
    user: { id: 7, name: "Riya" },
  }));
  render(<App />);

  await userEvent.click(await screen.findByRole("button", {
    name: "My auctions",
  }));
  await userEvent.click(await screen.findByRole("button", {
    name: "View Graphing calculator",
  }));

  expect(await screen.findByRole("heading", {
    name: "Graphing calculator",
  })).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringMatching(/\/api\/auctions\/1$/),
    expect.objectContaining({
      headers: { authorization: "Bearer seller-token" },
    })
  );
});

test("auction detail includes the leading bid, bid history, and countdown", async () => {
  render(<App />);

  fireEvent.click(await screen.findByRole("button", {
    name: "View Graphing calculator",
  }));

  expect(await screen.findByRole("heading", { name: "Graphing calculator" }))
    .toBeInTheDocument();
  expect(screen.getByText("Led by Sam")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Bid history" }))
    .toBeInTheDocument();
  expect(screen.getByText("Time remaining")).toBeInTheDocument();
});

test("seller can open listing management controls", async () => {
  window.localStorage.setItem("campus-auction-auth", JSON.stringify({
    token: "test-token",
    user: { id: 7, name: "Riya" },
  }));
  render(<App />);

  fireEvent.click(await screen.findByRole("button", {
    name: "View Graphing calculator",
  }));
  expect(await screen.findByText("Sellers can’t bid on their own listings."))
    .toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "Edit listing" }));

  expect(await screen.findByRole("heading", { name: "Edit listing" }))
    .toBeInTheDocument();
  expect(screen.getByLabelText("Starting price")).toBeDisabled();
  expect(screen.getByLabelText("Minimum bid increment")).toBeDisabled();
});

test("saving edited photos returns to a usable auction detail", async () => {
  window.localStorage.setItem("campus-auction-auth", JSON.stringify({
    token: "test-token",
    user: { id: 7, name: "Riya" },
  }));
  render(<App />);

  await userEvent.click(await screen.findByRole("button", {
    name: "View Graphing calculator",
  }));
  await userEvent.click(await screen.findByRole("button", {
    name: "Edit listing",
  }));
  expect(await screen.findByRole("heading", { name: "Edit listing" }))
    .toBeInTheDocument();
  const image = new File(["image data"], "calculator.png", {
    type: "image/png",
  });
  await userEvent.upload(await screen.findByLabelText(/Add photos/), image);
  await userEvent.click(screen.getByRole("button", { name: "Save changes" }));

  expect(await screen.findByRole("heading", { name: "Bid history" }))
    .toBeInTheDocument();
  expect(screen.getByText("Led by Sam")).toBeInTheDocument();
});

test("seller can review and approve a provisional winning bid", async () => {
  currentAuction = { ...auction, status: "pending_approval" };
  window.localStorage.setItem("campus-auction-auth", JSON.stringify({
    token: "test-token",
    user: { id: 7, name: "Riya" },
  }));
  render(<App />);

  await userEvent.click(screen.getByRole("button", { name: "My auctions" }));
  expect(await screen.findByRole("heading", { name: "My auctions" }))
    .toBeInTheDocument();
  await userEvent.click(await screen.findByRole("button", {
    name: "View Graphing calculator",
  }));

  await userEvent.click(await screen.findByRole("button", {
    name: "Approve winning bid",
  }));
  expect(await screen.findByText("This auction is approved."))
    .toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringMatching(/\/api\/auctions\/1\/approve$/),
    expect.objectContaining({ method: "POST" })
  );
});

test("seller rejection requires and displays an outcome reason", async () => {
  currentAuction = { ...auction, status: "pending_approval" };
  window.localStorage.setItem("campus-auction-auth", JSON.stringify({
    token: "test-token",
    user: { id: 7, name: "Riya" },
  }));
  render(<App />);

  await userEvent.click(screen.getByRole("button", { name: "My auctions" }));
  await userEvent.click(await screen.findByRole("button", {
    name: "View Graphing calculator",
  }));
  await userEvent.type(
    await screen.findByLabelText("Rejection reason"),
    "The item cannot be handed over."
  );
  await userEvent.click(screen.getByRole("button", {
    name: "Reject winning bid",
  }));

  expect(await screen.findByText("The item cannot be handed over."))
    .toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringMatching(/\/api\/auctions\/1\/reject$/),
    expect.objectContaining({ method: "POST" })
  );
});

test("seller handover confirmation waits for the winner", async () => {
  currentAuction = { ...auction, status: "approved" };
  window.localStorage.setItem("campus-auction-auth", JSON.stringify({
    token: "test-token",
    user: { id: 7, name: "Riya" },
  }));
  render(<App />);

  await userEvent.click(screen.getByRole("button", { name: "My auctions" }));
  await userEvent.click(await screen.findByRole("button", {
    name: "View Graphing calculator",
  }));
  await userEvent.click(await screen.findByRole("button", {
    name: "Confirm campus handover",
  }));

  expect(await screen.findByText("Handover confirmation recorded. Waiting for the other party."))
    .toBeInTheDocument();
  expect(screen.getByText("Seller · Riya").parentElement)
    .toHaveTextContent("Confirmed");
  expect(screen.getByText("Winner · Sam").parentElement)
    .toHaveTextContent("Waiting");
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringMatching(/\/api\/auctions\/1\/handover\/confirm$/),
    expect.objectContaining({ method: "POST" })
  );
});

test("winner confirmation completes the approved campus handover", async () => {
  currentAuction = {
    ...auction,
    status: "approved",
    handover_confirmations: [{ user_id: 7, name: "Riya" }],
  };
  window.localStorage.setItem("campus-auction-auth", JSON.stringify({
    token: "test-token",
    user: { id: 8, name: "Sam" },
  }));
  render(<App />);

  await userEvent.click(screen.getByRole("button", { name: "My auctions" }));
  await userEvent.click(await screen.findByRole("button", {
    name: "View Graphing calculator",
  }));
  await userEvent.click(await screen.findByRole("button", {
    name: "Confirm campus handover",
  }));

  expect(await screen.findByText("This auction is completed."))
    .toBeInTheDocument();
  expect(screen.getByText("Campus handover confirmed by seller and winner."))
    .toBeInTheDocument();
});

test("an approved sale can record a failed pickup reason", async () => {
  currentAuction = { ...auction, status: "approved" };
  window.localStorage.setItem("campus-auction-auth", JSON.stringify({
    token: "test-token",
    user: { id: 8, name: "Sam" },
  }));
  render(<App />);

  await userEvent.click(screen.getByRole("button", { name: "My auctions" }));
  await userEvent.click(await screen.findByRole("button", {
    name: "View Graphing calculator",
  }));
  await userEvent.type(
    await screen.findByLabelText("Failed pickup reason"),
    "Pickup could not be completed."
  );
  await userEvent.click(screen.getByRole("button", {
    name: "Record failed pickup",
  }));

  expect(await screen.findByText("This auction is failed pickup."))
    .toBeInTheDocument();
  expect(screen.getByText("Pickup could not be completed."))
    .toBeInTheDocument();
});

test("an approved sale can be cancelled with a recorded reason", async () => {
  currentAuction = { ...auction, status: "approved" };
  window.localStorage.setItem("campus-auction-auth", JSON.stringify({
    token: "test-token",
    user: { id: 7, name: "Riya" },
  }));
  render(<App />);

  await userEvent.click(screen.getByRole("button", { name: "My auctions" }));
  await userEvent.click(await screen.findByRole("button", {
    name: "View Graphing calculator",
  }));
  await userEvent.type(
    await screen.findByLabelText("Sale cancellation reason"),
    "Both parties agreed to cancel."
  );
  await userEvent.click(screen.getByRole("button", {
    name: "Cancel approved sale",
  }));

  expect(await screen.findByText("Both parties agreed to cancel."))
    .toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringMatching(/\/api\/auctions\/1\/transaction-cancel$/),
    expect.objectContaining({ method: "POST" })
  );
});

test("seller cancellation records and displays its outcome", async () => {
  window.localStorage.setItem("campus-auction-auth", JSON.stringify({
    token: "test-token",
    user: { id: 7, name: "Riya" },
  }));
  render(<App />);

  fireEvent.click(await screen.findByRole("button", {
    name: "View Graphing calculator",
  }));
  fireEvent.change(await screen.findByLabelText("Cancellation reason"), {
    target: { value: "Item is no longer available." },
  });
  fireEvent.click(screen.getByRole("button", { name: "Cancel listing" }));

  expect(await screen.findByText("Outcome note")).toBeInTheDocument();
  expect(screen.getByText("Item is no longer available."))
    .toBeInTheDocument();
});

test("search filters are sent to the auction API", async () => {
  render(<App />);

  fireEvent.change(await screen.findByLabelText("Search listings"), {
    target: { value: "bike" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply filters" }));

  expect(await screen.findByRole("button", {
    name: "View Graphing calculator",
  })).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringContaining("q=bike"),
    expect.objectContaining({ method: "GET" })
  );
});

test("a signed-in non-seller can place a bid", async () => {
  window.localStorage.setItem("campus-auction-auth", JSON.stringify({
    token: "test-token",
    user: { id: 8, name: "Sam" },
  }));
  render(<App />);

  fireEvent.click(await screen.findByRole("button", {
    name: "View Graphing calculator",
  }));
  const bidInput = await screen.findByLabelText("Your bid");
  expect(bidInput).toHaveAttribute("min", "475");
  fireEvent.change(bidInput, { target: { value: "475" } });
  fireEvent.click(screen.getByRole("button", { name: "Submit bid" }));

  expect(await screen.findByText("Bid placed successfully."))
    .toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledWith(
    expect.stringMatching(/\/api\/auctions\/1\/bids$/),
    expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({
        authorization: "Bearer test-token",
      }),
    })
  );
});

test("sign-in dialog receives focus and closes with Escape", async () => {
  render(<App />);
  const signInButton = screen.getByRole("button", { name: "Sign in" });
  await userEvent.click(signInButton);

  const emailInput = await screen.findByLabelText("Campus email");
  expect(document.activeElement).toBe(emailInput);
  fireEvent.keyDown(document, { key: "Escape" });

  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(document.activeElement).toBe(signInButton);
});
