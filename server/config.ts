import "dotenv/config";
import path from "node:path";

const resolveFromCwd = (value: string) => path.resolve(process.cwd(), value);

export type AppConfig = {
  port: number;
  jwtSecret: string;
  databasePath: string;
  uploadDir: string;
  exportDir: string;
  maxUploadBytes: number;
};

export const config: AppConfig = {
  port: Number(process.env.PORT ?? 8787),
  jwtSecret: process.env.JWT_SECRET ?? "development-only-change-me",
  databasePath: resolveFromCwd(process.env.DATABASE_PATH ?? "./data/cutwise.sqlite"),
  uploadDir: resolveFromCwd(process.env.UPLOAD_DIR ?? "./uploads"),
  exportDir: resolveFromCwd(process.env.EXPORT_DIR ?? "./exports"),
  maxUploadBytes: 5 * 1024 * 1024 * 1024,
};
