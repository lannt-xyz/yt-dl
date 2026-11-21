import clsx from "clsx";
import { ClipboardPaste, Link2, Loader2, Plus } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import type { Job } from "../api/types";
import { extractYoutubeUrl, looksLikeYoutubeUrl } from "../lib/youtube";
import { useJobs } from "../state/jobs";
import { usePlayer } from "../state/player";
import { useToast } from "../state/toast";
import { ConfirmDialog } from "./ConfirmDialog";
import { Card } from "./ui";

const BITRATES = [128, 192, 320] as const;
const BITRATE_KEY = "yt-mp3:bitrate";

function loadBitrate(): number {
  try {
    const v = Number(localStorage.getItem(BITRATE_KEY));
    return (BITRATES as readonly number[]).includes(v) ? v : 192;
  } catch {
    return 192;
  }
}

export function UrlForm() {
  const { submit } = useJobs();
  const toast = useToast();
  const player = usePlayer();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bitrate, setBitrate] = useState(loadBitrate);
  const [duplicate, setDuplicate] = useState<{ url: string; job: Job } | null>(null);

  const pickBitrate = (b: number) => {
    setBitrate(b);
    try {
      localStorage.setItem(BITRATE_KEY, String(b));
    } catch {
      /* private mode */
    }
  };

  const send = useCallback(
    async (raw: string, force = false) => {
      const url = extractYoutubeUrl(raw) ?? raw.trim();
      if (!looksLikeYoutubeUrl(url)) {
        setError("Đây không phải link YouTube. Hãy dán link dạng youtube.com/watch?v=… hoặc youtu.be/…");
        return;
      }
      setBusy(true);
      setError(null);
      const res = await submit(url, { bitrate, force });
      setBusy(false);
      switch (res.kind) {
        case "created":
          setValue("");
          toast.push({ tone: "info", title: "Đã thêm vào hàng đợi", text: "Sẽ báo cho bạn khi tải xong." });
          break;
        case "duplicate":
          setDuplicate({ url, job: res.job });
          break;
        case "already_queued":
          setValue("");
          toast.push({ tone: "info", title: "Video này đang trong hàng đợi" });
          break;
        case "error":
          setError(res.message);
          break;
      }
    },
    [submit, bitrate, toast],
  );

  // Deep-link: /?url=<link> (dùng cho Shortcut/bookmarklet), tự gửi rồi xóa khỏi thanh địa chỉ.
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (deepLinkHandled.current) return;
    deepLinkHandled.current = true;
    const params = new URLSearchParams(window.location.search);
    const shared = params.get("url") ?? params.get("text");
    if (!shared) return;
    window.history.replaceState(null, "", window.location.pathname);
    setValue(shared);
    void send(shared);
  }, [send]);

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void send(value);
  };

  const paste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) return;
      setValue(text.trim());
      if (extractYoutubeUrl(text)) void send(text);
    } catch {
      inputRef.current?.focus();
      setError("Trình duyệt không cho đọc clipboard. Hãy nhấn giữ vào ô nhập và chọn Dán.");
    }
  };

  return (
    <Card className="p-4 sm:p-5">
      <form onSubmit={onSubmit} noValidate>
        <label htmlFor="yt-url" className="text-sm font-semibold">
          Link YouTube
        </label>
        <div
          className={clsx(
            "mt-2 flex items-center gap-1 rounded-xl border bg-surface-2 pr-1 pl-3 focus-within:border-accent",
            error ? "border-bad" : "border-line",
          )}
        >
          <Link2 className="size-5 shrink-0 text-muted" />
          <input
            id="yt-url"
            ref={inputRef}
            type="url"
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            placeholder="Dán link video…"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? "yt-url-error" : undefined}
            className="h-12 min-w-0 flex-1 bg-transparent px-1 outline-none placeholder:text-muted/70"
          />
          <button
            type="button"
            onClick={() => void paste()}
            aria-label="Dán từ clipboard"
            title="Dán từ clipboard"
            className="grid size-11 shrink-0 place-items-center rounded-lg text-muted hover:bg-surface hover:text-ink"
          >
            <ClipboardPaste className="size-5" />
          </button>
        </div>
        {error && (
          <p id="yt-url-error" role="alert" className="mt-2 text-sm text-bad">
            {error}
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div role="radiogroup" aria-label="Chất lượng MP3" className="flex items-center gap-1 rounded-xl bg-surface-2 p-1">
            {BITRATES.map((b) => (
              <button
                key={b}
                type="button"
                role="radio"
                aria-checked={bitrate === b}
                onClick={() => pickBitrate(b)}
                className={clsx(
                  "h-9 rounded-lg px-3 text-sm font-medium tabular-nums transition-colors",
                  bitrate === b ? "bg-surface text-ink shadow-sm" : "text-muted",
                )}
              >
                {b}k
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="flex h-12 min-w-36 flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-5 font-semibold text-accent-ink transition active:scale-[0.98] disabled:opacity-50 sm:flex-none"
          >
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Plus className="size-5" />}
            Thêm vào hàng đợi
          </button>
        </div>
      </form>

      <ConfirmDialog
        open={duplicate !== null}
        title="Video này đã được tải"
        confirmLabel="Tải lại bản mới"
        cancelLabel="Đóng"
        secondary={
          duplicate?.job.has_file
            ? {
                label: "Nghe bản đã tải",
                onClick: () => {
                  if (duplicate) player.toggle(duplicate.job);
                  setDuplicate(null);
                },
              }
            : undefined
        }
        onConfirm={() => {
          const d = duplicate;
          setDuplicate(null);
          if (d) void send(d.url, true);
        }}
        onClose={() => setDuplicate(null)}
      >
        <p className="line-clamp-2 font-medium text-ink">{duplicate?.job.title}</p>
        <p className="mt-1">Bạn muốn nghe lại bản đã có hay tải lại từ đầu?</p>
      </ConfirmDialog>
    </Card>
  );
}
