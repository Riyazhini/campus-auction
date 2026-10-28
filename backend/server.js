
import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath, pathToFileURL } from "url";

import authRouter from "./src/routes/auth.js";
import auctionsRouter from "./src/routes/auctions.js";

export const app = express();
const PORT = process.env.PORT || 3000;

// Resolve paths relative to this server.js file
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json({ limit: "10kb" }));

// Serve uploaded auction photos
app.use(
  "/uploads",
  express.static(path.join(__dirname, "uploads"))
);

app.get("/", (req, res) => {
  res.send("Campus Auction Backend is running!");
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Campus Auction API is running",
  });
});

// Register API routes before starting the server
app.use("/api/auth", authRouter);
app.use("/api/auctions", auctionsRouter);

app.use((error, _req, res, _next) => {
  const status = error.status || (error.name === "MulterError" ? 400 : 500);

  if (status >= 500) {
    console.error("Request error:", error);
  }

  return res.status(status).json({
    message: status >= 500
      ? "An unexpected server error occurred."
      : error.message,
  });
});

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  app.listen(PORT, () => {
    console.log(`Backend running at http://localhost:${PORT}`);
  });
}
