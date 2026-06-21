import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export function resolveMediaTool(tool: "ffmpeg" | "ffprobe") {
  const configured = process.env[tool === "ffmpeg" ? "FFMPEG_PATH" : "FFPROBE_PATH"];
  if (configured) return configured;

  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    const packageRoot = path.join(
      process.env.LOCALAPPDATA,
      "Microsoft",
      "WinGet",
      "Packages",
      "Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe",
    );
    try {
      const installedVersion = fs.readdirSync(packageRoot, { withFileTypes: true })
        .find((entry) => entry.isDirectory() && entry.name.startsWith("ffmpeg-"));
      if (installedVersion) {
        const executable = path.join(packageRoot, installedVersion.name, "bin", `${tool}.exe`);
        if (fs.existsSync(executable)) return executable;
      }
    } catch {
      // The regular PATH lookup below remains the portable fallback.
    }
  }
  return tool;
}

export function probeDuration(filePath: string, ffprobePath = resolveMediaTool("ffprobe")) {
  return new Promise<number | null>((resolve) => {
    const child = spawn(ffprobePath, [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      filePath,
    ], { windowsHide: true });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk.toString(); });
    child.on("error", () => resolve(null));
    child.on("close", (code) => {
      if (code !== 0) return resolve(null);
      const duration = Number(output.trim());
      resolve(Number.isFinite(duration) && duration > 0 ? duration : null);
    });
  });
}
