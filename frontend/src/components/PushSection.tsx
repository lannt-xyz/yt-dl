import { BellRing, Share, SquarePlus } from "lucide-react";
import { usePush } from "../state/push";
import { Card, Switch } from "./ui";

export function PushSection() {
  const { state, busy, error, enable, disable, sendTest } = usePush();

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold tracking-wide text-muted uppercase">Thông báo</h3>
      <p className="mt-1 text-sm text-muted">
        Nhận thông báo trên thiết bị khi mỗi video tải xong hoặc bị lỗi, kể cả lúc đã đóng app.
      </p>

      <div className="mt-3">
        {state === "loading" && <p className="text-sm text-muted">Đang kiểm tra…</p>}

        {state === "unsupported" && (
          <p role="status" className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-muted">
            Trình duyệt này không hỗ trợ thông báo đẩy. Thông báo trong app vẫn hoạt động khi đang mở.
          </p>
        )}

        {state === "needs-install" && (
          <div role="status" className="rounded-xl bg-accent-soft p-3 text-sm">
            <p className="font-semibold text-accent">Cần thêm app vào Màn hình chính</p>
            <p className="mt-1 text-muted">
              iPhone và iPad chỉ cho gửi thông báo tới app đã được cài. Cách làm:
            </p>
            <ol className="mt-2 space-y-1.5 text-ink">
              <li className="flex items-center gap-2">
                1. Mở trang này trong Safari, nhấn <Share className="inline size-4" aria-label="nút Chia sẻ" /> Chia sẻ
              </li>
              <li className="flex items-center gap-2">
                2. Chọn <SquarePlus className="inline size-4" aria-hidden /> “Thêm vào MH chính”
              </li>
              <li>3. Mở app từ biểu tượng mới, rồi quay lại đây để bật thông báo</li>
            </ol>
          </div>
        )}

        {state === "denied" && (
          <p role="alert" className="rounded-xl bg-bad/10 px-3 py-2 text-sm text-bad">
            Thông báo đang bị chặn. Hãy bật lại trong Cài đặt của trình duyệt/thiết bị cho trang này.
          </p>
        )}

        {(state === "off" || state === "on") && (
          <>
            <Switch
              checked={state === "on"}
              disabled={busy}
              onChange={(v) => void (v ? enable() : disable())}
              label="Thông báo trên thiết bị này"
              description={state === "on" ? "Đang bật" : "Đang tắt"}
            />
            {state === "on" && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void sendTest()}
                className="mt-2 flex h-11 items-center gap-2 rounded-xl bg-accent-soft px-4 text-sm font-semibold text-accent disabled:opacity-50"
              >
                <BellRing className="size-4" /> Gửi thông báo thử
              </button>
            )}
          </>
        )}

        {error && (
          <p role="alert" className="mt-2 text-sm text-bad">
            {error}
          </p>
        )}
      </div>
    </Card>
  );
}
