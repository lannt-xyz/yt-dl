import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  secondary?: { label: string; onClick: () => void };
  onConfirm: () => void;
  onClose: () => void;
}

/** Bottom-sheet trên điện thoại, hộp thoại giữa màn hình trên màn hình lớn. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = "Để sau",
  secondary,
  onConfirm,
  onClose,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Đóng"
        tabIndex={-1}
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
        className="toast-in safe-bottom relative w-full max-w-md rounded-t-3xl border border-line bg-surface p-5 shadow-xl sm:rounded-3xl"
      >
        <h2 id="dlg-title" className="text-lg font-semibold">
          {title}
        </h2>
        <div className="mt-2 text-sm text-muted">{children}</div>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            className="h-12 flex-1 rounded-xl bg-accent px-4 font-semibold text-accent-ink"
          >
            {confirmLabel}
          </button>
          {secondary && (
            <button
              type="button"
              onClick={secondary.onClick}
              className="h-12 flex-1 rounded-xl bg-accent-soft px-4 font-semibold text-accent"
            >
              {secondary.label}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="h-12 flex-1 rounded-xl px-4 font-medium text-muted hover:bg-surface-2"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
