export type ResolutionGroup =
  | 'Panoramic'
  | 'Square 1:1'
  | 'Portrait 9:16'
  | 'Portrait 3:4 / 2:3'
  | 'Portrait Ultra-Tall'
  | 'Very Small'
  | 'Very Large (4K+)'
  | 'Landscape 16:9'
  | 'Landscape Standard'
  | 'Corrupted';

export const ALL_RESOLUTION_GROUPS: ResolutionGroup[] = [
  'Panoramic',
  'Square 1:1',
  'Portrait 9:16',
  'Portrait 3:4 / 2:3',
  'Portrait Ultra-Tall',
  'Very Small',
  'Very Large (4K+)',
  'Landscape 16:9',
  'Landscape Standard',
  'Corrupted',
];

export type WatermarkPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'middle-left'
  | 'center'
  | 'middle-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'custom';

export type FitMode = 'relative' | 'fixed';
export type ReferenceSide = 'shorter' | 'longer';
export type WatermarkType = 'logo' | 'text' | 'both';
export type OutputFormat = 'original' | 'jpeg' | 'png' | 'webp';

export interface FontOption {
  id: string;
  label: string;
  family: string;
}

export const FONT_OPTIONS: FontOption[] = [
  { id: 'system', label: 'System Clean (Sans)', family: 'system-ui, sans-serif' },
  { id: 'impact', label: 'Impact / Bold Stamp', family: 'Impact, "Arial Black", sans-serif' },
  { id: 'georgia', label: 'Georgia (Editorial Serif)', family: 'Georgia, serif' },
  { id: 'arial', label: 'Arial (Neutral)', family: 'Arial, Helvetica, sans-serif' },
  { id: 'courier', label: 'Courier (Typewriter)', family: '"Courier New", monospace' },
  { id: 'trebuchet', label: 'Trebuchet (Modern Display)', family: '"Trebuchet MS", sans-serif' },
];

export interface WatermarkCoreSettings {
  // Essential Controls
  position: WatermarkPosition;
  scale: number; // 1-100%, default 18
  opacity: number; // 0-100%, default 80
  margin: number; // 0-20%, default 3
  offsetX: number; // -50% to +50%, default 0
  offsetY: number; // -50% to +50%, default 0

  // Size Mode
  fitMode: FitMode; // default 'relative'
  referenceSide: ReferenceSide; // default 'shorter'
  fixedPixelSize: number; // 10-5000px, default 220

  // Advanced Controls
  rotation: number; // -180 to +180, default 0
  tiled: boolean; // default false
  tileSpacing: number; // 10-1000px, default 120
  tileAngle: number; // -180 to +180, default -35
  customX: number; // 0-100%, default 85
  customY: number; // 0-100%, default 85

  // Watermark Type
  watermarkType: WatermarkType; // default 'logo'

  // Text Watermark Settings
  text: string; // default '© LocalMark Studio'
  fontFamily: string; // default 'system-ui, sans-serif'
  textColor: string; // default '#ffffff'
  outlineColor: string; // default '#000000'
  outlineWidth: number; // 0-20px, default 2
  shadowBlur: number; // 0-50, default 4
  shadowColor: string; // default 'rgba(0,0,0,0.7)'
  shadowOffsetX: number; // -20 to +20, default 1
  shadowOffsetY: number; // -20 to +20, default 1
}

export type ExactResolutionKey = `RES:${number}x${number}`;
export type ResolutionTargetScope = 'GLOBAL' | ResolutionGroup | ExactResolutionKey;

export interface OutputSettings {
  format: OutputFormat; // default 'original'
  quality: number; // 0.1 to 1.0, default 1.0 (100% quality)
  preserveOriginalQuality?: boolean; // default true (locks 1:1 native resolution + 100% quality)
  resizeEnabled: boolean; // default false
  maxWidth: number; // default 2560
  maxHeight: number; // default 1440
  filenamePattern: string; // default '{name}_watermarked.{ext}'
  autoRotateExif: boolean; // default true
  concurrency: number; // 1-16, default half of CPU cores
}

export type GroupOverrideSettings = Partial<WatermarkCoreSettings>;

export interface WatermarkSettings extends WatermarkCoreSettings {
  output: OutputSettings;
  groupOverrides: Partial<Record<string, GroupOverrideSettings>>;
}

export interface ExifMetadata {
  make?: string;
  model?: string;
  lens?: string;
  iso?: number;
  aperture?: string;
  shutterSpeed?: string;
  focalLength?: string;
  orientation?: number; // 1..8
  dateTaken?: string;
  colorSpace?: string;
  software?: string;
}

export type QueueItemStatus = 'waiting' | 'processing' | 'done' | 'failed';

export interface MediaItem {
  id: string; // prefix img_ or vid_
  name: string;
  path: string;
  mediaType: 'image' | 'video';
  mimeType: string;
  sizeBytes: number;
  rawWidth: number;
  rawHeight: number;
  width: number; // effective display width after EXIF orientation 5,6,7,8 check
  height: number; // effective display height
  durationSec?: number; // for videos
  exif: ExifMetadata;
  group: ResolutionGroup;
  thumbnailUrl: string; // 256px-wide thumbnail data URL or object URL
  previewSourceUrl?: string; // high-res source or synthetic canvas generator key
  fileRef?: File;
  status: QueueItemStatus;
  progress: number; // 0-100
  processingTimeMs?: number;
  errorMessage?: string;
  outputBlob?: Blob;
  outputFilename?: string;
  isCorrupted?: boolean;
  demoSceneId?: string;
}

export interface WatermarkLogo {
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  sizeBytes: number;
  mimeType: string;
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
  settings: Partial<WatermarkCoreSettings>;
  createdAt?: string;
}

export interface SmartWarning {
  id: string;
  severity: 'warning' | 'error';
  message: string;
}

export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  level: 'info' | 'success' | 'warning' | 'error';
  message: string;
  filename?: string;
  durationMs?: number;
}
