# Campus Auction

A campus-only marketplace for listing, finding, and bidding on second-hand
items. The project uses a React frontend, an Express API, and SQLite.

## Features

- Campus-email registration, login, and authenticated listing management
- Create, edit, and cancel auction listings with up to five photos
- Browse and filter active auctions; inspect listing details and public bid history
- Place bids with server-side validation and serialized SQLite transactions
- Expired auctions close on reads or bid attempts, selecting a provisional winner or marking the auction unsold
- Sellers can approve or reject provisional winners; participants can find relevant listings in My auctions
- Approved sales complete only after both seller and winner confirm campus handover
- The seller or winner can record a failed pickup or cancel an approved sale with a reason
- Auction state changes and outcome notes are recorded in an event history
- Relevant users receive in-app notifications for outbids and auction lifecycle outcomes
- The auction home page groups matching listings by category
- Listing closing times use explicit hour, minute, and AM/PM controls

## Requirements

- Node.js 18 or newer
- npm
- A campus email domain for account registration

## Run locally

Install dependencies in each application directory:

```powershell
cd backend
npm install
cd ..\frontend
npm install
```

Create `backend/.env` with:

```dotenv
PORT=5000
JWT_SECRET=replace-with-a-long-random-secret
CAMPUS_EMAIL_DOMAIN=your-campus.edu
```

Start the API and frontend in separate terminals:

```powershell
cd backend
npm start
```

```powershell
cd frontend
npm start
```

The API listens on `http://localhost:5000`; the React development server
normally listens on `http://localhost:3000`. Set
`REACT_APP_API_URL` in the frontend environment if the API runs elsewhere.
The API also exposes `GET /api/health`.

## Tests

Run the backend API integration test:

```powershell
cd backend
npm test
```

Run frontend tests once (without the interactive watch process):

```powershell
cd frontend
npm test -- --watchAll=false
```

Create React App can produce a production build with `npm run build`.

## API overview

- `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`
- `GET /api/auctions` with `q`, `category`, `condition`, `minPrice`,
  `maxPrice`, `closesSoon`, `limit`, and `offset` query parameters
- `POST /api/auctions` to create a listing (bearer token required)
- `GET /api/auctions/:id` for item details and public bid history
- `GET /api/auctions/mine` for authenticated seller and winner listings
- `POST /api/auctions/:id/approve` or `/reject` for seller decisions
- `POST /api/auctions/:id/handover/confirm` for seller and winner confirmations
- `POST /api/auctions/:id/failed-pickup` or `/transaction-cancel` for
  reasoned final outcomes by either sale participant
- `PATCH /api/auctions/:id` and `POST /api/auctions/:id/cancel` for
  seller-only listing management
- `POST /api/auctions/:id/bids` to place a bid (bearer token required)
- `GET /api/notifications` for the authenticated user's latest notifications and unread count
- `PATCH /api/notifications/:id` with `{ "is_read": true|false }` to update a notification

Price values are stored as positive whole numbers; the project has not yet
specified a currency. The “closing soon” filter means auctions closing in the
next 24 hours. Sellers cannot bid on their own listings.

Expired active auctions are settled on auction list/detail reads and late bid
attempts. The highest valid bid is stored as the provisional winner and moves
the auction to `pending_approval`; an auction without bids becomes `unsold`.
The auction detail response includes a chronological `events` history.

Notifications are stored only for the relevant users: previous leaders when
outbid, sellers and provisional winners when an auction closes, winners after
seller decisions, and both participants after completed handover or a failed
pickup/sale cancellation. Authenticated users can view and update only their
own notifications. The frontend refreshes notifications periodically while
signed in.

See [docs/rules.md](docs/rules.md) for the auction state machine and business
rules.
