import type { ReactElement, SVGProps } from "react";

/**
 * The single icon set. 24px grid, 1.75px rounded stroke. Outline is the resting state;
 * `filled` marks an active state. Icons are decorative: the caller supplies the accessible
 * name on the control that contains the icon.
 */
const PATHS = {
  home: "M4 11.5 12 4l8 7.5M6 10v9.5h12V10M10 19.5v-5h4v5",
  talk: "M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7a2.5 2.5 0 0 1-2.5 2.5H11l-4.5 3.5V16A2.5 2.5 0 0 1 5 13.5z",
  ours: "M9.5 6.2a5.8 5.8 0 1 0 0 11.6 5.8 5.8 0 0 0 0-11.6ZM14.5 6.2a5.8 5.8 0 1 1 0 11.6 5.8 5.8 0 0 1 0-11.6Z",
  us: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4.5 20a7.5 7.5 0 0 1 15 0",
  plus: "M12 5v14M5 12h14",
  close: "M6 6l12 12M18 6 6 18",
  send: "M4 12 20 4l-4.5 16-3.5-6.5z",
  back: "M14.5 5 7.5 12l7 7",
  forward: "M9.5 5l7 7-7 7",
  more: "M6 12h.01M12 12h.01M18 12h.01",
  check: "M5 12.5l4.5 4.5L19 7.5",
  alert:
    "M12 8v5M12 16.5h.01M10.3 4.5 3.4 17a2 2 0 0 0 1.7 3h13.8a2 2 0 0 0 1.7-3L13.7 4.5a2 2 0 0 0-3.4 0Z",
  offline: "M3 3l18 18M8.5 8.5A9 9 0 0 0 4 11M12 6a13 13 0 0 1 8 3M8 15a6 6 0 0 1 3-1.6M12 19h.01",
  ribbon: "M7 4h10v16l-5-3.5L7 20z",
  letter: "M5 5h14v14H5zM5 8.5l7 4.5 7-4.5",
  mic: "M12 15a3 3 0 0 0 3-3V7a3 3 0 0 0-6 0v5a3 3 0 0 0 3 3ZM6 11.5a6 6 0 0 0 12 0M12 17.5V21",
  micOff:
    "M4 4l16 16M9 9v3a3 3 0 0 0 4.5 2.6M15 10.5V7a3 3 0 0 0-5.7-1.3M6 11.5a6 6 0 0 0 9 5.2M12 17.5V21",
  phone:
    "M6.5 4h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5l1.5-2 4 1.5v3a2 2 0 0 1-2 2A15 15 0 0 1 4.5 6a2 2 0 0 1 2-2Z",
  video:
    "M4 7.5A1.5 1.5 0 0 1 5.5 6h8A1.5 1.5 0 0 1 15 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-8A1.5 1.5 0 0 1 4 16.5zM15 10.5l5-3v9l-5-3",
  videoOff:
    "M4 4l16 16M5.5 6h8A1.5 1.5 0 0 1 15 7.5V12M15 16.5A1.5 1.5 0 0 1 13.5 18h-8A1.5 1.5 0 0 1 4 16.5v-9M15 10.5l5-3v9",
  camera:
    "M4.5 8.5A1.5 1.5 0 0 1 6 7h2l1.2-2h5.6L16 7h2a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 18 19H6a1.5 1.5 0 0 1-1.5-1.5zM12 16a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
  flip: "M4 12a8 8 0 0 1 13.5-5.8L20 8.5M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.5 5.8L4 15.5M4 20v-4.5h4.5",
  clock: "M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM12 8v4.5l3 1.5",
  heart: "M12 19.5s-7-4.3-7-9.4A4 4 0 0 1 12 7.6a4 4 0 0 1 7 2.5c0 5.1-7 9.4-7 9.4Z",
  speaker: "M5 9.5h3l4-3.5v12l-4-3.5H5zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11",
  image: "M5 5h14v14H5zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM5 16l4.5-4.5L14 16l2-2 3 3",
} as const;

export type IconName = keyof typeof PATHS;

export const ICON_NAMES = Object.keys(PATHS) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "name"> {
  readonly name: IconName;
  readonly size?: number;
  readonly filled?: boolean;
}

export function Icon({ name, size = 24, filled = false, ...rest }: IconProps): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      fillOpacity={filled ? 0.18 : undefined}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
