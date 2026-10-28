export const API_BASE_URL =
  process.env.REACT_APP_API_URL || "http://localhost:5000/api";

export function getUploadUrl(url) {
  if (!url) {
    return "";
  }

  const apiRoot = API_BASE_URL.replace(/\/api\/?$/, "");
  return /^https?:\/\//i.test(url) ? url : `${apiRoot}${url}`;
}

export async function apiRequest(
  path,
  { token, method = "GET", body, signal } = {}
) {
  const headers = {};
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }

  let requestBody = body;
  if (body && !(body instanceof FormData)) {
    headers["content-type"] = "application/json";
    requestBody = JSON.stringify(body);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: requestBody,
    signal,
  });
  const text = await response.text();
  let payload = {};

  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("The server returned an invalid response.");
    }
  }

  if (!response.ok) {
    throw new Error(payload.message || "The request could not be completed.");
  }

  return payload;
}
