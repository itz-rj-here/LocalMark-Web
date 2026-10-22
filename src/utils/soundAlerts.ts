export type SoundThemeId = 'studio_chime' | 'windows_chord' | 'minimal_pulse';

export interface SystemSoundSettings {
  enabled: boolean;
  playOnCompletion: boolean;
  playOnCriticalError: boolean;
  onlyLargeBatches: boolean;
  largeBatchMinItems: number; // e.g., 10 items (configurable down to 1)
  volume: number; // 0 to 100
  theme: SoundThemeId;
}

export const DEFAULT_SOUND_SETTINGS: SystemSoundSettings = {
  enabled: true,
  playOnCompletion: true,
  playOnCriticalError: true,
  onlyLargeBatches: false,
  largeBatchMinItems: 10,
  volume: 75,
  theme: 'studio_chime',
};

export interface SynthNote {
  freqHz: number;
  startSec: number;
  durationSec: number;
  type: OscillatorType;
  gainScalar: number;
}

/**
 * Pure decision function determining which system sound (if any) to trigger after or during a batch.
 */
export function evaluateBatchSoundTrigger(
  soundSettings: SystemSoundSettings,
  event: 'batch_complete' | 'critical_error',
  totalBatchCount: number,
  failedCount: number
): 'completion' | 'error' | null {
  if (!soundSettings.enabled || soundSettings.volume <= 0) {
    return null;
  }

  if (event === 'critical_error') {
    return soundSettings.playOnCriticalError ? 'error' : null;
  }

  // On batch_complete: if there were failures and playOnCriticalError is on, prioritize error alert
  if (failedCount > 0 && soundSettings.playOnCriticalError) {
    return 'error';
  }

  if (!soundSettings.playOnCompletion) {
    return null;
  }

  if (soundSettings.onlyLargeBatches && totalBatchCount < Math.max(1, soundSettings.largeBatchMinItems)) {
    return null;
  }

  return 'completion';
}

/**
 * Returns deterministic acoustic note sequences for Web Audio API synthesis.
 */
export function getSoundSynthesizerNotes(
  kind: 'completion' | 'error',
  theme: SoundThemeId
): SynthNote[] {
  if (kind === 'error') {
    if (theme === 'windows_chord') {
      return [
        { freqHz: 330, startSec: 0, durationSec: 0.16, type: 'sawtooth', gainScalar: 0.7 },
        { freqHz: 220, startSec: 0.14, durationSec: 0.28, type: 'sawtooth', gainScalar: 0.85 },
      ];
    }
    if (theme === 'minimal_pulse') {
      return [
        { freqHz: 260, startSec: 0, durationSec: 0.12, type: 'triangle', gainScalar: 0.8 },
        { freqHz: 195, startSec: 0.15, durationSec: 0.22, type: 'triangle', gainScalar: 0.85 },
      ];
    }
    // studio_chime error: descending minor second/fifth alert
    return [
      { freqHz: 440, startSec: 0, durationSec: 0.14, type: 'triangle', gainScalar: 0.8 },
      { freqHz: 349.23, startSec: 0.12, durationSec: 0.16, type: 'triangle', gainScalar: 0.85 },
      { freqHz: 261.63, startSec: 0.26, durationSec: 0.3, type: 'sine', gainScalar: 0.9 },
    ];
  }

  // Completion chime
  if (theme === 'windows_chord') {
    return [
      { freqHz: 523.25, startSec: 0, durationSec: 0.18, type: 'sine', gainScalar: 0.75 },
      { freqHz: 659.25, startSec: 0.08, durationSec: 0.22, type: 'sine', gainScalar: 0.75 },
      { freqHz: 783.99, startSec: 0.16, durationSec: 0.32, type: 'sine', gainScalar: 0.85 },
      { freqHz: 1046.5, startSec: 0.26, durationSec: 0.45, type: 'triangle', gainScalar: 0.9 },
    ];
  }
  if (theme === 'minimal_pulse') {
    return [
      { freqHz: 587.33, startSec: 0, durationSec: 0.14, type: 'sine', gainScalar: 0.8 },
      { freqHz: 880, startSec: 0.13, durationSec: 0.28, type: 'sine', gainScalar: 0.9 },
    ];
  }
  // studio_chime completion: warm major 9th ascending arpeggio
  return [
    { freqHz: 523.25, startSec: 0, durationSec: 0.2, type: 'sine', gainScalar: 0.8 },
    { freqHz: 659.25, startSec: 0.1, durationSec: 0.22, type: 'sine', gainScalar: 0.8 },
    { freqHz: 783.99, startSec: 0.2, durationSec: 0.25, type: 'sine', gainScalar: 0.85 },
    { freqHz: 1174.66, startSec: 0.3, durationSec: 0.45, type: 'triangle', gainScalar: 0.95 },
  ];
}

let sharedAudioCtx: AudioContext | null = null;

/**
 * Plays the synthesized system sound using the browser's offline Web Audio API.
 */
export function playSystemSoundAlert(
  kind: 'completion' | 'error',
  soundSettings: SystemSoundSettings
): boolean {
  if (typeof window === 'undefined') return false;
  const AudioCtx =
    window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return false;

  try {
    if (!sharedAudioCtx) {
      sharedAudioCtx = new AudioCtx();
    }
    if (sharedAudioCtx.state === 'suspended') {
      sharedAudioCtx.resume().catch(() => {});
    }

    const ctx = sharedAudioCtx;
    const now = ctx.currentTime;
    const masterVolume = Math.max(0, Math.min(1, soundSettings.volume / 100)) * 0.28;
    const notes = getSoundSynthesizerNotes(kind, soundSettings.theme);

    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = note.type;
      osc.frequency.setValueAtTime(note.freqHz, now + note.startSec);

      const peakGain = Math.max(0.001, masterVolume * note.gainScalar);
      gain.gain.setValueAtTime(0.0001, now + note.startSec);
      gain.gain.exponentialRampToValueAtTime(peakGain, now + note.startSec + 0.02);
      gain.gain.exponentialRampToValueAtTime(
        0.0001,
        now + note.startSec + Math.max(0.05, note.durationSec)
      );

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(now + note.startSec);
      osc.stop(now + note.startSec + note.durationSec + 0.02);
    }

    return true;
  } catch {
    return false;
  }
}
