import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  Cpu,
  Download,
  FileArchive,
  FolderOutput,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  Trash2,
  Volume2,
  VolumeX,
} from 'lucide-react';
import {
  ActivityLogEntry,
  MediaItem,
  QueueItemStatus,
  WatermarkSettings,
} from '../types/localmark';
import { formatBytes, formatDurationMmSs } from '../utils/watermarkEngine';
import { SoundThemeId, SystemSoundSettings } from '../utils/soundAlerts';

interface Step3ProcessExportProps {
  items: MediaItem[];
  settings: WatermarkSettings;
  isProcessing: boolean;
  isPaused: boolean;
  elapsedMs: number;
  itemsPerSec: number;
  etaSeconds: number | null;
  activityLog: ActivityLogEntry[];
  recentOutputFolders: string[];
  selectedOutputFolder: string;
  onSelectOutputFolder: (folderPath: string) => void;
  onStartProcessing: () => void;
  onTogglePause: () => void;
  onCancelProcessing: () => void;
  onRetryFailed: () => void;
  onRetrySingleItem: (id: string) => void;
  onDownloadSingleItem: (item: MediaItem) => void;
  onRemoveItem: (id: string) => void;
  onSaveToFolder: () => void;
  onDownloadZip: () => void;
  onClearActivityLog: () => void;
  onMinimizeToTray: () => void;
  onPrevStep: () => void;
  onResetAll: () => void;
  soundSettings: SystemSoundSettings;
  onUpdateSoundSettings: (patch: Partial<SystemSoundSettings>) => void;
  onTestSoundAlert: (kind: 'completion' | 'error') => void;
}

export const Step3ProcessExport: React.FC<Step3ProcessExportProps> = ({
  items,
  settings,
  isProcessing,
  isPaused,
  elapsedMs,
  itemsPerSec,
  etaSeconds,
  activityLog,
  recentOutputFolders,
  selectedOutputFolder,
  onSelectOutputFolder,
  onStartProcessing,
  onTogglePause,
  onCancelProcessing,
  onRetryFailed,
  onRetrySingleItem,
  onDownloadSingleItem,
  onRemoveItem,
  onSaveToFolder,
  onDownloadZip,
  onClearActivityLog,
  onMinimizeToTray,
  onPrevStep,
  onResetAll,
  soundSettings,
  onUpdateSoundSettings,
  onTestSoundAlert,
}) => {
  const [statusFilter, setStatusFilter] = useState<QueueItemStatus | 'ALL'>('ALL');
  const [visibleLimit, setVisibleLimit] = useState(80);

  const counts = React.useMemo(() => {
    let waiting = 0;
    let processing = 0;
    let done = 0;
    let failed = 0;
    for (const item of items) {
      if (item.status === 'waiting') waiting++;
      else if (item.status === 'processing') processing++;
      else if (item.status === 'done') done++;
      else if (item.status === 'failed') failed++;
    }
    return { waiting, processing, done, failed, total: items.length };
  }, [items]);

  const overallPercent = React.useMemo(() => {
    if (items.length === 0) return 0;
    const sumProgress = items.reduce((acc, it) => acc + it.progress, 0);
    return Math.round(sumProgress / items.length);
  }, [items]);

  const filteredQueue = React.useMemo(() => {
    if (statusFilter === 'ALL') return items;
    return items.filter((it) => it.status === statusFilter);
  }, [items, statusFilter]);

  return (
    <div className="space-y-6 pb-4">
      {/* Top Batch Progress & Controls Panel */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1624] p-6 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center items-start gap-3">
            <button
              type="button"
              onClick={onPrevStep}
              disabled={isProcessing && !isPaused}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Configure Watermark</span>
            </button>
            <div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">
                3. Multi-Core Batch Process & Export
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Streaming I/O pipeline with {settings.output.concurrency} parallel workers · FFmpeg H.264 video overlay & audio passthrough
              </p>
            </div>
          </div>

          {/* Primary Batch Execution Controls */}
          <div className="flex flex-wrap items-center gap-2.5">
            {!isProcessing ? (
              <button
                type="button"
                onClick={onStartProcessing}
                disabled={items.length === 0}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 text-white text-xs font-semibold shadow-sm disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>
                  {counts.done > 0 && counts.waiting === 0
                    ? 'Re-Process Entire Batch'
                    : 'Start Processing'}
                </span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onTogglePause}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
                >
                  {isPaused ? (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>Resume (Space)</span>
                    </>
                  ) : (
                    <>
                      <Pause className="w-3.5 h-3.5 fill-current" />
                      <span>Pause (Space)</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={onCancelProcessing}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>Cancel (Esc)</span>
                </button>
              </>
            )}

            {counts.failed > 0 && !isProcessing && (
              <button
                type="button"
                onClick={onRetryFailed}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 text-xs font-medium cursor-pointer whitespace-nowrap shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Failed ({counts.failed})</span>
              </button>
            )}

            <button
              type="button"
              onClick={onMinimizeToTray}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer whitespace-nowrap shrink-0"
              title="Minimize LocalMark to Windows System Tray"
            >
              <Minimize2 className="w-3.5 h-3.5" />
              <span>Minimize to Tray</span>
            </button>

            <button
              type="button"
              onClick={onResetAll}
              disabled={isProcessing}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-500/30 hover:bg-rose-500/10 text-xs font-medium text-rose-600 dark:text-rose-400 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset All</span>
            </button>
          </div>
        </div>

        {/* Overall Batch Progress Bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-mono tabular-nums">
            <span className="text-slate-700 dark:text-slate-200 font-semibold">
              Overall Batch Progress: {overallPercent}%
            </span>
            <span className="text-slate-500 dark:text-slate-400">
              {counts.done.toLocaleString()} / {counts.total.toLocaleString()} done ·{' '}
              <span className={counts.failed > 0 ? 'text-rose-500 font-semibold' : ''}>
                {counts.failed} failed
              </span>
            </span>
          </div>

          <div className="w-full h-3 rounded-full bg-slate-100 dark:bg-slate-900 overflow-hidden border border-slate-200 dark:border-slate-800">
            <div
              style={{ width: `${overallPercent}%` }}
              className="h-full bg-gradient-to-r from-indigo-600 to-violet-500 transition-all duration-150"
            />
          </div>
        </div>

        {/* 4-Column Telemetry Strip (Tabular Numerals) */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
          <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800">
            <div className="text-xs text-slate-500 dark:text-slate-400">Processing Throughput</div>
            <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
              {itemsPerSec.toFixed(1)} <span className="text-xs font-normal text-slate-500">items/sec</span>
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800">
            <div className="text-xs text-slate-500 dark:text-slate-400">Estimated Time Remaining</div>
            <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
              {etaSeconds !== null ? formatDurationMmSs(etaSeconds) : '00:00'}
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800">
            <div className="text-xs text-slate-500 dark:text-slate-400">Elapsed Time</div>
            <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
              {(elapsedMs / 1000).toFixed(2)}s
            </div>
          </div>

          <div className="p-3.5 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800">
            <div className="text-xs text-slate-500 dark:text-slate-400">Completed / Failed</div>
            <div className="text-lg font-semibold font-mono tabular-nums text-slate-900 dark:text-white mt-0.5">
              <span className="text-emerald-500">{counts.done}</span> /{' '}
              <span className={counts.failed > 0 ? 'text-rose-500' : 'text-slate-400'}>
                {counts.failed}
              </span>
            </div>
          </div>
        </div>

        {/* Export Destination & Archive Bar */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2 flex-1 min-w-[260px]">
            <span className="text-xs font-medium text-slate-600 dark:text-slate-300 shrink-0">
              Output Directory:
            </span>
            <select
              aria-label="Select recent output folder"
              value={selectedOutputFolder}
              onChange={(e) => onSelectOutputFolder(e.target.value)}
              className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 font-mono text-xs text-slate-800 dark:text-slate-200 flex-1 max-w-md"
            >
              {recentOutputFolders.map((folder) => (
                <option key={folder} value={folder}>
                  {folder}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={onSaveToFolder}
              disabled={counts.done === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 text-xs font-semibold disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
            >
              <FolderOutput className="w-4 h-4" />
              <span>Save to Folder ({counts.done})</span>
            </button>

            <button
              type="button"
              onClick={onDownloadZip}
              disabled={counts.done === 0}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 text-xs font-semibold disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
            >
              <FileArchive className="w-4 h-4" />
              <span>Download as ZIP (Level 0 Fast Store)</span>
            </button>
          </div>
        </div>

        {/* Optional System Sound Alerts Bar */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              {soundSettings.enabled ? (
                <Volume2 className="w-4 h-4 text-indigo-500 shrink-0" />
              ) : (
                <VolumeX className="w-4 h-4 text-slate-400 shrink-0" />
              )}
              <div>
                <h3 className="text-xs font-semibold text-slate-900 dark:text-slate-100">
                  Optional System Sound Alerts
                </h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Offline Web Audio synthesizer chimes when a batch completes or if a critical error occurs during processing.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <label className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 cursor-pointer mr-2">
                <input
                  type="checkbox"
                  aria-label="Enable System Sound Alerts"
                  checked={soundSettings.enabled}
                  onChange={(e) => onUpdateSoundSettings({ enabled: e.target.checked })}
                  className="w-4 h-4 accent-indigo-600 cursor-pointer"
                />
                <span>Enable System Sounds</span>
              </label>

              <button
                type="button"
                onClick={() => onTestSoundAlert('completion')}
                disabled={!soundSettings.enabled}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Volume2 className="w-3.5 h-3.5 text-emerald-500" />
                <span>Test Complete Chime</span>
              </button>

              <button
                type="button"
                onClick={() => onTestSoundAlert('error')}
                disabled={!soundSettings.enabled}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-rose-500/30 hover:bg-rose-500/10 text-xs font-medium text-rose-600 dark:text-rose-400 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
              >
                <AlertCircle className="w-3.5 h-3.5 text-rose-500" />
                <span>Test Error Alert</span>
              </button>
            </div>
          </div>

          {soundSettings.enabled && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-900/60 border border-slate-200/70 dark:border-slate-800 text-xs items-center">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={soundSettings.playOnCompletion}
                  onChange={(e) =>
                    onUpdateSoundSettings({ playOnCompletion: e.target.checked })
                  }
                  className="w-3.5 h-3.5 accent-indigo-600"
                />
                <span className="text-slate-700 dark:text-slate-300">
                  Alert on Batch Complete
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={soundSettings.playOnCriticalError}
                  onChange={(e) =>
                    onUpdateSoundSettings({ playOnCriticalError: e.target.checked })
                  }
                  className="w-3.5 h-3.5 accent-indigo-600"
                />
                <span className="text-slate-700 dark:text-slate-300">
                  Alert on Critical Error
                </span>
              </label>

              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={soundSettings.onlyLargeBatches}
                    onChange={(e) =>
                      onUpdateSoundSettings({ onlyLargeBatches: e.target.checked })
                    }
                    className="w-3.5 h-3.5 accent-indigo-600"
                  />
                  <span className="text-slate-700 dark:text-slate-300">Large Batch ≥</span>
                </label>
                <input
                  type="number"
                  min={1}
                  max={10000}
                  aria-label="Minimum items for large batch sound alert"
                  value={soundSettings.largeBatchMinItems}
                  onChange={(e) =>
                    onUpdateSoundSettings({
                      largeBatchMinItems: Math.max(1, Number(e.target.value) || 10),
                    })
                  }
                  className="w-16 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 font-mono text-xs text-slate-900 dark:text-slate-100"
                />
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="sound-theme-select" className="text-slate-500 shrink-0">
                  Tone:
                </label>
                <select
                  id="sound-theme-select"
                  value={soundSettings.theme}
                  onChange={(e) =>
                    onUpdateSoundSettings({ theme: e.target.value as SoundThemeId })
                  }
                  className="w-full px-2 py-1 rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 text-xs"
                >
                  <option value="studio_chime">Studio Warm Chime</option>
                  <option value="windows_chord">Windows Workstation Chord</option>
                  <option value="minimal_pulse">Minimal Acoustic Pulse</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <label htmlFor="sound-volume-slider" className="text-slate-500 shrink-0">
                  Vol:
                </label>
                <input
                  id="sound-volume-slider"
                  type="range"
                  min={0}
                  max={100}
                  value={soundSettings.volume}
                  onChange={(e) =>
                    onUpdateSoundSettings({ volume: Number(e.target.value) })
                  }
                  className="w-full accent-indigo-600 cursor-pointer"
                />
                <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300 w-9 text-right">
                  {soundSettings.volume}%
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom 2-Column Split: Queue List (8 cols) + Activity Log (4 cols) */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Queue List */}
        <div className="lg:col-span-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1624] overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Batch Processing Queue ({filteredQueue.length.toLocaleString()})
            </h3>

            <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-900 text-xs">
              {(
                [
                  { id: 'ALL', label: `All (${counts.total})` },
                  { id: 'waiting', label: `Waiting (${counts.waiting})` },
                  { id: 'processing', label: `Active (${counts.processing})` },
                  { id: 'done', label: `Done (${counts.done})` },
                  { id: 'failed', label: `Failed (${counts.failed})` },
                ] as { id: QueueItemStatus | 'ALL'; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-2.5 py-1 rounded font-medium transition-colors cursor-pointer whitespace-nowrap ${
                    statusFilter === tab.id
                      ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto max-h-[440px] overflow-y-auto custom-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-900/80 sticky top-0 z-10 text-xs font-medium text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-4">Item</th>
                  <th className="py-2.5 px-4">Status & Progress</th>
                  <th className="py-2.5 px-4 text-right">Dimensions</th>
                  <th className="py-2.5 px-4 text-right">Duration</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-xs">
                {filteredQueue.slice(0, visibleLimit).map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-2.5 px-4">
                      <div className="flex items-center gap-3">
                        {item.thumbnailUrl ? (
                          <img
                            src={item.thumbnailUrl}
                            alt={item.name}
                            referrerPolicy="no-referrer"
                            className="w-10 h-8 rounded object-cover border border-slate-200 dark:border-slate-700 shrink-0"
                          />
                        ) : (
                          <div className="w-10 h-8 rounded bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-500 font-mono text-[10px] shrink-0">
                            ERR
                          </div>
                        )}
                        <div className="min-w-0">
                          <div className="font-medium text-slate-900 dark:text-slate-100 break-all leading-snug">
                            {item.outputFilename || item.name}
                          </div>
                          <div className="text-[11px] font-mono text-slate-400">
                            {item.group} · {formatBytes(item.sizeBytes)}
                          </div>
                        </div>
                      </div>
                    </td>

                    <td className="py-2.5 px-4 w-56">
                      <div className="flex items-center justify-between mb-1 font-mono tabular-nums text-[11px]">
                        <span
                          className={
                            item.status === 'done'
                              ? 'text-emerald-600 dark:text-emerald-400 font-medium'
                              : item.status === 'failed'
                                ? 'text-rose-600 dark:text-rose-400 font-medium'
                                : item.status === 'processing'
                                  ? 'text-indigo-500 font-medium'
                                  : 'text-slate-500'
                          }
                        >
                          {item.status.toUpperCase()}
                        </span>
                        <span className="text-slate-500">{item.progress}%</span>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-900 overflow-hidden">
                        <div
                          style={{ width: `${item.progress}%` }}
                          className={`h-full transition-all duration-150 ${
                            item.status === 'done'
                              ? 'bg-emerald-500'
                              : item.status === 'failed'
                                ? 'bg-rose-500'
                                : 'bg-indigo-500'
                          }`}
                        />
                      </div>
                      {item.errorMessage && item.status === 'failed' && (
                        <div className="text-[10px] text-rose-500 mt-0.5 break-words leading-snug">
                          {item.errorMessage}
                        </div>
                      )}
                    </td>

                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                      {item.width}×{item.height}
                    </td>

                    <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-500">
                      {item.processingTimeMs !== undefined ? `${item.processingTimeMs}ms` : '—'}
                    </td>

                    <td className="py-2.5 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        {item.status === 'done' && (
                          <button
                            type="button"
                            onClick={() => onDownloadSingleItem(item)}
                            aria-label={`Save ${item.name}`}
                            title="Save watermarked file"
                            className="p-1.5 rounded hover:bg-indigo-500/10 text-indigo-500 cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {(item.status === 'failed' || item.status === 'done') && (
                          <button
                            type="button"
                            onClick={() => onRetrySingleItem(item.id)}
                            aria-label={`Retry ${item.name}`}
                            title="Re-process this file"
                            className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-indigo-500 cursor-pointer"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => onRemoveItem(item.id)}
                          aria-label={`Delete ${item.name} from queue`}
                          title="Remove from queue"
                          className="p-1.5 rounded hover:bg-rose-500/10 text-slate-400 hover:text-rose-500 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {filteredQueue.length > visibleLimit && (
              <div className="p-3 text-center border-t border-slate-200 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setVisibleLimit((v) => v + 100)}
                  className="px-4 py-1.5 rounded-md text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  Show More ({filteredQueue.length - visibleLimit} remaining)
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Activity Log (Capped at 500 entries) */}
        <div className="lg:col-span-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1624] overflow-hidden flex flex-col h-[500px]">
          <div className="px-4 py-3.5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Activity Log ({activityLog.length} / 500)
              </h3>
            </div>
            <button
              type="button"
              onClick={onClearActivityLog}
              disabled={activityLog.length === 0}
              className="text-xs font-medium text-slate-500 hover:text-rose-500 disabled:opacity-40 cursor-pointer"
            >
              Clear Log
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-3 space-y-2 font-mono text-[11px] custom-scrollbar">
            {activityLog.length === 0 ? (
              <div className="h-full flex items-center justify-center text-slate-400 text-xs font-sans">
                No batch events recorded yet. Click "Start Processing" to begin.
              </div>
            ) : (
              activityLog.map((entry) => (
                <div
                  key={entry.id}
                  className="p-2 rounded bg-slate-50 dark:bg-slate-900/70 border border-slate-100 dark:border-slate-800/80 space-y-0.5"
                >
                  <div className="flex items-center justify-between text-[10px]">
                    <span
                      className={
                        entry.level === 'error'
                          ? 'text-rose-500 font-semibold'
                          : entry.level === 'warning'
                            ? 'text-amber-500 font-semibold'
                            : entry.level === 'success'
                              ? 'text-emerald-500 font-semibold'
                              : 'text-indigo-400 font-semibold'
                      }
                    >
                      [{entry.level.toUpperCase()}] {entry.timestamp}
                    </span>
                    {entry.durationMs !== undefined && (
                      <span className="text-slate-400 tabular-nums">{entry.durationMs}ms</span>
                    )}
                  </div>
                  <div className="text-slate-700 dark:text-slate-300 break-words">
                    {entry.filename && (
                      <span className="font-semibold text-slate-900 dark:text-white mr-1">
                        {entry.filename}:
                      </span>
                    )}
                    {entry.message}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Global Fixed Progress Bar at Bottom of Screen (Step 3) */}
      <div
        role="region"
        aria-label="Global Batch Progress"
        className="fixed bottom-0 inset-x-0 z-40 bg-white/95 dark:bg-[#0c121e]/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 shadow-[0_-4px_24px_rgba(0,0,0,0.12)] dark:shadow-[0_-4px_24px_rgba(0,0,0,0.4)]"
      >
        {/* Full-width continuous progress track */}
        <div className="w-full h-1.5 bg-slate-200/80 dark:bg-slate-800 overflow-hidden">
          <div
            style={{ width: `${overallPercent}%` }}
            className={`h-full transition-all duration-200 ease-out ${
              overallPercent === 100 && counts.failed === 0
                ? 'bg-emerald-500'
                : counts.failed > 0 && counts.processing === 0 && counts.waiting === 0
                  ? 'bg-rose-500'
                  : isPaused
                    ? 'bg-amber-500'
                    : 'bg-gradient-to-r from-indigo-600 via-indigo-500 to-violet-500'
            }`}
          />
        </div>

        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
          {/* Left: Overall Completion Percentage & Counts */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="font-mono text-sm sm:text-base font-bold tabular-nums text-slate-900 dark:text-white">
                {overallPercent}%
              </span>
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                {isProcessing
                  ? isPaused
                    ? 'Batch Paused'
                    : 'Processing Queue…'
                  : overallPercent === 100
                    ? 'Batch Complete'
                    : 'Queue Ready'}
              </span>
            </div>

            <div className="hidden sm:flex items-center gap-2 text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              <span aria-hidden="true">·</span>
              <span>
                {counts.done.toLocaleString()} / {counts.total.toLocaleString()} completed
              </span>
              {counts.processing > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-indigo-600 dark:text-indigo-400">
                    {counts.processing} active
                  </span>
                </>
              )}
              {counts.failed > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="text-rose-500 font-medium">
                    {counts.failed} failed
                  </span>
                </>
              )}
            </div>
          </div>

          {/* Center: In-bar visual progress bar */}
          <div className="hidden md:flex items-center gap-3 flex-1 max-w-xs lg:max-w-md mx-4">
            <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden border border-slate-300/40 dark:border-slate-700/50">
              <div
                style={{ width: `${overallPercent}%` }}
                className={`h-full transition-all duration-200 ${
                  overallPercent === 100 && counts.failed === 0
                    ? 'bg-emerald-500'
                    : isPaused
                      ? 'bg-amber-500'
                      : 'bg-gradient-to-r from-indigo-600 to-violet-500'
                }`}
              />
            </div>
            {isProcessing && itemsPerSec > 0 && (
              <span className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap shrink-0">
                {itemsPerSec.toFixed(1)}/s
              </span>
            )}
          </div>

          {/* Right: Quick Action Controls */}
          <div className="flex items-center gap-2">
            {!isProcessing ? (
              <button
                type="button"
                onClick={onStartProcessing}
                disabled={items.length === 0}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium shadow-sm disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>
                  {counts.done > 0 && counts.waiting === 0
                    ? 'Re-Process Batch'
                    : 'Start Batch'}
                </span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={onTogglePause}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
                >
                  {isPaused ? (
                    <>
                      <Play className="w-3 h-3 fill-current" />
                      <span>Resume</span>
                    </>
                  ) : (
                    <>
                      <Pause className="w-3 h-3 fill-current" />
                      <span>Pause</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={onCancelProcessing}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0"
                >
                  <Square className="w-3 h-3 fill-current" />
                  <span>Cancel</span>
                </button>
              </>
            )}

            {counts.done > 0 && (
              <button
                type="button"
                onClick={onDownloadZip}
                disabled={isProcessing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300 disabled:opacity-40 cursor-pointer whitespace-nowrap shrink-0"
                title="Download all processed files as ZIP"
              >
                <Download className="w-3.5 h-3.5 text-indigo-500" />
                <span>Download ZIP ({counts.done})</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
