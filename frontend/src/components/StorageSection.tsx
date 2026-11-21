import { HardDrive, Loader2, Trash } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { type SystemInfo, api } from "../api/client";
import { formatBytes } from "../lib/format";
import { useToast } from "../state/toast";
import { Card } from "./ui";

export function StorageSection() {
  const toast = useToast();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setInfo(await api.system.info());
    } catch {
      /* bỏ qua; hiển thị trạng thái đang tải */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cleanup = async () => {
    setBusy(true);
    try {
      const r = await api.system.cleanup();
      const total = r.removed_files + r.orphan_files;
      toast.push(
        total
          ? { tone: "success", title: "Đã dọn dẹp", text: `${total} file, giải phóng ${formatBytes(r.freed_bytes)}` }
          : { tone: "info", title: "Không có gì cần dọn" },
      );
      await load();
    } catch {
      toast.push({ tone: "error", title: "Dọn dẹp thất bại" });
    } finally {
      setBusy(false);
    }
  };

  if (!info?.disk || !info.storage) {
    return (
      <Card className="p-4">
        <p className="text-sm text-muted">Đang tải thông tin lưu trữ…</p>
      </Card>
    );
  }
  const { disk, storage } = info;
  const usedPct = Math.min(100, Math.round((disk.used / disk.total) * 100));
  const lowDisk = disk.free < 2 * 1024 ** 3;

  return (
    <Card className="p-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted uppercase">
        <HardDrive className="size-4" /> Lưu trữ
      </h3>
      <div
        role="progressbar"
        aria-label="Dung lượng ổ đĩa đã dùng"
        aria-valuenow={usedPct}
        aria-valuemin={0}
        aria-valuemax={100}
        className="mt-3 h-2 overflow-hidden rounded-full bg-surface-2"
      >
        <div className={lowDisk ? "h-full bg-bad" : "h-full bg-accent"} style={{ width: `${usedPct}%` }} />
      </div>
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted">Còn trống</dt>
        <dd className={lowDisk ? "text-right font-semibold text-bad" : "text-right font-semibold"}>
          {formatBytes(disk.free)}
        </dd>
        <dt className="text-muted">Audio đã tải</dt>
        <dd className="text-right font-semibold">
          {formatBytes(info.audio_bytes)} ({storage.files} file)
        </dd>
        <dt className="text-muted">Tự xóa file sau</dt>
        <dd className="text-right">{storage.retention_days > 0 ? `${storage.retention_days} ngày` : "không bao giờ"}</dd>
        <dt className="text-muted">Giới hạn dung lượng</dt>
        <dd className="text-right">{storage.max_storage_gb > 0 ? `${storage.max_storage_gb} GB` : "không giới hạn"}</dd>
        <dt className="text-muted">Sao lưu dữ liệu</dt>
        <dd className="text-right">{info.backups.count} bản</dd>
      </dl>
      {lowDisk && (
        <p role="alert" className="mt-3 rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad">
          Ổ đĩa sắp đầy. Hãy dọn dẹp hoặc đặt giới hạn dung lượng trên máy chủ.
        </p>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={() => void cleanup()}
        className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent-soft text-sm font-semibold text-accent disabled:opacity-50"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Trash className="size-4" />} Dọn dẹp ngay
      </button>
      <p className="mt-2 text-xs text-muted">
        Dòng lịch sử được giữ lại; bản đã dọn có thể tải lại bất cứ lúc nào.
      </p>
    </Card>
  );
}
