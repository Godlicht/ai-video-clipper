import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import type { AppConfig } from "./config.js";
import { createDatabase, type CutwiseDatabase } from "./db.js";

describe("Cutwise API", () => {
  let tempDir: string;
  let database: CutwiseDatabase;
  let app: ReturnType<typeof createApp>;
  let appConfig: AppConfig;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "cutwise-api-"));
    appConfig = {
      port: 0,
      jwtSecret: "test-secret-with-enough-entropy",
      databasePath: ":memory:",
      uploadDir: path.join(tempDir, "uploads"),
      exportDir: path.join(tempDir, "exports"),
      maxUploadBytes: 1024 * 1024,
    };
    database = createDatabase(appConfig.databasePath);
    app = createApp(database, appConfig);
  });

  afterEach(() => {
    database.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const register = async (email = "jakub@example.com") => {
    const response = await request(app)
      .post("/api/auth/register")
      .send({ name: "Jakub", email, password: "bezpieczne-haslo" })
      .expect(201);
    return response.body.token as string;
  };

  it("rejestruje użytkownika, loguje go i zwraca profil", async () => {
    const token = await register();

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "JAKUB@example.com", password: "bezpieczne-haslo" })
      .expect(200);
    expect(login.body.token).toEqual(expect.any(String));

    const profile = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(profile.body.user).toMatchObject({ name: "Jakub", email: "jakub@example.com" });
  });

  it("odrzuca duplikat konta i nieprawidłowe logowanie", async () => {
    await register();

    await request(app)
      .post("/api/auth/register")
      .send({ name: "Drugi", email: "jakub@example.com", password: "inne-haslo" })
      .expect(409);
    await request(app)
      .post("/api/auth/login")
      .send({ email: "jakub@example.com", password: "zle-haslo" })
      .expect(401);
  });

  it("trwale zapisuje upload projektu i pozwala go usunąć", async () => {
    const token = await register();
    const created = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${token}`)
      .field("title", "Mój podcast")
      .attach("video", Buffer.from("fake-video"), { filename: "podcast.mp4", contentType: "video/mp4" })
      .expect(201);

    expect(created.body.project).toMatchObject({
      title: "Mój podcast",
      sourceFilename: "podcast.mp4",
      status: "uploaded_unverified",
    });
    expect(fs.readdirSync(appConfig.uploadDir)).toHaveLength(1);

    const list = await request(app)
      .get("/api/projects")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);
    expect(list.body.projects).toHaveLength(1);

    await request(app)
      .delete(`/api/projects/${created.body.project.id}`)
      .set("Authorization", `Bearer ${token}`)
      .expect(204);
    expect(fs.readdirSync(appConfig.uploadDir)).toHaveLength(0);
  });

  it("izoluje projekty między kontami", async () => {
    const firstToken = await register("first@example.com");
    const secondToken = await register("second@example.com");

    const created = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${firstToken}`)
      .attach("video", Buffer.from("fake-video"), { filename: "private.webm", contentType: "video/webm" })
      .expect(201);

    await request(app)
      .get(`/api/projects/${created.body.project.id}`)
      .set("Authorization", `Bearer ${secondToken}`)
      .expect(404);
    await request(app)
      .get(`/api/projects/${created.body.project.id}/media`)
      .set("Authorization", `Bearer ${secondToken}`)
      .expect(404);
  });

  it("odrzuca upload bez sesji i nieobsługiwany format", async () => {
    await request(app)
      .post("/api/projects")
      .attach("video", Buffer.from("fake-video"), { filename: "video.mp4", contentType: "video/mp4" })
      .expect(401);

    const token = await register();
    const response = await request(app)
      .post("/api/projects")
      .set("Authorization", `Bearer ${token}`)
      .attach("video", Buffer.from("text"), { filename: "notes.txt", contentType: "text/plain" })
      .expect(400);
    expect(response.body.error).toMatch(/MP4, MOV i WebM/);
  });
});
