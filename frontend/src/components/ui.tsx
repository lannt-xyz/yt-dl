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

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex min-h-12 cursor-pointer items-center gap-3 py-1">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{label}</span>
        {description && <span className="mt-0.5 block text-sm text-muted">{description}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={clsx(
          "relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50",
          checked ? "bg-accent" : "bg-surface-2 ring-1 ring-line ring-inset",
        )}
      >
        <span
          className={clsx(
            "absolute top-1 left-1 size-6 rounded-full bg-white shadow transition-transform",
            checked && "translate-x-6",
          )}
        />
      </button>
    </label>
  );
}
