import { IMAGERY_LINKS } from '../../lib/globe/imagery';
import type { ImageryStage } from '../../lib/globe/imagery';

// ImageryAttributionProps configures the attribution strip.
interface ImageryAttributionProps {
  // stage picks the credit for the imagery on screen.
  stage: ImageryStage;
  // position is fixed for the landing globe and absolute inside the replay stage.
  position: 'fixed' | 'absolute';
}

// linkClass styles the credit links.
const linkClass = 'underline decoration-slate-500/60 underline-offset-2 hover:text-slate-100';

// ImageryAttribution renders the hairline credit for the globe imagery in the
// bottom-right corner. The text is the attribution EOX publishes for the
// layer, with its two links live.
export default function ImageryAttribution({ stage, position }: ImageryAttributionProps) {
  return (
    <div
      className={`${position} bottom-1 right-2 z-[25] max-w-[calc(100vw-16px)] text-right text-[11px] leading-snug text-slate-300/70`}
      style={{ textShadow: '0 1px 2px rgba(0,0,0,0.8)' }}
    >
      {stage === 'stock' ? (
        <span>Imagery: NASA Blue Marble</span>
      ) : (
        <span>
          EOxCloudless{' '}
          <a className={linkClass} href={IMAGERY_LINKS.eox} target="_blank" rel="noopener noreferrer">
            https://cloudless.eox.at
          </a>{' '}
          by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016) released under{' '}
          <a className={linkClass} href={IMAGERY_LINKS.license} target="_blank" rel="noopener noreferrer">
            Creative Commons Attribution 4.0 International License
          </a>
          .
        </span>
      )}
    </div>
  );
}
