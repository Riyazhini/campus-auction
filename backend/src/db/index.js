
import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.resolve(__dirname, "../../auction.db");
const schemaPath = path.join(__dirname, "schema.sql");

const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const schema = fs.readFileSync(schemaPath, "utf8");
db.exec(schema);

console.log(`SQLite database initialized: ${dbPath}`);

export default db;
