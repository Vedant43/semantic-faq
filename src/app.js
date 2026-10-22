import express from "express";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { requireApiKey } from "./middleware/apiKey.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { modelStatus } from "./model.js";
import askRouter from "./routes/ask.js";
import documentsRouter from "./routes/documents.js";

const app = express();
app.use(express.json({ limit: "100kb" }));

app.get("/health", (req, res) => res.json({ status: "ok", model: modelStatus() }));

const askLimiter = rateLimit({
  windowMs: 60_000,
  limit: config.rateLimitPerMinute,
  message: { error: "Too many requests, try again shortly" },
});

app.use("/documents", requireApiKey, documentsRouter);
app.use("/ask", askLimiter, requireApiKey, askRouter);

app.use(notFound);
app.use(errorHandler);

export default app;
