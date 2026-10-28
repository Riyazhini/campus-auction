
import {
  AUCTION_CATEGORIES,
  ITEM_CONDITIONS,
  MAX_TITLE_LENGTH,
  MAX_DESCRIPTION_LENGTH,
  MIN_CLOSING_DURATION_MS,
  MAX_CLOSING_DURATION_MS,
} from "../constants/auction.js";

export function validateAuction(data, { validateClosingWindow = true } = {}) {
  const errors = {};

  const title =
    typeof data.title === "string" ? data.title.trim() : "";

  const category =
    typeof data.category === "string" ? data.category.trim() : "";

  const description =
    typeof data.description === "string"
      ? data.description.trim()
      : "";

  const condition =
    typeof data.condition === "string"
      ? data.condition.trim().toLowerCase()
      : "";

  const startingPrice = data.starting_price;
  const minIncrement = data.min_increment;
  const closesAt = data.closes_at;

  if (!title) {
    errors.title = "Title is required.";
  } else if (title.length > MAX_TITLE_LENGTH) {
    errors.title = `Title must not exceed ${MAX_TITLE_LENGTH} characters.`;
  }

  if (!AUCTION_CATEGORIES.includes(category)) {
    errors.category = "Please select a valid category.";
  }

  if (!ITEM_CONDITIONS.includes(condition)) {
    errors.condition = "Please select a valid item condition.";
  }

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    errors.description =
      `Description must not exceed ${MAX_DESCRIPTION_LENGTH} characters.`;
  }

  if (
    startingPrice === undefined ||
    startingPrice === null ||
    startingPrice === "" ||
    !Number.isSafeInteger(Number(startingPrice)) ||
    Number(startingPrice) <= 0
  ) {
    errors.starting_price =
      "Starting price must be a positive whole number.";
  }

  if (
    minIncrement === undefined ||
    minIncrement === null ||
    minIncrement === "" ||
    !Number.isSafeInteger(Number(minIncrement)) ||
    Number(minIncrement) <= 0
  ) {
    errors.min_increment =
      "Minimum bid increment must be a positive whole number.";
  }

  let closesAtUtc = null;

  if (typeof closesAt !== "string" || !closesAt.trim()) {
    errors.closes_at = "Closing date and time are required.";
  } else {
    const closingTime = Date.parse(closesAt);
    const now = Date.now();

    if (!Number.isFinite(closingTime)) {
      errors.closes_at = "Please provide a valid closing date and time.";
    } else if (closingTime <= now) {
      errors.closes_at = "Closing time must be in the future.";
    } else if (
      validateClosingWindow &&
      closingTime - now < MIN_CLOSING_DURATION_MS
    ) {
      errors.closes_at =
        "Closing time must be at least 1 hour in the future.";
    } else if (
      validateClosingWindow &&
      closingTime - now > MAX_CLOSING_DURATION_MS
    ) {
      errors.closes_at =
        "Closing time cannot be more than 14 days away.";
    } else {
      closesAtUtc = new Date(closingTime).toISOString();
    }
  }

  return {
    errors,
    value: {
      title,
      category,
      description,
      condition,
      starting_price: Number(startingPrice),
      min_increment: Number(minIncrement),
      closes_at: closesAtUtc,
    },
  };
}
