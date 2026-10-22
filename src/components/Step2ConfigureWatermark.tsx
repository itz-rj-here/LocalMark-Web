import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BookmarkPlus,
  ChevronDown,
  ChevronRight,
  Download,
  Eye,
  FileVideo,
  Info,
  Layers,
  Redo2,
  RotateCcw,
  Save,
  Sliders,
  Trash2,
  Type,
  Undo2,
  Upload,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  ALL_RESOLUTION_GROUPS,
  FONT_OPTIONS,
  MediaItem,
  OutputFormat,
  Preset,
  ResolutionGroup,
  ResolutionTargetScope,
  WatermarkCoreSettings,
  WatermarkLogo,
  WatermarkPosition,
  WatermarkSettings,
  WatermarkType,
} from '../types/localmark';
import {
  BUILT_IN_PRESETS,
  calculateTargetDimensions,
  evaluateSmartWarnings,
  formatBytes,
  formatDurationMmSs,
  formatOutputFilename,
  formatResolutionScopeLabel,
  getExactResolutionKey,
  getMergedSettingsForGroup,
  getMergedSettingsForItem,
  groupItemsByExactResolution,
} from '../utils/watermarkEngine';
import { drawBaseMediaToCanvas, drawWatermarkOverlay } from '../utils/canvasRenderer';

interface Step2ConfigureWatermarkProps {
  items: MediaItem[];
  selectedItemId: string | null;
  onSelectItem: (id: string) => void;
  settings: WatermarkSettings;
  logo: WatermarkLogo | null;
  customPresets: Preset[];
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onUpdateCoreSettings: (
    patch: Partial<WatermarkCoreSettings>,
    targetGroup?: ResolutionTargetScope
  ) => void;
  onUpdateOutputSettings: (patch: Partial<WatermarkSettings['output']>) => void;
  onClearGroupOverride: (group: ResolutionTargetScope) => void;
  onApplyPreset: (preset: Preset, targetGroup?: ResolutionTargetScope) => void;
  onSaveCustomPreset: (name: string, description: string) => void;
  onDeleteCustomPreset: (id: string) => void;
  onImportPresetsJson: (presets: Preset[]) => void;
  onPrevStep: () => void;
  onNextStep: () => void;
}

const GRID_POSITIONS: { pos: WatermarkPosition; label: string }[] = [
  { pos: 'top-left', label: 'Top Left' },
  { pos: 'top-center', label: 'Top Center' },
  { pos: 'top-right', label: 'Top Right' },
  { pos: 'middle-left', label: 'Middle Left' },
  { pos: 'center', label: 'Center' },
  { pos: 'middle-right', label: 'Middle Right' },
  { pos: 'bottom-left', label: 'Bottom Left' },
  { pos: 'bottom-center', label: 'Bottom Center' },
  { pos: 'bottom-right', label: 'Bottom Right' },
];

export const Step2ConfigureWatermark: React.FC<Step2ConfigureWatermarkProps> = ({
  items,
  selectedItemId,
  onSelectItem,
  settings,
  logo,
  customPresets,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onUpdateCoreSettings,
  onUpdateOutputSettings,
  onClearGroupOverride,
  onApplyPreset,
  onSaveCustomPreset,
  onDeleteCustomPreset,
  onImportPresetsJson,
  onPrevStep,
  onNextStep,
}) => {
  const selectedItem = React.useMemo(() => {
    if (items.length === 0) return null;
    return items.find((i) => i.id === selectedItemId) || items[0];
  }, [items, selectedItemId]);

  const [viewMode, setViewMode] = useState<'split' | 'before' | 'after'>('split');
  const [splitPercent, setSplitPercent] = useState<number>(50);
  const [zoom, setZoom] = useState<number>(1);
  const [editingScope, setEditingScope] = useState<ResolutionTargetScope>('GLOBAL');
  const [resolutionPickerTab, setResolutionPickerTab] = useState<'exact' | 'category'>('exact');

  // Group all loaded items by exact W×H pixel resolution
  const exactResolutionBuckets = React.useMemo(
    () => groupItemsByExactResolution(items),
    [items]
  );

  // Count loaded items per ResolutionGroup category
  const categoryGroupCounts = React.useMemo(() => {
    const counts: Record<string, MediaItem[]> = {};
    for (const item of items) {
      if (!counts[item.group]) counts[item.group] = [];
      counts[item.group].push(item);
    }
    return counts;
  }, [items]);

  // Items matching the currently selected editingScope
  const scopeMatchingItems = React.useMemo(() => {
    if (editingScope === 'GLOBAL') return items.filter((i) => !i.isCorrupted);
    if (editingScope.startsWith('RES:')) {
      return items.filter(
        (i) => !i.isCorrupted && getExactResolutionKey(i.width, i.height) === editingScope
      );
    }
    return items.filter((i) => i.group === editingScope);
  }, [items, editingScope]);

  // Select a resolution scope and automatically preview a photo belonging to that resolution
  const handleSelectResolutionScope = (nextScope: ResolutionTargetScope) => {
    setEditingScope(nextScope);
    if (nextScope === 'GLOBAL') return;
    if (nextScope.startsWith('RES:')) {
      const matching = items.filter(
        (i) => !i.isCorrupted && getExactResolutionKey(i.width, i.height) === nextScope
      );
      if (matching.length > 0 && (!selectedItem || !matching.some((m) => m.id === selectedItem.id))) {
        onSelectItem(matching[0].id);
      }
    } else {
      const matching = items.filter((i) => i.group === nextScope);
      if (matching.length > 0 && (!selectedItem || selectedItem.group !== nextScope)) {
        onSelectItem(matching[0].id);
      }
    }
  };

  // Collapsible sections state (Advanced Controls collapsed by default per spec)
  const [openSections, setOpenSections] = useState<{
    essential: boolean;
    sizeMode: boolean;
    advanced: boolean;
    typeAndText: boolean;
    output: boolean;
    overrides: boolean;
  }>({
    essential: true,
    sizeMode: true,
    advanced: false,
    typeAndText: true,
    output: true,
    overrides: false,
  });

  // Preset Save Modal / Inline Form
  const [showPresetForm, setShowPresetForm] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetDesc, setPresetDesc] = useState('');
  const presetFileInputRef = useRef<HTMLInputElement>(null);

  // Canvases for Before and After rendering
  const beforeCanvasRef = useRef<HTMLCanvasElement>(null);
  const afterCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);

  // Determine the active CoreSettings being edited (Global, Category Group, or Exact W×H Resolution)
  const activeCoreSettings: WatermarkCoreSettings = React.useMemo(() => {
    if (editingScope === 'GLOBAL') {
      return settings;
    }
    return getMergedSettingsForGroup(settings, editingScope);
  }, [settings, editingScope]);

  // Determine the effective settings for the currently previewed item (merges Global -> Category -> Exact W×H)
  const previewCoreSettings: WatermarkCoreSettings = React.useMemo(() => {
    if (!selectedItem) return settings;
    return getMergedSettingsForItem(settings, selectedItem);
  }, [settings, selectedItem]);

  // Evaluate Smart Warnings for the currently selected item
  const smartWarnings = React.useMemo(
    () => evaluateSmartWarnings(selectedItem, settings, logo),
    [selectedItem, settings, logo]
  );

  // Render Before and After canvases in real-time
  useEffect(() => {
    let cancelled = false;
    const renderPreview = async () => {
      if (!selectedItem || !beforeCanvasRef.current || !afterCanvasRef.current) return;

      const beforeCanvas = beforeCanvasRef.current;
      const afterCanvas = afterCanvasRef.current;

      if (selectedItem.isCorrupted || selectedItem.width <= 0 || selectedItem.height <= 0) {
        beforeCanvas.width = 640;
        beforeCanvas.height = 400;
        afterCanvas.width = 640;
        afterCanvas.height = 400;
        const bCtx = beforeCanvas.getContext('2d')!;
        const aCtx = afterCanvas.getContext('2d')!;
        for (const ctx of [bCtx, aCtx]) {
          ctx.fillStyle = '#1e1b2e';
          ctx.fillRect(0, 0, 640, 400);
          ctx.fillStyle = '#f43f5e';
          ctx.font = '600 16px "Plus Jakarta Sans", sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('Corrupted or Unreadable Media File (0×0)', 320, 200);
        }
        return;
      }

      const target = calculateTargetDimensions(
        selectedItem.width,
        selectedItem.height,
        settings.output.resizeEnabled,
        settings.output.maxWidth,
        settings.output.maxHeight
      );

      // Fit preview canvas cleanly up to 960px on longest side for crisp 60fps interaction
      const maxPreviewDim = 960;
      const scaleRatio =
        Math.max(target.width, target.height) > maxPreviewDim
          ? maxPreviewDim / Math.max(target.width, target.height)
          : 1;

      const cw = Math.max(1, Math.round(target.width * scaleRatio));
      const ch = Math.max(1, Math.round(target.height * scaleRatio));

      beforeCanvas.width = cw;
      beforeCanvas.height = ch;
      afterCanvas.width = cw;
      afterCanvas.height = ch;

      const bCtx = beforeCanvas.getContext('2d')!;
      const aCtx = afterCanvas.getContext('2d')!;

      await drawBaseMediaToCanvas(bCtx, selectedItem, cw, ch);
      if (cancelled) return;

      aCtx.drawImage(beforeCanvas, 0, 0);

      const scaledCore: WatermarkCoreSettings = {
        ...previewCoreSettings,
        fixedPixelSize: Math.round(previewCoreSettings.fixedPixelSize * scaleRatio),
        tileSpacing: Math.round(previewCoreSettings.tileSpacing * scaleRatio),
      };

      await drawWatermarkOverlay(aCtx, cw, ch, scaledCore, logo);
    };

    renderPreview();
    return () => {
      cancelled = true;
    };
  }, [selectedItem, previewCoreSettings, settings.output, logo]);

  // Keyboard +/- zoom support
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))));
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))));
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Split slider pointer movement
  const updateSplitFromClientX = (clientX: number) => {
    if (!afterCanvasRef.current) return;
    const rect = afterCanvasRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const rel = ((clientX - rect.left) / rect.width) * 100;
    setSplitPercent(Math.max(0, Math.min(100, Math.round(rel))));
  };

  const toggleSection = (key: keyof typeof openSections) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleExportPresets = () => {
    const json = JSON.stringify(customPresets, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'localmark_custom_presets.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportPresetsFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (Array.isArray(parsed)) {
          onImportPresetsJson(parsed);
        }
      } catch {
        // Ignore invalid JSON
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const sampleFilenamePreview = selectedItem
    ? formatOutputFilename(
        settings.output.filenamePattern,
        selectedItem.name,
        settings.output.format,
        1,
        selectedItem.mediaType === 'video'
      )
    : 'photo_watermarked.jpg';

  const megapixels = selectedItem
    ? ((selectedItem.width * selectedItem.height) / 1_000_000).toFixed(2)
    : '0.00';
  const aspectRatioStr =
    selectedItem && selectedItem.height > 0
      ? (selectedItem.width / selectedItem.height).toFixed(2)
      : '—';

  return (
    <div className="space-y-5">
      {/* Top Action & Preset Toolbar */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1624] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onPrevStep}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Files</span>
            </button>

            <div className="h-5 w-px bg-slate-200 dark:bg-slate-800 mx-1" />

            {/* Undo / Redo Buttons */}
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              aria-label="Undo setting change (Ctrl+Z)"
              title="Undo (Ctrl+Z)"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Undo2 className="w-3.5 h-3.5" />
              <span>Undo</span>
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              aria-label="Redo setting change (Ctrl+Y)"
              title="Redo (Ctrl+Y)"
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <Redo2 className="w-3.5 h-3.5" />
              <span>Redo</span>
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => setShowPresetForm((v) => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-indigo-500/30 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-600 dark:text-indigo-300 text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <BookmarkPlus className="w-3.5 h-3.5" />
              <span>Save Preset (Ctrl+S)</span>
            </button>

            <button
              type="button"
              onClick={onNextStep}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-semibold shadow-sm transition-all cursor-pointer whitespace-nowrap shrink-0"
            >
              <span>Next: Process & Export</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Built-in Presets Quick Selector Row */}
        <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400 mr-1">
            Built-in Presets:
          </span>
          {BUILT_IN_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              onClick={() => onApplyPreset(preset, editingScope)}
              title={preset.description}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-slate-100 hover:bg-indigo-600 hover:text-white dark:bg-slate-800/80 dark:hover:bg-indigo-600 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              {preset.name}
            </button>
          ))}
        </div>
      </div>

      {/* Custom Presets Save / Import / Export Drawer */}
      {(showPresetForm || customPresets.length > 0) && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1624] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">
              Custom Studio Presets ({customPresets.length})
            </div>
            <div className="flex items-center gap-2">
              <input
                ref={presetFileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleImportPresetsFile}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => presetFileInputRef.current?.click()}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Upload className="w-3 h-3" />
                <span>Import JSON</span>
              </button>
              {customPresets.length > 0 && (
                <button
                  type="button"
                  onClick={handleExportPresets}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                >
                  <Download className="w-3 h-3" />
                  <span>Export JSON</span>
                </button>
              )}
            </div>
          </div>

          {showPresetForm && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (!presetName.trim()) return;
                onSaveCustomPreset(presetName.trim(), presetDesc.trim() || 'Custom studio preset');
                setPresetName('');
                setPresetDesc('');
                setShowPresetForm(false);
              }}
              className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800"
            >
              <input
                type="text"
                required
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="Preset name (e.g., Wedding Client Proof)"
                aria-label="Custom preset name"
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 w-56"
              />
              <input
                type="text"
                value={presetDesc}
                onChange={(e) => setPresetDesc(e.target.value)}
                placeholder="Short description..."
                aria-label="Custom preset description"
                className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 flex-1 min-w-[180px]"
              />
              <button
                type="submit"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium cursor-pointer"
              >
                <Save className="w-3.5 h-3.5" />
                <span>Save Preset</span>
              </button>
            </form>
          )}

          {customPresets.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {customPresets.map((cp) => (
                <div
                  key={cp.id}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-indigo-500/10 border border-indigo-500/20 text-xs"
                >
                  <button
                    type="button"
                    onClick={() => onApplyPreset(cp, editingScope)}
                    className="font-medium text-indigo-700 dark:text-indigo-300 hover:underline cursor-pointer"
                    title={cp.description}
                  >
                    {cp.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteCustomPreset(cp.id)}
                    aria-label={`Delete preset ${cp.name}`}
                    className="text-slate-400 hover:text-rose-500 cursor-pointer"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Smart Warnings Alert Bar */}
      {smartWarnings.length > 0 && (
        <div
          role="region"
          aria-label="Smart Watermark Warnings"
          className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="space-y-1 text-xs">
              {smartWarnings.map((w) => (
                <div
                  key={w.id}
                  className={
                    w.severity === 'error'
                      ? 'font-semibold text-rose-600 dark:text-rose-400'
                      : 'font-medium text-amber-800 dark:text-amber-200'
                  }
                >
                  {w.message}
                </div>
              ))}
            </div>
          </div>
          <span className="text-[11px] font-mono text-amber-700/80 dark:text-amber-300/80">
            Live Geometry Guard
          </span>
        </div>
      )}

      {/* Main 12-Column Studio Workspace: Live Preview & EXIF (7 cols) + Settings Inspector (5 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Live Split Preview + Thumbnail Strip + EXIF Metadata Panel */}
        <div className="lg:col-span-7 space-y-5">
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1624] overflow-hidden">
            {/* Preview Toolbar */}
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900">
                <button
                  type="button"
                  onClick={() => setViewMode('split')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    viewMode === 'split'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Split Comparison
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('before')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    viewMode === 'before'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  Before Only
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('after')}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                    viewMode === 'after'
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  After Only
                </button>
              </div>

              {/* Zoom Controls */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.max(0.5, Number((z - 0.25).toFixed(2))))}
                  aria-label="Zoom out preview"
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-xs font-mono tabular-nums px-2 text-slate-700 dark:text-slate-300">
                  {Math.round(zoom * 100)}%
                </span>
                <button
                  type="button"
                  onClick={() => setZoom((z) => Math.min(3, Number((z + 0.25).toFixed(2))))}
                  aria-label="Zoom in preview"
                  className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setZoom(1)}
                  className="px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-mono text-slate-600 dark:text-slate-300 cursor-pointer"
                >
                  1×
                </button>
              </div>
            </div>

            {/* Interactive Canvas Viewport */}
            <div
              ref={previewContainerRef}
              onPointerMove={(e) => {
                if (isDraggingSlider && viewMode === 'split') {
                  updateSplitFromClientX(e.clientX);
                }
              }}
              onPointerUp={() => setIsDraggingSlider(false)}
              onPointerLeave={() => setIsDraggingSlider(false)}
              className="relative h-[430px] bg-slate-950 flex items-center justify-center overflow-auto select-none p-4"
            >
              <div
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: 'center center',
                }}
                className="relative inline-block shadow-2xl rounded overflow-hidden border border-slate-800 transition-transform duration-150"
              >
                {/* Watermarked (After) Canvas Base */}
                <canvas
                  ref={afterCanvasRef}
                  data-testid="watermark-preview-after-canvas"
                  className="block max-h-[380px] max-w-full w-auto h-auto"
                />

                {/* Original (Before) Canvas Clipped Overlay */}
                <canvas
                  ref={beforeCanvasRef}
                  data-testid="watermark-preview-before-canvas"
                  style={{
                    clipPath:
                      viewMode === 'before'
                        ? 'inset(0 0 0 0)'
                        : viewMode === 'after'
                          ? 'inset(0 100% 0 0)'
                          : `inset(0 ${100 - splitPercent}% 0 0)`,
                  }}
                  className="absolute inset-0 w-full h-full pointer-events-none"
                />

                {/* Draggable Split Comparison Slider */}
                {viewMode === 'split' && (
                  <div
                    style={{ left: `${splitPercent}%` }}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      setIsDraggingSlider(true);
                    }}
                    className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_10px_rgba(0,0,0,0.8)] cursor-ew-resize z-20"
                  >
                    <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-7 h-7 rounded-full bg-indigo-600 border-2 border-white text-white flex items-center justify-center shadow-lg text-[10px] font-bold">
                      ↔
                    </div>
                    <span className="absolute top-2 right-2 bg-black/75 text-white text-[10px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap">
                      Original
                    </span>
                    <span className="absolute top-2 left-2 bg-indigo-600/90 text-white text-[10px] font-mono px-1.5 py-0.5 rounded whitespace-nowrap">
                      Watermarked
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Split Slider Range Input + Selected Item Readout */}
            <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-900/60 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs">
              {selectedItem ? (
                <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-300 font-mono tabular-nums">
                  <span className="font-semibold text-slate-900 dark:text-white break-all">
                    {selectedItem.name}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span>
                    {selectedItem.width}×{selectedItem.height}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className="text-indigo-500">{selectedItem.group}</span>
                  {settings.groupOverrides[selectedItem.group] && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="text-amber-500">Group Override Active</span>
                    </>
                  )}
                </div>
              ) : (
                <span>No file selected</span>
              )}

              {viewMode === 'split' && (
                <div className="flex items-center gap-2">
                  <label htmlFor="split-slider" className="text-slate-500 dark:text-slate-400">
                    Split:
                  </label>
                  <input
                    id="split-slider"
                    type="range"
                    min={0}
                    max={100}
                    value={splitPercent}
                    onChange={(e) => setSplitPercent(Number(e.target.value))}
                    className="w-28 accent-indigo-600 cursor-pointer"
                  />
                  <span className="font-mono tabular-nums w-9 text-right text-slate-600 dark:text-slate-400">
                    {splitPercent}%
                  </span>
                </div>
              )}
            </div>

            {/* Bottom Thumbnail Strip */}
            <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1624]">
              <div className="flex items-center gap-2.5 overflow-x-auto pb-2 custom-scrollbar-thin">
                {items.slice(0, 40).map((item) => {
                  const active = selectedItem?.id === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onSelectItem(item.id)}
                      className={`group relative shrink-0 w-28 h-16 rounded-lg overflow-hidden border-2 transition-all cursor-pointer ${
                        active
                          ? 'border-indigo-500 ring-2 ring-indigo-500/30'
                          : 'border-slate-200 dark:border-slate-800 opacity-75 hover:opacity-100'
                      }`}
                    >
                      {item.thumbnailUrl ? (
                        <img
                          src={item.thumbnailUrl}
                          alt={item.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full bg-rose-950/60 flex items-center justify-center text-rose-400 text-[10px] font-mono">
                          ERR
                        </div>
                      )}
                      {item.mediaType === 'video' && (
                        <span className="absolute top-1 right-1 bg-black/80 text-white text-[9px] font-mono px-1 rounded flex items-center gap-0.5">
                          <FileVideo className="w-2.5 h-2.5" />
                          {formatDurationMmSs(item.durationSec)}
                        </span>
                      )}
                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/65 to-transparent px-1 py-0.5 text-[9px] leading-tight text-white font-mono whitespace-normal text-center">
                        {item.group}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* EXIF Metadata & Technical Inspector Panel */}
          {selectedItem && (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1624] p-5">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <Info className="w-4 h-4 text-indigo-500" />
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    EXIF & Media Technical Metadata
                  </h3>
                </div>
                <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                  {selectedItem.id} · {selectedItem.mimeType}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800/80">
                  <div className="text-slate-400 dark:text-slate-500">Camera Make / Model</div>
                  <div className="font-medium text-slate-800 dark:text-slate-200 mt-0.5 break-words leading-snug">
                    {[selectedItem.exif.make, selectedItem.exif.model].filter(Boolean).join(' ') ||
                      'Unlisted / Native'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800/80">
                  <div className="text-slate-400 dark:text-slate-500">Lens</div>
                  <div className="font-medium text-slate-800 dark:text-slate-200 mt-0.5 break-words leading-snug">
                    {selectedItem.exif.lens || 'Standard Prime/Zoom'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800/80">
                  <div className="text-slate-400 dark:text-slate-500">Exposure / ISO</div>
                  <div className="font-mono tabular-nums font-medium text-slate-800 dark:text-slate-200 mt-0.5 break-words leading-snug">
                    {selectedItem.exif.aperture || 'f/—'} · {selectedItem.exif.shutterSpeed || '—'} · ISO{' '}
                    {selectedItem.exif.iso || '—'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800/80">
                  <div className="text-slate-400 dark:text-slate-500">Focal Length & Color</div>
                  <div className="font-mono tabular-nums font-medium text-slate-800 dark:text-slate-200 mt-0.5 break-words leading-snug">
                    {selectedItem.exif.focalLength || '—'} · {selectedItem.exif.colorSpace || 'sRGB'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800/80">
                  <div className="text-slate-400 dark:text-slate-500">Dimensions & MP</div>
                  <div className="font-mono tabular-nums font-medium text-slate-800 dark:text-slate-200 mt-0.5 break-words leading-snug">
                    {selectedItem.width}×{selectedItem.height} ({megapixels} MP)
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800/80">
                  <div className="text-slate-400 dark:text-slate-500">Aspect Ratio & Group</div>
                  <div className="font-mono tabular-nums font-medium text-slate-800 dark:text-slate-200 mt-0.5 break-words leading-snug">
                    {aspectRatioStr}:1 · {selectedItem.group}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800/80">
                  <div className="text-slate-400 dark:text-slate-500">EXIF Orientation & Date</div>
                  <div className="font-mono tabular-nums font-medium text-slate-800 dark:text-slate-200 mt-0.5 break-words leading-snug">
                    Tag {selectedItem.exif.orientation || 1} · {selectedItem.exif.dateTaken || '—'}
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-100 dark:border-slate-800/80">
                  <div className="text-slate-400 dark:text-slate-500">
                    {selectedItem.mediaType === 'video' ? 'Duration & Size' : 'Software & Size'}
                  </div>
                  <div className="font-mono tabular-nums font-medium text-slate-800 dark:text-slate-200 mt-0.5 break-words leading-snug">
                    {selectedItem.mediaType === 'video'
                      ? `${formatDurationMmSs(selectedItem.durationSec)} · ${formatBytes(selectedItem.sizeBytes)}`
                      : `${selectedItem.exif.software || 'RAW'} · ${formatBytes(selectedItem.sizeBytes)}`}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Collapsible Watermark Configuration Inspector */}
        <div className="lg:col-span-5 space-y-3">
          {/* Scope Selector: Global vs Same-Resolution (W×H) & Category Group Overrides */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1624] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="scope-select"
                className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5"
              >
                <Layers className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                <span>Resolution Group & Same-Dimension Target</span>
              </label>
              <div className="flex items-center gap-2">
                {selectedItem && !selectedItem.isCorrupted && (
                  <button
                    type="button"
                    onClick={() => {
                      const exactKey = getExactResolutionKey(selectedItem.width, selectedItem.height);
                      setResolutionPickerTab('exact');
                      handleSelectResolutionScope(exactKey);
                    }}
                    className="text-[11px] font-mono font-medium px-2 py-0.5 rounded border border-indigo-500/30 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 hover:bg-indigo-500/20 transition-colors cursor-pointer"
                    title="Configure watermark specifically for all photos sharing the selected image's exact pixel dimensions"
                  >
                    Target {selectedItem.width}×{selectedItem.height}px
                  </button>
                )}
                {editingScope !== 'GLOBAL' && settings.groupOverrides[editingScope] && (
                  <button
                    type="button"
                    onClick={() => onClearGroupOverride(editingScope)}
                    className="text-[11px] font-medium text-rose-500 hover:underline cursor-pointer"
                  >
                    Reset Override
                  </button>
                )}
              </div>
            </div>

            {/* Unified Dropdown for Global, Exact Same Resolution (W×H), and Aspect Category Groups */}
            <select
              id="scope-select"
              value={editingScope}
              onChange={(e) => handleSelectResolutionScope(e.target.value as ResolutionTargetScope)}
              className="w-full px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-medium text-slate-900 dark:text-slate-100 focus:outline-none focus:border-indigo-500"
            >
              <option value="GLOBAL">Global Settings (Default for all Photo Resolutions)</option>
              {exactResolutionBuckets.length > 0 && (
                <optgroup label="Same Exact Resolution Groups (Width × Height)">
                  {exactResolutionBuckets.map((bucket) => {
                    const hasOverride = Boolean(settings.groupOverrides[bucket.key]);
                    return (
                      <option key={bucket.key} value={bucket.key}>
                        Same Resolution: {bucket.label} ({bucket.count}{' '}
                        {bucket.count === 1 ? 'file' : 'files'} · {bucket.group}){' '}
                        {hasOverride ? '★ Custom Watermark' : ''}
                      </option>
                    );
                  })}
                </optgroup>
              )}
              <optgroup label="Aspect Ratio & Resolution Category Groups">
                {ALL_RESOLUTION_GROUPS.filter((g) => g !== 'Corrupted').map((g) => {
                  const hasOverride = Boolean(settings.groupOverrides[g]);
                  const count = categoryGroupCounts[g]?.length || 0;
                  return (
                    <option key={g} value={g}>
                      Category Group: {g} ({count} {count === 1 ? 'file' : 'files'}){' '}
                      {hasOverride ? '★ Custom Watermark' : ''}
                    </option>
                  );
                })}
              </optgroup>
            </select>

            {/* Quick Interactive Group Selector (Same Pixel Resolution vs Aspect Category) */}
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex items-center gap-1 p-0.5 rounded-lg bg-slate-100 dark:bg-slate-900 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setResolutionPickerTab('exact')}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                      resolutionPickerTab === 'exact'
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Same Resolution W×H ({exactResolutionBuckets.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setResolutionPickerTab('category')}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                      resolutionPickerTab === 'category'
                        ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    Resolution Categories (9)
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => handleSelectResolutionScope('GLOBAL')}
                  className={`text-[11px] font-medium px-2 py-1 rounded transition-colors cursor-pointer ${
                    editingScope === 'GLOBAL'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  All Photos ({items.length})
                </button>
              </div>

              {resolutionPickerTab === 'exact' ? (
                <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto custom-scrollbar-thin pr-0.5">
                  {exactResolutionBuckets.map((bucket) => {
                    const isSelected = editingScope === bucket.key;
                    const hasOverride = Boolean(settings.groupOverrides[bucket.key]);
                    return (
                      <button
                        key={bucket.key}
                        type="button"
                        onClick={() => handleSelectResolutionScope(bucket.key)}
                        className={`px-2.5 py-1.5 rounded-lg border text-left transition-all cursor-pointer flex items-center justify-between gap-1.5 ${
                          isSelected
                            ? 'border-indigo-500 bg-indigo-500/15 text-indigo-700 dark:text-indigo-200'
                            : hasOverride
                              ? 'border-indigo-500/40 bg-indigo-500/5 text-slate-800 dark:text-slate-200'
                              : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="font-mono tabular-nums text-[11px] font-semibold leading-tight">
                            {bucket.width}×{bucket.height}
                            {hasOverride ? ' ★' : ''}
                          </div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-tight">
                            {bucket.group}
                          </div>
                        </div>
                        <span className="font-mono tabular-nums text-[10px] text-slate-500 dark:text-slate-400 shrink-0">
                          {bucket.count} {bucket.count === 1 ? 'img' : 'imgs'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto custom-scrollbar-thin pr-0.5">
                  {ALL_RESOLUTION_GROUPS.filter((g) => g !== 'Corrupted').map((g) => {
                    const isSelected = editingScope === g;
                    const hasOverride = Boolean(settings.groupOverrides[g]);
                    const count = categoryGroupCounts[g]?.length || 0;
                    return (
                      <button
                        key={g}
                        type="button"
                        onClick={() => handleSelectResolutionScope(g)}
                        className={`px-2.5 py-1.5 rounded-lg border text-left transition-all cursor-pointer flex items-center justify-between gap-1.5 ${
                          isSelected
                            ? 'border-indigo-500 bg-indigo-500/15 text-indigo-700 dark:text-indigo-200'
                            : hasOverride
                              ? 'border-indigo-500/40 bg-indigo-500/5 text-slate-800 dark:text-slate-200'
                              : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                        }`}
                      >
                        <span className="text-[11px] font-medium leading-tight">
                          {g}
                          {hasOverride ? ' ★' : ''}
                        </span>
                        <span className="font-mono tabular-nums text-[10px] text-slate-500 dark:text-slate-400 shrink-0">
                          {count}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Active Scope Status & Matching Images Switcher */}
            {editingScope !== 'GLOBAL' && (
              <div className="p-2.5 rounded-lg bg-indigo-500/10 border border-indigo-500/20 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-1 text-[11px]">
                  <span className="text-indigo-700 dark:text-indigo-300 font-medium">
                    Customizing watermark for{' '}
                    <strong className="font-mono">{formatResolutionScopeLabel(editingScope)}</strong> (
                    {scopeMatchingItems.length}{' '}
                    {scopeMatchingItems.length === 1 ? 'matching file' : 'matching files'})
                  </span>
                </div>
                {scopeMatchingItems.length > 0 && (
                  <div className="flex items-center gap-1.5 overflow-x-auto custom-scrollbar-thin pb-1">
                    {scopeMatchingItems.slice(0, 12).map((mItem) => {
                      const isCurrentPreview = selectedItem?.id === mItem.id;
                      return (
                        <button
                          key={mItem.id}
                          type="button"
                          onClick={() => onSelectItem(mItem.id)}
                          className={`px-2 py-1 rounded text-[10px] font-mono shrink-0 transition-colors cursor-pointer ${
                            isCurrentPreview
                              ? 'bg-indigo-600 text-white font-semibold'
                              : 'bg-white/80 dark:bg-slate-900/80 text-slate-700 dark:text-slate-300 hover:bg-indigo-500/20'
                          }`}
                        >
                          {mItem.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* 100% Original Resolution & Lossless Quality Preservation Lock */}
            <div className="pt-2.5 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={settings.output.preserveOriginalQuality !== false}
                  onChange={(e) => {
                    const locked = e.target.checked;
                    onUpdateOutputSettings({
                      preserveOriginalQuality: locked,
                      ...(locked
                        ? {
                            resizeEnabled: false,
                            format: 'original',
                            quality: 1.0,
                          }
                        : {}),
                    });
                  }}
                  className="w-3.5 h-3.5 accent-emerald-600 cursor-pointer"
                />
                <span className="font-semibold text-slate-800 dark:text-slate-200">
                  100% Preserve Original Image Resolution & Quality
                </span>
              </label>
              <span className="font-mono tabular-nums text-[10px] text-emerald-600 dark:text-emerald-400">
                {settings.output.preserveOriginalQuality !== false
                  ? `1:1 Native ${selectedItem ? `${selectedItem.width}×${selectedItem.height}px` : 'Pixels'} · 100% Quality`
                  : `Custom Export (${Math.round(settings.output.quality * 100)}% Quality)`}
              </span>
            </div>
          </div>

          {/* 1. Watermark Type & Text Settings */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1624] overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection('typeAndText')}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
            >
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Type className="w-3.5 h-3.5 text-indigo-500" />
                <span>Watermark Type & Text Styling</span>
              </span>
              {openSections.typeAndText ? (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {openSections.typeAndText && (
              <div className="p-4 pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-3 text-xs">
                {/* Type Selector: Logo Only, Text Only, Both */}
                <div className="grid grid-cols-3 gap-1.5 p-1 rounded-lg bg-slate-100 dark:bg-slate-900">
                  {(
                    [
                      { id: 'logo', label: 'Logo Only' },
                      { id: 'text', label: 'Text Only' },
                      { id: 'both', label: 'Both' },
                    ] as { id: WatermarkType; label: string }[]
                  ).map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => onUpdateCoreSettings({ watermarkType: t.id }, editingScope)}
                      className={`py-1.5 px-2 rounded-md font-medium transition-colors cursor-pointer whitespace-nowrap ${
                        activeCoreSettings.watermarkType === t.id
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {(activeCoreSettings.watermarkType === 'text' ||
                  activeCoreSettings.watermarkType === 'both') && (
                  <div className="space-y-3 pt-2">
                    <div>
                      <label htmlFor="wm-text-input" className="block text-slate-500 dark:text-slate-400 mb-1">
                        Watermark Text
                      </label>
                      <input
                        id="wm-text-input"
                        type="text"
                        value={activeCoreSettings.text}
                        onChange={(e) => onUpdateCoreSettings({ text: e.target.value }, editingScope)}
                        placeholder="© LocalMark Studio"
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                      />
                    </div>

                    <div>
                      <label htmlFor="wm-font-select" className="block text-slate-500 dark:text-slate-400 mb-1">
                        Font Family
                      </label>
                      <select
                        id="wm-font-select"
                        value={activeCoreSettings.fontFamily}
                        onChange={(e) =>
                          onUpdateCoreSettings({ fontFamily: e.target.value }, editingScope)
                        }
                        className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                      >
                        {FONT_OPTIONS.map((f) => (
                          <option key={f.id} value={f.family}>
                            {f.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label htmlFor="wm-text-color" className="block text-slate-500 dark:text-slate-400 mb-1">
                          Text Color
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            id="wm-text-color"
                            type="color"
                            value={activeCoreSettings.textColor}
                            onChange={(e) =>
                              onUpdateCoreSettings({ textColor: e.target.value }, editingScope)
                            }
                            className="w-8 h-7 rounded cursor-pointer border border-slate-300 dark:border-slate-700"
                          />
                          <span className="font-mono text-slate-600 dark:text-slate-300">
                            {activeCoreSettings.textColor}
                          </span>
                        </div>
                      </div>

                      <div>
                        <label htmlFor="wm-outline-color" className="block text-slate-500 dark:text-slate-400 mb-1">
                          Outline Color
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            id="wm-outline-color"
                            type="color"
                            value={activeCoreSettings.outlineColor}
                            onChange={(e) =>
                              onUpdateCoreSettings({ outlineColor: e.target.value }, editingScope)
                            }
                            className="w-8 h-7 rounded cursor-pointer border border-slate-300 dark:border-slate-700"
                          />
                          <span className="font-mono text-slate-600 dark:text-slate-300">
                            {activeCoreSettings.outlineColor}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="flex justify-between mb-1">
                          <label htmlFor="wm-outline-width" className="text-slate-500 dark:text-slate-400">
                            Outline Width
                          </label>
                          <span className="font-mono tabular-nums">{activeCoreSettings.outlineWidth}px</span>
                        </div>
                        <input
                          id="wm-outline-width"
                          type="range"
                          min={0}
                          max={20}
                          value={activeCoreSettings.outlineWidth}
                          onChange={(e) =>
                            onUpdateCoreSettings(
                              { outlineWidth: Number(e.target.value) },
                              editingScope
                            )
                          }
                          className="w-full accent-indigo-600"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between mb-1">
                          <label htmlFor="wm-shadow-blur" className="text-slate-500 dark:text-slate-400">
                            Shadow Blur
                          </label>
                          <span className="font-mono tabular-nums">{activeCoreSettings.shadowBlur}px</span>
                        </div>
                        <input
                          id="wm-shadow-blur"
                          type="range"
                          min={0}
                          max={50}
                          value={activeCoreSettings.shadowBlur}
                          onChange={(e) =>
                            onUpdateCoreSettings({ shadowBlur: Number(e.target.value) }, editingScope)
                          }
                          className="w-full accent-indigo-600"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <div className="flex justify-between mb-1">
                          <label htmlFor="wm-shadow-x" className="text-slate-500 dark:text-slate-400">
                            Shadow Offset X
                          </label>
                          <span className="font-mono tabular-nums">{activeCoreSettings.shadowOffsetX}px</span>
                        </div>
                        <input
                          id="wm-shadow-x"
                          type="range"
                          min={-20}
                          max={20}
                          value={activeCoreSettings.shadowOffsetX}
                          onChange={(e) =>
                            onUpdateCoreSettings(
                              { shadowOffsetX: Number(e.target.value) },
                              editingScope
                            )
                          }
                          className="w-full accent-indigo-600"
                        />
                      </div>

                      <div>
                        <div className="flex justify-between mb-1">
                          <label htmlFor="wm-shadow-y" className="text-slate-500 dark:text-slate-400">
                            Shadow Offset Y
                          </label>
                          <span className="font-mono tabular-nums">{activeCoreSettings.shadowOffsetY}px</span>
                        </div>
                        <input
                          id="wm-shadow-y"
                          type="range"
                          min={-20}
                          max={20}
                          value={activeCoreSettings.shadowOffsetY}
                          onChange={(e) =>
                            onUpdateCoreSettings(
                              { shadowOffsetY: Number(e.target.value) },
                              editingScope
                            )
                          }
                          className="w-full accent-indigo-600"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 2. Essential Controls */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1624] overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection('essential')}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
            >
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <Sliders className="w-3.5 h-3.5 text-indigo-500" />
                <span>Essential Controls (Position, Scale, Opacity, Margin)</span>
              </span>
              {openSections.essential ? (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {openSections.essential && (
              <div className="p-4 pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-4 text-xs">
                {/* 3x3 Position Grid + Custom */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-slate-500 dark:text-slate-400">Anchor Position</span>
                    <span className="font-mono text-indigo-500">{activeCoreSettings.position}</span>
                  </div>
                  <div className="grid grid-cols-4 gap-2 items-center">
                    <div className="col-span-3 grid grid-cols-3 gap-1.5 p-1.5 rounded-lg bg-slate-100 dark:bg-slate-900">
                      {GRID_POSITIONS.map((cell) => (
                        <button
                          key={cell.pos}
                          type="button"
                          onClick={() =>
                            onUpdateCoreSettings({ position: cell.pos, tiled: false }, editingScope)
                          }
                          aria-label={`Position ${cell.label}`}
                          className={`py-2 rounded text-[11px] font-medium transition-colors cursor-pointer ${
                            activeCoreSettings.position === cell.pos
                              ? 'bg-indigo-600 text-white shadow-sm'
                              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-indigo-500/20'
                          }`}
                        >
                          {cell.label
                            .split(' ')
                            .map((w) => w[0])
                            .join('')}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        onUpdateCoreSettings({ position: 'custom', tiled: false }, editingScope)
                      }
                      className={`h-full py-2 px-2 rounded-lg border text-xs font-medium transition-colors cursor-pointer ${
                        activeCoreSettings.position === 'custom'
                          ? 'bg-indigo-600 border-indigo-500 text-white'
                          : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      Custom X/Y
                    </button>
                  </div>
                </div>

                {/* Scale 1-100% */}
                <div>
                  <div className="flex justify-between mb-1">
                    <label htmlFor="wm-scale" className="text-slate-600 dark:text-slate-300 font-medium">
                      Scale
                    </label>
                    <span className="font-mono tabular-nums text-indigo-500">
                      {activeCoreSettings.scale}%
                    </span>
                  </div>
                  <input
                    id="wm-scale"
                    type="range"
                    min={1}
                    max={100}
                    value={activeCoreSettings.scale}
                    onChange={(e) =>
                      onUpdateCoreSettings({ scale: Number(e.target.value) }, editingScope)
                    }
                    className="w-full accent-indigo-600 cursor-pointer"
                  />
                </div>

                {/* Opacity 0-100% */}
                <div>
                  <div className="flex justify-between mb-1">
                    <label htmlFor="wm-opacity" className="text-slate-600 dark:text-slate-300 font-medium">
                      Opacity
                    </label>
                    <span className="font-mono tabular-nums text-indigo-500">
                      {activeCoreSettings.opacity}%
                    </span>
                  </div>
                  <input
                    id="wm-opacity"
                    type="range"
                    min={0}
                    max={100}
                    value={activeCoreSettings.opacity}
                    onChange={(e) =>
                      onUpdateCoreSettings({ opacity: Number(e.target.value) }, editingScope)
                    }
                    className="w-full accent-indigo-600 cursor-pointer"
                  />
                </div>

                {/* Margin 0-20% */}
                <div>
                  <div className="flex justify-between mb-1">
                    <label htmlFor="wm-margin" className="text-slate-600 dark:text-slate-300 font-medium">
                      Edge Margin (shorter side)
                    </label>
                    <span className="font-mono tabular-nums text-indigo-500">
                      {activeCoreSettings.margin}%
                    </span>
                  </div>
                  <input
                    id="wm-margin"
                    type="range"
                    min={0}
                    max={20}
                    step={0.5}
                    value={activeCoreSettings.margin}
                    onChange={(e) =>
                      onUpdateCoreSettings({ margin: Number(e.target.value) }, editingScope)
                    }
                    className="w-full accent-indigo-600 cursor-pointer"
                  />
                </div>

                {/* Offset X & Offset Y (-50% to +50%) */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <div className="flex justify-between mb-1">
                      <label htmlFor="wm-offset-x" className="text-slate-500 dark:text-slate-400">
                        Offset X Nudge
                      </label>
                      <span className="font-mono tabular-nums">{activeCoreSettings.offsetX}%</span>
                    </div>
                    <input
                      id="wm-offset-x"
                      type="range"
                      min={-50}
                      max={50}
                      value={activeCoreSettings.offsetX}
                      onChange={(e) =>
                        onUpdateCoreSettings({ offsetX: Number(e.target.value) }, editingScope)
                      }
                      className="w-full accent-indigo-600 cursor-pointer"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between mb-1">
                      <label htmlFor="wm-offset-y" className="text-slate-500 dark:text-slate-400">
                        Offset Y Nudge
                      </label>
                      <span className="font-mono tabular-nums">{activeCoreSettings.offsetY}%</span>
                    </div>
                    <input
                      id="wm-offset-y"
                      type="range"
                      min={-50}
                      max={50}
                      value={activeCoreSettings.offsetY}
                      onChange={(e) =>
                        onUpdateCoreSettings({ offsetY: Number(e.target.value) }, editingScope)
                      }
                      className="w-full accent-indigo-600 cursor-pointer"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 3. Size Mode */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1624] overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection('sizeMode')}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
            >
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Size Mode (Relative vs Fixed Pixel)
              </span>
              {openSections.sizeMode ? (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {openSections.sizeMode && (
              <div className="p-4 pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-lg bg-slate-100 dark:bg-slate-900">
                  <button
                    type="button"
                    onClick={() => onUpdateCoreSettings({ fitMode: 'relative' }, editingScope)}
                    className={`py-1.5 px-2 rounded-md font-medium transition-colors cursor-pointer ${
                      activeCoreSettings.fitMode === 'relative'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Relative (% of Side)
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdateCoreSettings({ fitMode: 'fixed' }, editingScope)}
                    className={`py-1.5 px-2 rounded-md font-medium transition-colors cursor-pointer ${
                      activeCoreSettings.fitMode === 'fixed'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    Fixed Pixel Width
                  </button>
                </div>

                {activeCoreSettings.fitMode === 'relative' ? (
                  <div>
                    <label className="block text-slate-500 dark:text-slate-400 mb-1">
                      Reference Side
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateCoreSettings({ referenceSide: 'shorter' }, editingScope)
                        }
                        className={`py-1.5 px-3 rounded-lg border font-medium cursor-pointer ${
                          activeCoreSettings.referenceSide === 'shorter'
                            ? 'border-indigo-500 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        Shorter side (Default)
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateCoreSettings({ referenceSide: 'longer' }, editingScope)
                        }
                        className={`py-1.5 px-3 rounded-lg border font-medium cursor-pointer ${
                          activeCoreSettings.referenceSide === 'longer'
                            ? 'border-indigo-500 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300'
                            : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        Longer side
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex justify-between mb-1">
                      <label htmlFor="wm-fixed-px" className="text-slate-500 dark:text-slate-400">
                        Fixed Pixel Size (10–5000px)
                      </label>
                      <span className="font-mono tabular-nums">
                        {activeCoreSettings.fixedPixelSize}px
                      </span>
                    </div>
                    <input
                      id="wm-fixed-px"
                      type="number"
                      min={10}
                      max={5000}
                      value={activeCoreSettings.fixedPixelSize}
                      onChange={(e) =>
                        onUpdateCoreSettings(
                          { fixedPixelSize: Math.max(10, Math.min(5000, Number(e.target.value))) },
                          editingScope
                        )
                      }
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono text-slate-900 dark:text-slate-100"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 4. Advanced Controls (Collapsed by Default per prompt) */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1624] overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection('advanced')}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
            >
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Advanced Controls (Rotation, Tiled Grid, Custom X/Y)
              </span>
              {openSections.advanced ? (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {openSections.advanced && (
              <div className="p-4 pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-3 text-xs">
                {/* Rotation -180 to +180 */}
                <div>
                  <div className="flex justify-between mb-1">
                    <label htmlFor="wm-rotation" className="text-slate-500 dark:text-slate-400">
                      Rotation Angle
                    </label>
                    <span className="font-mono tabular-nums">{activeCoreSettings.rotation}°</span>
                  </div>
                  <input
                    id="wm-rotation"
                    type="range"
                    min={-180}
                    max={180}
                    value={activeCoreSettings.rotation}
                    onChange={(e) =>
                      onUpdateCoreSettings({ rotation: Number(e.target.value) }, editingScope)
                    }
                    className="w-full accent-indigo-600 cursor-pointer"
                  />
                </div>

                {/* Tiled Mode Toggle */}
                <div className="flex items-center justify-between py-1">
                  <div>
                    <div className="font-medium text-slate-800 dark:text-slate-200">
                      Anti-Theft Tiled Grid Mode
                    </div>
                    <div className="text-[11px] text-slate-500 dark:text-slate-400">
                      Repeat watermark diagonally across entire frame
                    </div>
                  </div>
                  <input
                    type="checkbox"
                    aria-label="Enable Anti-Theft Tiled Grid Mode"
                    checked={activeCoreSettings.tiled}
                    onChange={(e) =>
                      onUpdateCoreSettings({ tiled: e.target.checked }, editingScope)
                    }
                    className="w-4 h-4 accent-indigo-600 cursor-pointer"
                  />
                </div>

                {activeCoreSettings.tiled && (
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <div className="flex justify-between mb-1">
                        <label htmlFor="wm-tile-spacing" className="text-slate-500 dark:text-slate-400">
                          Tile Spacing
                        </label>
                        <span className="font-mono tabular-nums">
                          {activeCoreSettings.tileSpacing}px
                        </span>
                      </div>
                      <input
                        id="wm-tile-spacing"
                        type="range"
                        min={10}
                        max={1000}
                        value={activeCoreSettings.tileSpacing}
                        onChange={(e) =>
                          onUpdateCoreSettings({ tileSpacing: Number(e.target.value) }, editingScope)
                        }
                        className="w-full accent-indigo-600"
                      />
                    </div>
                    <div>
                      <div className="flex justify-between mb-1">
                        <label htmlFor="wm-tile-angle" className="text-slate-500 dark:text-slate-400">
                          Tile Grid Angle
                        </label>
                        <span className="font-mono tabular-nums">{activeCoreSettings.tileAngle}°</span>
                      </div>
                      <input
                        id="wm-tile-angle"
                        type="range"
                        min={-180}
                        max={180}
                        value={activeCoreSettings.tileAngle}
                        onChange={(e) =>
                          onUpdateCoreSettings({ tileAngle: Number(e.target.value) }, editingScope)
                        }
                        className="w-full accent-indigo-600"
                      />
                    </div>
                  </div>
                )}

                {/* Custom X / Custom Y */}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <div className="flex justify-between mb-1">
                      <label htmlFor="wm-custom-x" className="text-slate-500 dark:text-slate-400">
                        Custom X (%)
                      </label>
                      <span className="font-mono tabular-nums">{activeCoreSettings.customX}%</span>
                    </div>
                    <input
                      id="wm-custom-x"
                      type="range"
                      min={0}
                      max={100}
                      value={activeCoreSettings.customX}
                      onChange={(e) =>
                        onUpdateCoreSettings(
                          { position: 'custom', customX: Number(e.target.value) },
                          editingScope
                        )
                      }
                      className="w-full accent-indigo-600"
                    />
                  </div>
                  <div>
                    <div className="flex justify-between mb-1">
                      <label htmlFor="wm-custom-y" className="text-slate-500 dark:text-slate-400">
                        Custom Y (%)
                      </label>
                      <span className="font-mono tabular-nums">{activeCoreSettings.customY}%</span>
                    </div>
                    <input
                      id="wm-custom-y"
                      type="range"
                      min={0}
                      max={100}
                      value={activeCoreSettings.customY}
                      onChange={(e) =>
                        onUpdateCoreSettings(
                          { position: 'custom', customY: Number(e.target.value) },
                          editingScope
                        )
                      }
                      className="w-full accent-indigo-600"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 5. Output Settings */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1624] overflow-hidden">
            <button
              type="button"
              onClick={() => toggleSection('output')}
              className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer"
            >
              <span className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                Output & Multi-Core Export Settings
              </span>
              {openSections.output ? (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronRight className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {openSections.output && (
              <div className="p-4 pt-2 border-t border-slate-100 dark:border-slate-800/80 space-y-3 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="out-format" className="block text-slate-500 dark:text-slate-400 mb-1">
                      Output Format
                    </label>
                    <select
                      id="out-format"
                      value={settings.output.format}
                      onChange={(e) =>
                        onUpdateOutputSettings({ format: e.target.value as OutputFormat })
                      }
                      className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                    >
                      <option value="original">Original (Keep Source)</option>
                      <option value="jpeg">JPEG</option>
                      <option value="png">PNG (Lossless)</option>
                      <option value="webp">WebP</option>
                    </select>
                  </div>

                  <div>
                    <div className="flex justify-between mb-1">
                      <label htmlFor="out-quality" className="text-slate-500 dark:text-slate-400">
                        Codec Quality
                      </label>
                      <span className="font-mono tabular-nums">
                        {settings.output.quality.toFixed(2)}
                      </span>
                    </div>
                    <input
                      id="out-quality"
                      type="range"
                      min={0.1}
                      max={1.0}
                      step={0.02}
                      value={settings.output.quality}
                      onChange={(e) =>
                        onUpdateOutputSettings({ quality: Number(e.target.value) })
                      }
                      className="w-full accent-indigo-600 mt-1.5"
                    />
                  </div>
                </div>

                {/* Filename Pattern */}
                <div>
                  <div className="flex justify-between mb-1">
                    <label htmlFor="out-pattern" className="text-slate-500 dark:text-slate-400">
                      Filename Pattern (tokens: &#123;name&#125; &#123;ext&#125; &#123;date&#125; &#123;index&#125;)
                    </label>
                  </div>
                  <input
                    id="out-pattern"
                    type="text"
                    value={settings.output.filenamePattern}
                    onChange={(e) => onUpdateOutputSettings({ filenamePattern: e.target.value })}
                    className="w-full px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono text-slate-900 dark:text-slate-100"
                  />
                  <div className="text-[11px] font-mono text-slate-400 mt-1">
                    Preview: <span className="text-indigo-400">{sampleFilenamePreview}</span>
                  </div>
                </div>

                {/* Proportional Resize */}
                <div className="pt-1 border-t border-slate-100 dark:border-slate-800">
                  <div className="flex items-center justify-between py-1">
                    <span className="font-medium text-slate-700 dark:text-slate-300">
                      Resize Output Proportionally
                    </span>
                    <input
                      type="checkbox"
                      aria-label="Resize Output Proportionally"
                      checked={settings.output.resizeEnabled}
                      onChange={(e) =>
                        onUpdateOutputSettings({ resizeEnabled: e.target.checked })
                      }
                      className="w-4 h-4 accent-indigo-600 cursor-pointer"
                    />
                  </div>

                  {settings.output.resizeEnabled && (
                    <div className="grid grid-cols-2 gap-3 mt-2">
                      <div>
                        <label htmlFor="out-max-w" className="block text-slate-500 mb-1">
                          Max Width (px)
                        </label>
                        <input
                          id="out-max-w"
                          type="number"
                          min={64}
                          max={16384}
                          value={settings.output.maxWidth}
                          onChange={(e) =>
                            onUpdateOutputSettings({ maxWidth: Number(e.target.value) })
                          }
                          className="w-full px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                        />
                      </div>
                      <div>
                        <label htmlFor="out-max-h" className="block text-slate-500 mb-1">
                          Max Height (px)
                        </label>
                        <input
                          id="out-max-h"
                          type="number"
                          min={64}
                          max={16384}
                          value={settings.output.maxHeight}
                          onChange={(e) =>
                            onUpdateOutputSettings({ maxHeight: Number(e.target.value) })
                          }
                          className="w-full px-2.5 py-1 rounded border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Auto-Rotate EXIF & CPU Concurrency */}
                <div className="grid grid-cols-2 gap-3 pt-1 border-t border-slate-100 dark:border-slate-800 items-center">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.output.autoRotateExif}
                      onChange={(e) =>
                        onUpdateOutputSettings({ autoRotateExif: e.target.checked })
                      }
                      className="w-4 h-4 accent-indigo-600"
                    />
                    <span className="text-slate-700 dark:text-slate-300">Auto-Rotate EXIF</span>
                  </label>

                  <div>
                    <div className="flex justify-between mb-1">
                      <label htmlFor="out-workers" className="text-slate-500 dark:text-slate-400">
                        CPU Workers
                      </label>
                      <span className="font-mono tabular-nums text-indigo-500">
                        {settings.output.concurrency} threads
                      </span>
                    </div>
                    <input
                      id="out-workers"
                      type="range"
                      min={1}
                      max={16}
                      value={settings.output.concurrency}
                      onChange={(e) =>
                        onUpdateOutputSettings({ concurrency: Number(e.target.value) })
                      }
                      className="w-full accent-indigo-600"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
