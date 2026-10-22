import {
  ExifMetadata,
  MediaItem,
  WatermarkCoreSettings,
  WatermarkLogo,
  WatermarkSettings,
} from '../types/localmark';
import {
  calculateLogoPlacement,
  calculatePositionOnCanvas,
  calculateTargetDimensions,
  classifyResolutionGroup,
  getEffectiveDimensions,
  getMergedSettingsForGroup,
  getMergedSettingsForItem,
  parseExifFromJpegBytes,
} from './watermarkEngine';

// Cache loaded HTMLImageElements by URL for instant live preview rendering
const imageElementCache = new Map<string, HTMLImageElement>();

export function loadImageElement(src: string): Promise<HTMLImageElement> {
  const cached = imageElementCache.get(src);
  if (cached && cached.complete && cached.naturalWidth > 0) {
    return Promise.resolve(cached);
  }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (imageElementCache.size > 60) {
        const firstKey = imageElementCache.keys().next().value;
        if (firstKey) imageElementCache.delete(firstKey);
      }
      imageElementCache.set(src, img);
      resolve(img);
    };
    img.onerror = () => reject(new Error('Failed to decode image source'));
    img.src = src;
  });
}

/**
 * Generates default studio watermark logo (crisp geometric emblem + wordmark) as a PNG Data URL.
 */
export function createDefaultLogo(variant: 'light' | 'badge' | 'minimal' = 'light'): WatermarkLogo {
  const canvas = document.createElement('canvas');
  canvas.width = 480;
  canvas.height = 160;
  const ctx = canvas.getContext('2d')!;

  ctx.clearRect(0, 0, 480, 160);

  if (variant === 'badge') {
    // Rounded studio badge
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.roundRect(8, 8, 464, 144, 24);
    ctx.fill();
    ctx.stroke();
  }

  // Camera aperture / shutter geometric mark
  const cx = 82;
  const cy = 80;
  const r = 46;

  const grad = ctx.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  grad.addColorStop(0, '#6366f1');
  grad.addColorStop(1, '#a855f7');

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();

  // Inner aperture blades
  ctx.strokeStyle = 'rgba(255,255,255,0.92)';
  ctx.lineWidth = 2.5;
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(angle) * 16, cy + Math.sin(angle) * 16);
    ctx.lineTo(cx + Math.cos(angle + 0.7) * 42, cy + Math.sin(angle + 0.7) * 42);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, 15, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Studio typography
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 42px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('LOCALMARK', 148, 82);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.82)';
  ctx.font = '600 18px "JetBrains Mono", monospace';
  ctx.fillText('STUDIO PROOF • ARCHIVE', 150, 114);

  const dataUrl = canvas.toDataURL('image/png');
  return {
    name: variant === 'badge' ? 'localmark_badge_logo.png' : 'localmark_studio_logo.png',
    dataUrl,
    width: 480,
    height: 160,
    sizeBytes: Math.round(dataUrl.length * 0.75),
    mimeType: 'image/png',
  };
}

export interface DemoSceneSpec {
  id: string;
  name: string;
  path: string;
  mediaType: 'image' | 'video';
  mimeType: string;
  rawWidth: number;
  rawHeight: number;
  sizeBytes: number;
  durationSec?: number;
  exif: ExifMetadata;
  isCorrupted?: boolean;
  palette: [string, string, string];
  subjectLabel: string;
}

export const DEMO_STUDIO_SCENES: DemoSceneSpec[] = [
  {
    id: 'scene_16_9',
    name: 'alpine_ridge_sunrise.jpg',
    path: 'C:\\Users\\Studio\\Pictures\\Shoot_2026_10\\alpine_ridge_sunrise.jpg',
    mediaType: 'image',
    mimeType: 'image/jpeg',
    rawWidth: 2560,
    rawHeight: 1440,
    sizeBytes: 4_820_400,
    exif: {
      make: 'Sony',
      model: 'ILCE-7RM5',
      lens: 'FE 24-70mm F2.8 GM II',
      iso: 100,
      aperture: 'f/8.0',
      shutterSpeed: '1/250s',
      focalLength: '35mm',
      orientation: 1,
      dateTaken: '2026:10:18 06:42:11',
      colorSpace: 'sRGB',
      software: 'Capture One 23 Windows',
    },
    palette: ['#0f172a', '#1e3a8a', '#f59e0b'],
    subjectLabel: 'Dolomites Alpine Sunrise',
  },
  {
    id: 'scene_portrait_3_4',
    name: 'editorial_portrait_studio_4k.jpg',
    path: 'C:\\Users\\Studio\\Pictures\\Shoot_2026_10\\editorial_portrait_studio_4k.jpg',
    mediaType: 'image',
    mimeType: 'image/jpeg',
    rawWidth: 6000,
    rawHeight: 4000, // With EXIF orientation 6 -> effective 4000x6000 -> Portrait 3:4 / 2:3!
    sizeBytes: 9_450_120,
    exif: {
      make: 'Canon',
      model: 'EOS R5',
      lens: 'RF 85mm F1.2 L USM',
      iso: 160,
      aperture: 'f/2.0',
      shutterSpeed: '1/500s',
      focalLength: '85mm',
      orientation: 6,
      dateTaken: '2026:10:19 14:15:04',
      colorSpace: 'Adobe RGB',
      software: 'Adobe Photoshop Lightroom Classic 14.0',
    },
    palette: ['#18181b', '#3f3f46', '#e11d48'],
    subjectLabel: 'Editorial Studio Portrait (EXIF Rotated)',
  },
  {
    id: 'scene_4k_landscape',
    name: 'architectural_pavilion_8k.tiff',
    path: 'C:\\Users\\Studio\\Pictures\\Shoot_2026_10\\architectural_pavilion_8k.tiff',
    mediaType: 'image',
    mimeType: 'image/tiff',
    rawWidth: 5120,
    rawHeight: 2880,
    sizeBytes: 24_110_800,
    exif: {
      make: 'Hasselblad',
      model: 'X2D 100C',
      lens: 'XCD 38V f/2.5',
      iso: 64,
      aperture: 'f/5.6',
      shutterSpeed: '1/125s',
      focalLength: '38mm',
      orientation: 1,
      dateTaken: '2026:10:19 17:30:22',
      colorSpace: 'sRGB',
      software: 'Phocus 3.8',
    },
    palette: ['#090d16', '#0f766e', '#38bdf8'],
    subjectLabel: 'Nordic Glass Pavilion (5K Master)',
  },
  {
    id: 'scene_panoramic',
    name: 'iceland_glacier_pano.webp',
    path: 'C:\\Users\\Studio\\Pictures\\Shoot_2026_10\\iceland_glacier_pano.webp',
    mediaType: 'image',
    mimeType: 'image/webp',
    rawWidth: 4800,
    rawHeight: 1800,
    sizeBytes: 6_190_000,
    exif: {
      make: 'Fujifilm',
      model: 'GFX100 II',
      lens: 'GF 20-35mmF4 R WR',
      iso: 80,
      aperture: 'f/11.0',
      shutterSpeed: '1/60s',
      focalLength: '24mm',
      orientation: 1,
      dateTaken: '2026:10:20 09:12:40',
      colorSpace: 'sRGB',
      software: 'PTGui Pro 12.24',
    },
    palette: ['#082f49', '#0284c7', '#e0f2fe'],
    subjectLabel: 'Vatnajökull Ultra-Wide Panorama',
  },
  {
    id: 'scene_square',
    name: 'chronograph_macro_1x1.png',
    path: 'C:\\Users\\Studio\\Pictures\\Shoot_2026_10\\chronograph_macro_1x1.png',
    mediaType: 'image',
    mimeType: 'image/png',
    rawWidth: 2048,
    rawHeight: 2048,
    sizeBytes: 5_340_200,
    exif: {
      make: 'Leica',
      model: 'SL3',
      lens: 'APO-Macro-Elmarit-TL 60mm f/2.8',
      iso: 100,
      aperture: 'f/9.0',
      shutterSpeed: '1/160s',
      focalLength: '60mm',
      orientation: 1,
      dateTaken: '2026:10:20 11:04:19',
      colorSpace: 'sRGB',
      software: 'Capture One 23 Windows',
    },
    palette: ['#111827', '#374151', '#d97706'],
    subjectLabel: 'Horology Macro Product 1:1',
  },
  {
    id: 'scene_portrait_9_16',
    name: 'tokyo_neon_reel_vertical.mp4',
    path: 'C:\\Users\\Studio\\Videos\\Reels\\tokyo_neon_reel_vertical.mp4',
    mediaType: 'video',
    mimeType: 'video/mp4',
    rawWidth: 1080,
    rawHeight: 1920,
    durationSec: 28,
    sizeBytes: 38_450_000,
    exif: {
      make: 'Sony',
      model: 'FX3 Cinema Line',
      lens: 'FE 35mm F1.4 GM',
      iso: 800,
      aperture: 'f/1.8',
      shutterSpeed: '1/50s',
      focalLength: '35mm',
      orientation: 1,
      dateTaken: '2026:10:20 21:44:00',
      colorSpace: 'Rec.709',
      software: 'DaVinci Resolve Studio 19',
    },
    palette: ['#1e1b4b', '#4338ca', '#ec4899'],
    subjectLabel: 'Shinjuku Rain B-Roll (1080p Vertical Video)',
  },
  {
    id: 'scene_landscape_std',
    name: 'coastal_cliff_aerial_3x2.jpg',
    path: 'C:\\Users\\Studio\\Pictures\\Shoot_2026_10\\coastal_cliff_aerial_3x2.jpg',
    mediaType: 'image',
    mimeType: 'image/jpeg',
    rawWidth: 3000,
    rawHeight: 2000,
    sizeBytes: 4_120_500,
    exif: {
      make: 'Nikon',
      model: 'Z8',
      lens: 'NIKKOR Z 24-120mm f/4 S',
      iso: 64,
      aperture: 'f/7.1',
      shutterSpeed: '1/400s',
      focalLength: '50mm',
      orientation: 1,
      dateTaken: '2026:10:21 15:20:09',
      colorSpace: 'sRGB',
      software: 'NX Studio 1.6',
    },
    palette: ['#042f2e', '#0d9488', '#fde047'],
    subjectLabel: 'Big Sur Coastal Aerial (3:2 Standard)',
  },
  {
    id: 'scene_ultra_tall',
    name: 'infographic_vertical_stitch.png',
    path: 'C:\\Users\\Studio\\Pictures\\Shoot_2026_10\\infographic_vertical_stitch.png',
    mediaType: 'image',
    mimeType: 'image/png',
    rawWidth: 900,
    rawHeight: 2200,
    sizeBytes: 2_890_000,
    exif: {
      make: 'LocalMark',
      model: 'StitchEngine',
      orientation: 1,
      dateTaken: '2026:10:21 16:05:12',
      colorSpace: 'sRGB',
      software: 'Figma Desktop Windows',
    },
    palette: ['#172554', '#2563eb', '#93c5fd'],
    subjectLabel: 'Vertical Architecture Blueprint',
  },
  {
    id: 'scene_very_small',
    name: 'client_avatar_badge_640.webp',
    path: 'C:\\Users\\Studio\\Pictures\\Thumbs\\client_avatar_badge_640.webp',
    mediaType: 'image',
    mimeType: 'image/webp',
    rawWidth: 640,
    rawHeight: 480,
    sizeBytes: 142_800,
    exif: {
      make: 'Apple',
      model: 'iPhone 16 Pro',
      lens: 'Main Camera 24mm',
      iso: 50,
      aperture: 'f/1.78',
      shutterSpeed: '1/1000s',
      focalLength: '24mm',
      orientation: 1,
      dateTaken: '2026:10:21 18:00:00',
      colorSpace: 'Display P3',
      software: 'iOS 18.1',
    },
    palette: ['#312e81', '#6366f1', '#c7d2fe'],
    subjectLabel: 'Web Proof Thumbnail (640×480)',
  },
  {
    id: 'scene_video_16_9',
    name: 'drone_showreel_4k_master.mp4',
    path: 'C:\\Users\\Studio\\Videos\\Masters\\drone_showreel_4k_master.mp4',
    mediaType: 'video',
    mimeType: 'video/mp4',
    rawWidth: 1920,
    rawHeight: 1080,
    durationSec: 45,
    sizeBytes: 64_900_000,
    exif: {
      make: 'DJI',
      model: 'Mavic 3 Pro Cine',
      lens: 'Hasselblad 24mm Eq.',
      iso: 100,
      aperture: 'f/4.0',
      shutterSpeed: '1/120s',
      focalLength: '24mm',
      orientation: 1,
      dateTaken: '2026:10:21 18:30:00',
      colorSpace: 'D-Log M',
      software: 'FFmpeg Lavf61.1.100',
    },
    palette: ['#0c4a6e', '#0369a1', '#38bdf8'],
    subjectLabel: 'Coastal Drone Showreel (1080p60)',
  },
];

/**
 * Draws a rich procedural photographic scene onto a given 2D canvas context.
 */
export function drawProceduralScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  spec: DemoSceneSpec
) {
  const [c1, c2, c3] = spec.palette;
  const skyGrad = ctx.createLinearGradient(0, 0, width * 0.3, height);
  skyGrad.addColorStop(0, c1);
  skyGrad.addColorStop(0.58, c2);
  skyGrad.addColorStop(1, c3);
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, width, height);

  // Sun / key light glow
  const sunX = width * 0.72;
  const sunY = height * 0.28;
  const sunR = Math.min(width, height) * 0.35;
  const radial = ctx.createRadialGradient(sunX, sunY, sunR * 0.05, sunX, sunY, sunR);
  radial.addColorStop(0, 'rgba(255, 250, 235, 0.85)');
  radial.addColorStop(0.4, 'rgba(255, 255, 255, 0.22)');
  radial.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = radial;
  ctx.fillRect(0, 0, width, height);

  // Layered mountain / architectural silhouettes for realistic contrast & split-slider comparison
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, height * 0.68);
  ctx.lineTo(width * 0.22, height * 0.44);
  ctx.lineTo(width * 0.46, height * 0.59);
  ctx.lineTo(width * 0.71, height * 0.38);
  ctx.lineTo(width, height * 0.56);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = 'rgba(15, 23, 42, 0.55)';
  ctx.fill();

  // Foreground ridge
  ctx.beginPath();
  ctx.moveTo(0, height * 0.8);
  ctx.lineTo(width * 0.34, height * 0.58);
  ctx.lineTo(width * 0.62, height * 0.74);
  ctx.lineTo(width * 0.88, height * 0.52);
  ctx.lineTo(width, height * 0.66);
  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = 'rgba(9, 13, 22, 0.82)';
  ctx.fill();

  // Subtle architectural grid lines in upper sky for focus detail
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
  ctx.lineWidth = Math.max(1, Math.min(width, height) * 0.002);
  const step = Math.max(32, Math.round(Math.min(width, height) / 8));
  for (let x = step; x < width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }
  for (let y = step; y < height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  // Subtle frame info in top-left corner of the scene
  const eff = getEffectiveDimensions(spec.rawWidth, spec.rawHeight, spec.exif.orientation);
  const labelSize = Math.max(11, Math.round(Math.min(width, height) * 0.028));
  ctx.fillStyle = 'rgba(255, 255, 255, 0.68)';
  ctx.font = `500 ${labelSize}px "JetBrains Mono", monospace`;
  ctx.textBaseline = 'top';
  ctx.fillText(`${spec.subjectLabel} • ${eff.width}×${eff.height}`, labelSize * 1.1, labelSize * 1.1);
  ctx.restore();
}

/**
 * Generates a 256px-wide thumbnail data URL for a demo scene without allocating full-resolution bitmaps in RAM.
 */
export function generateSceneThumbnail(spec: DemoSceneSpec): string {
  if (spec.isCorrupted || spec.rawWidth <= 0 || spec.rawHeight <= 0) {
    return '';
  }
  const eff = getEffectiveDimensions(spec.rawWidth, spec.rawHeight, spec.exif.orientation);
  const thumbW = 256;
  const thumbH = Math.max(64, Math.min(512, Math.round((thumbW * eff.height) / eff.width)));

  const canvas = document.createElement('canvas');
  canvas.width = thumbW;
  canvas.height = thumbH;
  const ctx = canvas.getContext('2d')!;
  drawProceduralScene(ctx, thumbW, thumbH, spec);
  return canvas.toDataURL('image/jpeg', 0.82);
}

/**
 * Builds a MediaItem from a DemoSceneSpec.
 */
export function createMediaItemFromDemoSpec(spec: DemoSceneSpec, indexSuffix: number): MediaItem {
  const eff = getEffectiveDimensions(spec.rawWidth, spec.rawHeight, spec.exif.orientation);
  const group = classifyResolutionGroup(
    spec.rawWidth,
    spec.rawHeight,
    spec.exif.orientation,
    spec.isCorrupted
  );
  const prefix = spec.mediaType === 'video' ? 'vid_' : 'img_';
  const id = `${prefix}${Date.now().toString(36)}_${indexSuffix}`;

  return {
    id,
    name: spec.name,
    path: spec.path,
    mediaType: spec.mediaType,
    mimeType: spec.mimeType,
    sizeBytes: spec.sizeBytes,
    rawWidth: spec.rawWidth,
    rawHeight: spec.rawHeight,
    width: eff.width,
    height: eff.height,
    durationSec: spec.durationSec,
    exif: { ...spec.exif },
    group,
    thumbnailUrl: generateSceneThumbnail(spec),
    demoSceneId: spec.id,
    status: 'waiting',
    progress: 0,
    isCorrupted: spec.isCorrupted,
  };
}

/**
 * Reads a user-selected File (image or video), extracts dimensions, EXIF metadata (for JPEGs),
 * and generates a memory-safe 256px-wide thumbnail.
 */
export async function processUploadedMediaFile(file: File, indexSuffix: number): Promise<MediaItem> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  const videoExts = ['mp4', 'webm', 'mov', 'ogg', 'mkv', 'm4v'];
  const isVideo = file.type.startsWith('video/') || videoExts.includes(ext);
  const prefix = isVideo ? 'vid_' : 'img_';
  const id = `${prefix}${Date.now().toString(36)}_${indexSuffix}`;
  const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || `C:\\LocalMark\\Imports\\${file.name}`;

  if (file.size === 0) {
    return {
      id,
      name: file.name,
      path,
      mediaType: isVideo ? 'video' : 'image',
      mimeType: file.type || (isVideo ? 'video/mp4' : 'image/jpeg'),
      sizeBytes: 0,
      rawWidth: 0,
      rawHeight: 0,
      width: 0,
      height: 0,
      exif: {},
      group: 'Corrupted',
      thumbnailUrl: '',
      fileRef: file,
      status: 'waiting',
      progress: 0,
      isCorrupted: true,
      errorMessage: '0-byte file (empty)',
    };
  }

  if (isVideo) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.muted = true;
      video.playsInline = true;

      const cleanup = () => {
        video.removeAttribute('src');
        video.load();
      };

      const timeout = setTimeout(() => {
        cleanup();
        resolve({
          id,
          name: file.name,
          path,
          mediaType: 'video',
          mimeType: file.type || 'video/mp4',
          sizeBytes: file.size,
          rawWidth: 1920,
          rawHeight: 1080,
          width: 1920,
          height: 1080,
          durationSec: 15,
          exif: { software: 'FFmpeg Native Decoder' },
          group: 'Landscape 16:9',
          thumbnailUrl: generateSceneThumbnail(DEMO_STUDIO_SCENES[9]),
          previewSourceUrl: url,
          fileRef: file,
          status: 'waiting',
          progress: 0,
        });
      }, 3500);

      video.onloadedmetadata = () => {
        const vw = video.videoWidth || 1920;
        const vh = video.videoHeight || 1080;
        const dur = Number.isFinite(video.duration) ? video.duration : 10;
        // Seek to 20% or 0.5s, whichever is smaller
        video.currentTime = Math.min(dur * 0.2, 0.5);
      };

      video.onseeked = () => {
        clearTimeout(timeout);
        const vw = video.videoWidth || 1920;
        const vh = video.videoHeight || 1080;
        const dur = Number.isFinite(video.duration) ? video.duration : 10;
        const thumbW = 256;
        const thumbH = Math.max(48, Math.round((thumbW * vh) / vw));
        const canvas = document.createElement('canvas');
        canvas.width = thumbW;
        canvas.height = thumbH;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(video, 0, 0, thumbW, thumbH);
        const thumbUrl = canvas.toDataURL('image/jpeg', 0.8);
        cleanup();

        const group = classifyResolutionGroup(vw, vh, 1, false);
        resolve({
          id,
          name: file.name,
          path,
          mediaType: 'video',
          mimeType: file.type || 'video/mp4',
          sizeBytes: file.size,
          rawWidth: vw,
          rawHeight: vh,
          width: vw,
          height: vh,
          durationSec: dur,
          exif: {
            colorSpace: 'Rec.709',
            software: 'Hardware Video Decoder',
          },
          group,
          thumbnailUrl: thumbUrl,
          previewSourceUrl: url,
          fileRef: file,
          status: 'waiting',
          progress: 0,
        });
      };

      video.onerror = () => {
        clearTimeout(timeout);
        cleanup();
        URL.revokeObjectURL(url);
        resolve({
          id,
          name: file.name,
          path,
          mediaType: 'video',
          mimeType: file.type || 'video/mp4',
          sizeBytes: file.size,
          rawWidth: 0,
          rawHeight: 0,
          width: 0,
          height: 0,
          exif: {},
          group: 'Corrupted',
          thumbnailUrl: '',
          fileRef: file,
          status: 'waiting',
          progress: 0,
          isCorrupted: true,
          errorMessage: 'Failed to decode video stream',
        });
      };

      video.src = url;
    });
  }

  // Image processing
  let exif: ExifMetadata = {};
  if (ext === 'jpg' || ext === 'jpeg' || file.type === 'image/jpeg') {
    try {
      const slice = file.slice(0, 65536);
      const buf = await slice.arrayBuffer();
      exif = parseExifFromJpegBytes(new Uint8Array(buf));
    } catch {
      // Ignore EXIF read error
    }
  }

  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const rawW = img.naturalWidth;
      const rawH = img.naturalHeight;
      const eff = getEffectiveDimensions(rawW, rawH, exif.orientation);
      const group = classifyResolutionGroup(rawW, rawH, exif.orientation, false);

      const thumbW = 256;
      const thumbH = Math.max(36, Math.round((thumbW * eff.height) / Math.max(1, eff.width)));
      const canvas = document.createElement('canvas');
      canvas.width = thumbW;
      canvas.height = thumbH;
      const ctx = canvas.getContext('2d')!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, thumbW, thumbH);
      const thumbUrl = canvas.toDataURL('image/jpeg', 0.82);

      resolve({
        id,
        name: file.name,
        path,
        mediaType: 'image',
        mimeType: file.type || 'image/jpeg',
        sizeBytes: file.size,
        rawWidth: rawW,
        rawHeight: rawH,
        width: eff.width,
        height: eff.height,
        exif: {
          colorSpace: exif.colorSpace || 'sRGB',
          orientation: exif.orientation || 1,
          ...exif,
        },
        group,
        thumbnailUrl: thumbUrl,
        previewSourceUrl: url,
        fileRef: file,
        status: 'waiting',
        progress: 0,
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({
        id,
        name: file.name,
        path,
        mediaType: 'image',
        mimeType: file.type || 'image/jpeg',
        sizeBytes: file.size,
        rawWidth: 0,
        rawHeight: 0,
        width: 0,
        height: 0,
        exif: {},
        group: 'Corrupted',
        thumbnailUrl: '',
        fileRef: file,
        status: 'waiting',
        progress: 0,
        isCorrupted: true,
        errorMessage: 'Corrupted or unsupported image header',
      });
    };
    img.src = url;
  });
}

/**
 * Draws the base (unwatermarked) image onto `ctx` at `canvasW x canvasH`.
 */
export async function drawBaseMediaToCanvas(
  ctx: CanvasRenderingContext2D,
  item: MediaItem,
  canvasW: number,
  canvasH: number
): Promise<void> {
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  if (item.demoSceneId) {
    const spec = DEMO_STUDIO_SCENES.find((s) => s.id === item.demoSceneId) || DEMO_STUDIO_SCENES[0];
    drawProceduralScene(ctx, canvasW, canvasH, spec);
    ctx.restore();
    return;
  }

  const srcUrl = item.previewSourceUrl || item.thumbnailUrl;
  if (srcUrl) {
    try {
      const img = await loadImageElement(srcUrl);
      ctx.drawImage(img, 0, 0, canvasW, canvasH);
      ctx.restore();
      return;
    } catch {
      // Fallback to procedural pattern if object URL was revoked
    }
  }

  drawProceduralScene(ctx, canvasW, canvasH, DEMO_STUDIO_SCENES[0]);
  ctx.restore();
}

/**
 * Renders the exact 14-step watermark overlay onto `ctx` (assuming base image is already drawn or transparent).
 */
export async function drawWatermarkOverlay(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  core: WatermarkCoreSettings,
  logo: WatermarkLogo | null
): Promise<void> {
  const showLogo = (core.watermarkType === 'logo' || core.watermarkType === 'both') && logo !== null;
  const showText =
    (core.watermarkType === 'text' || core.watermarkType === 'both') &&
    core.text.trim().length > 0;

  if (!showLogo && !showText) {
    return;
  }

  let logoImg: HTMLImageElement | null = null;
  if (showLogo && logo) {
    try {
      logoImg = await loadImageElement(logo.dataUrl);
    } catch {
      logoImg = null;
    }
  }

  const alpha = Math.max(0, Math.min(1, core.opacity / 100));
  if (alpha <= 0) return;

  const logoAspect = logo && logo.height > 0 ? logo.width / logo.height : 2.5;
  const logoBox = calculateLogoPlacement(canvasW, canvasH, core, logoAspect);

  // Measure text if needed
  const fontSize = Math.max(14, Math.min(canvasW, canvasH) * (core.scale / 100) * 0.45);
  ctx.save();
  ctx.font = `600 ${fontSize}px ${core.fontFamily}`;
  const textMetrics = ctx.measureText(core.text);
  const textWidth = Math.max(fontSize, textMetrics.width);
  const textHeight = fontSize * 1.25;
  ctx.restore();

  const textBox = calculatePositionOnCanvas(
    canvasW,
    canvasH,
    textWidth,
    textHeight,
    core.position,
    core.margin,
    core.offsetX,
    core.offsetY,
    core.customX,
    core.customY
  );

  // Helper to stamp a single watermark unit centered at (cx, cy)
  const drawSingleUnitAtCenter = (cx: number, cy: number, applySingleRotation: boolean) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    if (applySingleRotation && core.rotation !== 0) {
      ctx.rotate((core.rotation * Math.PI) / 180);
    }

    if (showLogo && logoImg && showText) {
      // Draw Both: Logo above, Text centered cleanly underneath
      const gap = Math.max(6, fontSize * 0.35);
      const totalH = logoBox.height + gap + textHeight;
      const logoTopY = -totalH / 2;
      ctx.drawImage(logoImg, -logoBox.width / 2, logoTopY, logoBox.width, logoBox.height);
      drawStyledTextAtOrigin(ctx, core, fontSize, 0, logoTopY + logoBox.height + gap + textHeight / 2);
    } else if (showLogo && logoImg) {
      ctx.drawImage(logoImg, -logoBox.width / 2, -logoBox.height / 2, logoBox.width, logoBox.height);
    } else if (showText) {
      drawStyledTextAtOrigin(ctx, core, fontSize, 0, 0);
    }

    ctx.restore();
  };

  if (core.tiled) {
    // Step 10: Tiled Mode ON
    const unitW = showLogo && logoImg ? logoBox.width : textWidth;
    const unitH =
      showLogo && logoImg && showText
        ? logoBox.height + fontSize * 1.6
        : showLogo && logoImg
          ? logoBox.height
          : textHeight;

    const stepX = Math.max(24, unitW + Math.max(10, core.tileSpacing));
    const stepY = Math.max(24, unitH + Math.max(10, core.tileSpacing));
    const diagonal = Math.hypot(canvasW, canvasH);

    ctx.save();
    ctx.translate(canvasW / 2, canvasH / 2);
    ctx.rotate((core.tileAngle * Math.PI) / 180);

    for (let y = -diagonal; y <= diagonal; y += stepY) {
      for (let x = -diagonal; x <= diagonal; x += stepX) {
        drawSingleUnitAtCenter(x, y, true);
      }
    }
    ctx.restore();
  } else {
    // Step 11: Tiled Mode OFF (single placement)
    const activeBox = showLogo && logoImg ? logoBox : textBox;
    drawSingleUnitAtCenter(activeBox.centerX, activeBox.centerY, true);
  }
}

function drawStyledTextAtOrigin(
  ctx: CanvasRenderingContext2D,
  core: WatermarkCoreSettings,
  fontSize: number,
  x: number,
  y: number
) {
  ctx.save();
  ctx.font = `600 ${fontSize}px ${core.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  // 1. Draw shadow first
  if (core.shadowBlur > 0 || core.shadowOffsetX !== 0 || core.shadowOffsetY !== 0) {
    ctx.save();
    ctx.shadowBlur = core.shadowBlur;
    ctx.shadowColor = core.shadowColor || 'rgba(0,0,0,0.7)';
    ctx.shadowOffsetX = core.shadowOffsetX;
    ctx.shadowOffsetY = core.shadowOffsetY;
    ctx.fillStyle = core.textColor;
    ctx.fillText(core.text, x, y);
    ctx.restore();
  }

  // 2. Draw outline stroke
  if (core.outlineWidth > 0) {
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = core.outlineWidth * 2;
    ctx.strokeStyle = core.outlineColor;
    ctx.strokeText(core.text, x, y);
  }

  // 3. Draw fill text
  ctx.fillStyle = core.textColor;
  ctx.fillText(core.text, x, y);
  ctx.restore();
}

/**
 * Full batch processing pipeline for a single MediaItem:
 * Decodes source, resizes if enabled, composites watermark with group overrides, and encodes output Blob.
 */
export async function processSingleMediaItemToBlob(
  item: MediaItem,
  settings: WatermarkSettings,
  logo: WatermarkLogo | null
): Promise<{ blob: Blob; width: number; height: number }> {
  if (item.isCorrupted || item.group === 'Corrupted' || item.width <= 0 || item.height <= 0) {
    throw new Error(item.errorMessage || 'Corrupted or unreadable media file (0×0 dimensions)');
  }

  const core = getMergedSettingsForItem(settings, item);
  const keep100Original = settings.output.preserveOriginalQuality !== false;
  const target = calculateTargetDimensions(
    item.width,
    item.height,
    keep100Original ? false : settings.output.resizeEnabled,
    settings.output.maxWidth,
    settings.output.maxHeight
  );

  // For real uploaded files, render at 100% full native resolution (up to 8192px hardware canvas limit);
  // for synthetic stress-test demo items, cap physical buffer to 2048px so 10,000 items stay fast.
  const maxRenderSide = item.demoSceneId ? 2048 : 8192;
  const renderScale =
    Math.max(target.width, target.height) > maxRenderSide
      ? maxRenderSide / Math.max(target.width, target.height)
      : 1;
  const renderW = Math.max(1, Math.round(target.width * renderScale));
  const renderH = Math.max(1, Math.round(target.height * renderScale));

  const canvas = document.createElement('canvas');
  canvas.width = renderW;
  canvas.height = renderH;
  const ctx = canvas.getContext('2d')!;

  await drawBaseMediaToCanvas(ctx, item, renderW, renderH);

  // Scale fixed pixel size and tile spacing proportionally if renderScale < 1
  const scaledCore: WatermarkCoreSettings = {
    ...core,
    fixedPixelSize: Math.round(core.fixedPixelSize * renderScale),
    tileSpacing: Math.round(core.tileSpacing * renderScale),
  };

  await drawWatermarkOverlay(ctx, renderW, renderH, scaledCore, logo);

  let mimeType = 'image/jpeg';
  if (settings.output.format === 'png') {
    mimeType = 'image/png';
  } else if (settings.output.format === 'webp') {
    mimeType = 'image/webp';
  } else if (settings.output.format === 'original') {
    if (item.mimeType === 'image/png' || item.mimeType === 'image/webp') {
      mimeType = item.mimeType;
    } else {
      mimeType = 'image/jpeg';
    }
  }

  const effectiveQuality = keep100Original ? 1.0 : settings.output.quality;

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('Failed to encode watermarked image buffer'));
      },
      mimeType,
      effectiveQuality
    );
  });

  return {
    blob,
    width: target.width,
    height: target.height,
  };
}
