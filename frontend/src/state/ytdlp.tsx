import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ApiError, type YtdlpStatus, api } from "../api/client";
import { useEvent } from "./events";
import { useToast } from "./toast";

interface YtdlpApi {
  status: YtdlpStatus | null;
  busy: boolean;
  check: () => Promise<void>;
  update: (version?: string) => Promise<boolean>;
  rollback: () => Promise<void>;
  configure: (body: { channel?: string; auto_update?: boolean }) => Promise<void>;
  /** Cập nhật yt-dlp rồi thử lại job lỗi; trả về true nếu đã gửi yêu cầu thử lại. */
  updateThenRetry: (jobId: string) => Promise<boolean>;
}

const YtdlpContext = createContext<YtdlpApi | null>(null);
const POLL_MS = 1000;
const MAX_WAIT_MS = 3 * 60 * 1000;

export function YtdlpProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [status, setStatus] = useState<YtdlpStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const statusRef = useRef<YtdlpStatus | null>(null);
  statusRef.current = status;

  const load = useCallback(async () => {
    try {
      setStatus(await api.ytdlp.status());
    } catch {
      /* chưa kết nối được; lần sau thử lại */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEvent("open", () => void load());

  useEvent("ytdlp", (data) => {
    const ev = data as { status: YtdlpStatus; error?: string | null };
    const before = statusRef.current;
    statusRef.current = ev.status; // cập nhật ngay: hai sự kiện liên tiếp có thể tới trước khi React render lại
    setStatus(ev.status);
    if (ev.error) {
      toast.push({ tone: "error", title: "Cập nhật yt-dlp thất bại", text: ev.error });
    } else if (before?.updating && !ev.status.updating && before.version !== ev.status.version) {
      toast.push({ tone: "success", title: "Đã cập nhật yt-dlp", text: `Phiên bản ${ev.status.version}` });
    }
  });

  const guard = useCallback(
    async <T,>(fn: () => Promise<T>, failTitle: string): Promise<T | undefined> => {
      setBusy(true);
      try {
        return await fn();
      } catch (e) {
        toast.push({ tone: "error", title: failTitle, text: e instanceof ApiError ? e.message : undefined });
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast],
  );

  const waitIdle = useCallback(async (): Promise<YtdlpStatus | null> => {
    const deadline = Date.now() + MAX_WAIT_MS;
    while (Date.now() < deadline) {
      const s = await api.ytdlp.status().catch(() => null);
      if (s) {
        setStatus(s);
        if (!s.updating) return s;
      }
      await new Promise((r) => setTimeout(r, POLL_MS));
    }
    return null;
  }, []);

  const value = useMemo<YtdlpApi>(
    () => ({
      status,
      busy,
      check: async () => {
        const s = await guard(() => api.ytdlp.check(), "Không kiểm tra được bản mới");
        if (s) setStatus(s);
      },
      update: async (version) => {
        const res = await guard(() => api.ytdlp.update(version), "Không bắt đầu được cập nhật");
        if (!res) return false;
        await load(); // lấy trạng thái thật (cập nhật có thể đã xong trước khi response này về)
        return true;
      },
      rollback: async () => {
        const s = await guard(() => api.ytdlp.rollback(), "Không quay lại được bản trước");
        if (s) setStatus(s);
      },
      configure: async (body) => {
        const s = await guard(() => api.ytdlp.settings(body), "Không lưu được cài đặt");
        if (s) setStatus(s);
      },
      updateThenRetry: async (jobId) => {
        setBusy(true);
        try {
          await api.ytdlp.check().catch(() => null);
          const before = (await api.ytdlp.status()).version;
          await api.ytdlp.update();
          const after = await waitIdle();
          if (!after) {
            toast.push({ tone: "error", title: "Cập nhật yt-dlp quá lâu", text: "Hãy thử lại sau." });
            return false;
          }
          if (after.version === before) {
            toast.push({ tone: "info", title: "yt-dlp đã là bản mới nhất", text: "Vẫn thử tải lại." });
          }
          await api.retry(jobId);
          return true;
        } catch (e) {
          toast.push({ tone: "error", title: "Không cập nhật được", text: e instanceof ApiError ? e.message : undefined });
          return false;
        } finally {
          setBusy(false);
        }
      },
    }),
    [status, busy, guard, waitIdle, toast, load],
  );

  return <YtdlpContext.Provider value={value}>{children}</YtdlpContext.Provider>;
}

export function useYtdlp(): YtdlpApi {
  const ctx = useContext(YtdlpContext);
  if (!ctx) throw new Error("useYtdlp phải nằm trong YtdlpProvider");
  return ctx;
}
