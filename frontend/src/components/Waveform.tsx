import clsx from "clsx";
import { type KeyboardEvent, type PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMediaQuery } from "../lib/useMediaQuery";
import {
  type Range,
  type View,
  clamp,
  formatTimeMs,
  fractionToTime,
  nudge,
  peaksForView,
  setEnd,
  setStart,
  timeToFraction,
} from "../lib/trim";

interface Props {
  peaks: number[];
  peaksPerSecond: number;
  duration: number;
  range: Range;
  view: View;
  playhead: number;
  /** `commit` = true khi người dùng thả tay/nhấn phím (điểm lưu cho Undo). */
  onChange: (range: Range, commit: boolean) => void;
  onSeek: (time: number) => void;
}

const BAR = 3;
const GAP = 1;

type Which = "start" | "end";

export function Waveform({ peaks, peaksPerSecond, duration, range, view, playhead, onChange, onSeek }: Props) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const dark = useMediaQuery("(prefers-color-scheme: dark)");
  const drag = useRef<{ which: Which; moved: boolean } | null>(null);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const update = () => setWidth(box.clientWidth);
    update();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(box);
    return () => ro.disconnect();
  }, []);

  const buckets = Math.max(0, Math.floor(width / (BAR + GAP)));
  const bars = useMemo(
    () => peaksForView(peaks, peaksPerSecond, view, buckets),
    [peaks, peaksPerSecond, view, buckets],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const box = boxRef.current;
    if (!canvas || !box || width === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const height = box.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const css = getComputedStyle(box);
    const accent = css.getPropertyValue("--accent").trim() || "#6d5efc";
    const muted = css.getPropertyValue("--muted").trim() || "#999";
    const mid = height / 2;
    const span = view.to - view.from;
    bars.forEach((p, i) => {
      const t = view.from + ((i + 0.5) / bars.length) * span;
      const inside = t >= range.start && t <= range.end;
      ctx.fillStyle = inside ? accent : muted;
      ctx.globalAlpha = inside ? 1 : 0.45;
      const h = Math.max(2, p * (height - 16));
      ctx.beginPath();
      ctx.roundRect(i * (BAR + GAP), mid - h / 2, BAR, h, 1.5);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
  }, [bars, range, view, width, dark]);

  const frac = (t: number) => clamp(timeToFraction(t, view), 0, 1);
  const startPct = frac(range.start) * 100;
  const endPct = frac(range.end) * 100;
  const playPct = frac(playhead) * 100;
  const playVisible = playhead >= view.from && playhead <= view.to;

  const timeAt = useCallback(
    (clientX: number) => {
      const rect = boxRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return 0;
      return fractionToTime(clamp((clientX - rect.left) / rect.width, 0, 1), view);
    },
    [view],
  );

  const apply = (which: Which, time: number, commit: boolean) =>
    onChange(which === "start" ? setStart(range, time, duration) : setEnd(range, time, duration), commit);

  const onPointerDown = (which: Which) => (e: PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    drag.current = { which, moved: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current.moved = true;
    apply(drag.current.which, timeAt(e.clientX), false);
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const { which } = drag.current;
    drag.current = null;
    apply(which, timeAt(e.clientX), true);
  };

  const onKeyDown = (which: Which) => (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 1 : e.altKey ? 0.01 : 0.1;
    let delta = 0;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") delta = -step;
    else if (e.key === "ArrowRight" || e.key === "ArrowUp") delta = step;
    else return;
    e.preventDefault();
    onChange(nudge(range, which, delta, duration), true);
  };

  const handle = (which: Which, pct: number, label: string) => (
    <div
      role="slider"
      tabIndex={0}
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Math.round(duration * 1000) / 1000}
      aria-valuenow={Math.round((which === "start" ? range.start : range.end) * 1000) / 1000}
      aria-valuetext={formatTimeMs(which === "start" ? range.start : range.end)}
      data-handle={which}
      onPointerDown={onPointerDown(which)}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onKeyDown={onKeyDown(which)}
      style={{ left: `${pct}%`, touchAction: "none" }}
      className="group absolute top-0 z-10 h-full w-11 -translate-x-1/2 cursor-ew-resize outline-none"
    >
      <span className="absolute inset-y-0 left-1/2 w-[3px] -translate-x-1/2 rounded-full bg-accent group-focus-visible:w-1" />
      <span
        className={clsx(
          "absolute left-1/2 grid h-7 w-5 -translate-x-1/2 place-items-center rounded-md bg-accent text-accent-ink shadow-md",
          which === "start" ? "top-0" : "bottom-0",
        )}
      >
        <span className="h-3 w-px bg-accent-ink/70" />
      </span>
    </div>
  );

  // Khung ngoài có đệm hai bên để tay cầm ở mép (0% / 100%) vẫn nằm trọn trong vùng chạm.
  return (
    <div
      className="relative h-36 w-full select-none overflow-hidden rounded-2xl border border-line bg-surface sm:h-44"
      style={{ touchAction: "pan-y" }}
    >
      <div
        ref={boxRef}
        data-testid="waveform"
        className="absolute inset-y-0 right-[18px] left-[18px]"
        onClick={(e) => {
          if ((e.target as HTMLElement).closest("[data-handle]")) return;
          onSeek(clamp(timeAt(e.clientX), 0, duration));
        }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 size-full" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-y-0 left-0 bg-bg/60" style={{ width: `${startPct}%` }} />
        <div className="pointer-events-none absolute inset-y-0 right-0 bg-bg/60" style={{ width: `${100 - endPct}%` }} />
        {playVisible && (
          <div
            data-testid="playhead"
            className="pointer-events-none absolute inset-y-0 w-0.5 bg-ink/80"
            style={{ left: `${playPct}%` }}
          />
        )}
        {handle("start", startPct, "Điểm bắt đầu")}
        {handle("end", endPct, "Điểm kết thúc")}
      </div>
    </div>
  );
}
