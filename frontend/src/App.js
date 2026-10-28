import { useCallback, useEffect, useRef, useState } from "react";
import AuctionForm from "./AuctionForm";
import { apiRequest, getUploadUrl } from "./api";
import { AUCTION_CATEGORIES, ITEM_CONDITIONS } from "./auctionOptions";
import "./App.css";

function formatAmount(amount) {
  return Number(amount).toLocaleString();
}

function formatDate(value) {
  return new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function categoryLabel(value) {
  return value.replaceAll("_", " ");
}

function AuthDialog({ mode, onModeChange, onClose, onSubmit, error }) {
  const dialogRef = useRef(null);
  const [values, setValues] = useState({
    name: "",
    email: "",
    password: "",
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const previousFocus = document.activeElement;
    const dialog = dialogRef.current;
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusableElements = () =>
      Array.from(dialog.querySelectorAll(focusableSelector));
    const initialFocus = dialog.querySelector("[data-autofocus]") ||
      focusableElements()[0];
    initialFocus?.focus();

    function keepFocusInDialog(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const elements = focusableElements();
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }

    document.addEventListener("keydown", keepFocusInDialog);
    return () => {
      document.removeEventListener("keydown", keepFocusInDialog);
      previousFocus?.focus?.();
    };
  }, [onClose]);

  function update(event) {
    setValues((current) => ({
      ...current,
      [event.target.name]: event.target.value,
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit(values);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <section
        ref={dialogRef}
        className="auth-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
      >
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <p className="eyebrow">Campus Auction</p>
        <h2 id="auth-title">
          {mode === "login" ? "Welcome back" : "Join your campus"}
        </h2>
        <p className="muted">
          {mode === "login"
            ? "Sign in to bid and manage your listings."
            : "Create an account with your campus email."}
        </p>
        <form className="auth-form" onSubmit={submit}>
          {mode === "register" && (
            <label className="field">
              Your name
              <input
                name="name"
                data-autofocus
                value={values.name}
                onChange={update}
                autoComplete="name"
                required
              />
            </label>
          )}
          <label className="field">
            Campus email
            <input
              name="email"
              data-autofocus={mode === "login" ? "" : undefined}
              type="email"
              value={values.email}
              onChange={update}
              autoComplete="email"
              required
            />
          </label>
          <label className="field">
            Password
            <input
              name="password"
              type="password"
              value={values.password}
              onChange={update}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              minLength="8"
              required
            />
          </label>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button button-primary button-full" disabled={submitting}>
            {submitting ? "Please wait..." : mode === "login" ? "Sign in" : "Create account"}
          </button>
        </form>
        <p className="auth-switch">
          {mode === "login" ? "New to campus auctions?" : "Already have an account?"}
          {" "}
          <button
            className="text-button"
            onClick={() => onModeChange(mode === "login" ? "register" : "login")}
          >
            {mode === "login" ? "Create an account" : "Sign in"}
          </button>
        </p>
      </section>
    </div>
  );
}

function AuctionCard({ auction, onSelect }) {
  return (
    <article className="auction-card">
      <div className="card-image">
        <button
          className="card-image-button"
          onClick={() => onSelect(auction.id)}
          aria-label={`View ${auction.title}`}
        >
          {auction.primary_photo
            ? <img src={getUploadUrl(auction.primary_photo)} alt="" />
            : <span className="image-placeholder">{categoryLabel(auction.category).slice(0, 1).toUpperCase()}</span>}
        </button>
        <span className="category-chip">{categoryLabel(auction.category)}</span>
      </div>
      <div className="card-body">
        <div className="card-heading">
          <h2>
            <button
              className="card-title-button"
              onClick={() => onSelect(auction.id)}
            >
              {auction.title}
            </button>
          </h2>
          <span className="condition-label">{auction.condition}</span>
        </div>
        <p className="card-description">
          {auction.description || "A great campus find, ready for a new owner."}
        </p>
        <div className="card-footer">
          <div>
            <span className="meta-label">Current price</span>
            <strong>{formatAmount(auction.current_price)}</strong>
          </div>
          <div className="card-closing">
            <span className="meta-label">Closes</span>
            <span>{formatDate(auction.closes_at)}</span>
          </div>
        </div>
      </div>
    </article>
  );
}

function AuctionFilters({ value, onChange, onSubmit, onReset }) {
  function update(event) {
    const { name, value: inputValue, checked, type } = event.target;
    onChange((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : inputValue,
    }));
  }

  return (
    <form className="auction-filters" onSubmit={onSubmit}>
      <label className="field filter-keyword">
        Search listings
        <input
          name="q"
          type="search"
          value={value.q}
          onChange={update}
          placeholder="Try “textbook” or “bike”"
          maxLength="100"
        />
      </label>
      <label className="field">
        Category
        <select name="category" value={value.category} onChange={update}>
          <option value="">All categories</option>
          {AUCTION_CATEGORIES.map((category) => (
            <option value={category} key={category}>
              {categoryLabel(category)}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Condition
        <select name="condition" value={value.condition} onChange={update}>
          <option value="">Any condition</option>
          {ITEM_CONDITIONS.map((condition) => (
            <option value={condition} key={condition}>{condition}</option>
          ))}
        </select>
      </label>
      <label className="field">
        Minimum current price
        <input
          name="minPrice"
          type="number"
          min="0"
          step="1"
          value={value.minPrice}
          onChange={update}
          placeholder="No minimum"
        />
      </label>
      <label className="field">
        Maximum current price
        <input
          name="maxPrice"
          type="number"
          min="0"
          step="1"
          value={value.maxPrice}
          onChange={update}
          placeholder="No maximum"
        />
      </label>
      <label className="filter-checkbox">
        <input
          name="closesSoon"
          type="checkbox"
          checked={value.closesSoon}
          onChange={update}
        />
        Closes in the next 24 hours
      </label>
      <div className="filter-actions">
        <button className="button button-primary button-small" type="submit">
          Apply filters
        </button>
        <button
          className="text-button filter-reset"
          type="button"
          onClick={onReset}
        >
          Clear
        </button>
      </div>
    </form>
  );
}

function AuctionSkeletons() {
  return (
    <div
      className="auction-grid auction-grid-skeleton"
      role="status"
      aria-label="Loading auctions"
      aria-busy="true"
    >
      {[0, 1, 2].map((item) => (
        <div className="auction-skeleton" key={item} aria-hidden="true">
          <div className="skeleton-image" />
          <div className="skeleton-copy">
            <span />
            <span />
            <span />
          </div>
        </div>
      ))}
    </div>
  );
}

function Countdown({ closesAt }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const remaining = new Date(closesAt).getTime() - now;
  if (remaining <= 0) {
    return <span className="countdown countdown-ended">Auction ended</span>;
  }

  const totalSeconds = Math.floor(remaining / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return (
    <span className="countdown">
      {days > 0 ? `${days}d ` : ""}
      {String(hours).padStart(2, "0")}:{String(minutes).padStart(2, "0")}:
      {String(seconds).padStart(2, "0")}
    </span>
  );
}

function AuctionDetail({
  auction,
  user,
  onBack,
  onEdit,
  onUpdate,
  onCancelListing,
  onPlaceBid,
  onSignIn,
  saving,
  error,
  bidding,
  bidError,
  bidMessage,
}) {
  const [editing, setEditing] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const [bidAmount, setBidAmount] = useState("");
  const isSeller = user && user.id === auction.seller_id;
  const canManage = isSeller && auction.status === "active";
  const canBid = auction.status === "active" &&
    Date.parse(auction.closes_at) > Date.now();
  const minimumBid = auction.leading_bid
    ? auction.current_price + auction.min_increment
    : auction.starting_price;

  async function submitEdit(formData) {
    if (await onUpdate(formData)) {
      setEditing(false);
    }
  }

  async function submitCancellation(event) {
    event.preventDefault();
    setCancelling(true);
    try {
      if (await onCancelListing(cancelReason)) {
        setCancelReason("");
      }
    } finally {
      setCancelling(false);
    }
  }

  async function submitBid(event) {
    event.preventDefault();
    if (await onPlaceBid(Number(bidAmount))) {
      setBidAmount("");
    }
  }

  if (editing) {
    return (
      <section className="page-section">
        <button className="back-button" onClick={() => setEditing(false)}>
          ← Back to item
        </button>
        <div className="section-heading">
          <p className="eyebrow">Seller tools</p>
          <h1>Edit listing</h1>
        </div>
        <AuctionForm
          auction={auction}
          onSubmit={submitEdit}
          onCancel={() => setEditing(false)}
          error={error}
          submitting={saving}
          lockedAfterBid={auction.bids.length > 0}
        />
      </section>
    );
  }

  return (
    <section className="page-section detail-page">
      <button className="back-button" onClick={onBack}>
        ← All auctions
      </button>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      <div className="detail-layout">
        <div className="detail-main">
          <div className="detail-gallery">
            {auction.photos.length > 0
              ? <img src={getUploadUrl(auction.photos[0].url)} alt={auction.title} />
              : <div className="image-placeholder detail-placeholder">{categoryLabel(auction.category).slice(0, 1).toUpperCase()}</div>}
          </div>
          {auction.photos.length > 1 && (
            <div className="detail-thumbnails">
              {auction.photos.slice(1).map((photo) => (
                <img
                  src={getUploadUrl(photo.url)}
                  alt=""
                  key={photo.id}
                />
              ))}
            </div>
          )}
          <div className="detail-copy">
            <div className="detail-tags">
              <span className="category-chip">{categoryLabel(auction.category)}</span>
              <span className="condition-label">{auction.condition}</span>
              <span className={`status-chip status-${auction.status}`}>
                {auction.status.replaceAll("_", " ")}
              </span>
            </div>
            <h1>{auction.title}</h1>
            <p className="detail-description">
              {auction.description || "The seller has not added a description."}
            </p>
            <div className="seller-line">
              Listed by <strong>{auction.seller_name}</strong>
              <span aria-hidden="true">·</span>
              {formatDate(auction.created_at)}
            </div>
          </div>
          <section className="history-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">Open record</p>
                <h2>Bid history</h2>
              </div>
              <span className="history-count">{auction.bids.length} bids</span>
            </div>
            {auction.bids.length === 0 ? (
              <p className="empty-history">No bids yet. Be the first to make an offer.</p>
            ) : (
              <ol className="bid-history">
                {auction.bids.map((bid) => (
                  <li key={bid.id}>
                    <span className="bid-avatar">
                      {bid.bidder_name.slice(0, 1).toUpperCase()}
                    </span>
                    <span className="bid-person">
                      <strong>{bid.bidder_name}</strong>
                      <small>{formatDate(bid.created_at)}</small>
                    </span>
                    <strong className="bid-amount">{formatAmount(bid.amount)}</strong>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="detail-aside">
          <div className="price-panel">
            <p className="eyebrow">
              {auction.leading_bid ? "Leading bid" : "Starting price"}
            </p>
            <strong className="detail-price">{formatAmount(auction.current_price)}</strong>
            {auction.leading_bid && (
              <p className="leading-bidder">
                Led by {auction.leading_bid.bidder_name}
              </p>
            )}
            {!auction.leading_bid && (
              <p className="leading-bidder">Starting price · no bids yet</p>
            )}
            <div className="countdown-row">
              <span>Time remaining</span>
              <Countdown closesAt={auction.closes_at} />
            </div>
            <p className="minimum-increment">
              Minimum next increment: {formatAmount(auction.min_increment)}
            </p>
          </div>

          {canBid && !isSeller && user && (
            <form className="bid-panel" onSubmit={submitBid}>
              <p className="eyebrow">Make your move</p>
              <h2>Place a bid</h2>
              <label className="field">
                Your bid
                <input
                  type="number"
                  min={minimumBid}
                  step="1"
                  value={bidAmount}
                  onChange={(event) => setBidAmount(event.target.value)}
                  required
                />
              </label>
              <p className="field-hint">
                Minimum bid: {formatAmount(minimumBid)}
              </p>
              {bidError && <p className="form-error" role="alert">{bidError}</p>}
              {bidMessage && <p className="bid-success" role="status">{bidMessage}</p>}
              <button
                className="button button-primary button-full"
                disabled={bidding}
              >
                {bidding ? "Placing bid..." : "Submit bid"}
              </button>
            </form>
          )}
          {canBid && !user && (
            <div className="bid-panel">
              <p className="eyebrow">Ready to bid?</p>
              <h2>Join the auction</h2>
              <p className="muted">Sign in with your campus account to place a bid.</p>
              <button
                className="button button-primary button-full"
                onClick={onSignIn}
              >
                Sign in to bid
              </button>
            </div>
          )}
          {canBid && isSeller && (
            <p className="bid-notice">
              Sellers can’t bid on their own listings.
            </p>
          )}
          {!canBid && auction.status !== "active" && (
            <p className="bid-notice">
              This auction is {auction.status.replaceAll("_", " ")}.
            </p>
          )}
          {!canBid && auction.status === "active" && (
            <p className="bid-notice">This auction has closed.</p>
          )}

          {canManage && (
            <div className="seller-panel">
              <p className="eyebrow">Seller tools</p>
              <h2>Manage listing</h2>
              <p className="muted">
                {auction.bids.length
                  ? "Price and closing time are locked after the first bid."
                  : "You can update the listing while it is active."}
              </p>
              <button
                className="button button-secondary button-full"
                onClick={() => {
                  setEditing(true);
                  onEdit();
                }}
              >
                Edit listing
              </button>
              <form className="cancel-listing-form" onSubmit={submitCancellation}>
                <label className="field">
                  Cancellation reason
                  <textarea
                    value={cancelReason}
                    onChange={(event) => setCancelReason(event.target.value)}
                    maxLength="1000"
                    rows="3"
                    required
                  />
                </label>
                <button
                  className="button button-danger button-full"
                  disabled={cancelling}
                >
                  {cancelling ? "Cancelling..." : "Cancel listing"}
                </button>
              </form>
            </div>
          )}
          {auction.outcome_note && (
            <div className="outcome-note">
              <span className="meta-label">Outcome note</span>
              <p>{auction.outcome_note}</p>
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

function App() {
  const [auth, setAuth] = useState(() => {
    try {
      return JSON.parse(window.localStorage.getItem("campus-auction-auth")) || null;
    } catch {
      return null;
    }
  });
  const [auctions, setAuctions] = useState([]);
  const [auctionTotal, setAuctionTotal] = useState(0);
  const [filters, setFilters] = useState({
    q: "",
    category: "",
    condition: "",
    minPrice: "",
    maxPrice: "",
    closesSoon: false,
  });
  const [draftFilters, setDraftFilters] = useState(filters);
  const [selectedAuctionId, setSelectedAuctionId] = useState(null);
  const [selectedAuction, setSelectedAuction] = useState(null);
  const [page, setPage] = useState("browse");
  const [loadingAuctions, setLoadingAuctions] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bidding, setBidding] = useState(false);
  const [bidError, setBidError] = useState("");
  const [bidMessage, setBidMessage] = useState("");
  const [error, setError] = useState("");
  const [authError, setAuthError] = useState("");
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const closeAuthDialog = useCallback(() => setShowAuth(false), []);

  const loadAuctions = useCallback(async () => {
    setLoadingAuctions(true);
    try {
      const params = new URLSearchParams();
      for (const key of ["q", "category", "condition", "minPrice", "maxPrice"]) {
        if (filters[key]) {
          params.set(key, filters[key]);
        }
      }
      if (filters.closesSoon) {
        params.set("closesSoon", "true");
      }
      const query = params.toString();
      const result = await apiRequest(
        `/auctions${query ? `?${query}` : ""}`
      );
      setAuctions(result.auctions);
      setAuctionTotal(result.pagination?.total ?? result.auctions.length);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoadingAuctions(false);
    }
  }, [filters]);

  useEffect(() => {
    loadAuctions();
  }, [loadAuctions]);

  useEffect(() => {
    if (!selectedAuctionId) {
      setSelectedAuction(null);
      return undefined;
    }

    let active = true;
    let controller;
    setSelectedAuction(null);
    setLoadingDetail(true);

    const refreshDetail = () => {
      controller?.abort();
      controller = new AbortController();
      apiRequest(`/auctions/${selectedAuctionId}`, {
        signal: controller.signal,
      })
        .then((result) => {
          if (active) {
            setSelectedAuction(result.auction);
            setError("");
          }
        })
        .catch((requestError) => {
          if (active && requestError.name !== "AbortError") {
            setError(requestError.message);
          }
        })
        .finally(() => {
          if (active) {
            setLoadingDetail(false);
          }
        });
    };

    refreshDetail();
    const poll = window.setInterval(refreshDetail, 5000);
    return () => {
      active = false;
      window.clearInterval(poll);
      controller?.abort();
    };
  }, [selectedAuctionId]);

  useEffect(() => {
    setBidError("");
    setBidMessage("");
  }, [selectedAuctionId]);

  async function authenticate(values) {
    setAuthError("");
    try {
      if (authMode === "register") {
        await apiRequest("/auth/register", {
          method: "POST",
          body: values,
        });
      }

      const result = await apiRequest("/auth/login", {
        method: "POST",
        body: { email: values.email, password: values.password },
      });
      const nextAuth = { token: result.token, user: result.user };
      window.localStorage.setItem(
        "campus-auction-auth",
        JSON.stringify(nextAuth)
      );
      setAuth(nextAuth);
      setShowAuth(false);
      setAuthError("");
    } catch (requestError) {
      setAuthError(requestError.message);
    }
  }

  function logout() {
    window.localStorage.removeItem("campus-auction-auth");
    setAuth(null);
  }

  async function createListing(formData) {
    setSaving(true);
    setError("");
    try {
      const result = await apiRequest("/auctions", {
        method: "POST",
        token: auth.token,
        body: formData,
      });
      await loadAuctions();
      setPage("browse");
      setSelectedAuctionId(result.auction.id);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateListing(formData) {
    setSaving(true);
    setError("");
    try {
      const result = await apiRequest(`/auctions/${selectedAuctionId}`, {
        method: "PATCH",
        token: auth.token,
        body: formData,
      });
      setSelectedAuction(result.auction);
      await loadAuctions();
      return true;
    } catch (requestError) {
      setError(requestError.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function cancelListing(reason) {
    setSaving(true);
    setError("");
    try {
      const result = await apiRequest(
        `/auctions/${selectedAuctionId}/cancel`,
        {
          method: "POST",
          token: auth.token,
          body: { reason },
        }
      );
      setSelectedAuction(result.auction);
      await loadAuctions();
      return true;
    } catch (requestError) {
      setError(requestError.message);
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function placeBid(amount) {
    if (!auth) {
      setAuthMode("login");
      setShowAuth(true);
      return false;
    }

    setBidding(true);
    setBidError("");
    setBidMessage("");
    try {
      const result = await apiRequest(
        `/auctions/${selectedAuctionId}/bids`,
        {
          method: "POST",
          token: auth.token,
          body: { amount },
        }
      );
      setBidMessage(result.message);

      try {
        const detail = await apiRequest(`/auctions/${selectedAuctionId}`);
        setSelectedAuction(detail.auction);
      } catch (refreshError) {
        setError(`Bid accepted. ${refreshError.message}`);
      }
      await loadAuctions();
      return true;
    } catch (requestError) {
      setBidError(requestError.message);
      return false;
    } finally {
      setBidding(false);
    }
  }

  function applyFilters(event) {
    event.preventDefault();
    setFilters({ ...draftFilters });
  }

  function resetFilters() {
    const emptyFilters = {
      q: "",
      category: "",
      condition: "",
      minPrice: "",
      maxPrice: "",
      closesSoon: false,
    };
    setDraftFilters(emptyFilters);
    setFilters(emptyFilters);
  }

  function openCreateForm() {
    if (!auth) {
      setAuthMode("login");
      setShowAuth(true);
      return;
    }
    setError("");
    setSelectedAuctionId(null);
    setPage("create");
  }

  function backToBrowse() {
    setSelectedAuctionId(null);
    setSelectedAuction(null);
    setPage("browse");
    setError("");
    loadAuctions();
  }

  const hasActiveFilters = Object.values(filters).some(Boolean);

  const mainContent = page === "create" ? (
    <section className="page-section">
      <button className="back-button" onClick={backToBrowse}>
        ← All auctions
      </button>
      <div className="section-heading">
        <p className="eyebrow">Pass it on</p>
        <h1>List an item</h1>
        <p className="muted">Give useful campus gear a second life.</p>
      </div>
      <AuctionForm
        onSubmit={createListing}
        onCancel={backToBrowse}
        error={error}
        submitting={saving}
      />
    </section>
  ) : selectedAuctionId ? (
    loadingDetail && !selectedAuction ? (
      <section className="page-section"><p className="muted">Loading listing...</p></section>
    ) : selectedAuction ? (
      <AuctionDetail
        auction={selectedAuction}
        user={auth?.user}
        onBack={backToBrowse}
        onEdit={() => setError("")}
        onUpdate={updateListing}
        onCancelListing={cancelListing}
        onPlaceBid={placeBid}
        onSignIn={() => {
          setAuthMode("login");
          setShowAuth(true);
        }}
        saving={saving}
        error={error}
        bidding={bidding}
        bidError={bidError}
        bidMessage={bidMessage}
      />
    ) : (
      <section className="page-section">
        <p className="notice notice-error" role="alert">{error || "Listing not found."}</p>
        <button className="button button-secondary" onClick={backToBrowse}>Back to auctions</button>
      </section>
    )
  ) : (
    <>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">The campus marketplace</p>
          <h1>Good finds.<br /><span>New chapters.</span></h1>
          <p className="hero-description">
            Buy and sell useful things with people in your campus community.
          </p>
          <button className="button button-primary" onClick={openCreateForm}>
            List an item <span aria-hidden="true">↗</span>
          </button>
        </div>
        <div className="hero-note">
          <span className="hero-note-mark">CA</span>
          <p>Make room for what’s next.</p>
          <span className="hero-note-caption">A little more circular, a little more campus.</span>
        </div>
      </section>

      <section className="auction-section">
        <div className="section-heading section-heading-row">
          <div>
            <p className="eyebrow">Fresh on campus</p>
            <h2>{loadingAuctions ? "Loading auctions…" : "Open auctions"}</h2>
          </div>
          <span className="result-count">
            {loadingAuctions ? "Updating listings…" : `${auctionTotal} listings`}
          </span>
        </div>
        <AuctionFilters
          value={draftFilters}
          onChange={setDraftFilters}
          onSubmit={applyFilters}
          onReset={resetFilters}
        />
        {error && auctions.length > 0 && (
          <p className="notice notice-error" role="alert">{error}</p>
        )}
        {loadingAuctions ? (
          <AuctionSkeletons />
        ) : error && auctions.length === 0 ? (
          <div className="empty-state error-state">
            <span className="empty-mark" aria-hidden="true">!</span>
            <h3>We couldn’t load the auctions.</h3>
            <p>Check your connection, then try again.</p>
            <button className="button button-secondary" onClick={loadAuctions}>
              Try again
            </button>
          </div>
        ) : auctions.length === 0 ? (
          <div className="empty-state">
            <span className="empty-mark">+</span>
            <h3>{hasActiveFilters ? "No listings match those filters." : "It’s quiet here for now."}</h3>
            <p>
              {hasActiveFilters
                ? "Try a different search or clear the filters."
                : "Be the first to list something useful for your campus."}
            </p>
            {hasActiveFilters ? (
              <button className="button button-secondary" onClick={resetFilters}>
                Clear filters
              </button>
            ) : (
              <button className="button button-secondary" onClick={openCreateForm}>
                Create a listing
              </button>
            )}
          </div>
        ) : (
          <div className="auction-grid">
            {auctions.map((auction) => (
              <AuctionCard
                key={auction.id}
                auction={auction}
                onSelect={setSelectedAuctionId}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );

  return (
    <div className="app-shell">
      <header className="site-header">
        <button className="brand" onClick={backToBrowse} aria-label="Campus Auction home">
          <span className="brand-mark">C</span>
          <span>campus<span className="brand-light">auction</span></span>
        </button>
        <nav className="header-actions" aria-label="Main navigation">
          <button className="nav-link" onClick={backToBrowse}>Browse</button>
          <button className="button button-small button-outline" onClick={openCreateForm}>
            + Sell an item
          </button>
          {auth ? (
            <div className="user-menu">
              <span className="user-avatar">{auth.user.name.slice(0, 1).toUpperCase()}</span>
              <span className="user-name">{auth.user.name}</span>
              <button className="text-button" onClick={logout}>Sign out</button>
            </div>
          ) : (
            <button
              className="nav-link nav-login"
              onClick={() => {
                setAuthMode("login");
                setShowAuth(true);
              }}
            >
              Sign in
            </button>
          )}
        </nav>
      </header>

      <main>
        {mainContent}
      </main>

      <footer className="site-footer">
        <span>Campus Auction</span>
        <span>Good things, passed along.</span>
      </footer>

      {showAuth && (
        <AuthDialog
          mode={authMode}
          onModeChange={(mode) => {
            setAuthMode(mode);
            setAuthError("");
          }}
          onClose={closeAuthDialog}
          onSubmit={authenticate}
          error={authError}
        />
      )}
    </div>
  );
}

export default App;
