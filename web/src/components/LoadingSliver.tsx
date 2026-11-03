// LoadingSliverProps sizes the sliver.
interface LoadingSliverProps {
  // width is the track width, any CSS length.
  width: number | string;
}

// LoadingSliver is the indeterminate progress bar shared by the first-load
// splash and the globe imagery pill, matching the boot loader in index.html.
// The loading-sliver keyframes live in index.css.
export default function LoadingSliver({ width }: LoadingSliverProps) {
  return (
    <div
      aria-hidden
      className="mx-auto rounded-full overflow-hidden"
      style={{ width, height: 3, background: 'rgba(148,163,184,0.24)' }}
    >
      <div
        className="h-full rounded-full"
        style={{
          width: '32%',
          background: 'linear-gradient(90deg, transparent 0%, #93c5fd 50%, transparent 100%)',
          animation: 'loading-sliver 2400ms ease-in-out infinite',
          boxShadow: '0 0 18px rgba(147,197,253,0.5)',
        }}
      />
    </div>
  );
}
