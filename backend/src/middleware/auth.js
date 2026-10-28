import jwt from "jsonwebtoken";

export function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Authentication token is required."
    });
  }

  const token = authHeader.slice(7);

  if (!token) {
    return res.status(401).json({
      success: false,
      message: "Authentication token is required."
    });
  }

  if (!process.env.JWT_SECRET) {
    return res.status(500).json({
      success: false,
      message: "Authentication is not configured."
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (error, decoded) => {
    if (error) {
      return res.status(401).json({
        success: false,
        message: "Invalid or expired token."
      });
    }

    req.user = { id: decoded.id };
    next();
  });
}

export function authenticateOptionalToken(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ") || !process.env.JWT_SECRET) {
    return next();
  }

  jwt.verify(authHeader.slice(7), process.env.JWT_SECRET, (error, decoded) => {
    if (!error) {
      req.user = { id: decoded.id };
    }
    next();
  });
}
