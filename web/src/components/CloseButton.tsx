// CloseButton is the canonical "exit this mode" affordance. Every overlay,
// panel, modal, and replay uses this one component so the exit gesture
// reads the same everywhere: a small slate-tone ghost circle in the
// top-right corner with a thin × stroke. Removes the previous mix of
// chunky white pills, "Back to globe" labels, and bespoke per-component
// close styling that made exits feel inconsistent and confusing.
interface CloseButtonProps {
  // onClick fires when the user dismisses the surface.
  onClick: () => void;
  // label is read by assistive tech and shown as a tooltip. Defaults to
  // "Close (Esc)" because every dismissable surface in this app is also
  // wired to the Escape key.
  label?: string;
  // sticky positions the button as `position: sticky` so it stays
  // reachable in long scrolling panels. Default is non-sticky for
  // overlays where the close lives in a fixed header.
  sticky?: boolean;
  // tone optionally shifts the visual weight. The default "ghost" tone
  // blends into the panel; "elevated" gives a slightly stronger contrast
  // when the background is busy enough that the ghost vanishes.
  tone?: 'ghost' | 'elevated';
}

export default function CloseButton({
  onClick,
  label = 'Close (Esc)',
  sticky = false,
  tone = 'ghost',
}: CloseButtonProps) {
  const stickyClasses = sticky ? 'sticky top-3 z-10' : '';
  const toneClasses =
    tone === 'elevated'
      ? 'bg-slate-900/80 border-slate-600/70 text-slate-200 hover:text-white hover:bg-slate-800/95 hover:border-slate-400/80'
      : 'bg-slate-900/55 border-slate-700/60 text-slate-300 hover:text-white hover:bg-slate-800/80 hover:border-slate-500/80';
  return (
    <button
      onClick={onClick}
      className={`${stickyClasses} inline-flex items-center justify-center w-9 h-9 rounded-full backdrop-blur border ${toneClasses} transition-all focus:outline-none focus-visible:ring-1 focus-visible:ring-slate-300/70`}
      aria-label={label}
      title={label}
    >
      <svg
        width="12"
        height="12"
        viewBox="0 0 12 12"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        aria-hidden="true"
      >
        <path d="M2 2 L10 10 M10 2 L2 10" />
      </svg>
    </button>
  );
}
