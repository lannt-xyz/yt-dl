import type { Job, JobList } from "./types";

export class ApiError extends Error {
  status: number;
  code: string;
  job?: Job;

  constructor(status: number, code: string, message: string, job?: Job) {
    super(message);
    this.status = status;
    this.code = code;
    this.job = job;
  }
}

let unauthorizedHandler: (() => void) | null = null;

/** AuthProvider đăng ký hàm này để quay về màn hình đăng nhập khi phiên hết hạn. */
export function setUnauthorizedHandler(fn: (() => void) | null) {
  unauthorizedHandler = fn;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new ApiError(0, "network", "Không kết nối được tới máy chủ");
  }
  if (res.status === 401 && !path.startsWith("/api/auth/login")) unauthorizedHandler?.();
  if (res.status === 204) return undefined as T;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    /* body không phải JSON */
  }
  if (!res.ok) {
    const detail = (body as { detail?: { code?: string; message?: string; job?: Job } } | null)
      ?.detail;
    throw new ApiError(
      res.status,
      detail?.code ?? "error",
      detail?.message ?? `Lỗi ${res.status}`,
      detail?.job,
    );
  }
  return body as T;
}

export interface CreateJobOptions {
  bitrate?: number;
  force?: boolean;
}

export interface Peaks {
  peaks_per_second: number;
  duration: number | null;
  peaks: number[];
}

export interface TrimBody {
  start: number;
  end: number;
  bitrate?: number;
  fade_in?: number;
  fade_out?: number;
  title?: string;
}

export interface YtdlpStatus {
  version: string;
  source: "venv" | "bundled";
  channel: "stable" | "nightly";
  auto_update: boolean;
  latest: string | null;
  update_available: boolean;
  last_check: number | null;
  last_error: string | null;
  versions: string[];
  previous: string | null;
  updating: boolean;
}

export interface AuthStatus {
  required: boolean;
  authenticated: boolean;
}

export interface ApiToken {
  id: string;
  name: string;
  created_at: number;
  last_used_at: number | null;
}

export interface SystemInfo {
  ytdlp_version: string;
  disk: { total: number; used: number; free: number };
  audio_bytes: number;
  storage: { retention_days: number; max_storage_gb: number; files: number };
  backups: { count: number; latest_age_seconds: number | null };
  auth_enabled: boolean;
}

export const api = {
  listJobs: (limit = 200) => request<JobList>(`/api/jobs?limit=${limit}`),
  createJob: (url: string, opts: CreateJobOptions = {}) =>
    request<Job>("/api/jobs", { method: "POST", body: JSON.stringify({ url, ...opts }) }),
  cancel: (id: string) => request<Job>(`/api/jobs/${id}/cancel`, { method: "POST" }),
  retry: (id: string) => request<Job>(`/api/jobs/${id}/retry`, { method: "POST" }),
  remove: (id: string, deleteFile = true) =>
    request<void>(`/api/jobs/${id}?delete_file=${deleteFile}`, { method: "DELETE" }),
  getPeaks: (id: string) => request<Peaks>(`/api/jobs/${id}/peaks`),
  trim: (id: string, body: TrimBody) =>
    request<Job>(`/api/jobs/${id}/trim`, { method: "POST", body: JSON.stringify(body) }),
  ytdlp: {
    status: () => request<YtdlpStatus>("/api/ytdlp"),
    check: () => request<YtdlpStatus>("/api/ytdlp/check", { method: "POST" }),
    update: (version?: string) =>
      request<{ accepted: boolean }>("/api/ytdlp/update", {
        method: "POST",
        body: JSON.stringify({ version }),
      }),
    rollback: () => request<YtdlpStatus>("/api/ytdlp/rollback", { method: "POST" }),
    settings: (body: { channel?: string; auto_update?: boolean }) =>
      request<YtdlpStatus>("/api/ytdlp/settings", { method: "PUT", body: JSON.stringify(body) }),
  },
  push: {
    key: () => request<{ public_key: string }>("/api/push/key"),
    subscribe: (sub: unknown) =>
      request<{ subscribed: boolean }>("/api/push/subscribe", { method: "POST", body: JSON.stringify(sub) }),
    unsubscribe: (endpoint: string) =>
      request<{ removed: boolean }>("/api/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint }) }),
    status: (endpoint: string) =>
      request<{ subscribed: boolean; devices: number }>("/api/push/status", {
        method: "POST",
        body: JSON.stringify({ endpoint }),
      }),
    test: () => request<{ sent: number }>("/api/push/test", { method: "POST" }),
  },
  auth: {
    status: () => request<AuthStatus>("/api/auth/status"),
    login: (password: string) =>
      request<{ authenticated: boolean }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
    logout: () => request<{ authenticated: boolean }>("/api/auth/logout", { method: "POST" }),
    tokens: () => request<{ items: ApiToken[] }>("/api/auth/tokens"),
    createToken: (name: string) =>
      request<{ id: string; name: string; token: string }>("/api/auth/tokens", {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    revokeToken: (id: string) => request<void>(`/api/auth/tokens/${id}`, { method: "DELETE" }),
  },
  system: {
    info: () => request<SystemInfo>("/api/system"),
    cleanup: () =>
      request<{ removed_files: number; orphan_files: number; freed_bytes: number }>(
        "/api/system/cleanup",
        { method: "POST" },
      ),
  },
  markSeen: () => request<{ updated: number }>("/api/jobs/mark-seen", { method: "POST" }),
};
