import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  tone?: "default" | "danger" | "accent";
  children: ReactNode;
}

/** Nút icon có vùng chạm tối thiểu 44×44px. */
export function IconButton({ label, tone = "default", className, children, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx(
        "grid size-11 shrink-0 place-items-center rounded-xl transition-colors disabled:opacity-40",
        tone === "default" && "text-muted hover:bg-surface-2 hover:text-ink active:bg-surface-2",
        tone === "danger" && "text-muted hover:bg-bad/10 hover:text-bad active:bg-bad/10",
        tone === "accent" && "bg-accent-soft text-accent hover:brightness-95",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Chip({
  active,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={clsx(
        "h-10 shrink-0 rounded-full border px-4 text-sm font-medium transition-colors",
        active
          ? "border-accent bg-accent text-accent-ink"
          : "border-line bg-surface text-muted hover:text-ink",
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={clsx("rounded-2xl border border-line bg-surface", className)}>
      {children}
    </section>
  );
}
