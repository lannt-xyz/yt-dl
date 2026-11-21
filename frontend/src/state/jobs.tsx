import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { ApiError, type CreateJobOptions, api } from "../api/client";
import type { Job } from "../api/types";
import { jobsReducer, sortJobs, transitionNotice } from "../lib/jobs";
import { useEvent, useEvents } from "./events";
import { useToast } from "./toast";

export type SubmitResult =
  | { kind: "created"; job: Job }
  | { kind: "duplicate"; job: Job }
  | { kind: "already_queued"; job: Job }
  | { kind: "error"; message: string };

interface JobsApi {
  jobs: Job[];
  loaded: boolean;
  online: boolean;
  unseen: number;
  submit: (url: string, opts?: CreateJobOptions) => Promise<SubmitResult>;
  cancel: (id: string) => Promise<void>;
  retry: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  markSeen: () => Promise<void>;
  refresh: () => Promise<void>;
}

const JobsContext = createContext<JobsApi | null>(null);

export function JobsProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [state, dispatch] = useReducer(jobsReducer, {});
  const [loaded, setLoaded] = useState(false);
  const { online } = useEvents();
  const stateRef = useRef(state);
  stateRef.current = state;

  const upsert = useCallback(
    (job: Job) => {
      const notice = transitionNotice(stateRef.current[job.id], job);
      if (notice) toast.push(notice);
      dispatch({ type: "upsert", job });
    },
    [toast],
  );

  const refresh = useCallback(async () => {
    try {
      const res = await api.listJobs();
      dispatch({ type: "replace", jobs: res.items });
      setLoaded(true);
    } catch {
      /* giữ nguyên dữ liệu cũ; trạng thái mạng do SSE quản lý */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  // (kết nối lại) SSE → đồng bộ lại để không lỡ sự kiện
  useEvent("open", () => void refresh());
  useEvent("job", (data) => upsert((data as { job: Job }).job));
  useEvent("deleted", (data) => dispatch({ type: "remove", id: (data as { id: string }).id }));

  const jobs = useMemo(() => sortJobs(Object.values(state)), [state]);
  const unseen = useMemo(
    () => jobs.filter((j) => !j.seen && ["done", "failed", "cancelled"].includes(j.status)).length,
    [jobs],
  );

  const submit = useCallback<JobsApi["submit"]>(
    async (url, opts) => {
      try {
        const job = await api.createJob(url, opts);
        // job nhanh có thể đã xong và được SSE báo trước khi response POST về → đừng ghi đè bằng bản cũ
        if (!stateRef.current[job.id]) upsert(job);
        return { kind: "created", job };
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.code === "duplicate" && e.job) return { kind: "duplicate", job: e.job };
          if (e.code === "already_queued" && e.job) return { kind: "already_queued", job: e.job };
          return { kind: "error", message: e.message };
        }
        return { kind: "error", message: "Có lỗi không xác định" };
      }
    },
    [upsert],
  );

  const guarded = useCallback(
    (fn: (id: string) => Promise<Job | void>) => async (id: string) => {
      try {
        const res = await fn(id);
        if (res) upsert(res);
      } catch (e) {
        toast.push({
          tone: "error",
          title: "Thao tác thất bại",
          text: e instanceof ApiError ? e.message : undefined,
        });
        void refresh();
      }
    },
    [toast, upsert, refresh],
  );

  const value = useMemo<JobsApi>(
    () => ({
      jobs,
      loaded,
      online,
      unseen,
      submit,
      cancel: guarded((id) => api.cancel(id)),
      retry: guarded((id) => api.retry(id)),
      remove: guarded(async (id) => {
        await api.remove(id);
        dispatch({ type: "remove", id });
      }),
      markSeen: async () => {
        await api.markSeen().catch(() => undefined);
        await refresh();
      },
      refresh,
    }),
    [jobs, loaded, online, unseen, submit, guarded, refresh],
  );

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}

export function useJobs(): JobsApi {
  const ctx = useContext(JobsContext);
  if (!ctx) throw new Error("useJobs phải nằm trong JobsProvider");
  return ctx;
}
