export function notFound(req, res) {
  res.status(404).json({ error: "Not found" });
}

export function errorHandler(err, req, res, next) {
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Malformed JSON body" });
  }

  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Request body too large" });
  }

  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}
