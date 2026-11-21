import { Inbox, ListMusic, Search, X } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { type Job, isActive } from "../api/types";
import { activeJobs, matchesQuery } from "../lib/jobs";
import { useJobs } from "../state/jobs";
import { JobCard } from "./JobCard";
import { Chip } from "./ui";

function Empty({ icon, title, hint }: { icon: React.ReactNode; title: string; hint?: string }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-line px-6 py-10 text-center">
      <div className="mb-3 grid size-12 place-items-center rounded-full bg-surface-2 text-muted">{icon}</div>
      <p className="font-medium">{title}</p>
      {hint && <p className="mt-1 max-w-xs text-sm text-muted">{hint}</p>}
    </div>
  );
}

function SectionTitle({ children, count }: { children: React.ReactNode; count?: number }) {
  return (
    <h2 className="mb-3 flex items-center gap-2 px-1 text-sm font-semibold tracking-wide text-muted uppercase">
      {children}
      {count ? (
        <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-ink tabular-nums">{count}</span>
      ) : null}
    </h2>
  );
}

export function QueueSection() {
  const { jobs, loaded } = useJobs();
  const queue = useMemo(() => activeJobs(jobs), [jobs]);

  if (!loaded) return <SkeletonList rows={1} />;
  if (queue.length === 0) return null;
  return (
    <section aria-label="Hàng đợi">
      <SectionTitle count={queue.length}>Hàng đợi</SectionTitle>
      <ul className="flex flex-col gap-3">
        {queue.map((job) => (
          <li key={job.id}>
            <JobCard job={job} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function SkeletonList({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-3" aria-busy="true" aria-label="Đang tải">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex animate-pulse gap-3 rounded-2xl border border-line bg-surface p-3">
          <div className="aspect-video w-24 rounded-lg bg-surface-2 sm:w-32" />
          <div className="flex-1 space-y-2 pt-1">
            <div className="h-4 w-3/4 rounded bg-surface-2" />
            <div className="h-3 w-1/2 rounded bg-surface-2" />
          </div>
        </div>
      ))}
    </div>
  );
}

type Filter = "all" | "done" | "failed";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "Tất cả" },
  { key: "done", label: "Hoàn tất" },
  { key: "failed", label: "Lỗi" },
];

function filterJobs(jobs: Job[], filter: Filter, query: string): Job[] {
  return jobs.filter((j) => {
    if (isActive(j.status)) return false;
    if (filter === "done" && j.status !== "done") return false;
    if (filter === "failed" && j.status !== "failed" && j.status !== "cancelled") return false;
    return matchesQuery(j, query);
  });
}

/** Lịch sử đầy đủ (tìm kiếm + lọc). Khi hiển thị sẽ tự đánh dấu đã xem. */
export function HistorySection({ visible = true }: { visible?: boolean }) {
  const { jobs, loaded, unseen, markSeen } = useJobs();
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const items = useMemo(() => filterJobs(jobs, filter, deferred), [jobs, filter, deferred]);

  useEffect(() => {
    if (!visible || unseen === 0) return;
    const t = window.setTimeout(() => void markSeen(), 1500);
    return () => window.clearTimeout(t);
  }, [visible, unseen, markSeen]);

  return (
    <section aria-label="Lịch sử">
      <SectionTitle>Lịch sử</SectionTitle>
      <div className="mb-3 flex items-center gap-1 rounded-xl border border-line bg-surface pr-1 pl-3 focus-within:border-accent">
        <Search className="size-5 shrink-0 text-muted" />
        <input
          type="search"
          placeholder="Tìm theo tiêu đề, kênh…"
          aria-label="Tìm trong lịch sử"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-12 min-w-0 flex-1 bg-transparent px-1 outline-none placeholder:text-muted/70 [&::-webkit-search-cancel-button]:hidden"
        />
        {query && (
          <button
            type="button"
            aria-label="Xóa tìm kiếm"
            onClick={() => setQuery("")}
            className="grid size-11 place-items-center rounded-lg text-muted hover:bg-surface-2"
          >
            <X className="size-4" />
          </button>
        )}
      </div>
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]">
        {FILTERS.map((f) => (
          <Chip key={f.key} active={filter === f.key} onClick={() => setFilter(f.key)}>
            {f.label}
          </Chip>
        ))}
      </div>

      {!loaded ? (
        <SkeletonList rows={3} />
      ) : items.length === 0 ? (
        query || filter !== "all" ? (
          <Empty icon={<Search className="size-6" />} title="Không có kết quả" hint="Thử từ khóa hoặc bộ lọc khác." />
        ) : (
          <Empty
            icon={<Inbox className="size-6" />}
            title="Chưa có gì trong lịch sử"
            hint="Dán một link YouTube để bắt đầu. Các bản đã tải sẽ xuất hiện ở đây."
          />
        )
      ) : (
        <ul className="flex flex-col gap-3">
          {items.map((job) => (
            <li key={job.id}>
              <JobCard job={job} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** Vài mục gần đây, dùng trên tab "Tải về" của điện thoại. */
export function RecentSection({ onSeeAll }: { onSeeAll: () => void }) {
  const { jobs, loaded } = useJobs();
  const recent = useMemo(() => jobs.filter((j) => !isActive(j.status)).slice(0, 3), [jobs]);
  if (!loaded || recent.length === 0) {
    return loaded ? (
      <Empty
        icon={<ListMusic className="size-6" />}
        title="Sẵn sàng tải"
        hint="Dán link YouTube ở trên. Bạn có thể thêm nhiều link liên tiếp, app sẽ tải lần lượt."
      />
    ) : null;
  }
  return (
    <section aria-label="Gần đây">
      <div className="mb-3 flex items-center justify-between px-1">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">Gần đây</h2>
        <button type="button" onClick={onSeeAll} className="h-9 px-2 text-sm font-semibold text-accent">
          Xem tất cả
        </button>
      </div>
      <ul className="flex flex-col gap-3">
        {recent.map((job) => (
          <li key={job.id}>
            <JobCard job={job} />
          </li>
        ))}
      </ul>
    </section>
  );
}
