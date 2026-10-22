import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
});

pool.on("error", (err) => console.error("Idle database client error:", err.message));

export const query = (text, params) => pool.query(text, params);
