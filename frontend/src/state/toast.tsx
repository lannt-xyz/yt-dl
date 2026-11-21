import { CheckCircle2, Info, X, XCircle } from "lucide-react";
import { type ReactNode, createContext, useCallback, useContext, useMemo, useState } from "react";
import type { Notice } from "../lib/jobs";

interface ToastItem extends Notice {
  id: number;
  action?: { label: string; onClick: () => void };
}

interface ToastApi {
  push: (notice: Notice, action?: ToastItem["action"]) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const MAX_TOASTS = 3;
// Toast che một phần màn hình nhỏ và chặn thao tác bên dưới → thông tin thường thì tắt sớm
const LIFETIME_MS = { info: 3500, success: 5500, error: 7000 } as const;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => setItems((l) => l.filter((t) => t.id !== id)), []);

  const push = useCallback<ToastApi["push"]>(
    (notice, action) => {
      const id = Date.now() + Math.random();
      setItems((l) => [...l.slice(-(MAX_TOASTS - 1)), { ...notice, id, action }]);
      window.setTimeout(() => dismiss(id), LIFETIME_MS[notice.tone]);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 px-4 pt-[max(env(safe-area-inset-top),0.75rem)]"
      >
        {items.map((t) => (
          <ToastCard key={t.id} item={t} onClose={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

const ICON = {
  success: <CheckCircle2 className="size-5 shrink-0 text-ok" />,
  error: <XCircle className="size-5 shrink-0 text-bad" />,
  info: <Info className="size-5 shrink-0 text-accent" />,
};

function ToastCard({ item, onClose }: { item: ToastItem; onClose: () => void }) {
  return (
    <div
      role="status"
      className="toast-in pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border border-line bg-surface p-3.5 shadow-lg shadow-black/10"
    >
      {ICON[item.tone]}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{item.title}</p>
        {item.text && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{item.text}</p>}
        {item.action && (
          <button
            type="button"
            onClick={() => {
              item.action?.onClick();
              onClose();
            }}
            className="mt-1.5 text-sm font-semibold text-accent"
          >
            {item.action.label}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Đóng thông báo"
        className="-m-1.5 grid size-9 place-items-center rounded-full text-muted hover:bg-surface-2"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast phải nằm trong ToastProvider");
  return ctx;
}
