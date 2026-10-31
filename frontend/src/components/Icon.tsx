/**
 * Inline SVG icons, replacing the emoji (✏️ 🗑) and unicode glyphs (▶ ⏸ ■)
 * previously used as controls.
 *
 * Emoji are font-dependent: they render as full-color Apple glyphs on macOS,
 * flat monochrome on Windows, and inconsistently on Android, so they cannot be
 * colored, sized or aligned with the rest of a control. These paths inherit
 * `currentColor` and the button's font-size instead.
 *
 * Every icon is decorative here -- each call site carries its own accessible
 * label -- so they are marked aria-hidden and kept out of the accessibility
 * tree rather than announced twice.
 */

type IconName = "play" | "pause" | "stop" | "pencil" | "trash";

const PATHS: Record<IconName, React.ReactNode> = {
  // Solid triangle, vertically centred on the optical middle rather than the
  // bounding box, so it does not look high inside a round button.
  play: <path d="M5 3.5v9l8-4.5-8-4.5Z" />,
  pause: (
    <>
      <rect x="4.5" y="3.5" width="2.5" height="9" rx="0.75" />
      <rect x="9" y="3.5" width="2.5" height="9" rx="0.75" />
    </>
  ),
  stop: <rect x="4" y="4" width="8" height="8" rx="1.25" />,
  pencil: (
    <path
      d="M11.2 2.3a1.6 1.6 0 0 1 2.3 2.3l-.8.8-2.3-2.3.8-.8ZM9.5 4l2.3 2.3-6 6-3 .7.7-3 6-6Z"
      fillRule="evenodd"
    />
  ),
  trash: (
    <>
      <path d="M6 2.5h3a.5.5 0 0 1 .5.5v.5h3a.5.5 0 0 1 0 1h-10a.5.5 0 0 1 0-1h3V3a.5.5 0 0 1 .5-.5Z" />
      <path
        d="M4 5.5h8l-.6 7a1 1 0 0 1-1 .9H5.6a1 1 0 0 1-1-.9L4 5.5Zm2.5 1.5v4.5h1V7h-1Zm2 0v4.5h1V7h-1Z"
        fillRule="evenodd"
      />
    </>
  ),
};

export default function Icon({
  name,
  size = "1em",
}: {
  name: IconName;
  size?: number | string;
}) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}
