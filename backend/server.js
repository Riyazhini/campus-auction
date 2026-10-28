
import express from "express";
import cors from "cors";

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("Campus Auction Backend is running!");
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "Campus Auction API is running"
  });
});

app.listen(PORT, () => {
  console.log(`Backend running at http://localhost:${PORT}`);
});
