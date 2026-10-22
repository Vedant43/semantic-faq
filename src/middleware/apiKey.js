import { config } from "../config.js";

export function requireApiKey(req, res, next) {
  if (!config.apiKey || req.get("x-api-key") === config.apiKey) return next();
  
  res.status(401).json({ error: "Missing or invalid API key" });
}
