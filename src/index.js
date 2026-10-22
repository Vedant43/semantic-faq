import { config } from "./config.js";
import app from "./app.js";
import { loadModel } from "./model.js";

await loadModel();
app.listen(config.port, () => console.log(`listening on ${config.port}`));
