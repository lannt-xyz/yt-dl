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
  markSeen: () => request<{ updated: number }>("/api/jobs/mark-seen", { method: "POST" }),
};
