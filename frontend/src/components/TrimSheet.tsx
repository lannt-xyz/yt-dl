import clsx from "clsx";
import {
  Loader2,
  Pause,
  Play,
  Repeat,
  Scissors,
  Undo2,
  X,
  ZoomIn,
} from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { ApiError, type Peaks, api } from "../api/client";
import type { Job } from "../api/types";
import { displayTitle } from "../lib/jobs";
import {
  FADE_OPTIONS,
  type Range,
  formatTimeMs,
  maxFade,
  nudge,
  parseTimeInput,
  setEnd,
  setStart,
  viewFor,
} from "../lib/trim";
import { useJobs } from "../state/jobs";
import { usePlayer } from "../state/player";
import { useToast } from "../state/toast";
import { Waveform } from "./Waveform";
import { Chip, IconButton } from "./ui";

const BITRATES = [128, 192, 320] as const;

type PeaksState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: Peaks; duration: number };

export function TrimSheet({ job, onClose }: { job: Job; onClose: () => void }) {
  const toast = useToast();
  const player = usePlayer();
  const { refresh } = useJobs();

  const [peaks, setPeaks] = useState<PeaksState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [range, setRange] = useState<Range>({ start: 0, end: 0 });
  const [undo, setUndo] = useState<Range[]>([]);
  const committed = useRef<Range>({ start: 0, end: 0 });
  const [zoomed, setZoomed] = useState(false);
  const [fadeIn, setFadeIn] = useState(0);
  const [fadeOut, setFadeOut] = useState(0);
  const [bitrate, setBitrate] = useState<number>(
    job.bitrate && (BITRATES as readonly number[]).includes(job.bitrate) ? job.bitrate : 192,
  );
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ---- tải waveform ----
  useEffect(() => {
    let alive = true;
    setPeaks({ status: "loading" });
    api
      .getPeaks(job.id)
      .then((data) => {
        if (!alive) return;
        const duration = data.duration ?? job.duration ?? data.peaks.length / data.peaks_per_second;
        const full = { start: 0, end: duration };
        committed.current = full;
        setRange(full);
        setUndo([]);
        setPeaks({ status: "ready", data, duration });
      })
      .catch((e: unknown) => {
        if (alive) {
          setPeaks({ status: "error", message: e instanceof ApiError ? e.message : "Không tải được waveform" });
        }
      });
    return () => {
      alive = false;
    };
  }, [job.id, job.duration, attempt]);

  // ---- audio riêng của màn hình trim ----
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const previewing = useRef(false);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);

  useEffect(() => {
    player.pause(); // tránh hai nguồn phát cùng lúc
    const audio = new Audio();
    audio.preload = "auto";
    audio.src = job.audio_url ?? "";
    audioRef.current = audio;
    audio.addEventListener("play", () => setPlaying(true));
    audio.addEventListener("pause", () => setPlaying(false));
    audio.addEventListener("ended", () => {
      setPlaying(false);
      previewing.current = false;
    });
    let raf = 0;
    const tick = () => {
      setPlayhead(audio.currentTime);
      if (previewing.current && audio.currentTime >= rangeRef.current.end) {
        audio.pause();
        previewing.current = false;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      audioRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.audio_url]);

  const seek = useCallback((t: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = t;
    setPlayhead(t);
  }, []);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    previewing.current = false;
    if (audio.paused) void audio.play();
    else audio.pause();
  }, []);

  const playSelection = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    previewing.current = true;
    audio.currentTime = rangeRef.current.start;
    void audio.play();
  }, []);

  // ---- chỉnh khoảng cắt (có Undo) ----
  const onRangeChange = useCallback((next: Range, commit: boolean) => {
    setRange(next);
    if (commit) {
      const prev = committed.current;
      if (prev.start !== next.start || prev.end !== next.end) {
        setUndo((u) => [...u.slice(-49), prev]);
        committed.current = next;
      }
    }
  }, []);

  const doUndo = () => {
    setUndo((u) => {
      const prev = u.at(-1);
      if (prev) {
        committed.current = prev;
        setRange(prev);
      }
      return u.slice(0, -1);
    });
  };

  const duration = peaks.status === "ready" ? peaks.duration : 0;

  // ---- phím tắt (desktop) ----
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Escape") onClose();
      else if (e.key === " " && tag !== "BUTTON") {
        e.preventDefault();
        togglePlay();
      } else if (e.key.toLowerCase() === "i" && duration) {
        onRangeChange(setStart(rangeRef.current, audioRef.current?.currentTime ?? 0, duration), true);
      } else if (e.key.toLowerCase() === "o" && duration) {
        onRangeChange(setEnd(rangeRef.current, audioRef.current?.currentTime ?? 0, duration), true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [duration, onClose, onRangeChange, togglePlay]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // fade không được vượt quá nửa đoạn cắt
  const fadeCap = maxFade(range);
  const effFadeIn = Math.min(fadeIn, fadeCap);
  const effFadeOut = Math.min(fadeOut, fadeCap);

  const save = async () => {
    if (peaks.status !== "ready") return;
    setSaving(true);
    setError(null);
    try {
      const child = await api.trim(job.id, {
        start: Number(range.start.toFixed(3)),
        end: Number(range.end.toFixed(3)),
        bitrate,
        fade_in: effFadeIn,
        fade_out: effFadeOut,
        title: title.trim() || undefined,
      });
      await refresh();
      toast.push(
        { tone: "success", title: "Đã lưu bản cắt", text: displayTitle(child) },
        { label: "Phát", onClick: () => player.toggle(child) },
      );
      onClose();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Không cắt được, thử lại sau");
    } finally {
      setSaving(false);
    }
  };

  const length = range.end - range.start;
  const view = peaks.status === "ready" ? viewFor(range, peaks.duration, zoomed) : { from: 0, to: 1 };

  return (
    <div className="fixed inset-0 z-40 flex md:items-center md:justify-center">
      <button
        type="button"
        aria-label="Đóng"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 hidden bg-black/50 md:block"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="trim-title"
        className="toast-in relative flex h-full w-full flex-col bg-bg md:h-auto md:max-h-[92dvh] md:max-w-3xl md:overflow-hidden md:rounded-3xl md:border md:border-line md:shadow-2xl"
      >
        <header className="safe-top flex items-center gap-2 border-b border-line px-3 py-2">
          <IconButton label="Đóng" onClick={onClose}>
            <X className="size-5" />
          </IconButton>
          <div className="min-w-0 flex-1">
            <h2 id="trim-title" className="flex items-center gap-1.5 text-base font-semibold">
              <Scissors className="size-4 text-accent" /> Cắt audio
            </h2>
            <p className="truncate text-xs text-muted">{displayTitle(job)}</p>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {peaks.status === "loading" && (
            <div role="status" className="grid h-44 place-items-center rounded-2xl border border-line bg-surface text-sm text-muted">
              <span className="flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" /> Đang dựng waveform…
              </span>
            </div>
          )}
          {peaks.status === "error" && (
            <div role="alert" className="grid h-44 place-items-center gap-2 rounded-2xl border border-bad/40 bg-bad/10 p-4 text-center text-sm text-bad">
              <p>{peaks.message}</p>
              <button type="button" onClick={() => setAttempt((n) => n + 1)} className="h-10 rounded-lg bg-bad px-4 font-semibold text-white">
                Thử lại
              </button>
            </div>
          )}

          {peaks.status === "ready" && (
            <div className="flex flex-col gap-5">
              <div>
                <Waveform
                  peaks={peaks.data.peaks}
                  peaksPerSecond={peaks.data.peaks_per_second}
                  duration={peaks.duration}
                  range={range}
                  view={view}
                  playhead={playhead}
                  onChange={onRangeChange}
                  onSeek={seek}
                />
                <div className="mt-1.5 flex justify-between px-1 text-xs text-muted tabular-nums">
                  <span>{formatTimeMs(view.from)}</span>
                  <span>{formatTimeMs((view.from + view.to) / 2)}</span>
                  <span>{formatTimeMs(view.to)}</span>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={togglePlay}
                  className="flex h-12 items-center gap-2 rounded-xl bg-accent px-5 font-semibold text-accent-ink"
                >
                  {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
                  {playing ? "Tạm dừng" : "Phát"}
                </button>
                <button
                  type="button"
                  onClick={playSelection}
                  className="flex h-12 items-center gap-2 rounded-xl bg-accent-soft px-4 font-semibold text-accent"
                >
                  <Repeat className="size-4" /> Nghe thử đoạn chọn
                </button>
                <div className="ml-auto flex items-center gap-1">
                  <IconButton label={zoomed ? "Xem toàn bài" : "Phóng to đoạn chọn"} tone={zoomed ? "accent" : "default"} aria-pressed={zoomed} onClick={() => setZoomed((z) => !z)}>
                    <ZoomIn className="size-5" />
                  </IconButton>
                  <IconButton label="Hoàn tác" onClick={doUndo} disabled={undo.length === 0}>
                    <Undo2 className="size-5" />
                  </IconButton>
                </div>
                <p className="w-full text-sm text-muted tabular-nums" aria-live="off">
                  Vị trí phát <span className="font-semibold text-ink">{formatTimeMs(playhead)}</span> / {formatTimeMs(peaks.duration)}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <TimeField
                  label="Bắt đầu"
                  value={range.start}
                  onCommit={(t) => onRangeChange(setStart(range, t, duration), true)}
                  onNudge={(d) => onRangeChange(nudge(range, "start", d, duration), true)}
                  onSetHere={() => onRangeChange(setStart(range, playhead, duration), true)}
                />
                <TimeField
                  label="Kết thúc"
                  value={range.end}
                  onCommit={(t) => onRangeChange(setEnd(range, t, duration), true)}
                  onNudge={(d) => onRangeChange(nudge(range, "end", d, duration), true)}
                  onSetHere={() => onRangeChange(setEnd(range, playhead, duration), true)}
                />
              </div>
              <p className="-mt-2 text-sm text-muted">
                Độ dài đoạn cắt: <span className="font-semibold text-ink tabular-nums">{formatTimeMs(length)}</span>
                <span className="hidden md:inline"> · Phím tắt: Space phát/dừng, I / O đặt điểm vào/ra</span>
              </p>

              <fieldset>
                <legend className="mb-2 text-sm font-semibold">Fade in</legend>
                <div className="flex flex-wrap gap-2">
                  {FADE_OPTIONS.map((f) => (
                    <Chip key={f} active={effFadeIn === f} disabled={f > fadeCap} onClick={() => setFadeIn(f)}>
                      {f === 0 ? "Tắt" : `${f}s`}
                    </Chip>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-2 text-sm font-semibold">Fade out</legend>
                <div className="flex flex-wrap gap-2">
                  {FADE_OPTIONS.map((f) => (
                    <Chip key={f} active={effFadeOut === f} disabled={f > fadeCap} onClick={() => setFadeOut(f)}>
                      {f === 0 ? "Tắt" : `${f}s`}
                    </Chip>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-2 text-sm font-semibold">Chất lượng</legend>
                <div className="flex flex-wrap gap-2">
                  {BITRATES.map((b) => (
                    <Chip key={b} active={bitrate === b} onClick={() => setBitrate(b)}>
                      {b} kbps
                    </Chip>
                  ))}
                </div>
              </fieldset>
              <div>
                <label htmlFor="trim-name" className="mb-2 block text-sm font-semibold">
                  Tên bản cắt <span className="font-normal text-muted">(tùy chọn)</span>
                </label>
                <input
                  id="trim-name"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={300}
                  placeholder="Tự đặt theo tên bài + đoạn cắt"
                  className="h-12 w-full rounded-xl border border-line bg-surface px-3 outline-none focus:border-accent"
                />
              </div>
            </div>
          )}
        </div>

        <footer className="safe-bottom border-t border-line bg-bg px-4 pt-3 pb-3">
          {error && (
            <p role="alert" className="mb-2 text-sm text-bad">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || peaks.status !== "ready" || length < 0.1}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent font-semibold text-accent-ink transition active:scale-[0.99] disabled:opacity-50"
          >
            {saving ? <Loader2 className="size-5 animate-spin" /> : <Scissors className="size-5" />}
            {saving ? "Đang cắt…" : "Cắt và lưu"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function TimeField({
  label,
  value,
  onCommit,
  onNudge,
  onSetHere,
}: {
  label: string;
  value: number;
  onCommit: (t: number) => void;
  onNudge: (delta: number) => void;
  onSetHere: () => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const invalid = draft !== null && parseTimeInput(draft) === null;
  const id = `time-${label}`;

  const commit = () => {
    if (draft === null) return;
    const t = parseTimeInput(draft);
    if (t !== null) onCommit(t);
    setDraft(null);
  };

  const nudgeBtn = (delta: number, text: string): ReactNode => (
    <button
      type="button"
      onClick={() => onNudge(delta)}
      aria-label={`${label} ${delta > 0 ? "+" : "−"}${Math.abs(delta)} giây`}
      className="grid h-11 min-w-10 place-items-center rounded-lg border border-line bg-surface px-1.5 text-xs font-semibold text-muted active:bg-surface-2"
    >
      {text}
    </button>
  );

  return (
    <div className="min-w-0 rounded-2xl border border-line bg-surface p-3">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <div className="mt-2 flex items-center gap-1.5">
        {nudgeBtn(-1, "−1s")}
        {nudgeBtn(-0.1, "−.1")}
        <input
          id={id}
          inputMode="decimal"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          value={draft ?? formatTimeMs(value)}
          aria-invalid={invalid || undefined}
          onFocus={(e) => {
            setDraft(formatTimeMs(value));
            e.currentTarget.select();
          }}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") setDraft(null);
          }}
          className={clsx(
            "h-11 min-w-0 flex-1 rounded-lg border bg-surface-2 px-2 text-center font-semibold tabular-nums outline-none focus:border-accent",
            invalid ? "border-bad" : "border-transparent",
          )}
        />
        {nudgeBtn(0.1, "+.1")}
        {nudgeBtn(1, "+1s")}
      </div>
      <button
        type="button"
        onClick={onSetHere}
        className="mt-2 h-10 w-full rounded-lg bg-accent-soft text-sm font-semibold text-accent"
      >
        Đặt tại vị trí đang phát
      </button>
    </div>
  );
}

