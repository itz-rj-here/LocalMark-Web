import {
  ExactResolutionKey,
  ExifMetadata,
  MediaItem,
  OutputFormat,
  Preset,
  ResolutionGroup,
  ResolutionTargetScope,
  SmartWarning,
  WatermarkCoreSettings,
  WatermarkLogo,
  WatermarkPosition,
  WatermarkSettings,
} from '../types/localmark';

export const DEFAULT_CORE_SETTINGS: WatermarkCoreSettings = {
  position: 'bottom-right',
  scale: 18,
  opacity: 80,
  margin: 3,
  offsetX: 0,
  offsetY: 0,
  fitMode: 'relative',
  referenceSide: 'shorter',
  fixedPixelSize: 220,
  rotation: 0,
  tiled: false,
  tileSpacing: 120,
  tileAngle: -35,
  customX: 85,
  customY: 85,
  watermarkType: 'logo',
  text: '© LocalMark Studio',
  fontFamily: 'system-ui, sans-serif',
  textColor: '#ffffff',
  outlineColor: '#000000',
  outlineWidth: 2,
  shadowBlur: 4,
  shadowColor: 'rgba(0,0,0,0.7)',
  shadowOffsetX: 1,
  shadowOffsetY: 1,
};

export function getDefaultConcurrency(): number {
  const cores = typeof navigator !== 'undefined' && navigator.hardwareConcurrency ? navigator.hardwareConcurrency : 8;
  return Math.max(1, Math.min(16, Math.floor(cores / 2) || 4));
}

export const DEFAULT_WATERMARK_SETTINGS: WatermarkSettings = {
  ...DEFAULT_CORE_SETTINGS,
  output: {
    format: 'original',
    quality: 1.0,
    preserveOriginalQuality: true,
    resizeEnabled: false,
    maxWidth: 2560,
    maxHeight: 1440,
    filenamePattern: '{name}_watermarked.{ext}',
    autoRotateExif: true,
    concurrency: getDefaultConcurrency(),
  },
  groupOverrides: {},
};

export const BUILT_IN_PRESETS: Preset[] = [
  {
    id: 'preset_photographer_signature',
    name: 'Photographer Signature',
    description: 'Bottom-right placement, 18% scale, 80% opacity, 3% margin, single mark.',
    builtIn: true,
    settings: {
      position: 'bottom-right',
      scale: 18,
      opacity: 80,
      margin: 3,
      tiled: false,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
    },
  },
  {
    id: 'preset_anti_theft_grid',
    name: 'Anti-Theft Diagonal Grid',
    description: 'Full-frame repeating diagonal watermark at -35°, 140px spacing, 28% opacity.',
    builtIn: true,
    settings: {
      tiled: true,
      tileAngle: -35,
      tileSpacing: 140,
      opacity: 28,
      scale: 14,
      rotation: 0,
    },
  },
  {
    id: 'preset_confidential_center',
    name: 'Confidential Center Stamp',
    description: 'Centered high-visibility proof mark at 36% scale, 40% opacity, 0% margin.',
    builtIn: true,
    settings: {
      position: 'center',
      scale: 36,
      opacity: 40,
      margin: 0,
      tiled: false,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
    },
  },
  {
    id: 'preset_discreet_footer',
    name: 'Discreet Footer Copyright',
    description: 'Subtle bottom-center signature at 12% scale, 65% opacity, 2% margin.',
    builtIn: true,
    settings: {
      position: 'bottom-center',
      scale: 12,
      opacity: 65,
      margin: 2,
      tiled: false,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
    },
  },
  {
    id: 'preset_social_media_proof',
    name: 'Social Media Proof',
    description: 'Top-right badge at 22% scale, 85% opacity, 4% margin for social feeds.',
    builtIn: true,
    settings: {
      position: 'top-right',
      scale: 22,
      opacity: 85,
      margin: 4,
      tiled: false,
      rotation: 0,
      offsetX: 0,
      offsetY: 0,
    },
  },
];

/**
 * For EXIF orientation tags 5, 6, 7, 8 — if width >= height (raw sensor data),
 * swap width and height to get the effective display dimensions.
 */
export function getEffectiveDimensions(
  rawWidth: number,
  rawHeight: number,
  exifOrientation?: number
): { width: number; height: number } {
  if (!Number.isFinite(rawWidth) || !Number.isFinite(rawHeight) || rawWidth <= 0 || rawHeight <= 0) {
    return { width: 0, height: 0 };
  }
  if (
    exifOrientation &&
    [5, 6, 7, 8].includes(exifOrientation) &&
    rawWidth >= rawHeight
  ) {
    return { width: rawHeight, height: rawWidth };
  }
  return { width: rawWidth, height: rawHeight };
}

/**
 * Categorize every file into one of the 10 Resolution Groups based on aspect ratio
 * and dimensions in the exact priority order specified.
 */
export function classifyResolutionGroup(
  rawWidth: number,
  rawHeight: number,
  exifOrientation?: number,
  isCorrupted?: boolean
): ResolutionGroup {
  if (isCorrupted) {
    return 'Corrupted';
  }
  const { width, height } = getEffectiveDimensions(rawWidth, rawHeight, exifOrientation);
  if (width <= 0 || height <= 0) {
    return 'Corrupted';
  }

  const ratio = width / height;

  // 1. Panoramic — aspect ratio >= 2.05 (ultra-wide landscapes)
  if (ratio >= 2.05) {
    return 'Panoramic';
  }
  // 2. Square 1:1 — ratio between 0.93 and 1.07
  if (ratio >= 0.93 && ratio <= 1.07) {
    return 'Square 1:1';
  }
  // 3. Portrait 9:16 — ratio 0.50 to 0.60 (Stories, Reels, vertical full-screen)
  if (ratio >= 0.50 && ratio <= 0.60) {
    return 'Portrait 9:16';
  }
  // 4. Portrait 3:4 / 2:3 — ratio 0.60 to 0.92 (standard phone/camera portrait)
  if (ratio > 0.60 && ratio < 0.93) {
    return 'Portrait 3:4 / 2:3';
  }
  // 5. Portrait Ultra-Tall — ratio below 0.50 (long screenshots, vertical panoramas)
  if (ratio < 0.50) {
    return 'Portrait Ultra-Tall';
  }
  // 6. Very Small — both dimensions under 800px (thumbnails, icons)
  if (width < 800 && height < 800) {
    return 'Very Small';
  }
  // 7. Very Large (4K+) — either dimension >= 4000px (only for landscape-oriented images)
  if (width > height && (width >= 4000 || height >= 4000)) {
    return 'Very Large (4K+)';
  }
  // 8. Landscape 16:9 — ratio 1.68 to 1.86 (widescreen, YouTube, monitors)
  if (ratio >= 1.68 && ratio <= 1.86) {
    return 'Landscape 16:9';
  }
  // 9. Landscape Standard — everything else (4:3, 3:2 cameras, etc.)
  return 'Landscape Standard';
}

/**
 * Build an exact-resolution scope key (e.g., "RES:2560x1440") for grouping photos with identical pixel dimensions.
 */
export function getExactResolutionKey(width: number, height: number): ExactResolutionKey {
  return `RES:${Math.max(0, Math.round(width))}x${Math.max(0, Math.round(height))}`;
}

/**
 * Format any ResolutionTargetScope into a human-readable label.
 */
export function formatResolutionScopeLabel(scope: ResolutionTargetScope | string): string {
  if (scope === 'GLOBAL') return 'Global (All Photos)';
  if (scope.startsWith('RES:')) {
    const dims = scope.slice(4).split('x');
    if (dims.length === 2) {
      return `${dims[0]} × ${dims[1]} px`;
    }
  }
  return scope;
}

export interface ExactResolutionBucket {
  key: ExactResolutionKey;
  width: number;
  height: number;
  label: string;
  group: ResolutionGroup;
  megapixels: string;
  count: number;
  items: MediaItem[];
}

/**
 * Groups all valid loaded media items by their exact pixel dimensions (width × height)
 * so users can select a group of same-resolution images and configure watermarks per resolution.
 */
export function groupItemsByExactResolution(items: MediaItem[]): ExactResolutionBucket[] {
  const map = new Map<ExactResolutionKey, ExactResolutionBucket>();
  for (const item of items) {
    if (item.isCorrupted || item.group === 'Corrupted' || item.width <= 0 || item.height <= 0) {
      continue;
    }
    const key = getExactResolutionKey(item.width, item.height);
    const existing = map.get(key);
    if (existing) {
      existing.count += 1;
      existing.items.push(item);
    } else {
      const mp = ((item.width * item.height) / 1_000_000).toFixed(2);
      map.set(key, {
        key,
        width: item.width,
        height: item.height,
        label: `${item.width} × ${item.height} px`,
        group: item.group,
        megapixels: `${mp} MP`,
        count: 1,
        items: [item],
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.width * b.height - a.width * a.height;
  });
}

/**
 * Merge global settings with any per-group or exact-resolution override for the given key.
 */
export function getMergedSettingsForGroup(
  settings: WatermarkSettings,
  groupOrScope: ResolutionTargetScope | string
): WatermarkCoreSettings {
  if (groupOrScope === 'GLOBAL') {
    return { ...settings };
  }
  const override = settings.groupOverrides[groupOrScope];
  if (!override) {
    return { ...settings };
  }
  return {
    ...settings,
    ...override,
  };
}

/**
 * Merge global settings with both ResolutionGroup category override and ExactResolutionKey override
 * (Exact W×H resolution override takes highest priority when present).
 */
export function getMergedSettingsForItem(
  settings: WatermarkSettings,
  item: Pick<MediaItem, 'width' | 'height' | 'group'>
): WatermarkCoreSettings {
  const groupOverride = settings.groupOverrides[item.group] || {};
  const exactKey = getExactResolutionKey(item.width, item.height);
  const exactOverride = settings.groupOverrides[exactKey] || {};
  return {
    ...settings,
    ...groupOverride,
    ...exactOverride,
  };
}

/**
 * Calculate output target dimensions when resize is enabled.
 */
export function calculateTargetDimensions(
  sourceWidth: number,
  sourceHeight: number,
  resizeEnabled: boolean,
  maxWidth: number,
  maxHeight: number
): { width: number; height: number } {
  if (!resizeEnabled || sourceWidth <= 0 || sourceHeight <= 0) {
    return { width: Math.max(1, Math.round(sourceWidth)), height: Math.max(1, Math.round(sourceHeight)) };
  }
  const safeMaxW = Math.max(16, maxWidth || 2560);
  const safeMaxH = Math.max(16, maxHeight || 1440);

  if (sourceWidth <= safeMaxW && sourceHeight <= safeMaxH) {
    return { width: Math.round(sourceWidth), height: Math.round(sourceHeight) };
  }
  const ratio = Math.min(safeMaxW / sourceWidth, safeMaxH / sourceHeight);
  return {
    width: Math.max(1, Math.round(sourceWidth * ratio)),
    height: Math.max(1, Math.round(sourceHeight * ratio)),
  };
}

export interface ComputedBoxPlacement {
  x: number;
  y: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
  marginPx: number;
}

/**
 * Calculates exact position on canvas using the 3x3 grid + margin + offset or Custom X/Y.
 */
export function calculatePositionOnCanvas(
  canvasW: number,
  canvasH: number,
  wmW: number,
  wmH: number,
  position: WatermarkPosition,
  marginPercent: number,
  offsetXPercent: number,
  offsetYPercent: number,
  customXPercent: number,
  customYPercent: number
): ComputedBoxPlacement {
  const marginPx = Math.min(canvasW, canvasH) * (marginPercent / 100);
  let x = 0;
  let y = 0;

  if (position === 'custom') {
    x = (canvasW - wmW) * (customXPercent / 100);
    y = (canvasH - wmH) * (customYPercent / 100);
  } else {
    // Horizontal
    if (position.endsWith('left')) {
      x = marginPx;
    } else if (position.endsWith('center') || position === 'center') {
      x = (canvasW - wmW) / 2;
    } else {
      // right
      x = canvasW - wmW - marginPx;
    }

    // Vertical
    if (position.startsWith('top')) {
      y = marginPx;
    } else if (position.startsWith('middle') || position === 'center') {
      y = (canvasH - wmH) / 2;
    } else {
      // bottom
      y = canvasH - wmH - marginPx;
    }
  }

  x += canvasW * (offsetXPercent / 100);
  y += canvasH * (offsetYPercent / 100);

  return {
    x,
    y,
    width: wmW,
    height: wmH,
    centerX: x + wmW / 2,
    centerY: y + wmH / 2,
    marginPx,
  };
}

/**
 * Calculates logo watermark pixel size and position.
 */
export function calculateLogoPlacement(
  canvasW: number,
  canvasH: number,
  core: WatermarkCoreSettings,
  logoAspect: number = 2.5
): ComputedBoxPlacement {
  const safeAspect = logoAspect > 0 ? logoAspect : 1;
  let wmW: number;
  if (core.fitMode === 'fixed') {
    wmW = Math.max(10, Math.min(5000, core.fixedPixelSize));
  } else {
    const referenceSide =
      core.referenceSide === 'shorter' ? Math.min(canvasW, canvasH) : Math.max(canvasW, canvasH);
    wmW = referenceSide * (core.scale / 100);
  }
  const wmH = wmW / safeAspect;

  return calculatePositionOnCanvas(
    canvasW,
    canvasH,
    wmW,
    wmH,
    core.position,
    core.margin,
    core.offsetX,
    core.offsetY,
    core.customX,
    core.customY
  );
}

/**
 * Calculates text watermark font size and bounding box placement.
 */
export function calculateTextPlacement(
  canvasW: number,
  canvasH: number,
  core: WatermarkCoreSettings,
  measuredTextWidth?: number
): ComputedBoxPlacement & { fontSize: number } {
  const fontSize = Math.max(14, Math.min(canvasW, canvasH) * (core.scale / 100) * 0.45);
  const textStr = core.text || '';
  const estimatedWidth =
    measuredTextWidth !== undefined ? measuredTextWidth : Math.max(fontSize, textStr.length * fontSize * 0.56);
  const wmH = fontSize * 1.25;

  const placement = calculatePositionOnCanvas(
    canvasW,
    canvasH,
    estimatedWidth,
    wmH,
    core.position,
    core.margin,
    core.offsetX,
    core.offsetY,
    core.customX,
    core.customY
  );

  return {
    ...placement,
    fontSize,
  };
}

/**
 * Evaluates Smart Warnings for a selected MediaItem and current WatermarkSettings.
 */
export function evaluateSmartWarnings(
  item: Pick<MediaItem, 'width' | 'height' | 'group' | 'isCorrupted'> | null,
  settings: WatermarkSettings,
  logo: WatermarkLogo | null
): SmartWarning[] {
  const warnings: SmartWarning[] = [];

  if (!item) {
    return warnings;
  }

  if (item.isCorrupted || item.group === 'Corrupted' || item.width <= 0 || item.height <= 0) {
    warnings.push({
      id: 'corrupted_file',
      severity: 'error',
      message: 'File is corrupted or unreadable',
    });
    return warnings;
  }

  const core = getMergedSettingsForItem(settings, item);
  const target = calculateTargetDimensions(
    item.width,
    item.height,
    settings.output.resizeEnabled,
    settings.output.maxWidth,
    settings.output.maxHeight
  );

  const needsLogo = core.watermarkType === 'logo' || core.watermarkType === 'both';
  const needsText = core.watermarkType === 'text' || core.watermarkType === 'both';

  if (needsLogo && !logo) {
    warnings.push({
      id: 'missing_logo',
      severity: 'warning',
      message: 'No logo uploaded but watermark type includes Logo — logo layer will be skipped',
    });
  }

  if (needsText && (!core.text || core.text.trim().length === 0)) {
    warnings.push({
      id: 'empty_text',
      severity: 'warning',
      message: 'Watermark text is empty — text layer will be skipped',
    });
  }

  const logoAspect = logo && logo.height > 0 ? logo.width / logo.height : 2.5;
  const activePlacement =
    needsLogo && logo
      ? calculateLogoPlacement(target.width, target.height, core, logoAspect)
      : calculateTextPlacement(target.width, target.height, core);

  // Tiny check: under 44x24px
  if (activePlacement.width < 44 || activePlacement.height < 24) {
    warnings.push({
      id: 'tiny_watermark',
      severity: 'warning',
      message: 'Watermark is tiny (under 44×24px) and may be unreadable',
    });
  }

  // Coverage over 20%
  const imageArea = target.width * target.height;
  const wmArea = activePlacement.width * activePlacement.height;
  if (imageArea > 0 && wmArea / imageArea > 0.2) {
    warnings.push({
      id: 'large_coverage',
      severity: 'warning',
      message: 'Watermark covers over 20% of the image and dominates the frame',
    });
  }

  // Boundary clipping check (when not tiled)
  if (!core.tiled) {
    const outOfBounds =
      activePlacement.x < 0 ||
      activePlacement.y < 0 ||
      activePlacement.x + activePlacement.width > target.width ||
      activePlacement.y + activePlacement.height > target.height;
    if (outOfBounds) {
      warnings.push({
        id: 'clipped_boundary',
        severity: 'warning',
        message: 'Watermark plus margins exceed image boundaries — may be clipped',
      });
    }
  }

  // Image much smaller than logo or logo scaled up excessively
  if (needsLogo && logo) {
    if (target.width < logo.width * 0.85 || target.height < logo.height * 0.85) {
      warnings.push({
        id: 'image_smaller_than_logo',
        severity: 'warning',
        message: 'Image is much smaller than the logo — watermark may look blurry',
      });
    }
  }

  return warnings;
}

/**
 * Formats an output filename using pattern tokens {name}, {ext}, {date}, {index}
 */
export function formatOutputFilename(
  pattern: string,
  originalFilename: string,
  outputFormat: OutputFormat,
  indexOneBased: number,
  isVideo: boolean = false,
  dateOverride?: string
): string {
  const lastDot = originalFilename.lastIndexOf('.');
  const baseName = lastDot > 0 ? originalFilename.slice(0, lastDot) : originalFilename;
  const sourceExt = lastDot > 0 ? originalFilename.slice(lastDot + 1).toLowerCase() : isVideo ? 'mp4' : 'jpg';

  let ext = sourceExt;
  if (isVideo) {
    ext = 'mp4';
  } else if (outputFormat !== 'original') {
    ext = outputFormat === 'jpeg' ? 'jpg' : outputFormat;
  }

  const today = dateOverride || new Date().toISOString().slice(0, 10);
  const paddedIndex = String(Math.max(1, indexOneBased)).padStart(3, '0');

  const safePattern = pattern.trim() || '{name}_watermarked.{ext}';
  let result = safePattern
    .replace(/\{name\}/g, baseName)
    .replace(/\{ext\}/g, ext)
    .replace(/\{date\}/g, today)
    .replace(/\{index\}/g, paddedIndex);

  if (!result.includes('.')) {
    result = `${result}.${ext}`;
  }
  return result;
}

/**
 * Resolves filename collisions by appending _2, _3, etc. before the file extension.
 */
export function resolveCollisionFilename(desiredName: string, existingNames: Set<string>): string {
  if (!existingNames.has(desiredName)) {
    existingNames.add(desiredName);
    return desiredName;
  }

  const lastDot = desiredName.lastIndexOf('.');
  const base = lastDot > 0 ? desiredName.slice(0, lastDot) : desiredName;
  const ext = lastDot > 0 ? desiredName.slice(lastDot) : '';

  let counter = 2;
  while (existingNames.has(`${base}_${counter}${ext}`)) {
    counter++;
  }
  const resolved = `${base}_${counter}${ext}`;
  existingNames.add(resolved);
  return resolved;
}

/**
 * CRC-32 lookup table for Level-0 STORE ZIP generation
 */
const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function computeCrc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Creates a standard PKZIP archive using Compression Method 0 (STORE) for instant zero-CPU archiving.
 */
export function createStoreZipArchive(entries: { name: string; data: Uint8Array }[]): Uint8Array {
  const encoder = new TextEncoder();
  const fileRecords: {
    nameBytes: Uint8Array;
    data: Uint8Array;
    crc: number;
    offset: number;
  }[] = [];

  let totalLocalSize = 0;
  let totalCentralSize = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.name);
    const crc = computeCrc32(entry.data);
    fileRecords.push({
      nameBytes,
      data: entry.data,
      crc,
      offset: totalLocalSize,
    });
    totalLocalSize += 30 + nameBytes.length + entry.data.length;
    totalCentralSize += 46 + nameBytes.length;
  }

  const totalSize = totalLocalSize + totalCentralSize + 22;
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);

  let pos = 0;
  // Write Local File Headers + Data
  for (const rec of fileRecords) {
    view.setUint32(pos, 0x04034b50, true); // Local file header signature
    view.setUint16(pos + 4, 20, true); // Version needed to extract (2.0)
    view.setUint16(pos + 6, 0x0800, true); // General purpose bit flag (UTF-8)
    view.setUint16(pos + 8, 0, true); // Compression method 0 = STORE
    view.setUint16(pos + 10, 0, true); // Last mod file time
    view.setUint16(pos + 12, 0x5421, true); // Last mod file date
    view.setUint32(pos + 14, rec.crc, true); // CRC-32
    view.setUint32(pos + 18, rec.data.length, true); // Compressed size
    view.setUint32(pos + 22, rec.data.length, true); // Uncompressed size
    view.setUint16(pos + 26, rec.nameBytes.length, true); // File name length
    view.setUint16(pos + 28, 0, true); // Extra field length
    out.set(rec.nameBytes, pos + 30);
    out.set(rec.data, pos + 30 + rec.nameBytes.length);
    pos += 30 + rec.nameBytes.length + rec.data.length;
  }

  const centralDirOffset = pos;
  // Write Central Directory Headers
  for (const rec of fileRecords) {
    view.setUint32(pos, 0x02014b50, true); // Central file header signature
    view.setUint16(pos + 4, 20, true); // Version made by
    view.setUint16(pos + 6, 20, true); // Version needed
    view.setUint16(pos + 8, 0x0800, true); // UTF-8 flag
    view.setUint16(pos + 10, 0, true); // Compression method 0 = STORE
    view.setUint16(pos + 12, 0, true); // Time
    view.setUint16(pos + 14, 0x5421, true); // Date
    view.setUint32(pos + 16, rec.crc, true); // CRC-32
    view.setUint32(pos + 20, rec.data.length, true); // Compressed size
    view.setUint32(pos + 24, rec.data.length, true); // Uncompressed size
    view.setUint16(pos + 28, rec.nameBytes.length, true); // File name length
    view.setUint16(pos + 30, 0, true); // Extra field length
    view.setUint16(pos + 32, 0, true); // File comment length
    view.setUint16(pos + 34, 0, true); // Disk number start
    view.setUint16(pos + 36, 0, true); // Internal file attributes
    view.setUint32(pos + 38, 0, true); // External file attributes
    view.setUint32(pos + 42, rec.offset, true); // Relative offset of local header
    out.set(rec.nameBytes, pos + 46);
    pos += 46 + rec.nameBytes.length;
  }

  // End of Central Directory Record (EOCD)
  view.setUint32(pos, 0x06054b50, true);
  view.setUint16(pos + 4, 0, true); // Number of this disk
  view.setUint16(pos + 6, 0, true); // Disk where central directory starts
  view.setUint16(pos + 8, fileRecords.length, true); // Number of central directory records on this disk
  view.setUint16(pos + 10, fileRecords.length, true); // Total number of central directory records
  view.setUint32(pos + 12, totalCentralSize, true); // Size of central directory
  view.setUint32(pos + 16, centralDirOffset, true); // Offset of start of central directory
  view.setUint16(pos + 20, 0, true); // Comment length

  return out;
}

/**
 * Lightweight native binary JPEG EXIF parser for reading Orientation, Make, Model, ISO, etc.
 */
export function parseExifFromJpegBytes(bytes: Uint8Array): ExifMetadata {
  const exif: ExifMetadata = {};
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return exif;
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 2;

  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1];
    if (marker === 0xda || marker === 0xd9) break; // SOS or EOI
    const segLength = view.getUint16(offset + 2, false);
    if (segLength < 2 || offset + 2 + segLength > bytes.length) break;

    // APP1 marker (0xFFE1) with "Exif\0\0"
    if (
      marker === 0xe1 &&
      segLength > 14 &&
      bytes[offset + 4] === 0x45 && // E
      bytes[offset + 5] === 0x78 && // x
      bytes[offset + 6] === 0x69 && // i
      bytes[offset + 7] === 0x66    // f
    ) {
      const tiffStart = offset + 10;
      const littleEndian = view.getUint16(tiffStart, false) === 0x4949;
      const firstIfdOffset = view.getUint32(tiffStart + 4, littleEndian);
      if (tiffStart + firstIfdOffset + 2 < bytes.length) {
        readIfd(view, bytes, tiffStart, tiffStart + firstIfdOffset, littleEndian, exif);
      }
      break;
    }

    offset += 2 + segLength;
  }

  return exif;
}

function readAsciiString(bytes: Uint8Array, start: number, count: number): string {
  let out = '';
  const end = Math.min(bytes.length, start + count);
  for (let i = start; i < end; i++) {
    if (bytes[i] === 0) break;
    out += String.fromCharCode(bytes[i]);
  }
  return out.trim();
}

function readIfd(
  view: DataView,
  bytes: Uint8Array,
  tiffStart: number,
  ifdStart: number,
  le: boolean,
  exif: ExifMetadata
) {
  if (ifdStart + 2 > bytes.length) return;
  const numEntries = view.getUint16(ifdStart, le);
  let exifSubIfdOffset = 0;

  for (let i = 0; i < numEntries; i++) {
    const entryOffset = ifdStart + 2 + i * 12;
    if (entryOffset + 12 > bytes.length) break;

    const tag = view.getUint16(entryOffset, le);
    const type = view.getUint16(entryOffset + 2, le);
    const count = view.getUint32(entryOffset + 4, le);
    const valueOffset = tiffStart + view.getUint32(entryOffset + 8, le);

    if (tag === 0x010f && type === 2 && valueOffset < bytes.length) {
      exif.make = readAsciiString(bytes, count <= 4 ? entryOffset + 8 : valueOffset, count);
    } else if (tag === 0x0110 && type === 2 && valueOffset < bytes.length) {
      exif.model = readAsciiString(bytes, count <= 4 ? entryOffset + 8 : valueOffset, count);
    } else if (tag === 0x0112 && type === 3) {
      exif.orientation = view.getUint16(entryOffset + 8, le);
    } else if (tag === 0x0131 && type === 2 && valueOffset < bytes.length) {
      exif.software = readAsciiString(bytes, count <= 4 ? entryOffset + 8 : valueOffset, count);
    } else if (tag === 0x0132 && type === 2 && valueOffset < bytes.length) {
      exif.dateTaken = readAsciiString(bytes, count <= 4 ? entryOffset + 8 : valueOffset, count);
    } else if (tag === 0x8769) {
      exifSubIfdOffset = view.getUint32(entryOffset + 8, le);
    } else if (tag === 0x8827 && (type === 3 || type === 4)) {
      exif.iso = type === 3 ? view.getUint16(entryOffset + 8, le) : view.getUint32(entryOffset + 8, le);
    } else if (tag === 0x829a && type === 5 && valueOffset + 8 <= bytes.length) {
      const num = view.getUint32(valueOffset, le);
      const den = view.getUint32(valueOffset + 4, le);
      if (num > 0 && den > 0) {
        exif.shutterSpeed = num < den ? `1/${Math.round(den / num)}s` : `${(num / den).toFixed(1)}s`;
      }
    } else if (tag === 0x829d && type === 5 && valueOffset + 8 <= bytes.length) {
      const num = view.getUint32(valueOffset, le);
      const den = view.getUint32(valueOffset + 4, le);
      if (den > 0) {
        exif.aperture = `f/${(num / den).toFixed(1)}`;
      }
    } else if (tag === 0x920a && type === 5 && valueOffset + 8 <= bytes.length) {
      const num = view.getUint32(valueOffset, le);
      const den = view.getUint32(valueOffset + 4, le);
      if (den > 0) {
        exif.focalLength = `${Math.round(num / den)}mm`;
      }
    } else if (tag === 0x9003 && type === 2 && valueOffset < bytes.length) {
      exif.dateTaken = readAsciiString(bytes, count <= 4 ? entryOffset + 8 : valueOffset, count);
    } else if (tag === 0xa001 && type === 3) {
      const cs = view.getUint16(entryOffset + 8, le);
      exif.colorSpace = cs === 1 ? 'sRGB' : cs === 2 ? 'Adobe RGB' : 'Uncalibrated';
    } else if (tag === 0xa434 && type === 2 && valueOffset < bytes.length) {
      exif.lens = readAsciiString(bytes, count <= 4 ? entryOffset + 8 : valueOffset, count);
    }
  }

  if (exifSubIfdOffset > 0 && tiffStart + exifSubIfdOffset + 2 <= bytes.length) {
    readIfd(view, bytes, tiffStart, tiffStart + exifSubIfdOffset, le, exif);
  }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDurationMmSs(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '00:00';
  const totalSec = Math.round(seconds);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
