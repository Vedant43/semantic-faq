import { config } from "./config.js";
import app from "./app.js";
import { loadModel } from "./model.js";

loadModel().catch((err) => console.error("Model failed to load:", err.message));

app.listen(config.port, () => console.log(`listening on ${config.port}`));
