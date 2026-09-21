// A handful of inline icons so the app has no icon-font dependency.
type IconName = "logo" | "plus" | "copy" | "check" | "send" | "refresh" | "back" | "sparkle" | "mic";

const PATHS: Record<IconName, string> = {
  logo: "M12 3a4 4 0 0 1 4 4v5a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4Zm-6 9a6 6 0 0 0 12 0h2a8 8 0 0 1-7 7.94V22h-2v-2.06A8 8 0 0 1 4 12h2Z",
  mic: "M12 3a4 4 0 0 1 4 4v5a4 4 0 0 1-8 0V7a4 4 0 0 1 4-4Zm-6 9a6 6 0 0 0 12 0h2a8 8 0 0 1-7 7.94V22h-2v-2.06A8 8 0 0 1 4 12h2Z",
  plus: "M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6V5Z",
  copy: "M8 3h10a2 2 0 0 1 2 2v10h-2V5H8V3Zm-4 4h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm0 2v10h10V9H4Z",
  check: "M9.5 16.2 5.3 12l1.4-1.4 2.8 2.8 7.8-7.8L18.7 7l-9.2 9.2Z",
  send: "M3 11 21 3l-8 18-2-7-8-3Zm5.6 0 4.4 1.7 1.7 4.4 4.2-11.5L8.6 11Z",
  refresh: "M12 5a7 7 0 0 1 6.3 4H16v2h6V5h-2v2.6A9 9 0 0 0 3 12h2a7 7 0 0 1 7-7Zm7 7a7 7 0 0 1-13.3 3H8v-2H2v6h2v-2.6A9 9 0 0 0 21 12h-2Z",
  back: "M15.4 6.4 9.8 12l5.6 5.6-1.4 1.4-7-7 7-7 1.4 1.4Z",
  sparkle: "M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2Zm6 12 1 2.6 2.6 1-2.6 1L18 21l-1-2.4-2.6-1 2.6-1 1-2.6ZM5 14l.8 2 2 .8-2 .8L5 20l-.8-2.4-2-.8 2-.8L5 14Z",
};

export function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
