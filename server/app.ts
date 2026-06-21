import bcrypt from "bcryptjs";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import fs from "node:fs";
import multer from "multer";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { AuthenticatedRequest } from "./auth.js";
import { authRequired, signToken } from "./auth.js";
import type { AppConfig } from "./config.js";
import type { CutwiseDatabase } from "./db.js";
import { probeDuration } from "./media.js";

const credentialsSchema = z.object({
  email: z.string().email().max(254).transform((value) => value.trim().toLowerCase()),
  password: z.string().min(8).max(128),
});

const registerSchema = credentialsSchema.extend({
  name: z.string().trim().min(2).max(80),
});

const allowedMimeTypes = new Set(["video/mp4", "video/quicktime", "video/webm"]);
const allowedExtensions = new Set([".mp4", ".mov", ".webm"]);

type ProjectRow = {
  id: string;
  user_id: string;
  title: string;
  status: string;
  source_filename: string;
  mime_type: string;
  size_bytes: number;
  duration_seconds: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

const serializeProject = (project: ProjectRow) => ({
  id: project.id,
  title: project.title,
  status: project.status,
  sourceFilename: project.source_filename,
  mimeType: project.mime_type,
  sizeBytes: project.size_bytes,
  durationSeconds: project.duration_seconds,
  errorMessage: project.error_message,
  createdAt: project.created_at,
  updatedAt: project.updated_at,
  mediaUrl: `/api/projects/${project.id}/media`,
});

export function createApp(db: CutwiseDatabase, appConfig: AppConfig) {
  fs.mkdirSync(appConfig.uploadDir, { recursive: true });
  fs.mkdirSync(appConfig.exportDir, { recursive: true });

  const upload = multer({
    storage: multer.diskStorage({
      destination: (_request, _file, callback) => callback(null, appConfig.uploadDir),
      filename: (_request, file, callback) => {
        const extension = path.extname(file.originalname).toLowerCase();
        callback(null, `${randomUUID()}${extension}`);
      },
    }),
    limits: { fileSize: appConfig.maxUploadBytes, files: 1 },
    fileFilter: (_request, file, callback) => {
      const extension = path.extname(file.originalname).toLowerCase();
      if (!allowedMimeTypes.has(file.mimetype) || !allowedExtensions.has(extension)) {
        return callback(new Error("Dozwolone są wyłącznie pliki MP4, MOV i WebM."));
      }
      callback(null, true);
    },
  });

  const app = express();
  app.disable("x-powered-by");
  app.use(cors({ origin: true, credentials: false }));
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_request, response) => {
    response.json({ status: "ok", database: "ready" });
  });

  app.post("/api/auth/register", async (request, response) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Podaj poprawne imię, e-mail i hasło (minimum 8 znaków)." });

    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(parsed.data.email);
    if (existing) return response.status(409).json({ error: "Konto z tym adresem e-mail już istnieje." });

    const user = {
      id: randomUUID(),
      email: parsed.data.email,
      name: parsed.data.name,
    };
    const passwordHash = await bcrypt.hash(parsed.data.password, 12);
    db.prepare(`
      INSERT INTO users (id, email, name, password_hash, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(user.id, user.email, user.name, passwordHash, new Date().toISOString());

    response.status(201).json({ user, token: signToken(user, appConfig.jwtSecret) });
  });

  app.post("/api/auth/login", async (request, response) => {
    const parsed = credentialsSchema.safeParse(request.body);
    if (!parsed.success) return response.status(400).json({ error: "Podaj poprawny e-mail i hasło." });

    const row = db.prepare(`
      SELECT id, email, name, password_hash
      FROM users WHERE email = ?
    `).get(parsed.data.email) as { id: string; email: string; name: string; password_hash: string } | undefined;
    if (!row || !(await bcrypt.compare(parsed.data.password, row.password_hash))) {
      return response.status(401).json({ error: "Nieprawidłowy e-mail lub hasło." });
    }

    const user = { id: row.id, email: row.email, name: row.name };
    response.json({ user, token: signToken(user, appConfig.jwtSecret) });
  });

  const requireAuth = authRequired(appConfig.jwtSecret);

  app.get("/api/auth/me", requireAuth, (request: AuthenticatedRequest, response) => {
    response.json({ user: request.user });
  });

  app.get("/api/projects", requireAuth, (request: AuthenticatedRequest, response) => {
    const projects = db.prepare(`
      SELECT id, user_id, title, status, source_filename, mime_type, size_bytes,
             duration_seconds, error_message, created_at, updated_at
      FROM projects WHERE user_id = ? ORDER BY created_at DESC
    `).all(request.user!.id) as ProjectRow[];
    response.json({ projects: projects.map(serializeProject) });
  });

  app.get("/api/projects/:id", requireAuth, (request: AuthenticatedRequest, response) => {
    const project = db.prepare(`
      SELECT id, user_id, title, status, source_filename, mime_type, size_bytes,
             duration_seconds, error_message, created_at, updated_at
      FROM projects WHERE id = ? AND user_id = ?
    `).get(request.params.id, request.user!.id) as ProjectRow | undefined;
    if (!project) return response.status(404).json({ error: "Projekt nie istnieje." });
    response.json({ project: serializeProject(project) });
  });

  app.post(
    "/api/projects",
    requireAuth,
    upload.single("video"),
    async (request: AuthenticatedRequest, response) => {
      if (!request.file) return response.status(400).json({ error: "Wybierz plik wideo." });

      const now = new Date().toISOString();
      const id = randomUUID();
      const title = typeof request.body.title === "string" && request.body.title.trim()
        ? request.body.title.trim().slice(0, 160)
        : path.parse(request.file.originalname).name.slice(0, 160);
      const duration = await probeDuration(request.file.path);
      const status = duration ? "uploaded" : "uploaded_unverified";

      db.prepare(`
        INSERT INTO projects (
          id, user_id, title, status, source_filename, source_path, mime_type,
          size_bytes, duration_seconds, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        request.user!.id,
        title,
        status,
        request.file.originalname,
        request.file.path,
        request.file.mimetype,
        request.file.size,
        duration,
        now,
        now,
      );

      const project = db.prepare(`
        SELECT id, user_id, title, status, source_filename, mime_type, size_bytes,
               duration_seconds, error_message, created_at, updated_at
        FROM projects WHERE id = ?
      `).get(id) as ProjectRow;
      response.status(201).json({ project: serializeProject(project) });
    },
  );

  app.get("/api/projects/:id/media", requireAuth, (request: AuthenticatedRequest, response) => {
    const project = db.prepare(`
      SELECT source_path, source_filename, mime_type
      FROM projects WHERE id = ? AND user_id = ?
    `).get(request.params.id, request.user!.id) as {
      source_path: string;
      source_filename: string;
      mime_type: string;
    } | undefined;
    if (!project || !fs.existsSync(project.source_path)) return response.status(404).json({ error: "Plik projektu nie istnieje." });
    response.type(project.mime_type);
    response.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(project.source_filename)}"`);
    response.sendFile(path.resolve(project.source_path));
  });

  app.delete("/api/projects/:id", requireAuth, (request: AuthenticatedRequest, response) => {
    const project = db.prepare(`
      SELECT source_path FROM projects WHERE id = ? AND user_id = ?
    `).get(request.params.id, request.user!.id) as { source_path: string } | undefined;
    if (!project) return response.status(404).json({ error: "Projekt nie istnieje." });

    db.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").run(request.params.id, request.user!.id);
    fs.rmSync(project.source_path, { force: true });
    response.status(204).end();
  });

  app.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
    void next;
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      return response.status(413).json({ error: "Plik przekracza limit 5 GB." });
    }
    const message = error instanceof Error ? error.message : "Nieoczekiwany błąd serwera.";
    response.status(400).json({ error: message });
  });

  return app;
}
