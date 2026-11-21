import { Check, Copy, KeyRound, LogOut, Trash2 } from "lucide-react";
import { type FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, type ApiToken, api } from "../api/client";
import { relativeTime } from "../lib/format";
import { useAuth } from "../state/auth";
import { useToast } from "../state/toast";
import { Card } from "./ui";

/** Đăng xuất + API token (dùng cho iOS Shortcut). Chỉ hiện khi server bật đăng nhập. */
export function AccessSection() {
  const { required, logout } = useAuth();
  const toast = useToast();
  const [tokens, setTokens] = useState<ApiToken[]>([]);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setTokens((await api.auth.tokens()).items);
    } catch {
      /* 401 đã được AuthProvider xử lý */
    }
  }, []);

  useEffect(() => {
    if (required) void load();
  }, [required, load]);

  if (!required) return null;

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await api.auth.createToken(name.trim() || "Shortcut");
      setFresh(res.token);
      setCopied(false);
      setName("");
      await load();
    } catch (err) {
      toast.push({ tone: "error", title: "Không tạo được token", text: err instanceof ApiError ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!fresh) return;
    try {
      await navigator.clipboard.writeText(fresh);
      setCopied(true);
    } catch {
      toast.push({ tone: "info", title: "Không tự sao chép được", text: "Hãy nhấn giữ vào token để chọn và sao chép." });
    }
  };

  const revoke = async (id: string) => {
    await api.auth.revokeToken(id).catch(() => undefined);
    await load();
  };

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold tracking-wide text-muted uppercase">Truy cập</h3>

      <div className="mt-3">
        <p className="text-sm font-semibold">API token</p>
        <p className="mt-1 text-sm text-muted">
          Dùng để gửi link YouTube từ iOS Phím tắt (Shortcuts) mà không cần đăng nhập.
        </p>

        {fresh && (
          <div role="status" className="mt-3 rounded-xl bg-accent-soft p-3">
            <p className="text-sm font-semibold text-accent">Token mới (chỉ hiện một lần)</p>
            <code data-testid="new-token" className="mt-2 block rounded-lg bg-surface px-3 py-2 text-xs break-all select-all">
              {fresh}
            </code>
            <button
              type="button"
              onClick={() => void copy()}
              className="mt-2 flex h-10 items-center gap-2 rounded-lg bg-accent px-3 text-sm font-semibold text-accent-ink"
            >
              {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
              {copied ? "Đã sao chép" : "Sao chép"}
            </button>
          </div>
        )}

        <form onSubmit={(e) => void create(e)} className="mt-3 flex gap-2">
          <input
            aria-label="Tên token"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="Tên (vd. iPhone Shortcut)"
            className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface-2 px-3 outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={busy}
            className="flex h-11 items-center gap-2 rounded-xl bg-accent-soft px-4 text-sm font-semibold text-accent disabled:opacity-50"
          >
            <KeyRound className="size-4" /> Tạo
          </button>
        </form>

        {tokens.length > 0 && (
          <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
            {tokens.map((t) => (
              <li key={t.id} className="flex items-center gap-2 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{t.name}</p>
                  <p className="text-xs text-muted">
                    {t.last_used_at ? `Dùng ${relativeTime(t.last_used_at)}` : "Chưa dùng"}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={`Thu hồi ${t.name}`}
                  onClick={() => void revoke(t.id)}
                  className="grid size-10 place-items-center rounded-lg text-muted hover:bg-bad/10 hover:text-bad"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <details className="mt-3 rounded-xl border border-line px-3 py-2 text-sm">
          <summary className="cursor-pointer font-semibold">Cách tạo Phím tắt trên iPhone/iPad</summary>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-muted">
            <li>Mở app Phím tắt → tạo phím tắt mới, bật “Hiển thị trong Bảng chia sẻ”, loại nhận: URL.</li>
            <li>
              Thêm “Lấy nội dung của URL”: URL <b className="text-ink">{window.location.origin}/api/jobs</b>, phương thức
              POST, kiểu nội dung JSON.
            </li>
            <li>
              Thêm tiêu đề <b className="text-ink">Authorization</b> = <b className="text-ink">Bearer &lt;token&gt;</b>.
            </li>
            <li>
              Thêm trường JSON <b className="text-ink">url</b> = “Phím tắt nhập vào”. Từ YouTube nhấn Chia sẻ → chọn phím tắt.
            </li>
          </ol>
        </details>
      </div>

      <button
        type="button"
        onClick={() => void logout()}
        className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-line text-sm font-medium text-muted hover:text-ink"
      >
        <LogOut className="size-4" /> Đăng xuất
      </button>
    </Card>
  );
}
