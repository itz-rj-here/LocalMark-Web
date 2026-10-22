import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILT_IN_PRESETS,
  DEFAULT_WATERMARK_SETTINGS,
  calculateLogoPlacement,
  calculateTargetDimensions,
  classifyResolutionGroup,
  createStoreZipArchive,
  evaluateSmartWarnings,
  formatOutputFilename,
  getEffectiveDimensions,
  getMergedSettingsForGroup,
  resolveCollisionFilename,
} from './watermarkEngine';

test('getEffectiveDimensions swaps width and height for EXIF orientation 5, 6, 7, 8 when rawWidth >= rawHeight', () => {
  assert.deepEqual(getEffectiveDimensions(6000, 4000, 6), { width: 4000, height: 6000 });
  assert.deepEqual(getEffectiveDimensions(6000, 4000, 8), { width: 4000, height: 6000 });
  assert.deepEqual(getEffectiveDimensions(6000, 4000, 1), { width: 6000, height: 4000 });
  assert.deepEqual(getEffectiveDimensions(4000, 6000, 6), { width: 4000, height: 6000 });
});

test('classifyResolutionGroup categorizes all 10 resolution groups in exact priority order', () => {
  // 1. Panoramic >= 2.05
  assert.equal(classifyResolutionGroup(5000, 2000), 'Panoramic');
  // 2. Square 1:1 (0.93 to 1.07)
  assert.equal(classifyResolutionGroup(1080, 1080), 'Square 1:1');
  assert.equal(classifyResolutionGroup(1000, 1050), 'Square 1:1');
  // 3. Portrait 9:16 (0.50 to 0.60)
  assert.equal(classifyResolutionGroup(1080, 1920), 'Portrait 9:16');
  // 4. Portrait 3:4 / 2:3 (0.60 to 0.92) — including 4000x6000 phone portrait before 4K check!
  assert.equal(classifyResolutionGroup(4000, 6000), 'Portrait 3:4 / 2:3');
  // Also raw 6000x4000 with EXIF orientation 6 must become 4000x6000 Portrait 3:4 / 2:3
  assert.equal(classifyResolutionGroup(6000, 4000, 6), 'Portrait 3:4 / 2:3');
  // 5. Portrait Ultra-Tall (< 0.50)
  assert.equal(classifyResolutionGroup(800, 2200), 'Portrait Ultra-Tall');
  // 6. Very Small (both < 800px)
  assert.equal(classifyResolutionGroup(640, 480), 'Very Small');
  // 7. Very Large (4K+) (landscape with dimension >= 4000px)
  assert.equal(classifyResolutionGroup(4096, 2304), 'Very Large (4K+)');
  assert.equal(classifyResolutionGroup(6000, 4000, 1), 'Very Large (4K+)');
  // 8. Landscape 16:9 (1.68 to 1.86)
  assert.equal(classifyResolutionGroup(1920, 1080), 'Landscape 16:9');
  assert.equal(classifyResolutionGroup(2560, 1440), 'Landscape 16:9');
  // 9. Landscape Standard (4:3, 3:2, etc.)
  assert.equal(classifyResolutionGroup(2400, 1600), 'Landscape Standard');
  // 10. Corrupted
  assert.equal(classifyResolutionGroup(0, 0), 'Corrupted');
  assert.equal(classifyResolutionGroup(1920, 1080, 1, true), 'Corrupted');
});

test('BUILT_IN_PRESETS contains all 5 required presets', () => {
  assert.equal(BUILT_IN_PRESETS.length, 5);
  const names = BUILT_IN_PRESETS.map((p) => p.name);
  assert.deepEqual(names, [
    'Photographer Signature',
    'Anti-Theft Diagonal Grid',
    'Confidential Center Stamp',
    'Discreet Footer Copyright',
    'Social Media Proof',
  ]);
});

test('getMergedSettingsForGroup applies per-group overrides accurately', () => {
  const settings = {
    ...DEFAULT_WATERMARK_SETTINGS,
    groupOverrides: {
      'Portrait 3:4 / 2:3': {
        position: 'bottom-center' as const,
        scale: 14,
      },
    },
  };
  const portraitMerged = getMergedSettingsForGroup(settings, 'Portrait 3:4 / 2:3');
  assert.equal(portraitMerged.position, 'bottom-center');
  assert.equal(portraitMerged.scale, 14);
  assert.equal(portraitMerged.opacity, 80);

  const landscapeMerged = getMergedSettingsForGroup(settings, 'Landscape 16:9');
  assert.equal(landscapeMerged.position, 'bottom-right');
  assert.equal(landscapeMerged.scale, 18);
});

test('calculateLogoPlacement computes relative and fixed pixel watermark dimensions and margins', () => {
  const placement = calculateLogoPlacement(2000, 1000, DEFAULT_WATERMARK_SETTINGS, 2.0);
  // Shorter side = 1000, scale = 18% -> width = 180, height = 90
  assert.equal(placement.width, 180);
  assert.equal(placement.height, 90);
  // Margin = 3% of shorter side (1000) = 30px
  assert.equal(placement.marginPx, 30);
  // Bottom-right: x = 2000 - 180 - 30 = 1790, y = 1000 - 90 - 30 = 880
  assert.equal(placement.x, 1790);
  assert.equal(placement.y, 880);
});

test('evaluateSmartWarnings flags tiny watermark, >20% coverage, clipped boundary, and corrupted files', () => {
  const logo = {
    name: 'logo.png',
    dataUrl: 'data:image/png;base64,',
    width: 400,
    height: 200,
    sizeBytes: 1200,
    mimeType: 'image/png',
  };

  // Corrupted file
  const corruptedWarnings = evaluateSmartWarnings(
    { width: 0, height: 0, group: 'Corrupted', isCorrupted: true },
    DEFAULT_WATERMARK_SETTINGS,
    logo
  );
  assert.equal(corruptedWarnings.some((w) => w.id === 'corrupted_file'), true);

  // Tiny watermark
  const tinySettings = { ...DEFAULT_WATERMARK_SETTINGS, scale: 1 };
  const tinyWarnings = evaluateSmartWarnings(
    { width: 1000, height: 1000, group: 'Square 1:1' },
    tinySettings,
    logo
  );
  assert.equal(tinyWarnings.some((w) => w.id === 'tiny_watermark'), true);

  // Over 20% coverage
  const hugeSettings = { ...DEFAULT_WATERMARK_SETTINGS, scale: 75 };
  const hugeWarnings = evaluateSmartWarnings(
    { width: 1000, height: 1000, group: 'Square 1:1' },
    hugeSettings,
    logo
  );
  assert.equal(hugeWarnings.some((w) => w.id === 'large_coverage'), true);

  // Clipped boundary
  const clippedSettings = { ...DEFAULT_WATERMARK_SETTINGS, offsetX: 40 };
  const clippedWarnings = evaluateSmartWarnings(
    { width: 1000, height: 1000, group: 'Square 1:1' },
    clippedSettings,
    logo
  );
  assert.equal(clippedWarnings.some((w) => w.id === 'clipped_boundary'), true);
});

test('formatOutputFilename and resolveCollisionFilename handle tokens and duplicate collisions', () => {
  const formatted = formatOutputFilename(
    '{name}_watermarked_{date}_{index}.{ext}',
    'wedding_shoot.JPG',
    'webp',
    7,
    false,
    '2026-10-22'
  );
  assert.equal(formatted, 'wedding_shoot_watermarked_2026-10-22_007.webp');

  const used = new Set<string>();
  assert.equal(resolveCollisionFilename('photo_watermarked.jpg', used), 'photo_watermarked.jpg');
  assert.equal(resolveCollisionFilename('photo_watermarked.jpg', used), 'photo_watermarked_2.jpg');
  assert.equal(resolveCollisionFilename('photo_watermarked.jpg', used), 'photo_watermarked_3.jpg');
});

test('calculateTargetDimensions scales down proportionally when resizeEnabled is true', () => {
  assert.deepEqual(calculateTargetDimensions(4000, 2000, true, 2000, 1440), {
    width: 2000,
    height: 1000,
  });
  assert.deepEqual(calculateTargetDimensions(1920, 1080, false, 1280, 720), {
    width: 1920,
    height: 1080,
  });
});

test('createStoreZipArchive produces a valid PKZIP buffer with EOCD signature', () => {
  const zipBytes = createStoreZipArchive([
    { name: 'test_001.txt', data: new TextEncoder().encode('LocalMark Offline ZIP Test') },
  ]);
  // Check local header signature PK\x03\x04
  assert.equal(zipBytes[0], 0x50);
  assert.equal(zipBytes[1], 0x4b);
  assert.equal(zipBytes[2], 0x03);
  assert.equal(zipBytes[3], 0x04);
  // Check EOCD signature PK\x05\x06 at end - 22
  const eocdOffset = zipBytes.length - 22;
  assert.equal(zipBytes[eocdOffset], 0x50);
  assert.equal(zipBytes[eocdOffset + 1], 0x4b);
  assert.equal(zipBytes[eocdOffset + 2], 0x05);
  assert.equal(zipBytes[eocdOffset + 3], 0x06);
});

import {
  DEFAULT_SOUND_SETTINGS,
  evaluateBatchSoundTrigger,
  getSoundSynthesizerNotes,
} from './soundAlerts';

test('evaluateBatchSoundTrigger respects enabled state, large-batch threshold, and critical error priority', () => {
  // Default enabled: plays completion sound on clean batch
  assert.equal(
    evaluateBatchSoundTrigger(DEFAULT_SOUND_SETTINGS, 'batch_complete', 10, 0),
    'completion'
  );

  // Critical error during batch triggers error sound
  assert.equal(
    evaluateBatchSoundTrigger(DEFAULT_SOUND_SETTINGS, 'critical_error', 10, 1),
    'error'
  );

  // Batch finishing with failed items triggers error sound when playOnCriticalError is true
  assert.equal(
    evaluateBatchSoundTrigger(DEFAULT_SOUND_SETTINGS, 'batch_complete', 10, 2),
    'error'
  );

  // Large batch threshold filter suppresses completion sound for small batches when onlyLargeBatches is true
  const largeOnlySettings = {
    ...DEFAULT_SOUND_SETTINGS,
    onlyLargeBatches: true,
    largeBatchMinItems: 50,
  };
  assert.equal(
    evaluateBatchSoundTrigger(largeOnlySettings, 'batch_complete', 10, 0),
    null
  );
  assert.equal(
    evaluateBatchSoundTrigger(largeOnlySettings, 'batch_complete', 50, 0),
    'completion'
  );

  // Disabled master toggle returns null
  assert.equal(
    evaluateBatchSoundTrigger({ ...DEFAULT_SOUND_SETTINGS, enabled: false }, 'batch_complete', 100, 0),
    null
  );
});

import {
  getExactResolutionKey,
  getMergedSettingsForItem,
  groupItemsByExactResolution,
} from './watermarkEngine';

test('getSoundSynthesizerNotes returns valid acoustic envelopes for all themes', () => {
  for (const theme of ['studio_chime', 'windows_chord', 'minimal_pulse'] as const) {
    const compNotes = getSoundSynthesizerNotes('completion', theme);
    const errNotes = getSoundSynthesizerNotes('error', theme);
    assert.equal(compNotes.length >= 2, true);
    assert.equal(errNotes.length >= 2, true);
    assert.equal(compNotes[0].freqHz > 0, true);
    assert.equal(errNotes[0].freqHz > 0, true);
  }
});

test('groupItemsByExactResolution and getMergedSettingsForItem support exact WxH resolution groups and 100% quality defaults', () => {
  assert.equal(DEFAULT_WATERMARK_SETTINGS.output.quality, 1.0);
  assert.equal(DEFAULT_WATERMARK_SETTINGS.output.preserveOriginalQuality, true);

  const key2560 = getExactResolutionKey(2560, 1440);
  assert.equal(key2560, 'RES:2560x1440');

  const mockItems = [
    {
      id: 'img_1',
      name: 'a.jpg',
      path: 'a.jpg',
      mediaType: 'image' as const,
      mimeType: 'image/jpeg',
      sizeBytes: 1000,
      rawWidth: 2560,
      rawHeight: 1440,
      width: 2560,
      height: 1440,
      exif: {},
      group: 'Landscape 16:9' as const,
      thumbnailUrl: '',
      status: 'waiting' as const,
      progress: 0,
    },
    {
      id: 'img_2',
      name: 'b.jpg',
      path: 'b.jpg',
      mediaType: 'image' as const,
      mimeType: 'image/jpeg',
      sizeBytes: 1000,
      rawWidth: 2560,
      rawHeight: 1440,
      width: 2560,
      height: 1440,
      exif: {},
      group: 'Landscape 16:9' as const,
      thumbnailUrl: '',
      status: 'waiting' as const,
      progress: 0,
    },
  ];

  const buckets = groupItemsByExactResolution(mockItems);
  assert.equal(buckets.length, 1);
  assert.equal(buckets[0].key, 'RES:2560x1440');
  assert.equal(buckets[0].count, 2);

  const settingsWithBothOverrides = {
    ...DEFAULT_WATERMARK_SETTINGS,
    groupOverrides: {
      'Landscape 16:9': { scale: 24, position: 'top-left' as const },
      'RES:2560x1440': { scale: 32 },
    },
  };

  // Exact resolution override (scale 32) takes precedence over category override (scale 24) while inheriting position 'top-left'
  const merged = getMergedSettingsForItem(settingsWithBothOverrides, mockItems[0]);
  assert.equal(merged.scale, 32);
  assert.equal(merged.position, 'top-left');
});


