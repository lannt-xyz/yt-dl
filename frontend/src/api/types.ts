export type JobStatus =
  | "queued"
  | "fetching_info"
  | "downloading"
  | "converting"
  | "done"
  | "failed"
  | "cancelled";

export interface Job {
  id: string;
  kind: "download" | "trim";
  parent_id: string | null;
  url: string;
  video_id: string | null;
  title: string | null;
  channel: string | null;
  thumbnail: string | null;
  duration: number | null;
  status: JobStatus;
  progress: number;
  error_code: string | null;
  error_message: string | null;
  file_size: number | null;
  bitrate: number | null;
  trim_start: number | null;
  trim_end: number | null;
  ytdlp_version: string | null;
  seen: boolean;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
  has_file: boolean;
  audio_url: string | null;
  download_url: string | null;
}

export interface JobList {
  items: Job[];
  total: number;
  unseen: number;
}

export const ACTIVE: JobStatus[] = ["queued", "fetching_info", "downloading", "converting"];
export const RUNNING: JobStatus[] = ["fetching_info", "downloading", "converting"];

export const isActive = (s: JobStatus) => ACTIVE.includes(s);
export const isRunning = (s: JobStatus) => RUNNING.includes(s);
