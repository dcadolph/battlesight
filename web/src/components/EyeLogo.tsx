// EyeLogo is the BattleSight mark used inline beside the wordmark. An eye
// silhouette in white with a small mushroom-cloud glyph for the pupil —
// the watchful eye on human conflict. Drawn at a 32x32 unit viewport so it
// stays crisp at every size; pass a height prop to scale.

interface EyeLogoProps {
  // size is the rendered height in pixels. Width tracks at the eye's
  // natural aspect ratio (~1.6 wider than tall).
  size?: number;
  // color is the stroke / fill color for both the eye outline and the
  // mushroom-cloud pupil. Defaults to the same blue accent used by the
  // "Sight" half of the wordmark.
  color?: string;
  // title is the accessible label; rendered as an SVG <title> element.
  title?: string;
}

export default function EyeLogo({ size = 22, color = '#60a5fa', title = 'BattleSight' }: EyeLogoProps) {
  const w = Math.round(size * 1.55);
  return (
    <svg
      width={w}
      height={size}
      viewBox="0 0 50 32"
      aria-label={title}
      role="img"
      style={{ display: 'inline-block', flexShrink: 0 }}
    >
      <title>{title}</title>
      {/* Outer almond. Two quadratic arcs meeting at the canthi. Stroked
          rather than filled so the iris reads inside. */}
      <path
        d="M 2 16 Q 25 1 48 16 Q 25 31 2 16 Z"
        fill="none"
        stroke={color}
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Iris ring framing the pupil cloud. Slightly inset so the eye does
          not look flat. */}
      <circle
        cx="25"
        cy="16"
        r="9"
        fill="none"
        stroke={color}
        strokeWidth="1.4"
      />
      {/* Mushroom cloud pupil. Three lobes for the cap, a tapered stalk,
          a thin ground line. Solid white fill against the dark page so the
          glyph reads even at 14px. */}
      <g fill={color}>
        {/* Cap: three overlapping ellipses form the billowing top. */}
        <ellipse cx="22" cy="12.5" rx="3.2" ry="2.4" />
        <ellipse cx="27.5" cy="12.5" rx="3.0" ry="2.3" />
        <ellipse cx="25" cy="11" rx="3.0" ry="2.4" />
        {/* Stalk: trapezoid narrowing toward the cloud. */}
        <path d="M 23.4 14 L 26.6 14 L 27.2 19 L 22.8 19 Z" />
        {/* Ground line: a flat platter under the stalk to suggest impact. */}
        <ellipse cx="25" cy="19.5" rx="4.2" ry="0.65" />
      </g>
    </svg>
  );
}
