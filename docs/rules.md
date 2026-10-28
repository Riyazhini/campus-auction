# Campus Auction — Business Rules

## 1. Purpose

This document defines the business rules for auction creation, bidding,
auction closure, approval, and completion. These rules must be enforced
by the backend and reflected in the frontend.

## 2. Bidding Rules

1. Every auction must have a starting price, a minimum bid increment, and
   start and closing date-times.
2. The first valid bid must be greater than or equal to the starting price.
3. Every subsequent valid bid must be greater than or equal to the
   current highest bid plus the minimum bid increment.
4. The current price is the highest valid bid recorded for the auction.
5. A bidder cannot submit a bid below the required minimum.
6. A bid must be associated with an existing auction and an authenticated
   bidder.
7. Invalid bids must be rejected by the server with a clear error message.
8. Once accepted, a bid must be recorded with its bidder, amount,
   and server-generated timestamp.
9. Accepted bids are retained in the bidding history and cannot be
   silently modified or deleted.
10. When simultaneous bids are submitted, the server must process them
    safely so that no accepted bid violates the minimum increment rule.
11. A seller cannot bid on their own auction.
12. A bid is accepted only at or after the listing's scheduled start time.

## 3. Auction Closing Rules

1. Each auction has a closing date and time.
2. The server is the authoritative source for the current time.
3. A bid is accepted only if the auction is active and the server time
   is earlier than the closing time when the bid is validated.
4. A bid submitted at or after the closing time must be rejected.
5. The browser clock must never determine whether a bid is valid.
6. When the closing time is reached, the auction must stop accepting bids.
7. An auction with at least one valid bid proceeds to the approval workflow.
8. An auction with no valid bids after closing becomes unsold.
9. Auction closure and bid validation must be enforced on the backend,
   even if the frontend has not refreshed.
10. When an expired active auction is next read or receives a bid attempt,
    the server closes it and selects the highest valid bid as the provisional
    winner, moving it to `pending_approval`; an auction with no bids becomes
    `unsold`. A bid attempt at or after the closing time is rejected.
11. Closing and settlement run atomically. The same auction cannot be settled
    twice, and every lifecycle transition is recorded in its event history.

## 4. Auction States

### 4.1 Active

The auction is open for bidding from its start time until its closing time,
provided all bidding rules are satisfied. Before its start time, an active
listing is scheduled, hidden from public browsing, and cannot receive bids.

### 4.2 Closed

The auction has ended and no additional bids are accepted.
The server determines whether the auction has valid bids.

### 4.3 Pending Approval

The auction has closed with at least one valid bid and is waiting
for its seller to decide the provisional winning bid.

### 4.4 Approved

The seller has approved the provisional winning bid. The winner and amount
are reserved for that transaction, and no further bids or seller changes
are accepted.

### 4.5 Rejected

The seller has rejected the provisional winning bid and recorded a
non-empty reason. The auction cannot be completed unless an explicitly
defined recovery process is introduced.

### 4.6 Completed

The approved auction transaction has been successfully completed after
both the seller and winning bidder confirm the campus handover.

### 4.7 Failed Pickup

The approved transaction could not be completed because the
required pickup or handover failed. Either the seller or winner can report
the failure with a reason; the report records who submitted it.

### 4.8 Unsold

The auction closed without any valid bids.

### 4.9 Cancelled

An active listing can be cancelled by its seller. An approved sale can be
cancelled by either the seller or winner with a reason. A cancelled auction
cannot accept bids or proceed to handover.

## 5. State Transitions

The expected state transitions are:

- Active -> Closed
- Active -> Cancelled
- Closed -> Pending Approval (if valid bids exist; highest bid is provisional)
- Closed -> Unsold (if no valid bids exist)
- Pending Approval -> Approved
- Pending Approval -> Rejected
- Approved -> Cancelled (seller or winner, with a reason)
- Approved -> Completed (only after seller and winner both confirm handover)
- Approved -> Failed Pickup (if pickup fails)

Only permitted transitions may be performed. Every state change
must be validated by the backend and recorded in the auction history.

Rejected, Unsold, Completed, Failed Pickup, and Cancelled are terminal
states in the initial version. Any reopening or retry process must be
explicitly defined before implementation.

## 6. Public Bidding History

1. All accepted bids are publicly visible to users who can view the auction.
2. Each bid entry must display:
   - Bidder's public display name or username
   - Bid amount
   - Server-recorded bid timestamp
3. Bids must be displayed in chronological order or another clearly
   documented order.
4. The auction page must show the current highest valid bid.
5. Rejected bids must not appear as accepted bids in the public history.
6. Private information such as passwords, authentication tokens,
   email addresses, and contact details must not be exposed in
   public bidding history.

## 7. Browsing and Search

1. The auction list shows started active listings and their current price. If
   there are no bids, the current price is the starting price. Future listings
   remain visible to their seller in My auctions.
2. Keyword search covers the title, description, and category.
3. Category and condition filters use the values defined by the backend.
4. Minimum and maximum price filters apply to the current price.
5. “Closing soon” means the auction closes within the next 24 hours.
6. Auction detail includes item information, the leading bid, a countdown,
   and the public bid history. The server remains authoritative for closing
   and bidding decisions.

## 8. Backend Enforcement

1. All bid validation must happen on the server.
2. The server must verify the auction state, closing time, starting price,
   current highest bid, and minimum increment before accepting a bid.
3. Bid creation and highest-bid updates must be handled atomically
   to prevent race conditions.
4. The server must prevent unauthorized users from approving,
   rejecting, or cancelling auctions.
5. Auction state transitions must be validated against the permitted
   transition rules.
6. The server must generate authoritative timestamps for bids and
   state changes.
7. Monetary values must use a precise representation suitable for
   currency calculations, not floating-point arithmetic.
8. Every listing creation and lifecycle outcome must be recorded with
   actor, timestamp, status transition, and applicable outcome note.
9. Only the listing seller may approve or reject a provisional winning bid.
   Rejection requires a recorded reason.
10. Only the seller and provisional winner can confirm handover. Each party
    can confirm once; the second distinct confirmation completes the sale.
11. Only the seller or winner of an approved sale can report failed pickup
    or cancel the transaction, and both outcomes require a non-empty reason.

## 9. Assumptions and Policies to Finalize

Before implementation, decide:

- Whether bidders can place multiple consecutive bids.
- What happens after a winning bidder fails to collect an item.
- Whether a rejected outcome can be reviewed or reopened.
- Who can cancel an auction and under what conditions.
- Whether auction extensions are allowed near closing time.
- The currency, rounding rules, and minimum increment configuration.

Until these policies are finalized, the backend must not introduce
implicit behavior that contradicts the documented bidding rules.

## Listing Edit and Cancellation Rules

### Editing

- Only the seller who created a listing may edit it.
- Only listings with status `active` may be edited.
- If no bids exist, the seller may edit all listing fields.
- Once a bid exists, `starting_price`, `min_increment`, and `closes_at` are locked.
- A scheduled start may be changed only by its seller while it remains in the
  future and has no bids. Start time is locked once the auction starts or a bid
  exists.
- After bids exist, the seller may edit the title, category, description, condition, and photos, subject to validation.
- The bid check and listing update must occur in one database transaction.

### Cancellation

- Only the seller may cancel their own listing.
- Only active listings may be cancelled.
- Cancellation requires a non-empty reason.
- The reason must be saved in `outcome_note`.
- Cancellation is allowed even when bids exist.
- Successful lifecycle events create notifications for the relevant users;
  failed requests and unrelated users must not receive notifications.

## In-app Notifications

- Notifications are persisted and scoped to their recipient.
- The previous leading bidder is notified only after a new bid is accepted.
- The seller and provisional winner are notified when an auction with bids
  closes; an auction closing without bids notifies its seller.
- The provisional winner is notified after the seller approves or rejects
  the winning bid.
- Both sale participants are notified when handover completes or a failed
  pickup / approved-sale cancellation is recorded.
- Authenticated users can list only their own notifications and update the
  read status only for notifications they own.
- The frontend shows unread count, read status, and a periodically refreshed
  notification list.

## Scheduling Rules

- Every listing has a `starts_at` and `closes_at` timestamp stored in UTC.
  Browser-local date-time input values are converted to UTC before storage.
- Creation requires a future start, a closing time at least one hour ahead,
  and a close later than the start.
- A future-start listing remains `active` in the lifecycle state machine, but
  is treated as scheduled: public browse/search omits it and direct detail
  requests return not found to anyone other than its seller.
- At or after `starts_at`, the listing is publicly visible and accepts bids
  without a background scheduler. The server checks start eligibility on
  every bid attempt.
- Expiration settlement applies only to started active listings.
