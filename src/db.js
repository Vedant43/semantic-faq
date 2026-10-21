import pg from "pg";
import { DATABASE_URL } from "./config.js";

export const pool = new pg.Pool({
  connectionString: DATABASE_URL,
});

pool.on("error", (err) => console.error("Idle database client error:", err.message));

export const query = (text, params) => pool.query(text, params);
