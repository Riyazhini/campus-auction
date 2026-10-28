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
- Auction state changes and outcome notes are recorded in an event history

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
- `PATCH /api/auctions/:id` and `POST /api/auctions/:id/cancel` for
  seller-only listing management
- `POST /api/auctions/:id/bids` to place a bid (bearer token required)

Price values are stored as positive whole numbers; the project has not yet
specified a currency. The “closing soon” filter means auctions closing in the
next 24 hours. Sellers cannot bid on their own listings.

Expired active auctions are settled on auction list/detail reads and late bid
attempts. The highest valid bid is stored as the provisional winner and moves
the auction to `pending_approval`; an auction without bids becomes `unsold`.
The auction detail response includes a chronological `events` history.

See [docs/rules.md](docs/rules.md) for the auction state machine and business
rules.
