import { Pause, Play, X } from "lucide-react";
import { formatDuration } from "../lib/format";
import { displayTitle } from "../lib/jobs";
import { usePlayer } from "../state/player";
import { IconButton } from "./ui";

export function MiniPlayer() {
  const p = usePlayer();
  if (!p.current) return null;
  const max = p.duration || p.current.duration || 0;
  return (
    <div className="toast-in fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 mx-auto w-[calc(100%-1.5rem)] max-w-2xl rounded-2xl border border-line bg-surface/95 p-2 pl-3 shadow-xl backdrop-blur lg:bottom-4">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{displayTitle(p.current)}</p>
          <div className="mt-1 flex items-center gap-2">
            <span className="w-10 text-xs text-muted tabular-nums">{formatDuration(p.time)}</span>
            <input
              type="range"
              aria-label="Tua"
              min={0}
              max={max || 1}
              step={0.1}
              value={Math.min(p.time, max || 1)}
              onChange={(e) => p.seek(Number(e.target.value))}
              className="h-6 min-w-0 flex-1 accent-[var(--accent)]"
            />
            <span className="w-10 text-right text-xs text-muted tabular-nums">{formatDuration(max)}</span>
          </div>
        </div>
        <IconButton label={p.playing ? "Tạm dừng" : "Phát"} tone="accent" onClick={() => p.toggle(p.current!)}>
          {p.playing ? <Pause className="size-5" /> : <Play className="size-5" />}
        </IconButton>
        <IconButton label="Đóng trình phát" onClick={p.close}>
          <X className="size-5" />
        </IconButton>
      </div>
    </div>
  );
}
