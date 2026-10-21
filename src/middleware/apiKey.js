import { API_KEY } from "../config.js";

export function requireApiKey(req, res, next) {
  if (!API_KEY || req.get("x-api-key") === API_KEY) return next();
  res.status(401).json({ error: "Missing or invalid API key" });
}
