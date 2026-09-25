import type { ButtonHTMLAttributes } from "react";
import { Icon, type IconName } from "../../../design/icons.tsx";

export type CallControlTone = "neutral" | "accept" | "end" | "warn";

export interface CallControlProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> {
  /** Always-visible text label. State is never carried by color alone. */
  readonly label: string;
  readonly icon: IconName;
  readonly tone?: CallControlTone;
  /** Rotates the handset so the same glyph reads as hanging up. */
  readonly hangup?: boolean;
}

/** Large call control: a 72px disc with a visible label underneath. */
export function CallControl({
  label,
  icon,
  tone = "neutral",
  hangup = false,
  className,
  type = "button",
  ...rest
}: CallControlProps) {
  return (
    <button
      type={type}
      className={["call-control", "call-control--" + tone, className].filter(Boolean).join(" ")}
      {...rest}
    >
      <span className={"call-control__disc" + (hangup ? " call-control__disc--hangup" : "")}>
        <Icon name={icon} size={28} />
      </span>
      <span className="call-control__label">{label}</span>
    </button>
  );
}
