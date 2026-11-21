import clsx from "clsx";
import {
  AlertTriangle,
  ArrowDownToLine,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Trash2,
  X,
} from "lucide-react";
import { memo, useEffect, useState } from "react";
import { type Job, isActive } from "../api/types";
import { formatBytes, formatDuration, relativeTime } from "../lib/format";
import { STATUS_LABEL, displayTitle } from "../lib/jobs";
import { useJobs } from "../state/jobs";
import { usePlayer } from "../state/player";
import { useTrim } from "../state/trim";
import { StepProgress } from "./StepProgress";
import { IconButton } from "./ui";

function Thumb({ job }: { job: Job }) {
  return (
    <div className="relative aspect-video w-24 shrink-0 overflow-hidden rounded-lg bg-surface-2 sm:w-32">
      {job.thumbnail && (
        <img
          src={job.thumbnail}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          className="size-full object-cover"
        />
      )}
      {job.duration != null && (
        <span className="absolute right-1 bottom-1 rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-white tabular-nums">
          {formatDuration(job.duration)}
        </span>
      )}
    </div>
  );
}

function Meta({ job }: { job: Job }) {
  const parts: string[] = [];
  if (job.channel) parts.push(job.channel);
  if (job.status === "done") {
    parts.push(formatBytes(job.file_size));
    if (job.bitrate) parts.push(`${job.bitrate} kbps`);
  }
  parts.push(relativeTime(job.finished_at ?? job.created_at));
  return <p className="mt-1 truncate text-xs text-muted">{parts.join(" · ")}</p>;
}

function DeleteButton({ onConfirm }: { onConfirm: () => void }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = window.setTimeout(() => setArmed(false), 3500);
    return () => window.clearTimeout(t);
  }, [armed]);

  if (armed) {
    return (
      <button
        type="button"
        onClick={onConfirm}
        className="h-11 shrink-0 rounded-xl bg-bad px-3.5 text-sm font-semibold text-white"
      >
        Xóa?
      </button>
    );
  }
  return (
    <IconButton label="Xóa" tone="danger" onClick={() => setArmed(true)}>
      <Trash2 className="size-5" />
    </IconButton>
  );
}

export const JobCard = memo(function JobCard({ job }: { job: Job }) {
  const { cancel, retry, remove } = useJobs();
  const player = usePlayer();
  const trim = useTrim();
  const active = isActive(job.status);
  const playingThis = player.current?.id === job.id && player.playing;

  return (
    <article
      className={clsx(
        "rounded-2xl border bg-surface p-3",
        job.status === "failed" ? "border-bad/40" : "border-line",
      )}
    >
      <div className="flex gap-3">
        <Thumb job={job} />
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 text-[15px] leading-snug font-semibold">
            {job.kind === "trim" && (
              <Scissors className="mr-1 -mt-0.5 inline size-3.5 text-accent" aria-label="Bản cắt" />
            )}
            {displayTitle(job)}
          </h3>
          <Meta job={job} />
          {active && job.status === "queued" && (
            <p className="mt-1.5 text-xs font-medium text-muted">{STATUS_LABEL.queued}…</p>
          )}
        </div>
      </div>

      {active && job.status !== "queued" && <StepProgress job={job} />}

      {job.status === "failed" && (
        <div className="mt-3 flex gap-2 rounded-xl bg-bad/10 p-3 text-sm text-bad" role="alert">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p className="min-w-0 break-words">{job.error_message ?? "Tải thất bại"}</p>
        </div>
      )}

      <div className="mt-2 flex items-center justify-end gap-1">
        {active && (
          <IconButton label="Hủy" tone="danger" onClick={() => void cancel(job.id)}>
            <X className="size-5" />
          </IconButton>
        )}

        {job.status === "done" && job.has_file && (
          <>
            <IconButton
              label={playingThis ? "Tạm dừng" : "Phát"}
              tone="accent"
              onClick={() => player.toggle(job)}
            >
              {playingThis ? <Pause className="size-5" /> : <Play className="size-5" />}
            </IconButton>
            <IconButton label="Cắt" onClick={() => trim.open(job)}>
              <Scissors className="size-5" />
            </IconButton>
            <a
              href={job.download_url ?? "#"}
              download
              aria-label="Tải xuống"
              title="Tải xuống"
              className="grid size-11 place-items-center rounded-xl text-muted hover:bg-surface-2 hover:text-ink"
            >
              <ArrowDownToLine className="size-5" />
            </a>
          </>
        )}

        {(job.status === "failed" || job.status === "cancelled") && job.kind === "download" && (
          <IconButton label="Thử lại" tone="accent" onClick={() => void retry(job.id)}>
            <RotateCcw className="size-5" />
          </IconButton>
        )}

        {!active && <DeleteButton onConfirm={() => void remove(job.id)} />}
      </div>
    </article>
  );
});
