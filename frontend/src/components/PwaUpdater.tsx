import { RefreshCw } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";

const HOUR = 60 * 60 * 1000;

/** Đăng ký service worker và hiện banner khi có phiên bản mới (không tự tải lại để khỏi mất thao tác). */
export function PwaUpdater() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_url, registration) {
      if (registration) window.setInterval(() => void registration.update(), HOUR);
    },
  });

  if (!needRefresh) return null;
  return (
    <div
      role="alert"
      className="toast-in fixed inset-x-3 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-50 mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-line bg-surface p-3 pl-4 shadow-xl lg:bottom-4"
    >
      <RefreshCw className="size-5 shrink-0 text-accent" />
      <p className="min-w-0 flex-1 text-sm font-medium">Có phiên bản mới của app</p>
      <button
        type="button"
        onClick={() => void updateServiceWorker(true)}
        className="h-10 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink"
      >
        Tải lại
      </button>
      <button
        type="button"
        onClick={() => setNeedRefresh(false)}
        className="h-10 rounded-xl px-3 text-sm font-medium text-muted"
      >
        Để sau
      </button>
    </div>
  );
}
