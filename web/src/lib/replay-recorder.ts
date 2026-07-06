// replay-recorder captures a battle replay to a video file, entirely
// client side. The WebGL canvases (MapLibre basemap + deck.gl action
// layer) are composited onto an offscreen canvas each frame, and the
// HTML chrome that lives outside WebGL (unit label pills, the phase
// title slate) is re-drawn onto the composite in 2D so the export
// matches what the viewer saw. The composite streams through
// MediaRecorder; stopping resolves a Blob ready for download.

// RecorderChrome is the per-frame overlay text the host supplies:
// the phase eyebrow ("PHASE 03 · SHORTLY AFTER..."), the phase title,
// and the era accent color for the rule under the title.
export interface RecorderChrome {
  eyebrow: string;
  title: string;
  accent: string;
  titleFont: string;
}

// RecorderSession owns one in-flight recording.
export class RecorderSession {
  private composite: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private recorder: MediaRecorder;
  private chunks: Blob[] = [];
  private raf = 0;
  private stopped = false;
  private container: HTMLElement;
  private getChrome: () => RecorderChrome;
  private done: Promise<Blob>;
  private resolveDone!: (b: Blob) => void;

  // mimeType is the container/codec MediaRecorder agreed to.
  readonly mimeType: string;

  constructor(container: HTMLElement, getChrome: () => RecorderChrome) {
    this.container = container;
    this.getChrome = getChrome;

    const rect = container.getBoundingClientRect();
    const scale = Math.min(2, window.devicePixelRatio || 1);
    this.composite = document.createElement('canvas');
    this.composite.width = Math.round(rect.width * scale);
    this.composite.height = Math.round(rect.height * scale);
    const ctx = this.composite.getContext('2d');
    if (!ctx) throw new Error('replay recorder: no 2d context');
    this.ctx = ctx;
    this.ctx.scale(scale, scale);

    this.mimeType = pickMimeType();
    const stream = this.composite.captureStream(30);
    this.recorder = new MediaRecorder(stream, {
      mimeType: this.mimeType,
      videoBitsPerSecond: 8_000_000,
    });
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.done = new Promise((resolve) => {
      this.resolveDone = resolve;
    });
    this.recorder.onstop = () => {
      this.resolveDone(new Blob(this.chunks, { type: this.mimeType }));
    };
    this.recorder.start(1000);
    this.tick();
  }

  // tick composites one frame: WebGL canvases, then label pills, then
  // the phase slate.
  private tick = () => {
    if (this.stopped) return;
    const rect = this.container.getBoundingClientRect();
    const { ctx } = this;
    ctx.fillStyle = '#0d0a08';
    ctx.fillRect(0, 0, rect.width, rect.height);

    for (const canvas of Array.from(this.container.querySelectorAll('canvas'))) {
      const c = canvas as HTMLCanvasElement;
      if (c.width === 0 || c.height === 0) continue;
      const cr = c.getBoundingClientRect();
      try {
        ctx.drawImage(c, cr.left - rect.left, cr.top - rect.top, cr.width, cr.height);
      } catch {
        // A mid-resize frame can throw; skip it.
      }
    }

    this.drawLabels(rect);
    this.drawSlate(rect);
    this.raf = requestAnimationFrame(this.tick);
  };

  // drawLabels re-renders the HTML unit/movement pills. Position comes
  // from each pill's live translate3d transform (the exact anchor the
  // imperative positioner wrote); text, color, and leader length come
  // from data attributes.
  private drawLabels(rect: DOMRect) {
    const { ctx } = this;
    const labels = this.container.querySelectorAll<HTMLElement>('[data-rec-label]');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const el of Array.from(labels)) {
      if (el.style.visibility === 'hidden') continue;
      const wrapOpacity = parseFloat(getComputedStyle(el.parentElement as Element).opacity || '1');
      if (wrapOpacity < 0.05) continue;
      const m = /translate3d\(([-\d.]+)px, ([-\d.]+)px/.exec(el.style.transform);
      if (!m) continue;
      const ax = parseFloat(m[1]);
      const ay = parseFloat(m[2]);
      if (ax < -40 || ay < -40 || ax > rect.width + 40 || ay > rect.height + 40) continue;
      const text = (el.dataset.recLabel || '').toUpperCase();
      const color = el.dataset.recColor || '#ffffff';
      const lift = parseFloat(el.dataset.recLift || '26');
      ctx.globalAlpha = wrapOpacity;
      ctx.font = '600 12px Inter, system-ui, sans-serif';
      const w = ctx.measureText(text).width + 24;
      const h = 26;
      ctx.fillStyle = 'rgba(14,10,7,0.88)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.roundRect(ax - w / 2, ay - lift - h, w, h, 6);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, ax, ay - lift - h / 2);
      ctx.strokeStyle = `${color}cc`;
      ctx.beginPath();
      ctx.moveTo(ax, ay - lift);
      ctx.lineTo(ax, ay);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // drawSlate renders the phase eyebrow, title, and accent rule at the
  // top center, matching the live chrome's typography.
  private drawSlate(rect: DOMRect) {
    const { ctx } = this;
    const chrome = this.getChrome();
    if (!chrome.title) return;
    const cx = rect.width / 2;
    const topY = rect.height * 0.07;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowBlur = 14;
    ctx.font = '600 11px Inter, system-ui, sans-serif';
    ctx.fillStyle = chrome.accent;
    ctx.fillText(chrome.eyebrow.toUpperCase(), cx, topY);
    ctx.font = `600 38px ${chrome.titleFont}`;
    ctx.fillStyle = '#ffffff';
    ctx.fillText(chrome.title, cx, topY + 22);
    ctx.shadowBlur = 0;
    const grad = ctx.createLinearGradient(cx - 88, 0, cx + 88, 0);
    grad.addColorStop(0, 'transparent');
    grad.addColorStop(0.5, chrome.accent);
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(cx - 88, topY + 74, 176, 2);
  }

  // stop ends the capture and resolves the finished video blob.
  async stop(): Promise<Blob> {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    if (this.recorder.state !== 'inactive') this.recorder.stop();
    return this.done;
  }
}

// pickMimeType returns the best container the browser can record.
// Safari records MP4/H.264; Chromium records WebM.
function pickMimeType(): string {
  const candidates = [
    'video/mp4;codecs=avc1',
    'video/mp4',
    'video/webm;codecs=vp9',
    'video/webm',
  ];
  for (const c of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(c)) return c;
  }
  return '';
}

// recordingSupported reports whether this browser can export video.
export function recordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && pickMimeType() !== '';
}

// downloadBlob saves the finished recording with a battle-named file.
export function downloadBlob(blob: Blob, baseName: string, mimeType: string) {
  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${baseName}.${ext}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
