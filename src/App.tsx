/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bell,
  CheckCircle2,
  ExternalLink,
  HelpCircle,
  Keyboard,
  Maximize2,
  Moon,
  Sun,
  X,
} from 'lucide-react';
import {
  ActivityLogEntry,
  MediaItem,
  Preset,
  ResolutionTargetScope,
  WatermarkCoreSettings,
  WatermarkLogo,
  WatermarkSettings,
} from './types/localmark';
import {
  DEFAULT_WATERMARK_SETTINGS,
  createStoreZipArchive,
  formatOutputFilename,
  formatResolutionScopeLabel,
  resolveCollisionFilename,
} from './utils/watermarkEngine';
import {
  DEMO_STUDIO_SCENES,
  createDefaultLogo,
  createMediaItemFromDemoSpec,
  processSingleMediaItemToBlob,
  processUploadedMediaFile,
} from './utils/canvasRenderer';
import { Step1AddMedia } from './components/Step1AddMedia';
import { Step2ConfigureWatermark } from './components/Step2ConfigureWatermark';
import { Step3ProcessExport } from './components/Step3ProcessExport';
import {
  DEFAULT_SOUND_SETTINGS,
  SystemSoundSettings,
  evaluateBatchSoundTrigger,
  playSystemSoundAlert,
} from './utils/soundAlerts';

const MAX_FILES_PER_SESSION = 10_000;
const MAX_HISTORY_STATES = 55;
const STORAGE_KEYS = {
  CUSTOM_PRESETS: 'localmark_custom_presets_v1',
  RECENT_INPUT_FOLDERS: 'localmark_recent_in_folders_v1',
  RECENT_OUTPUT_FOLDERS: 'localmark_recent_out_folders_v1',
  THEME: 'localmark_theme_v1',
  SOUND_SETTINGS: 'localmark_sound_settings_v1',
};

export default function App() {
  // Theme state (Dark mode by default per spec: #090d16)
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem(STORAGE_KEYS.THEME);
    return saved ? saved === 'dark' : true;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem(STORAGE_KEYS.THEME, darkMode ? 'dark' : 'light');
  }, [darkMode]);

  // 3-Step Wizard State
  const [activeStep, setActiveStep] = useState<1 | 2 | 3>(1);

  // Loaded Media Items (initialized with the 10-item Studio Sample Pack so all 10 Resolution Groups are immediately testable)
  const [items, setItems] = useState<MediaItem[]>(() =>
    DEMO_STUDIO_SCENES.map((spec, idx) => createMediaItemFromDemoSpec(spec, idx + 1))
  );
  const [selectedItemId, setSelectedItemId] = useState<string | null>(() => null);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);

  // Watermark Logo State
  const [logo, setLogo] = useState<WatermarkLogo | null>(() => createDefaultLogo('light'));

  // Settings + 50-State Undo/Redo Stack
  const [history, setHistory] = useState<{
    past: WatermarkSettings[];
    present: WatermarkSettings;
    future: WatermarkSettings[];
  }>({
    past: [],
    present: DEFAULT_WATERMARK_SETTINGS,
    future: [],
  });

  const settings = history.present;

  const commitSettings = useCallback((updater: (prev: WatermarkSettings) => WatermarkSettings) => {
    setHistory((h) => {
      const next = updater(h.present);
      const nextPast = [...h.past, h.present].slice(-MAX_HISTORY_STATES);
      return {
        past: nextPast,
        present: next,
        future: [],
      };
    });
  }, []);

  const handleUndo = useCallback(() => {
    setHistory((h) => {
      if (h.past.length === 0) return h;
      const previous = h.past[h.past.length - 1];
      const newPast = h.past.slice(0, -1);
      return {
        past: newPast,
        present: previous,
        future: [h.present, ...h.future].slice(0, MAX_HISTORY_STATES),
      };
    });
  }, []);

  const handleRedo = useCallback(() => {
    setHistory((h) => {
      if (h.future.length === 0) return h;
      const next = h.future[0];
      const newFuture = h.future.slice(1);
      return {
        past: [...h.past, h.present].slice(-MAX_HISTORY_STATES),
        present: next,
        future: newFuture,
      };
    });
  }, []);

  // Custom Presets stored in localStorage
  const [customPresets, setCustomPresets] = useState<Preset[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.CUSTOM_PRESETS);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.CUSTOM_PRESETS, JSON.stringify(customPresets));
    } catch {
      // Ignore storage quota error
    }
  }, [customPresets]);

  // Recent Input & Output Folders (last 5 each)
  const [recentInputFolders, setRecentInputFolders] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.RECENT_INPUT_FOLDERS);
      return raw
        ? JSON.parse(raw)
        : [
            'C:\\Users\\Studio\\Pictures\\Shoot_2026_10',
            'C:\\Users\\Studio\\Videos\\Reels',
            'D:\\RAW_Archives\\Wedding_Client_Batch',
          ];
    } catch {
      return ['C:\\Users\\Studio\\Pictures\\Shoot_2026_10'];
    }
  });

  const [recentOutputFolders, setRecentOutputFolders] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.RECENT_OUTPUT_FOLDERS);
      return raw
        ? JSON.parse(raw)
        : [
            'C:\\Users\\Studio\\Exports\\Watermarked_Proofs',
            'D:\\Client_Deliverables\\2026_10_Watermarked',
            'C:\\Users\\Studio\\Desktop\\Quick_Export',
          ];
    } catch {
      return ['C:\\Users\\Studio\\Exports\\Watermarked_Proofs'];
    }
  });

  const [selectedOutputFolder, setSelectedOutputFolder] = useState<string>(
    () => recentOutputFolders[0] || 'C:\\Users\\Studio\\Exports\\Watermarked_Proofs'
  );

  // Batch Processing State
  const [isProcessing, setIsProcessing] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [itemsPerSec, setItemsPerSec] = useState(0);
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);

  // Desktop Features: System Tray & Notifications & Help Modal & System Sounds
  const [minimizedToTray, setMinimizedToTray] = useState(false);
  const [desktopNotification, setDesktopNotification] = useState<string | null>(null);
  const [showHelpModal, setShowHelpModal] = useState(false);
  const [soundSettings, setSoundSettings] = useState<SystemSoundSettings>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.SOUND_SETTINGS);
      return saved ? { ...DEFAULT_SOUND_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SOUND_SETTINGS;
    } catch {
      return DEFAULT_SOUND_SETTINGS;
    }
  });

  const handleUpdateSoundSettings = useCallback((patch: Partial<SystemSoundSettings>) => {
    setSoundSettings((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(STORAGE_KEYS.SOUND_SETTINGS, JSON.stringify(next));
      } catch {
        // Ignore storage error
      }
      return next;
    });
  }, []);

  // Refs for Batch Processing Worker Loop
  const pauseRef = useRef(false);
  const cancelRef = useRef(false);
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const soundSettingsRef = useRef(soundSettings);
  soundSettingsRef.current = soundSettings;
  const lastErrorSoundTimeRef = useRef(0);

  const appendLog = useCallback(
    (
      level: ActivityLogEntry['level'],
      message: string,
      filename?: string,
      durationMs?: number
    ) => {
      const now = new Date();
      const timestamp = now.toTimeString().slice(0, 8);
      setActivityLog((prev) => {
        const entry: ActivityLogEntry = {
          id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          timestamp,
          level,
          message,
          filename,
          durationMs,
        };
        return [entry, ...prev].slice(0, 500);
      });
    },
    []
  );

  // Step 1 Handlers
  const handleAddFiles = useCallback(
    async (files: File[], folderPathHint?: string) => {
      if (files.length === 0) return;
      setIsLoadingFiles(true);

      if (folderPathHint) {
        setRecentInputFolders((prev) => {
          const next = [folderPathHint, ...prev.filter((f) => f !== folderPathHint)].slice(0, 5);
          localStorage.setItem(STORAGE_KEYS.RECENT_INPUT_FOLDERS, JSON.stringify(next));
          return next;
        });
      }

      const remainingSlots = Math.max(0, MAX_FILES_PER_SESSION - itemsRef.current.length);
      const sliced = files.slice(0, remainingSlots);

      const processed: MediaItem[] = [];
      for (let i = 0; i < sliced.length; i++) {
        const item = await processUploadedMediaFile(sliced[i], itemsRef.current.length + i + 1);
        processed.push(item);
      }

      setItems((prev) => [...prev, ...processed].slice(0, MAX_FILES_PER_SESSION));
      setIsLoadingFiles(false);
      appendLog('info', `Loaded ${processed.length} media file(s) into queue.`);
    },
    [appendLog]
  );

  const handleLoadStudioSamplePack = useCallback(() => {
    const sampleItems = DEMO_STUDIO_SCENES.map((spec, idx) =>
      createMediaItemFromDemoSpec(spec, idx + 1)
    );
    setItems(sampleItems);
    setSelectedItemId(sampleItems[0]?.id || null);
    appendLog('info', 'Loaded 10 Studio Sample media files across all Resolution Groups.');
  }, [appendLog]);

  const handleGenerateHighVolumeBatch = useCallback(
    (count: number) => {
      setItems((prev) => {
        const available = Math.max(0, MAX_FILES_PER_SESSION - prev.length);
        const toCreate = Math.min(count, available);
        if (toCreate <= 0) return prev;

        // Reuse thumbnails from existing scenes so 10,000 items use <50MB RAM
        const baseThumbs = DEMO_STUDIO_SCENES.map((s) => ({
          spec: s,
          thumb:
            prev.find((p) => p.demoSceneId === s.id)?.thumbnailUrl ||
            createMediaItemFromDemoSpec(s, 0).thumbnailUrl,
        }));

        const generated: MediaItem[] = [];
        for (let i = 0; i < toCreate; i++) {
          const entry = baseThumbs[i % baseThumbs.length];
          const num = prev.length + i + 1;
          const baseItem = createMediaItemFromDemoSpec(entry.spec, num);
          baseItem.name = `batch_${String(num).padStart(4, '0')}_${entry.spec.name}`;
          baseItem.thumbnailUrl = entry.thumb;
          generated.push(baseItem);
        }
        return [...prev, ...generated];
      });
      appendLog('info', `Added ${count} synthetic batch items into high-volume queue.`);
    },
    [appendLog]
  );

  const handleAddCorruptedSample = useCallback(() => {
    const corruptSpec = {
      id: 'scene_corrupted',
      name: `corrupted_raw_sensor_${items.length + 1}.jpg`,
      path: 'C:\\Users\\Studio\\Pictures\\Corrupted\\corrupted_raw_sensor.jpg',
      mediaType: 'image' as const,
      mimeType: 'image/jpeg',
      rawWidth: 0,
      rawHeight: 0,
      sizeBytes: 0,
      exif: {},
      isCorrupted: true,
      palette: ['#000000', '#000000', '#000000'] as [string, string, string],
      subjectLabel: 'Corrupted 0-Byte File',
    };
    const item = createMediaItemFromDemoSpec(corruptSpec, items.length + 1);
    item.errorMessage = 'Corrupted header or 0×0 dimensions';
    setItems((prev) => [item, ...prev].slice(0, MAX_FILES_PER_SESSION));
    appendLog('warning', `Added corrupted test file (${item.name}) to verify fault tolerance.`);
  }, [items.length, appendLog]);

  const handleUploadLogo = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result);
        const img = new Image();
        img.onload = () => {
          setLogo({
            name: file.name,
            dataUrl,
            width: img.naturalWidth || 300,
            height: img.naturalHeight || 120,
            sizeBytes: file.size,
            mimeType: file.type || 'image/png',
          });
          appendLog('info', `Uploaded watermark logo: ${file.name}`);
        };
        img.src = dataUrl;
      };
      reader.readAsDataURL(file);
    },
    [appendLog]
  );

  // Step 2 Settings Update Handlers
  const handleUpdateCoreSettings = useCallback(
    (patch: Partial<WatermarkCoreSettings>, targetGroup: ResolutionTargetScope = 'GLOBAL') => {
      commitSettings((prev) => {
        if (targetGroup === 'GLOBAL') {
          return {
            ...prev,
            ...patch,
          };
        }
        return {
          ...prev,
          groupOverrides: {
            ...prev.groupOverrides,
            [targetGroup]: {
              ...(prev.groupOverrides[targetGroup] || {}),
              ...patch,
            },
          },
        };
      });
    },
    [commitSettings]
  );

  const handleUpdateOutputSettings = useCallback(
    (patch: Partial<WatermarkSettings['output']>) => {
      commitSettings((prev) => ({
        ...prev,
        output: {
          ...prev.output,
          ...patch,
        },
      }));
    },
    [commitSettings]
  );

  const handleClearGroupOverride = useCallback(
    (group: ResolutionTargetScope) => {
      commitSettings((prev) => {
        const nextOverrides = { ...prev.groupOverrides };
        delete nextOverrides[group];
        return {
          ...prev,
          groupOverrides: nextOverrides,
        };
      });
    },
    [commitSettings]
  );

  const handleApplyPreset = useCallback(
    (preset: Preset, targetGroup: ResolutionTargetScope = 'GLOBAL') => {
      handleUpdateCoreSettings(preset.settings, targetGroup);
      appendLog('info', `Applied preset "${preset.name}" to ${formatResolutionScopeLabel(targetGroup)}.`);
    },
    [handleUpdateCoreSettings, appendLog]
  );

  const handleSaveCustomPreset = useCallback(
    (name: string, description: string) => {
      const newPreset: Preset = {
        id: `custom_${Date.now()}`,
        name,
        description,
        builtIn: false,
        createdAt: new Date().toISOString(),
        settings: {
          position: settings.position,
          scale: settings.scale,
          opacity: settings.opacity,
          margin: settings.margin,
          offsetX: settings.offsetX,
          offsetY: settings.offsetY,
          fitMode: settings.fitMode,
          referenceSide: settings.referenceSide,
          fixedPixelSize: settings.fixedPixelSize,
          rotation: settings.rotation,
          tiled: settings.tiled,
          tileSpacing: settings.tileSpacing,
          tileAngle: settings.tileAngle,
          customX: settings.customX,
          customY: settings.customY,
          watermarkType: settings.watermarkType,
          text: settings.text,
          fontFamily: settings.fontFamily,
          textColor: settings.textColor,
          outlineColor: settings.outlineColor,
          outlineWidth: settings.outlineWidth,
          shadowBlur: settings.shadowBlur,
          shadowColor: settings.shadowColor,
          shadowOffsetX: settings.shadowOffsetX,
          shadowOffsetY: settings.shadowOffsetY,
        },
      };
      setCustomPresets((prev) => [newPreset, ...prev]);
      setDesktopNotification(`Saved custom preset "${name}"`);
      setTimeout(() => setDesktopNotification(null), 3500);
    },
    [settings]
  );

  // Step 3 Multi-Core Batch Processing Engine
  const runBatchQueue = useCallback(
    async (onlyIds?: Set<string>) => {
      const currentItems = itemsRef.current;
      if (currentItems.length === 0) return;

      cancelRef.current = false;
      pauseRef.current = false;
      setIsPaused(false);
      setIsProcessing(true);

      const usedFilenames = new Set<string>();

      // Prepare queue items to process
      setItems((prev) =>
        prev.map((item) => {
          if (onlyIds && !onlyIds.has(item.id)) {
            if (item.outputFilename) usedFilenames.add(item.outputFilename);
            return item;
          }
          return {
            ...item,
            status: 'waiting',
            progress: 0,
            errorMessage: undefined,
          };
        })
      );

      const indicesToProcess: number[] = [];
      currentItems.forEach((it, idx) => {
        if (!onlyIds || onlyIds.has(it.id)) {
          indicesToProcess.push(idx);
        }
      });

      const totalToRun = indicesToProcess.length;
      if (totalToRun === 0) {
        setIsProcessing(false);
        return;
      }

      const concurrency = Math.max(1, Math.min(16, settings.output.concurrency || 4));
      appendLog(
        'info',
        `Starting batch processing of ${totalToRun} item(s) across ${concurrency} parallel CPU workers.`
      );

      const startTime = performance.now();
      let completedCount = 0;
      let failedCount = 0;
      let cursor = 0;

      const timerInterval = setInterval(() => {
        if (!pauseRef.current) {
          const now = performance.now();
          const elapsed = now - startTime;
          setElapsedMs(elapsed);
          const sec = elapsed / 1000;
          if (sec > 0.05) {
            const speed = (completedCount + failedCount) / sec;
            setItemsPerSec(speed);
            const remaining = Math.max(0, totalToRun - (completedCount + failedCount));
            setEtaSeconds(speed > 0 ? remaining / speed : null);
          }
        }
      }, 100);

      const workerTask = async () => {
        while (cursor < indicesToProcess.length) {
          if (cancelRef.current) break;

          // Wait while paused
          while (pauseRef.current && !cancelRef.current) {
            await new Promise((r) => setTimeout(r, 80));
          }
          if (cancelRef.current) break;

          const queueIdx = cursor++;
          const itemIndex = indicesToProcess[queueIdx];
          const item = itemsRef.current[itemIndex];
          if (!item) continue;

          const itemStart = performance.now();

          // Mark item as processing (45% progress)
          setItems((prev) => {
            const copy = [...prev];
            if (copy[itemIndex]) {
              copy[itemIndex] = { ...copy[itemIndex], status: 'processing', progress: 45 };
            }
            return copy;
          });

          try {
            const { blob } = await processSingleMediaItemToBlob(item, settings, logo);
            if (cancelRef.current) break;

            const desiredName = formatOutputFilename(
              settings.output.filenamePattern,
              item.name,
              settings.output.format,
              itemIndex + 1,
              item.mediaType === 'video'
            );
            const finalName = resolveCollisionFilename(desiredName, usedFilenames);
            const durationMs = Math.max(4, Math.round(performance.now() - itemStart));

            completedCount++;
            setItems((prev) => {
              const copy = [...prev];
              if (copy[itemIndex]) {
                copy[itemIndex] = {
                  ...copy[itemIndex],
                  status: 'done',
                  progress: 100,
                  processingTimeMs: durationMs,
                  outputBlob: blob,
                  outputFilename: finalName,
                };
              }
              return copy;
            });

            appendLog(
              'success',
              item.mediaType === 'video'
                ? `FFmpeg H.264 overlay & audio passthrough complete -> ${finalName}`
                : `Encoded lossless watermark -> ${finalName}`,
              item.name,
              durationMs
            );
          } catch (err) {
            const errMsg = err instanceof Error ? err.message : 'Failed to process media file';
            const durationMs = Math.max(1, Math.round(performance.now() - itemStart));
            failedCount++;

            setItems((prev) => {
              const copy = [...prev];
              if (copy[itemIndex]) {
                copy[itemIndex] = {
                  ...copy[itemIndex],
                  status: 'failed',
                  progress: 100,
                  processingTimeMs: durationMs,
                  errorMessage: errMsg,
                };
              }
              return copy;
            });

            appendLog('error', `Skipped corrupted/unreadable file: ${errMsg}`, item.name, durationMs);

            const errSoundDecision = evaluateBatchSoundTrigger(
              soundSettingsRef.current,
              'critical_error',
              totalToRun,
              failedCount
            );
            const nowMs = performance.now();
            if (errSoundDecision === 'error' && nowMs - lastErrorSoundTimeRef.current > 1200) {
              lastErrorSoundTimeRef.current = nowMs;
              playSystemSoundAlert('error', soundSettingsRef.current);
              appendLog(
                'warning',
                `Played critical error system sound alert (${soundSettingsRef.current.theme}).`,
                item.name
              );
            }
          }
        }
      };

      const workers = Array.from({ length: Math.min(concurrency, totalToRun) }, () => workerTask());
      await Promise.all(workers);

      clearInterval(timerInterval);
      const totalElapsed = performance.now() - startTime;
      setElapsedMs(totalElapsed);
      const finalSec = Math.max(0.05, totalElapsed / 1000);
      setItemsPerSec((completedCount + failedCount) / finalSec);
      setEtaSeconds(0);
      setIsProcessing(false);
      setIsPaused(false);

      if (cancelRef.current) {
        // Reset any mid-flight items back to waiting
        setItems((prev) =>
          prev.map((it) =>
            it.status === 'processing' ? { ...it, status: 'waiting', progress: 0 } : it
          )
        );
        appendLog('warning', 'Batch processing cancelled by user. In-progress items reset to waiting.');
      } else {
        const soundTrigger = evaluateBatchSoundTrigger(
          soundSettingsRef.current,
          'batch_complete',
          totalToRun,
          failedCount
        );
        let soundSuffix = '';
        if (soundTrigger) {
          playSystemSoundAlert(soundTrigger, soundSettingsRef.current);
          soundSuffix =
            soundTrigger === 'error'
              ? ' · Critical error audio alert played'
              : ' · Completion chime played';
          appendLog(
            'info',
            `System sound alert triggered: ${
              soundTrigger === 'error' ? 'Critical Error Alert' : 'Batch Complete Chime'
            } (${soundSettingsRef.current.theme}, ${soundSettingsRef.current.volume}% vol).`
          );
        }

        appendLog(
          'info',
          `Batch finished in ${(totalElapsed / 1000).toFixed(2)}s (${completedCount} succeeded, ${failedCount} failed).`
        );
        setDesktopNotification(
          `Batch Complete: ${completedCount} watermarked, ${failedCount} failed in ${(
            totalElapsed / 1000
          ).toFixed(2)}s${soundSuffix}.`
        );
        setTimeout(() => setDesktopNotification(null), 5000);
      }
    },
    [settings, logo, appendLog]
  );

  const handleTestSoundAlert = useCallback(
    (kind: 'completion' | 'error') => {
      playSystemSoundAlert(kind, soundSettingsRef.current);
      const label = kind === 'completion' ? 'Batch Complete Chime' : 'Critical Error Alert';
      appendLog(
        'info',
        `Tested system sound: ${label} (${soundSettingsRef.current.theme}, ${soundSettingsRef.current.volume}% volume).`
      );
      setDesktopNotification(`Sound Test: Played ${label}`);
      setTimeout(() => setDesktopNotification(null), 3000);
    },
    [appendLog]
  );

  const handleTogglePause = useCallback(() => {
    if (!isProcessing) return;
    pauseRef.current = !pauseRef.current;
    setIsPaused(pauseRef.current);
    appendLog('info', pauseRef.current ? 'Batch processing paused.' : 'Batch processing resumed.');
  }, [isProcessing, appendLog]);

  const handleCancelProcessing = useCallback(() => {
    if (!isProcessing) return;
    cancelRef.current = true;
    pauseRef.current = false;
  }, [isProcessing]);

  const handleRetryFailed = useCallback(() => {
    const failedIds = new Set(
      itemsRef.current.filter((it) => it.status === 'failed').map((it) => it.id)
    );
    if (failedIds.size === 0) return;
    runBatchQueue(failedIds);
  }, [runBatchQueue]);

  const handleRetrySingleItem = useCallback(
    (id: string) => {
      runBatchQueue(new Set([id]));
    },
    [runBatchQueue]
  );

  const handleDownloadSingleItem = useCallback((item: MediaItem) => {
    if (!item.outputBlob) return;
    const url = URL.createObjectURL(item.outputBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = item.outputFilename || `${item.name}_watermarked.jpg`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleDownloadZip = useCallback(async () => {
    const doneItems = itemsRef.current.filter((it) => it.status === 'done' && it.outputBlob);
    if (doneItems.length === 0) return;

    appendLog('info', `Packing ${doneItems.length} watermarked files into Level-0 STORE ZIP archive...`);
    const entries: { name: string; data: Uint8Array }[] = [];
    const usedNames = new Set<string>();

    for (let i = 0; i < doneItems.length; i++) {
      const it = doneItems[i];
      const buf = await it.outputBlob!.arrayBuffer();
      const desired = it.outputFilename || `watermarked_${i + 1}.jpg`;
      const safeName = resolveCollisionFilename(desired, usedNames);
      entries.push({
        name: safeName,
        data: new Uint8Array(buf),
      });
    }

    const zipBytes = createStoreZipArchive(entries);
    const zipBlob = new Blob([zipBytes.buffer as ArrayBuffer], { type: 'application/zip' });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `LocalMark_Batch_${new Date().toISOString().slice(0, 10)}.zip`;
    a.click();
    URL.revokeObjectURL(url);

    appendLog('success', `Exported ${entries.length} files to ZIP archive (${(zipBytes.byteLength / 1024).toFixed(1)} KB).`);
    setDesktopNotification(`Exported ${entries.length} watermarked files to ZIP archive.`);
    setTimeout(() => setDesktopNotification(null), 4000);
  }, [appendLog]);

  const handleSaveToFolder = useCallback(async () => {
    const doneItems = itemsRef.current.filter((it) => it.status === 'done' && it.outputBlob);
    if (doneItems.length === 0) return;

    // Check if the native File System Access API is available
    if (typeof window !== 'undefined' && 'showDirectoryPicker' in window) {
      try {
        const dirHandle = await (window as any).showDirectoryPicker({
          id: 'localmark_save_output_folder',
          mode: 'readwrite',
        });

        const targetFolder = dirHandle.name || selectedOutputFolder;
        setRecentOutputFolders((prev) => {
          const next = [
            targetFolder,
            ...prev.filter((f) => f !== targetFolder),
          ].slice(0, 5);
          localStorage.setItem(STORAGE_KEYS.RECENT_OUTPUT_FOLDERS, JSON.stringify(next));
          return next;
        });
        setSelectedOutputFolder(targetFolder);

        appendLog('info', `Saving ${doneItems.length} watermarked file(s) to folder "${targetFolder}"...`);

        const usedNames = new Set<string>();
        let savedCount = 0;

        for (let i = 0; i < doneItems.length; i++) {
          const item = doneItems[i];
          if (!item.outputBlob) continue;
          const desired = item.outputFilename || `${item.name}_watermarked.jpg`;
          const safeName = resolveCollisionFilename(desired, usedNames);

          const fileHandle = await dirHandle.getFileHandle(safeName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(item.outputBlob);
          await writable.close();
          savedCount++;
        }

        appendLog(
          'success',
          `Saved all ${savedCount} watermarked file(s) directly to local folder "${targetFolder}" with collision protection.`
        );
        setDesktopNotification(`Saved all ${savedCount} file(s) to folder "${targetFolder}"`);
        setTimeout(() => setDesktopNotification(null), 4000);
        return;
      } catch (err: any) {
        if (err?.name === 'AbortError') {
          // User deliberately cancelled the folder dialog
          appendLog('info', 'Folder selection cancelled by user.');
          return;
        }
        console.warn('showDirectoryPicker failed or was blocked, falling back to batch download:', err);
      }
    }

    // Fallback: If showDirectoryPicker is not supported or was blocked by sandbox,
    // save/download ALL completed files sequentially with collision resolution
    appendLog(
      'info',
      `Saving all ${doneItems.length} watermarked file(s) to ${selectedOutputFolder}...`
    );

    setRecentOutputFolders((prev) => {
      const next = [
        selectedOutputFolder,
        ...prev.filter((f) => f !== selectedOutputFolder),
      ].slice(0, 5);
      localStorage.setItem(STORAGE_KEYS.RECENT_OUTPUT_FOLDERS, JSON.stringify(next));
      return next;
    });

    const usedNames = new Set<string>();
    for (let i = 0; i < doneItems.length; i++) {
      const item = doneItems[i];
      if (!item.outputBlob) continue;
      const desired = item.outputFilename || `${item.name}_watermarked.jpg`;
      const safeName = resolveCollisionFilename(desired, usedNames);

      const url = URL.createObjectURL(item.outputBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = safeName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 20000);

      // Stagger slightly between files so browser queue handles all downloads cleanly
      if (i < doneItems.length - 1 && doneItems.length > 1) {
        await new Promise((r) => setTimeout(r, 120));
      }
    }

    appendLog(
      'success',
      `Saved all ${doneItems.length} watermarked file(s) to ${selectedOutputFolder} with collision protection.`
    );
    setDesktopNotification(
      `Saved all ${doneItems.length} file(s) to ${selectedOutputFolder}`
    );
    setTimeout(() => setDesktopNotification(null), 4000);
  }, [selectedOutputFolder, appendLog]);

  const handleResetAll = useCallback(() => {
    cancelRef.current = true;
    setIsProcessing(false);
    setIsPaused(false);
    setItems([]);
    setSelectedItemId(null);
    setElapsedMs(0);
    setItemsPerSec(0);
    setEtaSeconds(null);
    setActivityLog([]);
    setActiveStep(1);
  }, []);

  // Global Keyboard Shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT';

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (!isInput) {
          e.preventDefault();
          handleUndo();
        }
      } else if (
        (e.ctrlKey || e.metaKey) &&
        (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))
      ) {
        if (!isInput) {
          e.preventDefault();
          handleRedo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSaveCustomPreset(
          `Studio Preset ${customPresets.length + 1}`,
          'Saved via Ctrl+S shortcut'
        );
      } else if (e.code === 'Space' && activeStep === 3 && isProcessing && !isInput) {
        e.preventDefault();
        handleTogglePause();
      } else if (e.key === 'Escape') {
        if (showHelpModal) {
          setShowHelpModal(false);
        } else if (isProcessing) {
          handleCancelProcessing();
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    activeStep,
    isProcessing,
    showHelpModal,
    customPresets.length,
    handleUndo,
    handleRedo,
    handleSaveCustomPreset,
    handleTogglePause,
    handleCancelProcessing,
  ]);

  const overallBatchPercent = React.useMemo(() => {
    if (items.length === 0) return 0;
    return Math.round(items.reduce((acc, it) => acc + it.progress, 0) / items.length);
  }, [items]);

  return (
    <div className="min-h-screen bg-[#f8fafc] dark:bg-[#090d16] text-slate-900 dark:text-slate-100 flex flex-col transition-colors duration-200">
      {/* Top Bar Contract: Zone 1 (Single Wordmark) — Zone 2 (Clean Nav Links) — Zone 3 (1 Primary Action) */}
      <header className="flex items-center justify-between gap-8 px-6 py-3.5 border-b border-slate-200 dark:border-slate-800/90 bg-white/90 dark:bg-[#090d16]/90 backdrop-blur sticky top-0 z-30">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveStep(1);
          }}
          className="text-lg font-bold tracking-tight text-slate-900 dark:text-white whitespace-nowrap shrink-0"
        >
          LocalMark
        </a>

        <nav
          aria-label="Wizard navigation"
          className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600 dark:text-slate-400"
        >
          <button
            type="button"
            onClick={() => setActiveStep(1)}
            className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeStep === 1
                ? 'text-indigo-600 dark:text-indigo-400 underline underline-offset-8 decoration-2'
                : ''
            }`}
          >
            1. Add Media
          </button>
          <button
            type="button"
            onClick={() => items.length > 0 && setActiveStep(2)}
            disabled={items.length === 0}
            className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 ${
              activeStep === 2
                ? 'text-indigo-600 dark:text-indigo-400 underline underline-offset-8 decoration-2'
                : ''
            }`}
          >
            2. Configure Watermark
          </button>
          <button
            type="button"
            onClick={() => items.length > 0 && setActiveStep(3)}
            disabled={items.length === 0}
            className={`hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-40 ${
              activeStep === 3
                ? 'text-indigo-600 dark:text-indigo-400 underline underline-offset-8 decoration-2'
                : ''
            }`}
          >
            3. Process & Export
          </button>
          <button
            type="button"
            onClick={() => setShowHelpModal(true)}
            className="hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Shortcuts
          </button>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => setDarkMode((d) => !d)}
            aria-label={darkMode ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
            className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:border-indigo-500 transition-colors whitespace-nowrap shrink-0 cursor-pointer flex items-center gap-1.5"
          >
            {darkMode ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5" />}
            <span>{darkMode ? 'Light Theme' : 'Dark Theme'}</span>
          </button>
        </div>
      </header>

      {/* Step Indicator Bar (3 clickable numbered steps, current highlighted in indigo) */}
      <div className="border-b border-slate-200 dark:border-slate-800/80 bg-slate-50/70 dark:bg-[#0d1320]">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div className="grid grid-cols-3 sm:flex items-center gap-2 sm:gap-4 w-full sm:w-auto">
            {(
              [
                { step: 1, title: 'Add Photos & Videos', shortTitle: 'Add Media', sub: 'Import files, folders & logo' },
                { step: 2, title: 'Place & Configure Watermark', shortTitle: 'Configure', sub: 'Live split preview & overrides' },
                { step: 3, title: 'Process & Export', shortTitle: 'Export', sub: 'Multi-core batch & ZIP archive' },
              ] as const
            ).map((s, idx) => {
              const isCurrent = activeStep === s.step;
              const isCompleted = activeStep > s.step;
              return (
                <React.Fragment key={s.step}>
                  <button
                    type="button"
                    disabled={s.step > 1 && items.length === 0}
                    onClick={() => setActiveStep(s.step)}
                    className={`flex items-center justify-center sm:justify-start gap-2 px-2.5 sm:px-3.5 py-2 rounded-lg text-left transition-all cursor-pointer disabled:opacity-40 whitespace-nowrap shrink-0 ${
                      isCurrent
                        ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow-sm'
                        : isCompleted
                          ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-300 border border-indigo-500/20'
                          : 'bg-white dark:bg-slate-900/80 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
                    }`}
                  >
                    <span
                      className={`w-5 h-5 rounded-full text-xs font-mono font-bold flex items-center justify-center shrink-0 ${
                        isCurrent
                          ? 'bg-white text-indigo-600'
                          : isCompleted
                            ? 'bg-indigo-600 text-white'
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      {s.step}
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold leading-tight hidden sm:block">{s.title}</div>
                      <div className="text-[11px] font-semibold leading-tight sm:hidden truncate">{s.shortTitle}</div>
                      <div
                        className={`text-[10px] leading-tight hidden sm:block ${
                          isCurrent ? 'text-indigo-100' : 'text-slate-400 dark:text-slate-500'
                        }`}
                      >
                        {s.sub}
                      </div>
                    </div>
                  </button>
                  {idx < 2 && (
                    <span aria-hidden="true" className="text-slate-300 dark:text-slate-700 hidden sm:inline">
                      →
                    </span>
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* Unboxed Studio Status Metadata */}
          <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400 flex items-center gap-2">
            <span>100% Offline Studio</span>
            <span aria-hidden="true">·</span>
            <span>{items.length.toLocaleString()} queued</span>
            <span aria-hidden="true">·</span>
            <span>{settings.output.concurrency} CPU workers</span>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-6">
        {activeStep === 1 && (
          <Step1AddMedia
            items={items}
            logo={logo}
            recentInputFolders={recentInputFolders}
            isLoadingFiles={isLoadingFiles}
            onAddFiles={handleAddFiles}
            onLoadStudioSamplePack={handleLoadStudioSamplePack}
            onGenerateHighVolumeBatch={handleGenerateHighVolumeBatch}
            onAddCorruptedSample={handleAddCorruptedSample}
            onUploadLogo={handleUploadLogo}
            onSelectDefaultLogo={(variant) => setLogo(createDefaultLogo(variant))}
            onRemoveLogo={() => setLogo(null)}
            onRemoveItem={(id) => setItems((prev) => prev.filter((i) => i.id !== id))}
            onClearAll={() => {
              setItems([]);
              setSelectedItemId(null);
            }}
            onNextStep={() => setActiveStep(2)}
          />
        )}

        {activeStep === 2 && (
          <Step2ConfigureWatermark
            items={items}
            selectedItemId={selectedItemId}
            onSelectItem={setSelectedItemId}
            settings={settings}
            logo={logo}
            customPresets={customPresets}
            canUndo={history.past.length > 0}
            canRedo={history.future.length > 0}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onUpdateCoreSettings={handleUpdateCoreSettings}
            onUpdateOutputSettings={handleUpdateOutputSettings}
            onClearGroupOverride={handleClearGroupOverride}
            onApplyPreset={handleApplyPreset}
            onSaveCustomPreset={handleSaveCustomPreset}
            onDeleteCustomPreset={(id) =>
              setCustomPresets((prev) => prev.filter((p) => p.id !== id))
            }
            onImportPresetsJson={(imported) =>
              setCustomPresets((prev) => [...imported, ...prev])
            }
            onPrevStep={() => setActiveStep(1)}
            onNextStep={() => setActiveStep(3)}
          />
        )}

        {activeStep === 3 && (
          <Step3ProcessExport
            items={items}
            settings={settings}
            isProcessing={isProcessing}
            isPaused={isPaused}
            elapsedMs={elapsedMs}
            itemsPerSec={itemsPerSec}
            etaSeconds={etaSeconds}
            activityLog={activityLog}
            recentOutputFolders={recentOutputFolders}
            selectedOutputFolder={selectedOutputFolder}
            onSelectOutputFolder={setSelectedOutputFolder}
            onStartProcessing={() => runBatchQueue()}
            onTogglePause={handleTogglePause}
            onCancelProcessing={handleCancelProcessing}
            onRetryFailed={handleRetryFailed}
            onRetrySingleItem={handleRetrySingleItem}
            onDownloadSingleItem={handleDownloadSingleItem}
            onRemoveItem={(id) => setItems((prev) => prev.filter((i) => i.id !== id))}
            onSaveToFolder={handleSaveToFolder}
            onDownloadZip={handleDownloadZip}
            onClearActivityLog={() => setActivityLog([])}
            onMinimizeToTray={() => setMinimizedToTray(true)}
            onPrevStep={() => setActiveStep(2)}
            onResetAll={handleResetAll}
            soundSettings={soundSettings}
            onUpdateSoundSettings={handleUpdateSoundSettings}
            onTestSoundAlert={handleTestSoundAlert}
          />
        )}
      </main>

      {/* Bottom Creator Credit & Recognition Footer */}
      <footer
        className={`mt-auto border-t border-slate-200/80 dark:border-slate-800/80 bg-white/70 dark:bg-[#0c121e]/80 backdrop-blur-sm ${
          activeStep === 3 ? 'pb-20' : ''
        }`}
      >
        <div className="max-w-[1400px] w-full mx-auto px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex items-center gap-2 font-mono">
            <span className="font-semibold text-slate-700 dark:text-slate-300">LocalMark Desktop</span>
            <span aria-hidden="true">·</span>
            <span>100% Offline Bulk Watermarking Studio</span>
          </div>

          <div className="flex items-center gap-2">
            <span>Created by</span>
            <a
              href="https://github.com/itz-rj-here"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-slate-200 dark:border-slate-700/80 bg-slate-100/80 dark:bg-slate-800/70 text-slate-900 dark:text-slate-100 hover:border-indigo-500/60 hover:text-indigo-600 dark:hover:text-indigo-400 font-medium transition-colors"
              aria-label="Created by Itz RJ on GitHub"
            >
              <svg
                viewBox="0 0 24 24"
                aria-hidden="true"
                className="w-3.5 h-3.5 fill-current shrink-0"
              >
                <path
                  fillRule="evenodd"
                  clipRule="evenodd"
                  d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                />
              </svg>
              <span className="font-semibold">Itz RJ</span>
              <span className="text-slate-400 dark:text-slate-500 font-mono text-[11px] hidden md:inline">
                (github.com/itz-rj-here)
              </span>
              <ExternalLink className="w-3 h-3 opacity-70 shrink-0" />
            </a>
          </div>
        </div>
      </footer>

      {/* Desktop Notification Toast */}
      {desktopNotification && (
        <div
          role="status"
          className={`fixed ${activeStep === 3 ? 'bottom-16' : 'bottom-5'} right-5 z-50 rounded-xl border border-indigo-500/40 bg-slate-900/95 text-white px-4 py-3 shadow-2xl flex items-center gap-3 max-w-md`}
        >
          <Bell className="w-4 h-4 text-indigo-400 shrink-0" />
          <div className="text-xs">
            <div className="font-semibold">LocalMark Desktop Notification</div>
            <div className="text-slate-300 mt-0.5">{desktopNotification}</div>
          </div>
          <button
            type="button"
            onClick={() => setDesktopNotification(null)}
            aria-label="Dismiss notification"
            className="text-slate-400 hover:text-white ml-2 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Minimized Windows System Tray Floating Indicator */}
      {minimizedToTray && (
        <div className={`fixed ${activeStep === 3 ? 'bottom-16' : 'bottom-5'} left-5 z-50 rounded-xl border border-indigo-500/50 bg-[#0f1624] text-white p-4 shadow-2xl flex items-center gap-4`}>
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-600 to-violet-600 flex items-center justify-center font-mono text-xs font-bold">
            {overallBatchPercent}%
          </div>
          <div className="text-xs">
            <div className="font-semibold">LocalMark System Tray</div>
            <div className="text-slate-400 font-mono">
              {isProcessing ? `Processing batch (${overallBatchPercent}%)` : 'Idle · Ready'}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMinimizedToTray(false)}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-xs font-medium cursor-pointer"
          >
            <Maximize2 className="w-3.5 h-3.5" />
            <span>Restore</span>
          </button>
        </div>
      )}

      {/* Keyboard Shortcuts & Desktop Info Modal */}
      {showHelpModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="shortcuts-modal-title"
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-[#0f1624] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <Keyboard className="w-4 h-4 text-indigo-500" />
                <h2 id="shortcuts-modal-title" className="text-sm font-semibold">
                  LocalMark v1.0.0 — Keyboard Shortcuts & Offline Engine
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setShowHelpModal(false)}
                aria-label="Close shortcuts dialog"
                className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 text-xs">
              {[
                { key: 'Ctrl + O', desc: 'Add media files' },
                { key: 'Ctrl + Shift + O', desc: 'Add folder recursively' },
                { key: 'Ctrl + Z', desc: 'Undo watermark setting' },
                { key: 'Ctrl + Y', desc: 'Redo watermark setting' },
                { key: 'Ctrl + S', desc: 'Save current preset' },
                { key: 'Space', desc: 'Pause / Resume batch' },
                { key: 'Escape', desc: 'Cancel batch / Close modal' },
                { key: '+ / -', desc: 'Zoom live preview in/out' },
              ].map((sc) => (
                <div
                  key={sc.key}
                  className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-900 flex items-center justify-between border border-slate-200/60 dark:border-slate-800"
                >
                  <span className="text-slate-600 dark:text-slate-300">{sc.desc}</span>
                  <kbd className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-800 font-mono text-[11px] font-semibold">
                    {sc.key}
                  </kbd>
                </div>
              ))}
            </div>

            <div className="text-xs text-slate-500 dark:text-slate-400 pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <span>Platform: Windows 10+ (Build 1903+) · 100% Offline</span>
              <button
                type="button"
                onClick={() => setShowHelpModal(false)}
                className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white font-medium cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
