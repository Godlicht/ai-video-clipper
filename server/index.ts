import fs from "node:fs";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { createDatabase } from "./db.js";

fs.mkdirSync(config.uploadDir, { recursive: true });
fs.mkdirSync(config.exportDir, { recursive: true });

const database = createDatabase(config.databasePath);
const app = createApp(database, config);

const server = app.listen(config.port, "127.0.0.1", () => {
  console.log(`Cutwise API: http://127.0.0.1:${config.port}`);
});

const shutdown = () => {
  server.close(() => {
    database.close();
    process.exit(0);
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
