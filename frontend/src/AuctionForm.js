import { useState } from "react";
import { getUploadUrl } from "./api";
import { AUCTION_CATEGORIES, ITEM_CONDITIONS } from "./auctionOptions";

function toLocalDateTime(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}

function AuctionForm({
  auction,
  onSubmit,
  onCancel,
  error,
  submitting,
  lockedAfterBid = false,
}) {
  const [values, setValues] = useState(() => ({
    title: auction?.title || "",
    category: auction?.category || "",
    description: auction?.description || "",
    condition: auction?.condition || "",
    starting_price: auction?.starting_price || "",
    min_increment: auction?.min_increment || "",
    starts_at: toLocalDateTime(auction?.starts_at),
    closes_at: toLocalDateTime(auction?.closes_at),
  }));
  const [photoIds, setPhotoIds] = useState(
    () => auction?.photos?.map((photo) => photo.id) || []
  );
  const [photos, setPhotos] = useState([]);
  const [dateTimeError, setDateTimeError] = useState("");
  const canEditStartTime = !auction || (
    !lockedAfterBid && Date.parse(auction.starts_at) > Date.now()
  );

  function updateField(event) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
    if (name === "starts_at" || name === "closes_at") {
      setDateTimeError("");
    }
  }

  function togglePhoto(id) {
    setPhotoIds((current) => (
      current.includes(id)
        ? current.filter((photoId) => photoId !== id)
        : [...current, id]
    ));
  }

  function handleSubmit(event) {
    event.preventDefault();
    const formData = new FormData();
    const startsAt = new Date(values.starts_at).getTime();
    const closesAt = new Date(values.closes_at).getTime();
    const closingTimeChanged = !auction ||
      closesAt !== Date.parse(auction.closes_at);
    if (canEditStartTime && (!Number.isFinite(startsAt) || startsAt <= Date.now())) {
      setDateTimeError("Choose an auction start time in the future.");
      return;
    }
    if (
      !lockedAfterBid &&
      closingTimeChanged &&
      (!Number.isFinite(closesAt) ||
        closesAt < Date.now() + 60 * 60 * 1000)
    ) {
      setDateTimeError("Choose a closing time at least one hour from now.");
      return;
    }
    if (Number.isFinite(startsAt) && closesAt <= startsAt) {
      setDateTimeError("The closing time must be after the auction starts.");
      return;
    }

    for (const [key, value] of Object.entries(values)) {
      if (key === "starts_at" || key === "closes_at") {
        continue;
      }
      formData.append(key, value);
    }

    if (canEditStartTime) {
      formData.append("starts_at", new Date(values.starts_at).toISOString());
    }
    if (!lockedAfterBid) {
      formData.append("closes_at", new Date(values.closes_at).toISOString());
    }

    if (auction) {
      formData.append("keep_photo_ids", JSON.stringify(photoIds));
    }
    for (const photo of photos) {
      formData.append("photos", photo);
    }
    onSubmit(formData);
  }

  return (
    <form className="listing-form" onSubmit={handleSubmit}>
      <div className="form-grid">
        <label className="field field-wide">
          Item title
          <input
            name="title"
            value={values.title}
            onChange={updateField}
            maxLength="100"
            placeholder="e.g. Graphing calculator"
            required
          />
        </label>

        <label className="field">
          Category
          <select
            name="category"
            value={values.category}
            onChange={updateField}
            required
          >
            <option value="">Choose category</option>
            {AUCTION_CATEGORIES.map((category) => (
              <option value={category} key={category}>
                {category.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Condition
          <select
            name="condition"
            value={values.condition}
            onChange={updateField}
            required
          >
            <option value="">Choose condition</option>
            {ITEM_CONDITIONS.map((condition) => (
              <option value={condition} key={condition}>
                {condition}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Starting price
          <input
            name="starting_price"
            type="number"
            min="1"
            step="1"
            value={values.starting_price}
            onChange={updateField}
            disabled={lockedAfterBid}
            required
          />
        </label>

        <label className="field">
          Minimum bid increment
          <input
            name="min_increment"
            type="number"
            min="1"
            step="1"
            value={values.min_increment}
            onChange={updateField}
            disabled={lockedAfterBid}
            required
          />
        </label>

        <label className="field">
          Auction starts
          <input
            name="starts_at"
            type="datetime-local"
            value={values.starts_at}
            onChange={updateField}
            min={toLocalDateTime(Date.now())}
            disabled={!canEditStartTime}
            required
          />
        </label>

        <label className="field">
          Auction closes
          <input
            name="closes_at"
            type="datetime-local"
            value={values.closes_at}
            onChange={updateField}
            min={toLocalDateTime(Date.now() + 60 * 60 * 1000)}
            disabled={lockedAfterBid}
            required
          />
        </label>
        {dateTimeError && (
          <p className="notice notice-error field-wide" role="alert">
            {dateTimeError}
          </p>
        )}

        <label className="field field-wide">
          Description
          <textarea
            name="description"
            value={values.description}
            onChange={updateField}
            rows="4"
            maxLength="2000"
            placeholder="Share useful details about the item."
          />
        </label>
      </div>

      {lockedAfterBid && (
        <p className="field-hint lock-note">
          Price, minimum increment, and auction times are locked after the first bid.
        </p>
      )}

      {auction?.photos?.length > 0 && (
        <fieldset className="photo-picker">
          <legend>Keep existing photos</legend>
          <div className="photo-picker-grid">
            {auction.photos.map((photo) => (
              <label className="photo-choice" key={photo.id}>
                <img src={getUploadUrl(photo.url)} alt="" />
                <span>
                  <input
                    type="checkbox"
                    checked={photoIds.includes(photo.id)}
                    onChange={() => togglePhoto(photo.id)}
                  />
                  Keep photo
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <label className="field">
        {auction ? "Add photos" : "Photos"}
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          onChange={(event) => setPhotos(Array.from(event.target.files || []))}
        />
        <span className="field-hint">Up to 5 photos, 3 MB each.</span>
      </label>

      {error && <p className="form-error" role="alert">{error}</p>}

      <div className="form-actions">
        <button className="button button-primary" disabled={submitting}>
          {submitting ? "Saving..." : auction ? "Save changes" : "Publish listing"}
        </button>
        <button
          className="button button-quiet"
          type="button"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

export default AuctionForm;
