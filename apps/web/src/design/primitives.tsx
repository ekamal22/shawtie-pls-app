import {
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { Icon, type IconName } from "./icons.tsx";
import { formatPresence, type PresenceInput } from "./presence.ts";

/*
 * Shared UX primitives (UX1). Surface branches compose these and add only surface-scoped
 * CSS. They never introduce competing buttons, sheets, dialogs, colors, or icon sets.
 */

function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* Buttons */

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly icon?: IconName;
  readonly compact?: boolean;
}

export function Button({
  variant = "secondary",
  icon,
  compact = false,
  className,
  type = "button",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "ds-button",
        "ds-button--" + variant,
        compact && "ds-button--compact",
        className,
      )}
      {...rest}
    >
      {icon ? <Icon name={icon} size={20} /> : null}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** Required accessible name. Icon-only controls must always be named. */
  readonly label: string;
  readonly icon: IconName;
  readonly variant?: ButtonVariant;
  readonly pressed?: boolean;
  readonly filled?: boolean;
}

export function IconButton({
  label,
  icon,
  variant = "quiet",
  pressed,
  filled,
  className,
  type = "button",
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      className={cx("ds-icon-button", "ds-button--" + variant, className)}
      {...rest}
    >
      <Icon name={icon} size={22} filled={filled ?? pressed ?? false} />
    </button>
  );
}

/* Small elements */

export function Chip({
  selected,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { readonly selected?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cx("ds-chip", selected && "is-selected", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Badge({
  tone = "neutral",
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLSpanElement> & { readonly tone?: "neutral" | "rose" | "candle" | "end" }) {
  return (
    <span className={cx("ds-badge", "ds-badge--" + tone, className)} {...rest}>
      {children}
    </span>
  );
}

/* Surfaces */

export type SurfaceKind = "room" | "paper" | "print" | "glass";

export function Card({
  surface = "room",
  as: Tag = "section",
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & {
  readonly surface?: SurfaceKind;
  readonly as?: "section" | "div" | "article";
}) {
  return (
    <Tag className={cx("ds-card", "ds-surface--" + surface, className)} {...rest}>
      {children}
    </Tag>
  );
}

export function SectionHeading({
  level = 2,
  kicker,
  children,
}: {
  readonly level?: 2 | 3;
  readonly kicker?: string;
  readonly children: ReactNode;
}) {
  const Tag = level === 2 ? "h2" : "h3";
  return (
    <div className="ds-section-heading">
      {kicker ? <p className="ds-kicker">{kicker}</p> : null}
      <Tag className="ds-editorial-title">{children}</Tag>
    </div>
  );
}

/** Editorial date: the day number large, month and year quiet. */
export function EditorialDate({
  value,
  className,
}: {
  readonly value: string;
  readonly className?: string;
}) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return (
    <time dateTime={value} className={cx("ds-editorial-date", className)}>
      <span className="ds-editorial-date__day">{date.getDate()}</span>
      <span className="ds-editorial-date__rest">
        {new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(date)}
      </span>
    </time>
  );
}

/* Identity */

export function PairMark({
  together = false,
  size = 28,
}: {
  readonly together?: boolean;
  readonly size?: number;
}) {
  return (
    <svg
      className={cx("ds-pair-mark", together && "is-together")}
      width={size}
      height={size * 0.64}
      viewBox="0 0 44 28"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx={together ? 18 : 14}
        cy="14"
        r="11"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <circle
        cx={together ? 26 : 30}
        cy="14"
        r="11"
        fill="none"
        stroke="var(--rose)"
        strokeWidth="2"
      />
    </svg>
  );
}

export function Avatar({ name, size = 40 }: { readonly name: string; readonly size?: number }) {
  const initial = Array.from(name.trim())[0]?.toUpperCase() ?? "?";
  return (
    <span
      className="ds-avatar"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden="true"
    >
      {initial}
    </span>
  );
}

/**
 * Quiet presence context. Presence, last seen, and typing are mutual and always on; this
 * component renders the authoritative state only and offers no way to hide it.
 */
export function PresenceLine({
  presence,
  typing = false,
  now,
}: {
  readonly presence: PresenceInput;
  readonly typing?: boolean;
  readonly now?: Date;
}) {
  const label = formatPresence(presence, now);
  return (
    <p className="ds-presence" data-online={presence.online ? "true" : "false"}>
      {presence.online ? <span className="ds-presence__dot" aria-hidden="true" /> : null}
      <span>{label}</span>
      {typing ? <span> {"·"} typing...</span> : null}
    </p>
  );
}

/* Feedback */

export function Notice({
  tone = "info",
  children,
  action,
}: {
  readonly tone?: "info" | "success" | "warning";
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className={cx("ds-notice", "ds-notice--" + tone)} role="status">
      <div>{children}</div>
      {action}
    </div>
  );
}

export function ErrorNotice({
  children,
  action,
}: {
  readonly children: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="ds-notice ds-notice--error" role="alert">
      <Icon name="alert" size={20} />
      <div>{children}</div>
      {action}
    </div>
  );
}

export function OfflineNotice({ children }: { readonly children?: ReactNode }) {
  return (
    <div className="ds-notice ds-notice--warning" role="status">
      <Icon name="offline" size={20} />
      <div>{children ?? "You're offline. Messages will send when you're back."}</div>
    </div>
  );
}

/**
 * Neutral lifecycle banner. Presentation of server-provided state only: it never persuades,
 * never adds urgency, and never restates deadlines the server did not supply.
 */
export function LifecycleBanner({
  title,
  children,
  action,
}: {
  readonly title: string;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="ds-lifecycle" role="status">
      <div>
        <strong>{title}</strong>
        {children ? <p>{children}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Skeleton({
  shape = "line",
  width,
}: {
  readonly shape?: "line" | "block" | "circle";
  readonly width?: string;
}) {
  return (
    <span
      className={cx("ds-skeleton", "ds-skeleton--" + shape)}
      style={width ? { width } : undefined}
      aria-hidden="true"
    />
  );
}

export function SkeletonGroup({
  label = "Loading",
  children,
}: {
  readonly label?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="ds-skeleton-group" role="status" aria-busy="true" aria-label={label}>
      {children}
    </div>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: {
  readonly title: string;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
}) {
  return (
    <div className="ds-empty">
      <p className="ds-empty__title">{title}</p>
      {children ? <p className="ds-empty__body">{children}</p> : null}
      {action}
    </div>
  );
}

/** Microphone and camera truth: icon, text, and state together, never color alone. */
export function MediaStateIndicator({
  device,
  on,
}: {
  readonly device: "microphone" | "camera";
  readonly on: boolean;
}) {
  const icon: IconName =
    device === "microphone" ? (on ? "mic" : "micOff") : on ? "camera" : "videoOff";
  const label =
    device === "microphone"
      ? on
        ? "Microphone on"
        : "Microphone off"
      : on
        ? "Camera on"
        : "Camera off";
  return (
    <span className="ds-media-state" data-state={on ? "on" : "off"}>
      <Icon name={icon} size={16} />
      {label}
    </span>
  );
}

/* Overlays: sheets and dialogs share one native <dialog> implementation. */

interface OverlayProps {
  readonly open: boolean;
  readonly onClose: () => void;
  readonly title: string;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}

function useModalDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) {
      if (typeof element.showModal === "function") element.showModal();
      else element.setAttribute("open", "");
    }
    if (!open && element.open) element.close();
  }, [open]);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const cancel = (event: Event) => {
      event.preventDefault();
      onClose();
    };
    element.addEventListener("cancel", cancel);
    return () => element.removeEventListener("cancel", cancel);
  }, [onClose]);
  return ref;
}

function Overlay({
  kind,
  open,
  onClose,
  title,
  children,
  footer,
}: OverlayProps & { readonly kind: "sheet" | "dialog" }) {
  const ref = useModalDialog(open, onClose);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      className={cx("ds-overlay", "ds-overlay--" + kind)}
      aria-labelledby={titleId}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="ds-overlay__panel">
        <header className="ds-overlay__header">
          <h2 id={titleId} className="ds-overlay__title">
            {title}
          </h2>
          <IconButton label="Close" icon="close" onClick={onClose} />
        </header>
        <div className="ds-overlay__body">{children}</div>
        {footer ? <footer className="ds-overlay__footer">{footer}</footer> : null}
      </div>
    </dialog>
  );
}

/** Bottom sheet on phones, centered panel on wide screens. */
export function Sheet(props: OverlayProps) {
  return <Overlay kind="sheet" {...props} />;
}

export function Dialog(props: OverlayProps) {
  return <Overlay kind="dialog" {...props} />;
}

/**
 * Confirmation dialog for consequential actions. States the consequence in plain words and
 * offers an explicit verb. The destructive button is never the initially focused control.
 */
export function ConfirmDialog({
  open,
  onCancel,
  onConfirm,
  title,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
  children,
}: {
  readonly open: boolean;
  readonly onCancel: () => void;
  readonly onConfirm: () => void;
  readonly title: string;
  readonly confirmLabel: string;
  readonly cancelLabel?: string;
  readonly destructive?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} autoFocus>
            {cancelLabel}
          </Button>
          <Button variant={destructive ? "danger" : "primary"} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}

/* Menu */

export interface MenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon?: IconName;
  readonly danger?: boolean;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

export function Menu({
  label,
  items,
  trigger,
}: {
  readonly label: string;
  readonly items: readonly MenuItem[];
  readonly trigger?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    listRef.current?.querySelector<HTMLElement>('[role="menuitem"]:not([disabled])')?.focus();
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const nodes = [
      ...(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ??
        []),
    ];
    const index = nodes.indexOf(document.activeElement as HTMLElement);
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      rootRef.current?.querySelector<HTMLElement>("[aria-haspopup]")?.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      nodes[(index + 1) % nodes.length]?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      nodes[(index - 1 + nodes.length) % nodes.length]?.focus();
    }
  }

  return (
    <div className="ds-menu" ref={rootRef}>
      <button
        type="button"
        className="ds-icon-button ds-button--quiet"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {trigger ?? <Icon name="more" size={22} />}
      </button>
      {open ? (
        <div
          id={menuId}
          className="ds-menu__list"
          role="menu"
          aria-label={label}
          ref={listRef}
          onKeyDown={onKeyDown}
        >
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              className={cx("ds-menu__item", item.danger && "is-danger")}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
            >
              {item.icon ? <Icon name={item.icon} size={20} /> : null}
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* Segmented control (tabs or radio semantics) */

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  kind = "radio",
}: {
  readonly label: string;
  readonly value: T;
  readonly options: ReadonlyArray<{ readonly value: T; readonly label: string }>;
  readonly onChange: (value: T) => void;
  readonly kind?: "radio" | "tabs";
}) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const delta = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const index = options.findIndex((option) => option.value === value);
    const next = options[(index + delta + options.length) % options.length];
    if (next) onChange(next.value);
  }
  return (
    <div
      className="ds-segmented"
      role={kind === "tabs" ? "tablist" : "radiogroup"}
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role={kind === "tabs" ? "tab" : "radio"}
            {...(kind === "tabs" ? { "aria-selected": selected } : { "aria-checked": selected })}
            tabIndex={selected ? 0 : -1}
            className={cx("ds-segmented__option", selected && "is-selected")}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
