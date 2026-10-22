import React, { useRef, useState } from 'react';
import {
  FileImage,
  FileVideo,
  FolderOpen,
  ImagePlus,
  Layers,
  Sparkles,
  Trash2,
  Upload,
  AlertTriangle,
  ArrowRight,
  Clock,
  CheckCircle2,
  FileWarning,
  Search,
} from 'lucide-react';
import {
  ALL_RESOLUTION_GROUPS,
  MediaItem,
  ResolutionGroup,
  WatermarkLogo,
} from '../types/localmark';
import { formatBytes, formatDurationMmSs } from '../utils/watermarkEngine';

interface Step1AddMediaProps {
  items: MediaItem[];
  logo: WatermarkLogo | null;
  recentInputFolders: string[];
  isLoadingFiles: boolean;
  onAddFiles: (files: File[], folderPathHint?: string) => void;
  onLoadStudioSamplePack: () => void;
  onGenerateHighVolumeBatch: (count: number) => void;
  onAddCorruptedSample: () => void;
  onUploadLogo: (file: File) => void;
  onSelectDefaultLogo: (variant: 'light' | 'badge') => void;
  onRemoveLogo: () => void;
  onRemoveItem: (id: string) => void;
  onClearAll: () => void;
  onNextStep: () => void;
}

const IGNORED_SYSTEM_DIRS = new Set([
  '.git',
  'node_modules',
  '.svn',
  '.hg',
  '$recycle.bin',
  'system volume information',
  '__macosx',
]);

const SUPPORTED_EXTENSIONS = new Set([
  'jpg',
  'jpeg',
  'png',
  'webp',
  'gif',
  'bmp',
  'tiff',
  'tif',
  'heic',
  'avif',
  'svg',
  'mp4',
  'webm',
  'mov',
  'ogg',
  'mkv',
  'm4v',
]);

export const Step1AddMedia: React.FC<Step1AddMediaProps> = ({
  items,
  logo,
  recentInputFolders,
  isLoadingFiles,
  onAddFiles,
  onLoadStudioSamplePack,
  onGenerateHighVolumeBatch,
  onAddCorruptedSample,
  onUploadLogo,
  onSelectDefaultLogo,
  onRemoveLogo,
  onRemoveItem,
  onClearAll,
  onNextStep,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);

  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [selectedGroupFilter, setSelectedGroupFilter] = useState<ResolutionGroup | 'ALL'>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(60);

  // Compute group counts
  const groupCounts = React.useMemo(() => {
    const counts: Record<ResolutionGroup, number> = {
      Panoramic: 0,
      'Square 1:1': 0,
      'Portrait 9:16': 0,
      'Portrait 3:4 / 2:3': 0,
      'Portrait Ultra-Tall': 0,
      'Very Small': 0,
      'Very Large (4K+)': 0,
      'Landscape 16:9': 0,
      'Landscape Standard': 0,
      Corrupted: 0,
    };
    for (const item of items) {
      counts[item.group] = (counts[item.group] || 0) + 1;
    }
    return counts;
  }, [items]);

  const filteredItems = React.useMemo(() => {
    return items.filter((item) => {
      if (selectedGroupFilter !== 'ALL' && item.group !== selectedGroupFilter) {
        return false;
      }
      if (searchQuery.trim() !== '') {
        const q = searchQuery.toLowerCase();
        return (
          item.name.toLowerCase().includes(q) ||
          item.group.toLowerCase().includes(q) ||
          (item.exif.model && item.exif.model.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [items, selectedGroupFilter, searchQuery]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onAddFiles(Array.from(e.target.files));
      e.target.value = '';
    }
  };

  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const rawFiles = Array.from(e.target.files);
      const validFiles: File[] = [];
      let topFolder = '';

      for (const f of rawFiles) {
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name;
        const segments = rel.split('/');
        if (!topFolder && segments.length > 1) {
          topFolder = `C:\\Users\\Studio\\Pictures\\${segments[0]}`;
        }
        // Max 20 levels deep, skip hidden/system folders like .git, node_modules
        if (segments.length > 20) continue;
        const hasHiddenOrSystem = segments.some(
          (seg, idx) =>
            idx < segments.length - 1 &&
            (seg.startsWith('.') || IGNORED_SYSTEM_DIRS.has(seg.toLowerCase()))
        );
        if (hasHiddenOrSystem) continue;

        const ext = f.name.split('.').pop()?.toLowerCase() || '';
        if (SUPPORTED_EXTENSIONS.has(ext) || f.type.startsWith('image/') || f.type.startsWith('video/')) {
          validFiles.push(f);
        }
      }

      onAddFiles(validFiles, topFolder || 'C:\\Users\\Studio\\Pictures\\Imported_Folder');
      e.target.value = '';
    }
  };

  // Recursive WebkitFileSystemEntry scanner for drag-and-drop folders (max 20 levels deep)
  const scanFileSystemEntry = async (
    entry: FileSystemEntry,
    depth: number = 0
  ): Promise<File[]> => {
    if (depth > 20) return [];
    if (entry.name.startsWith('.') || IGNORED_SYSTEM_DIRS.has(entry.name.toLowerCase())) {
      return [];
    }

    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      return new Promise((resolve) => {
        fileEntry.file(
          (file) => {
            const ext = file.name.split('.').pop()?.toLowerCase() || '';
            if (
              SUPPORTED_EXTENSIONS.has(ext) ||
              file.type.startsWith('image/') ||
              file.type.startsWith('video/')
            ) {
              resolve([file]);
            } else {
              resolve([]);
            }
          },
          () => resolve([])
        );
      });
    }

    if (entry.isDirectory) {
      const dirEntry = entry as FileSystemDirectoryEntry;
      const reader = dirEntry.createReader();
      const collected: File[] = [];

      const readBatch = (): Promise<FileSystemEntry[]> =>
        new Promise((resolve) => {
          reader.readEntries(
            (entries) => resolve(entries),
            () => resolve([])
          );
        });

      let batch = await readBatch();
      while (batch.length > 0) {
        for (const child of batch) {
          const childFiles = await scanFileSystemEntry(child, depth + 1);
          collected.push(...childFiles);
        }
        batch = await readBatch();
      }
      return collected;
    }

    return [];
  };

  const handleDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDraggingOver(false);

    const itemsList = e.dataTransfer.items;
    if (itemsList && itemsList.length > 0) {
      const gathered: File[] = [];
      let folderHint = '';
      for (let i = 0; i < itemsList.length; i++) {
        const item = itemsList[i];
        const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
        if (entry) {
          if (entry.isDirectory && !folderHint) {
            folderHint = `C:\\Users\\Studio\\Pictures\\${entry.name}`;
          }
          const filesFromEntry = await scanFileSystemEntry(entry, 0);
          gathered.push(...filesFromEntry);
        } else if (item.kind === 'file') {
          const f = item.getAsFile();
          if (f) gathered.push(f);
        }
      }
      if (gathered.length > 0) {
        onAddFiles(gathered, folderHint || undefined);
        return;
      }
    }

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onAddFiles(Array.from(e.dataTransfer.files));
    }
  };

  const totalSizeBytes = React.useMemo(
    () => items.reduce((acc, it) => acc + it.sizeBytes, 0),
    [items]
  );

  return (
    <div className="space-y-6">
      {/* Top 2-Column Split: Media Dropzone (Left 8 cols) + Watermark Logo Uploader (Right 4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Media File & Folder Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDraggingOver(true);
          }}
          onDragLeave={() => setIsDraggingOver(false)}
          onDrop={handleDrop}
          className={`lg:col-span-8 rounded-xl border transition-all p-6 flex flex-col justify-between ${
            isDraggingOver
              ? 'border-indigo-500 bg-indigo-500/10'
              : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1624]'
          }`}
        >
          <div>
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                  1. Add Photos & Videos
                </h2>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
                  Drag & drop files or entire folders from Windows Explorer (max 10,000 files, 20 subfolder levels deep).
                </p>
              </div>
              <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
                <span>Capacity: {items.length.toLocaleString()} / 10,000 files</span>
                <span aria-hidden="true" className="mx-2">·</span>
                <span>{formatBytes(totalSizeBytes)}</span>
              </div>
            </div>

            {/* Hidden Native Inputs */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".jpg,.jpeg,.png,.webp,.gif,.bmp,.tiff,.tif,.heic,.avif,.svg,.mp4,.webm,.mov,.ogg,.mkv,.m4v,image/*,video/*"
              onChange={handleFileChange}
              className="hidden"
            />
            <input
              ref={folderInputRef}
              type="file"
              multiple
              // @ts-expect-error webkitdirectory is standard in Chromium/Windows desktop webviews
              webkitdirectory=""
              directory=""
              onChange={handleFolderChange}
              className="hidden"
            />

            {/* Primary File Input Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 my-4">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white font-medium text-sm shadow-sm transition-all cursor-pointer whitespace-nowrap shrink-0"
              >
                <ImagePlus className="w-4 h-4 shrink-0" />
                <span>Add Files (Ctrl+O)</span>
              </button>

              <button
                type="button"
                onClick={() => folderInputRef.current?.click()}
                className="flex items-center justify-center gap-2.5 px-4 py-3.5 rounded-lg border border-slate-300 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-500 bg-slate-50 dark:bg-slate-800/60 text-slate-800 dark:text-slate-100 font-medium text-sm transition-all cursor-pointer whitespace-nowrap shrink-0"
              >
                <FolderOpen className="w-4 h-4 text-indigo-500 shrink-0" />
                <span>Add Folder (Ctrl+Shift+O)</span>
              </button>
            </div>

            {/* Supported Formats Readout */}
            <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1 pt-2 border-t border-slate-100 dark:border-slate-800/80">
              <div>
                <span className="font-medium text-slate-700 dark:text-slate-300">Images:</span>{' '}
                JPEG, PNG, WebP, GIF, BMP, TIFF, HEIC, AVIF, SVG
                <span aria-hidden="true" className="mx-2">·</span>
                <span className="font-medium text-slate-700 dark:text-slate-300">Videos:</span>{' '}
                MP4, WebM, MOV, OGG, MKV, M4V
              </div>
              <div>
                Auto-extracts EXIF camera metadata, swaps sensor dimensions for EXIF orientations 5–8, and generates 256px RAM-safe thumbnails.
              </div>
            </div>
          </div>

          {/* Studio Sample Loaders & Recent Input Folders */}
          <div className="mt-5 pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onLoadStudioSamplePack}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>Load Studio Sample Pack (10 Media)</span>
              </button>

              <button
                type="button"
                onClick={() => onGenerateHighVolumeBatch(250)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <Layers className="w-3.5 h-3.5" />
                <span>+250 Stress Batch</span>
              </button>

              <button
                type="button"
                onClick={onAddCorruptedSample}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 border border-amber-500/20 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <FileWarning className="w-3.5 h-3.5" />
                <span>+Corrupted Test File</span>
              </button>
            </div>

            {recentInputFolders.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                <Clock className="w-3.5 h-3.5 shrink-0" />
                <span className="shrink-0">Recent:</span>
                <span className="font-mono break-all" title={recentInputFolders[0]}>
                  {recentInputFolders[0]}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Watermark Logo Upload Area */}
        <div className="lg:col-span-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1624] p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-2 mb-3">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                Watermark Logo
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                PNG / SVG / WebP
              </span>
            </div>

            <input
              ref={logoInputRef}
              type="file"
              accept="image/png,image/svg+xml,image/webp,image/jpeg"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  onUploadLogo(file);
                  e.target.value = '';
                }
              }}
              className="hidden"
            />

            {/* Logo Preview Box */}
            <div className="h-32 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-100/70 dark:bg-slate-900/70 flex items-center justify-center p-4 relative overflow-hidden">
              {logo ? (
                <img
                  src={logo.dataUrl}
                  alt={logo.name}
                  referrerPolicy="no-referrer"
                  className="max-h-24 max-w-full object-contain drop-shadow"
                />
              ) : (
                <div className="text-center text-xs text-slate-500 dark:text-slate-400">
                  No logo selected (Text-only or upload PNG/SVG)
                </div>
              )}
            </div>

            {logo && (
              <div className="mt-2.5 flex flex-wrap items-center justify-between gap-1 text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                <span className="break-all" title={logo.name}>
                  {logo.name}
                </span>
                <span>
                  {logo.width}×{logo.height}px · {formatBytes(logo.sizeBytes)}
                </span>
              </div>
            )}
          </div>

          <div className="space-y-2 mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
            <button
              type="button"
              onClick={() => logoInputRef.current?.click()}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:hover:bg-white text-white dark:text-slate-900 font-medium text-xs transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Upload className="w-3.5 h-3.5" />
              <span>Upload Custom Logo...</span>
            </button>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onSelectDefaultLogo('light')}
                className="flex-1 px-2.5 py-1.5 rounded-md text-xs font-medium border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer whitespace-nowrap"
              >
                Studio Mark
              </button>
              <button
                type="button"
                onClick={() => onSelectDefaultLogo('badge')}
                className="flex-1 px-2.5 py-1.5 rounded-md text-xs font-medium border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer whitespace-nowrap"
              >
                Dark Emblem
              </button>
              {logo && (
                <button
                  type="button"
                  onClick={onRemoveLogo}
                  aria-label="Remove watermark logo"
                  className="px-2.5 py-1.5 rounded-md text-xs font-medium border border-rose-500/30 hover:bg-rose-500/10 text-rose-600 dark:text-rose-400 transition-colors cursor-pointer whitespace-nowrap"
                >
                  Clear
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Resolution Group Summary & Filter Bar */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1624] p-5">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Resolution Group Classification
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Every file is automatically classified in priority order (Portrait checks precede 4K size checks; EXIF tags 5–8 auto-swapped).
            </p>
          </div>

          {/* Clean unboxed typographic summary as required by prompt */}
          <div className="text-xs text-slate-600 dark:text-slate-300 font-mono tabular-nums">
            {ALL_RESOLUTION_GROUPS.filter((g) => groupCounts[g] > 0).length === 0 ? (
              <span>No media loaded yet</span>
            ) : (
              ALL_RESOLUTION_GROUPS.filter((g) => groupCounts[g] > 0).map((g, idx, arr) => (
                <React.Fragment key={g}>
                  <span>
                    {g}: <strong>{groupCounts[g]}</strong> {groupCounts[g] === 1 ? 'file' : 'files'}
                  </span>
                  {idx < arr.length - 1 && (
                    <span aria-hidden="true" className="mx-2 text-slate-400">
                      •
                    </span>
                  )}
                </React.Fragment>
              ))
            )}
          </div>
        </div>

        {/* Interactive Filter Tabs for the 10 Resolution Groups */}
        <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100 dark:border-slate-800/80">
          <button
            type="button"
            onClick={() => setSelectedGroupFilter('ALL')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
              selectedGroupFilter === 'ALL'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-100 dark:bg-slate-800/70 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-800'
            }`}
          >
            All Groups ({items.length})
          </button>
          {ALL_RESOLUTION_GROUPS.map((group) => {
            const count = groupCounts[group] || 0;
            const isActive = selectedGroupFilter === group;
            return (
              <button
                key={group}
                type="button"
                onClick={() => setSelectedGroupFilter(group)}
                className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  isActive
                    ? 'bg-indigo-600 text-white'
                    : count > 0
                      ? 'bg-slate-100 dark:bg-slate-800/70 text-slate-800 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700'
                      : 'bg-slate-50 dark:bg-slate-900/40 text-slate-400 dark:text-slate-600'
                }`}
              >
                {group} ({count})
              </button>
            );
          })}
        </div>
      </div>

      {/* Loaded Media Queue Table / Grid */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1624] overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Loaded Media Queue ({filteredItems.length.toLocaleString()})
            </h3>
            {isLoadingFiles && (
              <span className="text-xs text-indigo-500 font-medium">
                Scanning & decoding EXIF...
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Search input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by filename, camera, group..."
                aria-label="Filter loaded media files"
                className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-800 dark:text-slate-200 focus:outline-none focus:border-indigo-500 w-60"
              />
            </div>

            <button
              type="button"
              onClick={onClearAll}
              disabled={items.length === 0}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-rose-500/50 hover:text-rose-600 dark:hover:text-rose-400 text-xs font-medium text-slate-600 dark:text-slate-300 disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear All</span>
            </button>

            <button
              type="button"
              onClick={onNextStep}
              disabled={items.length === 0}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-semibold shadow-sm disabled:opacity-40 disabled:pointer-events-none transition-all cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>Next: Place & Configure Watermark</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {filteredItems.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {items.length === 0
                ? 'No photos or videos loaded yet.'
                : 'No files match the selected Resolution Group or search filter.'}
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-4">
              {items.length === 0
                ? 'Click "Add Files", "Add Folder", or load the 10-item Studio Sample Pack to inspect all Resolution Groups.'
                : 'Try selecting "All Groups" to view all queued files.'}
            </p>
            {items.length === 0 && (
              <button
                type="button"
                onClick={onLoadStudioSamplePack}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium transition-colors cursor-pointer"
              >
                <Sparkles className="w-4 h-4" />
                <span>Load Studio Sample Pack (10 Media Files)</span>
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto max-h-[420px] overflow-y-auto custom-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-900/80 sticky top-0 z-10 text-xs font-medium text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-4">Preview</th>
                  <th className="py-2.5 px-4">ID & Filename</th>
                  <th className="py-2.5 px-4">Resolution Group</th>
                  <th className="py-2.5 px-4 text-right">Dimensions</th>
                  <th className="py-2.5 px-4">EXIF / Codec Info</th>
                  <th className="py-2.5 px-4 text-right">Size</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
                {filteredItems.slice(0, visibleCount).map((item) => {
                  const isSwapped =
                    item.rawWidth !== item.width || item.rawHeight !== item.height;
                  return (
                    <tr
                      key={item.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-2 px-4 w-16">
                        {item.isCorrupted || !item.thumbnailUrl ? (
                          <div className="w-12 h-9 rounded bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-500">
                            <AlertTriangle className="w-4 h-4" />
                          </div>
                        ) : (
                          <div className="w-12 h-9 rounded overflow-hidden bg-slate-900 border border-slate-200 dark:border-slate-700 relative flex items-center justify-center">
                            <img
                              src={item.thumbnailUrl}
                              alt={item.name}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover"
                            />
                            {item.mediaType === 'video' && (
                              <span className="absolute bottom-0.5 right-0.5 bg-black/75 text-[9px] font-mono text-white px-1 rounded">
                                {formatDurationMmSs(item.durationSec)}
                              </span>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-4">
                        <div className="flex items-center gap-1.5 font-medium text-slate-900 dark:text-slate-100">
                          {item.mediaType === 'video' ? (
                            <FileVideo className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                          ) : (
                            <FileImage className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          )}
                          <span className="break-all" title={item.name}>
                            {item.name}
                          </span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500">
                          {item.id} · {item.path}
                        </div>
                      </td>
                      <td className="py-2 px-4">
                        <span
                          className={`font-medium ${
                            item.group === 'Corrupted'
                              ? 'text-rose-600 dark:text-rose-400'
                              : 'text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {item.group}
                        </span>
                      </td>
                      <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                        {item.isCorrupted ? (
                          <span className="text-rose-500">0 × 0</span>
                        ) : (
                          <div>
                            <span>
                              {item.width} × {item.height}
                            </span>
                            {isSwapped && (
                              <div className="text-[10px] text-indigo-400">
                                EXIF tag {item.exif.orientation} swapped ({item.rawWidth}×{item.rawHeight})
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-4 text-slate-500 dark:text-slate-400">
                        {item.isCorrupted ? (
                          <span className="text-rose-500">
                            {item.errorMessage || 'Failed to decode header'}
                          </span>
                        ) : item.exif.make || item.exif.model ? (
                          <span>
                            {[item.exif.make, item.exif.model].filter(Boolean).join(' ')}
                            {item.exif.aperture ? ` · ${item.exif.aperture}` : ''}
                            {item.exif.iso ? ` · ISO ${item.exif.iso}` : ''}
                          </span>
                        ) : (
                          <span>{item.mimeType}</span>
                        )}
                      </td>
                      <td className="py-2 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        {formatBytes(item.sizeBytes)}
                      </td>
                      <td className="py-2 px-4 text-right">
                        <button
                          type="button"
                          onClick={() => onRemoveItem(item.id)}
                          aria-label={`Remove ${item.name}`}
                          className="p-1.5 rounded hover:bg-rose-500/10 text-slate-400 hover:text-rose-500 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {filteredItems.length > visibleCount && (
              <div className="p-3 text-center border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setVisibleCount((prev) => prev + 100)}
                  className="px-4 py-1.5 rounded-md text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer"
                >
                  Show More ({filteredItems.length - visibleCount} remaining)
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
