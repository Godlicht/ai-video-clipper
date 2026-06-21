export type ApiUser = {
  id: string;
  email: string;
  name: string;
};

export type ApiProject = {
  id: string;
  title: string;
  status: string;
  sourceFilename: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds: number | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  mediaUrl: string;
};

export type ApiRenderConfig = {
  ratio: "9:16" | "1:1" | "16:9";
  quality: "720p" | "1080p" | "4K";
  captionsEnabled: boolean;
  trackingEnabled: boolean;
};

export type ApiClip = {
  id: string;
  projectId: string;
  title: string;
  description: string;
  reason: string;
  start: number;
  end: number;
  score: number;
  transcript: string;
  selected: boolean;
  renderConfig: ApiRenderConfig;
};

type AuthResponse = {
  user: ApiUser;
  token: string;
};

const apiRequest = async <T>(path: string, options: RequestInit = {}, token?: string): Promise<T> => {
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData) && !(options.body instanceof Blob)) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, { ...options, headers });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Błąd połączenia z serwerem." }));
    throw new Error(payload.error ?? payload.detail ?? "Błąd połączenia z serwerem.");
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
};

export const api = {
  register: (name: string, email: string, password: string) =>
    apiRequest<AuthResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    }),

  login: (email: string, password: string) =>
    apiRequest<AuthResponse>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  me: (token: string) => apiRequest<{ user: ApiUser }>("/api/auth/me", {}, token),

  listProjects: (token: string) =>
    apiRequest<{ projects: ApiProject[] }>("/api/projects", {}, token),

  createProject: (token: string, file: File, title?: string, signal?: AbortSignal) => {
    const extension = file.name.split(".").pop()?.toLowerCase();
    const inferredMime = extension === "mov"
      ? "video/quicktime"
      : extension === "webm"
        ? "video/webm"
        : "video/mp4";
    const headers: Record<string, string> = {
      "X-Filename": encodeURIComponent(file.name),
      "X-Mime-Type": inferredMime,
    };
    if (title) headers["X-Project-Title"] = encodeURIComponent(title);
    return apiRequest<{ project: ApiProject }>("/api/projects", {
      method: "POST",
      body: file,
      headers,
      signal,
    }, token);
  },

  deleteProject: (token: string, projectId: string) =>
    apiRequest<void>(`/api/projects/${projectId}`, { method: "DELETE" }, token),

  getProjectMediaUrl: (token: string, projectId: string) =>
    apiRequest<{ url: string }>(`/api/projects/${projectId}/media-access`, { method: "POST" }, token),

  analyzeProject: (token: string, projectId: string) =>
    apiRequest<{ clips: ApiClip[] }>(`/api/projects/${projectId}/analysis`, { method: "POST" }, token),

  listClips: (token: string, projectId: string) =>
    apiRequest<{ clips: ApiClip[] }>(`/api/projects/${projectId}/clips`, {}, token),

  updateClip: (token: string, clip: ApiClip) =>
    apiRequest<{ clip: ApiClip }>(`/api/clips/${clip.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        title: clip.title,
        startSeconds: clip.start,
        endSeconds: clip.end,
        selected: clip.selected,
        renderConfig: clip.renderConfig,
      }),
    }, token),

  exportClip: (token: string, clip: ApiClip) =>
    apiRequest<{ export: { id: string; status: string; downloadUrl: string } }>(
      `/api/clips/${clip.id}/exports`,
      {
        method: "POST",
        body: JSON.stringify({
          startSeconds: clip.start,
          endSeconds: clip.end,
          renderConfig: clip.renderConfig,
        }),
      },
      token,
    ),

  downloadExport: async (token: string, downloadUrl: string) => {
    const response = await fetch(downloadUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) throw new Error("Nie udało się pobrać wyrenderowanego klipu.");
    return response.blob();
  },
};
