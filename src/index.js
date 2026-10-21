import express from "express";
import { PORT } from "./config.js";
import { requireApiKey } from "./middleware/apiKey.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import askRouter from "./routes/ask.js";
import documentsRouter from "./routes/documents.js";

const app = express();
app.use(express.json({ limit: "100kb" }));

app.get("/health", (req, res) => res.json({ status: "ok" }));

app.use("/documents", requireApiKey, documentsRouter);
app.use("/ask", requireApiKey, askRouter);

app.use(notFound);
app.use(errorHandler);

app.listen(PORT, () => console.log(`listening on ${PORT}`));
