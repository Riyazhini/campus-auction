import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";

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
  closes_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  status: "active",
  winner_id: 8,
  winner_name: "Sam",
  winning_amount: 450,
  created_at: new Date().toISOString(),
  seller_name: "Riya",
  primary_photo: null,
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

beforeEach(() => {
  window.localStorage.clear();
  currentAuction = auction;
  fetchMock = jest.fn(async (url) => {
    const path = new URL(url).pathname;
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
      auctions: [auction],
      pagination: { total: 1 },
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
