import clsx from "clsx";
import { ArrowUpCircle, Loader2, RefreshCw, Undo2 } from "lucide-react";
import { relativeTime } from "../lib/format";
import { useYtdlp } from "../state/ytdlp";
import { Card, Switch } from "./ui";

const CHANNELS = [
  { key: "stable", label: "Ổn định" },
  { key: "nightly", label: "Nightly" },
] as const;

export function YtdlpSection() {
  const { status, busy, check, update, rollback, configure } = useYtdlp();

  if (!status) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted">Đang tải thông tin yt-dlp…</p>
      </Card>
    );
  }
  const working = status.updating || busy;

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold tracking-wide text-muted">yt-dlp</h3>
      <p className="mt-1 text-sm text-muted">
        Thư viện tải video. YouTube hay thay đổi nên cần cập nhật thường xuyên.
      </p>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted">Đang dùng</dt>
        <dd className="text-right font-semibold tabular-nums" data-testid="ytdlp-version">
          {status.version}
          {status.source === "bundled" && <span className="ml-1.5 font-normal text-muted">(cài sẵn)</span>}
        </dd>
        <dt className="text-muted">Mới nhất</dt>
        <dd className="text-right font-semibold tabular-nums">{status.latest ?? "—"}</dd>
        <dt className="text-muted">Kiểm tra lần cuối</dt>
        <dd className="text-right">{status.last_check ? relativeTime(status.last_check) : "chưa bao giờ"}</dd>
      </dl>

      {status.update_available && !status.updating && (
        <p role="status" className="mt-3 rounded-xl bg-accent-soft px-3 py-2 text-sm font-medium text-accent">
          Có bản mới {status.latest}
        </p>
      )}
      {status.last_error && (
        <p role="alert" className="mt-3 rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad">
          {status.last_error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={working || !status.update_available}
          onClick={() => void update()}
          className={clsx(
            "flex h-12 flex-1 items-center justify-center gap-2 rounded-xl px-4 font-semibold disabled:opacity-50",
            status.update_available ? "bg-accent text-accent-ink" : "bg-surface-2 text-muted",
          )}
        >
          {status.updating ? <Loader2 className="size-5 animate-spin" /> : <ArrowUpCircle className="size-5" />}
          {status.updating ? "Đang cập nhật…" : "Cập nhật"}
        </button>
        <button
          type="button"
          disabled={working}
          onClick={() => void check()}
          className="flex h-12 items-center justify-center gap-2 rounded-xl bg-accent-soft px-4 font-semibold text-accent disabled:opacity-50"
        >
          <RefreshCw className="size-4" /> Kiểm tra
        </button>
        {status.previous && (
          <button
            type="button"
            disabled={working}
            onClick={() => void rollback()}
            className="flex h-12 items-center justify-center gap-2 rounded-xl border border-line px-4 font-medium text-muted disabled:opacity-50"
          >
            <Undo2 className="size-4" /> Quay lại {status.previous}
          </button>
        )}
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <p className="mb-2 text-sm font-semibold">Kênh cập nhật</p>
        <div role="radiogroup" aria-label="Kênh cập nhật" className="flex gap-1 rounded-xl bg-surface-2 p-1">
          {CHANNELS.map((c) => (
            <button
              key={c.key}
              type="button"
              role="radio"
              aria-checked={status.channel === c.key}
              onClick={() => void configure({ channel: c.key })}
              className={clsx(
                "h-10 flex-1 rounded-lg text-sm font-medium transition-colors",
                status.channel === c.key ? "bg-surface text-ink shadow-sm" : "text-muted",
              )}
            >
              {c.label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">
          Nightly nhận bản sửa lỗi sớm hơn nhưng có thể kém ổn định hơn.
        </p>
        <div className="mt-3">
          <Switch
            checked={status.auto_update}
            onChange={(v) => void configure({ auto_update: v })}
            label="Tự động cập nhật"
            description="Kiểm tra mỗi ngày, và tự cập nhật rồi tải lại khi YouTube làm tải lỗi."
          />
        </div>
      </div>
    </Card>
  );
}
