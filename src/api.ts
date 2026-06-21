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

type AuthResponse = {
  user: ApiUser;
  token: string;
};

const apiRequest = async <T>(path: string, options: RequestInit = {}, token?: string): Promise<T> => {
  const headers = new Headers(options.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");

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
    const form = new FormData();
    form.append("video", file);
    if (title) form.append("title", title);
    return apiRequest<{ project: ApiProject }>("/api/projects", { method: "POST", body: form, signal }, token);
  },

  deleteProject: (token: string, projectId: string) =>
    apiRequest<void>(`/api/projects/${projectId}`, { method: "DELETE" }, token),

  getProjectMediaUrl: (token: string, projectId: string) =>
    apiRequest<{ url: string }>(`/api/projects/${projectId}/media-access`, { method: "POST" }, token),
};
