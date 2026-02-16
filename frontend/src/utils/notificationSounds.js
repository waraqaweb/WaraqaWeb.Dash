let audioCtx = null;
let unlockBound = false;

const getAudioContext = () => {
  if (typeof window === 'undefined') return null;

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return null;

  if (!audioCtx) {
    audioCtx = new AudioContextClass();
  }

  return audioCtx;
};

const resumeAudioContext = async () => {
  const ctx = getAudioContext();
  if (!ctx) return false;

  if (ctx.state === 'running') return true;

  try {
    await ctx.resume();
    return ctx.state === 'running';
  } catch (e) {
    return false;
  }
};

export const bindAudioUnlockOnUserGesture = () => {
  if (typeof window === 'undefined' || unlockBound) return;
  unlockBound = true;

  const unlock = async () => {
    const ok = await resumeAudioContext();
    if (ok) {
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      window.removeEventListener('touchstart', unlock, true);
    }
  };

  window.addEventListener('pointerdown', unlock, true);
  window.addEventListener('keydown', unlock, true);
  window.addEventListener('touchstart', unlock, true);
};

const playTone = (ctx, {
  frequency,
  durationMs,
  type = 'sine',
  startAt,
  gain = 0.08,
}) => {
  const oscillator = ctx.createOscillator();
  const gainNode = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startAt);

  gainNode.gain.setValueAtTime(0.0001, startAt);
  gainNode.gain.exponentialRampToValueAtTime(gain, startAt + 0.015);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startAt + durationMs / 1000);

  oscillator.connect(gainNode);
  gainNode.connect(ctx.destination);

  oscillator.start(startAt);
  oscillator.stop(startAt + durationMs / 1000);
};

const playPattern = async (steps = []) => {
  const ready = await resumeAudioContext();
  if (!ready) return false;

  const ctx = getAudioContext();
  if (!ctx) return false;

  const base = ctx.currentTime + 0.01;
  for (const step of steps) {
    playTone(ctx, {
      frequency: step.frequency,
      durationMs: step.durationMs,
      type: step.type || 'sine',
      gain: step.gain || 0.08,
      startAt: base + (step.delayMs || 0) / 1000,
    });
  }

  return true;
};

export const playGeneralNotificationSound = async () => {
  try {
    await playPattern([
      { frequency: 880, durationMs: 90, delayMs: 0, type: 'triangle', gain: 0.07 },
      { frequency: 1175, durationMs: 130, delayMs: 110, type: 'triangle', gain: 0.07 },
    ]);
  } catch (e) {
    // ignore audio failures
  }
};

export const playClassStartSound = async () => {
  try {
    await playPattern([
      { frequency: 523.25, durationMs: 140, delayMs: 0, type: 'sine', gain: 0.085 },
      { frequency: 659.25, durationMs: 140, delayMs: 170, type: 'sine', gain: 0.085 },
      { frequency: 783.99, durationMs: 220, delayMs: 340, type: 'sine', gain: 0.085 },
    ]);
  } catch (e) {
    // ignore audio failures
  }
};
