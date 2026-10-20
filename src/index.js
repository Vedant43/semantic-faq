import express from "express";

const app = express();
app.use(express.json());

app.get("/health", (req, res) => res.json({ status: "ok" }));

const port = process.env.PORT || 3000;

app.listen(port, () => console.log(`listening on ${port}`));