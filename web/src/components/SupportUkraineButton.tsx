// DONATE_URL is United24, the official fundraising platform of Ukraine.
export const DONATE_URL = 'https://u24.gov.ua/donate';

// SupportUkraineButton is the always-visible donation link in the header
// row, in Ukraine's blue and yellow. It is 44 px tall so it is an easy tap
// on a phone.
export default function SupportUkraineButton() {
  return (
    <a
      href={DONATE_URL}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="support-ukraine"
      className="inline-flex items-center h-11 px-1.5 rounded-full font-semibold whitespace-nowrap transition-transform hover:scale-[1.03] focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300/80"
      style={{
        background: 'linear-gradient(180deg, #0057b7 0%, #0057b7 50%, #ffd700 50%, #ffd700 100%)',
        border: '1px solid rgba(255,255,255,0.35)',
        boxShadow: '0 6px 20px -6px rgba(0,87,183,0.7)',
      }}
      title="Donate to Ukraine's defense through United24"
    >
      <span
        className="rounded-full px-3 py-1.5 text-[12px] tracking-[0.04em]"
        style={{ background: 'rgba(8,10,18,0.85)', color: '#ffd700' }}
      >
        Support Ukraine
      </span>
    </a>
  );
}
