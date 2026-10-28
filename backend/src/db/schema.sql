
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auctions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seller_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  condition TEXT NOT NULL,
  starting_price INTEGER NOT NULL CHECK (starting_price > 0),
  min_increment INTEGER NOT NULL CHECK (min_increment > 0),
  starts_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00.000Z',
  closes_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN (
      'active', 'closed', 'pending_approval', 'approved',
      'rejected', 'completed', 'failed_pickup', 'unsold', 'cancelled'
    )),
  winner_id INTEGER REFERENCES users(id),
  winning_amount INTEGER,
  outcome_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS photos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_id INTEGER NOT NULL REFERENCES auctions(id) ON DELETE CASCADE,
  url TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_id INTEGER NOT NULL REFERENCES auctions(id),
  bidder_id INTEGER NOT NULL REFERENCES users(id),
  amount INTEGER NOT NULL CHECK (amount > 0),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  auction_id INTEGER REFERENCES auctions(id),
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0 CHECK (is_read IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS auction_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  auction_id INTEGER NOT NULL REFERENCES auctions(id),
  actor_id INTEGER REFERENCES users(id),
  event_type TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS handover_confirmations (
  auction_id INTEGER NOT NULL REFERENCES auctions(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  confirmed_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (auction_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_auctions_status_closes
  ON auctions(status, closes_at);

CREATE INDEX IF NOT EXISTS idx_bids_auction
  ON bids(auction_id, amount DESC);

CREATE INDEX IF NOT EXISTS idx_auction_events_auction
  ON auction_events(auction_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_handover_confirmations_auction
  ON handover_confirmations(auction_id, confirmed_at);
