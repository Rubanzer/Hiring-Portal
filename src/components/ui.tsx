import * as React from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Small shared UI vocabulary. Deliberately hand-rolled and tiny — every screen in this app is
 * a form, a table or a board, and a component library would be more surface area than help.
 */

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const BUTTON_VARIANTS = {
  primary: "bg-ink-900 text-white hover:bg-ink-800 focus-visible:outline-ink-900",
  secondary:
    "bg-white text-ink-800 border border-ink-300 hover:bg-ink-100 focus-visible:outline-ink-400",
  danger: "bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600",
  ghost: "text-ink-600 hover:bg-ink-100 hover:text-ink-900 focus-visible:outline-ink-400",
} as const;

const BUTTON_SIZES = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-11 px-5 text-base",
} as const;

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2",
        "disabled:cursor-not-allowed disabled:opacity-50",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

export function LinkButton({
  variant = "primary",
  size = "md",
  className,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: keyof typeof BUTTON_VARIANTS;
  size?: keyof typeof BUTTON_SIZES;
}) {
  return (
    <a
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors",
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        className,
      )}
      {...props}
    />
  );
}

const FIELD_BASE =
  "w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 " +
  "placeholder:text-ink-400 focus:border-ink-500 focus:outline-none focus:ring-2 focus:ring-ink-200 " +
  "disabled:bg-ink-100 disabled:text-ink-500";

export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(FIELD_BASE, "h-10", className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(FIELD_BASE, "min-h-20", className)} {...props} />;
}

export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(FIELD_BASE, "h-10 pr-8", className)} {...props} />;
}

export function Label({
  className,
  required,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label className={cn("block text-sm font-medium text-ink-700", className)} {...props}>
      {children}
      {required ? <span className="ml-0.5 text-red-600">*</span> : null}
    </label>
  );
}

export function Field({
  label,
  hint,
  error,
  required,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {children}
      {hint && !error ? <p className="text-xs text-ink-500">{hint}</p> : null}
      {error ? <p className="text-xs font-medium text-red-600">{error}</p> : null}
    </div>
  );
}

export function Card({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-xl border border-ink-200 bg-white shadow-sm", className)}
      {...props}
    />
  );
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-ink-200 px-5 py-4">
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-ink-900">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-sm text-ink-500">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Badge({
  className,
  color,
  children,
}: {
  className?: string;
  /** Hex colour from the stage row; renders as a tinted pill. */
  color?: string;
  children: React.ReactNode;
}) {
  if (color) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
          className,
        )}
        style={{ backgroundColor: `${color}1a`, color }}
      >
        {children}
      </span>
    );
  }
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full bg-ink-100 px-2 py-0.5 text-xs font-medium text-ink-700",
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Alert({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "success" | "warning" | "error";
  title?: string;
  children?: React.ReactNode;
}) {
  const tones = {
    info: "border-sky-200 bg-sky-50 text-sky-900",
    success: "border-green-200 bg-green-50 text-green-900",
    warning: "border-amber-200 bg-amber-50 text-amber-900",
    error: "border-red-200 bg-red-50 text-red-900",
  } as const;

  return (
    <div className={cn("rounded-lg border px-4 py-3 text-sm", tones[tone])}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? "mt-1" : ""}>{children}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <p className="text-sm font-semibold text-ink-800">{title}</p>
      {description ? (
        <p className="max-w-md text-sm text-ink-500">{description}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink-900">{title}</h1>
        {description ? <p className="mt-1 text-sm text-ink-500">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Wide content — tables, boards — scrolls inside this, so the page body never does. */
export function ScrollArea({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("board-scroll overflow-x-auto", className)} {...props} />;
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink-900">{value}</p>
      {hint ? <p className="mt-0.5 text-xs text-ink-500">{hint}</p> : null}
    </Card>
  );
}

export function formatCurrency(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `₹${value.toLocaleString("en-IN")}`;
}

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
