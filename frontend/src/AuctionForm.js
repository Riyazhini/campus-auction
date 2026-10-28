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

function getClosingParts(value) {
  const [date = "", time = ""] = value.split("T");
  const [rawHour = "00", minute = "00"] = time.split(":");
  const hour = Number(rawHour);
  return {
    date,
    hour: String(hour % 12 || 12),
    minute,
    period: hour >= 12 ? "PM" : "AM",
  };
}

function toLocalDateTimeValue({ date, hour, minute, period }) {
  const hour24 = (Number(hour) % 12) + (period === "PM" ? 12 : 0);
  return `${date}T${String(hour24).padStart(2, "0")}:${minute}`;
}

function AuctionForm({
  auction,
  onSubmit,
  onCancel,
  error,
  submitting,
  lockedAfterBid = false,
}) {
  const initialClosing = toLocalDateTime(auction?.closes_at);
  const [closingParts, setClosingParts] = useState(
    () => getClosingParts(initialClosing)
  );
  const [values, setValues] = useState(() => ({
    title: auction?.title || "",
    category: auction?.category || "",
    description: auction?.description || "",
    condition: auction?.condition || "",
    starting_price: auction?.starting_price || "",
    min_increment: auction?.min_increment || "",
    closes_at: initialClosing,
  }));
  const [photoIds, setPhotoIds] = useState(
    () => auction?.photos?.map((photo) => photo.id) || []
  );
  const [photos, setPhotos] = useState([]);
  const [closingError, setClosingError] = useState("");

  function updateField(event) {
    const { name, value } = event.target;
    setValues((current) => ({ ...current, [name]: value }));
  }

  function updateClosingPart(event) {
    const { name, value } = event.target;
    setClosingParts((current) => ({ ...current, [name]: value }));
    setClosingError("");
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
    const closingValue = toLocalDateTimeValue(closingParts);
    if (
      !(auction && lockedAfterBid) &&
      new Date(closingValue).getTime() < Date.now() + 60 * 60 * 1000
    ) {
      setClosingError("Choose a closing time at least one hour from now.");
      return;
    }

    for (const [key, value] of Object.entries(values)) {
      if (key === "closes_at") {
        continue;
      }
      formData.append(key, value);
    }

    if (!(auction && lockedAfterBid)) {
      formData.append("closes_at", new Date(closingValue).toISOString());
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
          Closing date
          <input
            name="date"
            type="date"
            value={closingParts.date}
            onChange={updateClosingPart}
            min={toLocalDateTime(Date.now() + 60 * 60 * 1000).slice(0, 10)}
            disabled={lockedAfterBid}
            required
          />
        </label>

        <fieldset className="field field-wide closing-time-fieldset">
          <legend>Closing time</legend>
          <div className="closing-time-grid">
            <label className="field">
              Hour
              <select
                name="hour"
                value={closingParts.hour}
                onChange={updateClosingPart}
                disabled={lockedAfterBid}
                required
              >
                {Array.from({ length: 12 }, (_, index) =>
                  String(index + 1)
                ).map((hour) => (
                  <option value={hour} key={hour}>{hour}</option>
                ))}
              </select>
            </label>
            <label className="field">
              Minute
              <select
                name="minute"
                value={closingParts.minute}
                onChange={updateClosingPart}
                disabled={lockedAfterBid}
                required
              >
                {Array.from({ length: 60 }, (_, minute) =>
                  String(minute).padStart(2, "0")
                ).map((minute) => (
                  <option value={minute} key={minute}>{minute}</option>
                ))}
              </select>
            </label>
            <label className="field">
              AM/PM
              <select
                name="period"
                value={closingParts.period}
                onChange={updateClosingPart}
                disabled={lockedAfterBid}
                required
              >
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </label>
          </div>
        </fieldset>
        {closingError && (
          <p className="notice notice-error field-wide" role="alert">
            {closingError}
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
          Price, minimum increment, and closing time are locked after the first bid.
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
