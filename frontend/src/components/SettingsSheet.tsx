import { Settings, X } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { IconButton } from "./ui";
import { YtdlpSection } from "./YtdlpSection";

export function SettingsSheet({ onClose, children }: { onClose: () => void; children?: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-40 flex md:items-center md:justify-center">
      <button
        type="button"
        aria-label="Đóng"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 hidden bg-black/50 md:block"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="toast-in relative flex h-full w-full flex-col bg-bg md:h-auto md:max-h-[90dvh] md:max-w-xl md:overflow-hidden md:rounded-3xl md:border md:border-line md:shadow-2xl"
      >
        <header className="safe-top flex items-center gap-2 border-b border-line px-3 py-2">
          <IconButton label="Đóng" onClick={onClose}>
            <X className="size-5" />
          </IconButton>
          <h2 id="settings-title" className="flex items-center gap-2 text-base font-semibold">
            <Settings className="size-4 text-accent" /> Cài đặt
          </h2>
        </header>
        <div className="safe-bottom flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4">
          <YtdlpSection />
          {children}
        </div>
      </div>
    </div>
  );
}
