
import express from "express";
import bcrypt from "bcrypt";
import db from "../db/index.js";
import { authenticateToken } from "../middleware/auth.js";
const router = express.Router();

router.post("/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string" ||
      !name.trim() ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and password are required."
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must contain at least 8 characters."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const domain = process.env.CAMPUS_EMAIL_DOMAIN
      ?.trim()
      .toLowerCase();

    if (
      !domain ||
      !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)
    ) {
      return res.status(500).json({
        success: false,
        message: "Campus email domain is not configured correctly."
      });
    }

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(normalizedEmail)) {
      return res.status(400).json({
        success: false,
        message: "Enter a valid email address."
      });
    }

    if (!normalizedEmail.endsWith(`@${domain}`)) {
      return res.status(400).json({
        success: false,
        message: "Use your campus email address."
      });
    }

    const existingUser = db.prepare(
      "SELECT id FROM users WHERE email = ?"
    ).get(normalizedEmail);

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists."
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const result = db.prepare(`
      INSERT INTO users (name, email, password_hash)
      VALUES (?, ?, ?)
    `).run(name.trim(), normalizedEmail, passwordHash);

    return res.status(201).json({
      success: true,
      message: "Registration successful.",
      user: {
        id: Number(result.lastInsertRowid),
        name: name.trim(),
        email: normalizedEmail
      }
    });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists."
      });
    }

    console.error("Registration error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to register at this time."
    });
  }
});

import jwt from "jsonwebtoken";

// Add this route before: export default router;

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (
      typeof email !== "string" ||
      typeof password !== "string" ||
      !email.trim() ||
      !password
    ) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required."
      });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = db.prepare(`
      SELECT id, name, email, password_hash
      FROM users
      WHERE email = ?
    `).get(normalizedEmail);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password."
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordMatches) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password."
      });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({
        success: false,
        message: "Authentication is not configured."
      });
    }

    const token = jwt.sign(
      { id: user.id },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || "1h" }
    );

    return res.status(200).json({
      success: true,
      message: "Login successful.",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      }
    });
  } catch (error) {
    console.error("Login error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Unable to log in at this time."
    });
  }
});

router.get("/me", authenticateToken, (req, res) => {
  const user = db.prepare(`
    SELECT id, name, email, created_at
    FROM users
    WHERE id = ?
  `).get(req.user.id);

  if (!user) {
    return res.status(401).json({
      success: false,
      message: "User account no longer exists."
    });
  }

  return res.status(200).json({
    success: true,
    user
  });
});


export default router;
