import type { Job } from "../api/types";

let n = 0;

export function makeJob(over: Partial<Job> = {}): Job {
  n += 1;
  return {
    id: `job${n}`,
    kind: "download",
    parent_id: null,
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    video_id: "dQw4w9WgXcQ",
    title: "Bài hát thử",
    channel: "Kênh A",
    thumbnail: "https://i.ytimg.com/vi/dQw4w9WgXcQ/mqdefault.jpg",
    duration: 213,
    status: "done",
    progress: 100,
    error_code: null,
    error_message: null,
    file_size: 3_400_000,
    bitrate: 192,
    trim_start: null,
    trim_end: null,
    ytdlp_version: "2026.10.26",
    seen: false,
    created_at: 1_700_000_000 + n,
    started_at: null,
    finished_at: 1_700_000_100 + n,
    has_file: true,
    audio_url: `/api/jobs/job${n}/audio`,
    download_url: `/api/jobs/job${n}/download`,
    ...over,
  };
}
