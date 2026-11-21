import clsx from "clsx";
import { Check } from "lucide-react";
import type { Job } from "../api/types";
import { STEPS, overallProgress, stepIndex } from "../lib/jobs";

export function StepProgress({ job }: { job: Job }) {
  const current = stepIndex(job.status);
  const pct = overallProgress(job);
  const indeterminate = job.status === "fetching_info" || job.status === "queued";
  return (
    <div className="mt-3">
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        className="h-1.5 overflow-hidden rounded-full bg-surface-2"
      >
        <div
          className={clsx(
            "h-full rounded-full bg-accent transition-[width] duration-500",
            indeterminate && job.status !== "queued" && "progress-indeterminate",
          )}
          style={{ width: job.status === "queued" ? "0%" : `${Math.max(pct, 6)}%` }}
        />
      </div>
      {job.status !== "queued" && (
        <ol className="mt-2 flex items-center justify-between gap-1 text-xs">
          {STEPS.map((s, i) => {
            const done = i < current;
            const active = i === current;
            return (
              <li
                key={s.key}
                className={clsx(
                  "flex items-center gap-1",
                  active ? "font-semibold text-accent" : done ? "text-ok" : "text-muted",
                )}
              >
                {done ? <Check className="size-3.5" /> : <span className="size-1.5 rounded-full bg-current" />}
                {s.label}
                {active && s.key === "downloading" && ` ${Math.round(job.progress)}%`}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
