import { type Job, type JobStatus, isActive } from "../api/types";

export const STEPS = [
  { key: "fetching_info", label: "Lấy thông tin" },
  { key: "downloading", label: "Tải" },
  { key: "converting", label: "Chuyển MP3" },
] as const;

export const STATUS_LABEL: Record<JobStatus, string> = {
  queued: "Đang chờ",
  fetching_info: "Lấy thông tin",
  downloading: "Đang tải",
  converting: "Chuyển MP3",
  done: "Hoàn tất",
  failed: "Lỗi",
  cancelled: "Đã hủy",
};

/** Chỉ số bước hiện tại (0..2); -1 nếu chưa bắt đầu. */
export function stepIndex(status: JobStatus): number {
  return STEPS.findIndex((s) => s.key === status);
}

/** Tiến trình tổng 0..100 từ trạng thái + % của bước hiện tại. */
export function overallProgress(job: Pick<Job, "status" | "progress">): number {
  switch (job.status) {
    case "queued":
      return 0;
    case "fetching_info":
      return 3;
    case "downloading":
      return 5 + job.progress * 0.8;
    case "converting":
      return 85 + job.progress * 0.15;
    case "done":
      return 100;
    default:
      return 0;
  }
}

export function sortJobs(jobs: Iterable<Job>): Job[] {
  return [...jobs].sort((a, b) => b.created_at - a.created_at || b.id.localeCompare(a.id));
}

export function activeJobs(jobs: Job[]): Job[] {
  // đang chạy trước, sau đó theo thứ tự vào hàng đợi (cũ nhất trước)
  return jobs
    .filter((j) => isActive(j.status))
    .sort((a, b) => {
      const ra = a.status === "queued" ? 1 : 0;
      const rb = b.status === "queued" ? 1 : 0;
      return ra - rb || a.created_at - b.created_at;
    });
}

export function matchesQuery(job: Job, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return [job.title, job.channel, job.url].some((v) => v?.toLowerCase().includes(q));
}

export function displayTitle(job: Job): string {
  return job.title ?? (job.video_id ? `youtu.be/${job.video_id}` : job.url);
}

export interface Notice {
  tone: "success" | "error" | "info";
  title: string;
  text?: string;
}

/** Thông báo cần hiện khi job đổi trạng thái (null = không cần thông báo). */
export function transitionNotice(prev: Job | undefined, next: Job): Notice | null {
  if (next.kind !== "download" || isActive(next.status)) return null;
  // Job đã biết thì chỉ báo khi nó vừa chuyển từ "đang chạy" sang kết thúc. Job CHƯA biết mà sự kiện cho thấy
  // đã kết thúc (xong/lỗi rất nhanh nên SSE tới trước phản hồi tạo job, hoặc job do thiết bị khác thêm) vẫn phải báo,
  // nếu không người dùng sẽ không bao giờ biết nó đã xong/lỗi.
  if (prev && !isActive(prev.status)) return null;
  const name = displayTitle(next);
  if (next.status === "done") return { tone: "success", title: "Tải xong", text: name };
  if (next.status === "failed") {
    return { tone: "error", title: "Tải thất bại", text: `${name} — ${next.error_message ?? ""}`.trim() };
  }
  return null; // đã hủy: người dùng tự thao tác nên không cần báo
}

export type JobsState = Record<string, Job>;
export type JobsAction =
  | { type: "replace"; jobs: Job[] }
  | { type: "upsert"; job: Job }
  | { type: "remove"; id: string };

export function jobsReducer(state: JobsState, action: JobsAction): JobsState {
  switch (action.type) {
    case "replace":
      return Object.fromEntries(action.jobs.map((j) => [j.id, j]));
    case "upsert":
      return { ...state, [action.job.id]: action.job };
    case "remove": {
      if (!(action.id in state)) return state;
      const { [action.id]: _removed, ...rest } = state;
      return rest;
    }
  }
}
