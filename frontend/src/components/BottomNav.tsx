import clsx from "clsx";
import { Download, History } from "lucide-react";

export type Tab = "download" | "history";

interface Props {
  tab: Tab;
  onChange: (tab: Tab) => void;
  unseen: number;
  active: number;
}

export function BottomNav({ tab, onChange, unseen, active }: Props) {
  const items = [
    { key: "download" as const, label: "Tải về", icon: Download, badge: active },
    { key: "history" as const, label: "Lịch sử", icon: History, badge: unseen },
  ];
  return (
    <nav
      aria-label="Điều hướng chính"
      className="safe-bottom fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 backdrop-blur lg:hidden"
    >
      <ul className="mx-auto flex h-[4.25rem] max-w-md items-stretch">
        {items.map(({ key, label, icon: Icon, badge }) => (
          <li key={key} className="flex-1">
            <button
              type="button"
              onClick={() => onChange(key)}
              aria-current={tab === key ? "page" : undefined}
              className={clsx(
                "relative flex h-full w-full flex-col items-center justify-center gap-1 text-xs font-medium",
                tab === key ? "text-accent" : "text-muted",
              )}
            >
              <span className="relative">
                <Icon className="size-6" />
                {badge > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 grid min-w-[1.15rem] place-items-center rounded-full bg-accent px-1 text-[11px] leading-[1.15rem] font-bold text-accent-ink tabular-nums">
                    {badge > 9 ? "9+" : badge}
                  </span>
                )}
              </span>
              {label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
