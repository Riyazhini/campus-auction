
import db from "./index.js";

const tables = db.prepare(`
  SELECT name
  FROM sqlite_master
  WHERE type = 'table'
    AND name NOT LIKE 'sqlite_%'
  ORDER BY name
`).all();

console.log("Database tables:");
for (const table of tables) {
  console.log(`- ${table.name}`);
}

const foreignKeys = db.pragma("foreign_keys");
console.log("Foreign keys enabled:", foreignKeys[0].foreign_keys === 1);

db.close();
