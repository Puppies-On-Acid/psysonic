/**
 * Spectral AutoDJ experiment - pure, offline transition-control planner.
 *
 * A plan holds the overall volume faders separately from the per-track EQ
 * controls, as in the 2022 joint fader/EQ estimation research. It does not
 * process PCM, alter the playback clock, or enable itself in AutoDJ.
 *
 * The bass-conflict heuristic below is an experimental Psysonic proposal,
 * NOT an algorithm validated by the cited research.
 */

/** Relative, nonnegative linear RMS for three consistent analysis bands. */
export interface SpectralBandRms {
  readonly low: number;
  readonly mid: number;
  readonly high: number;
}

export interface SpectralAutodjInput {
  readonly overlapSec: number;
  readonly outgoing: SpectralBandRms | null;
  readonly incoming: SpectralBandRms | null;
}

export type SpectralTransitionStyle = 'neutral' | 'bass-handoff';

/** One immutable, versioned control plan; not a persisted setting or DSP state. */
export interface SpectralAutodjPlan {
  readonly version: 1;
  readonly overlapSec: number;
  readonly style: SpectralTransitionStyle;
  /** Attenuation only (-4..0 dB), applied to incoming LOW band independently. */
  readonly incomingLowCutDb: number;
}

export interface SpectralGainFrame {
  readonly fader: number;
  readonly eqDb: SpectralBandRms;
}

export interface SpectralTransitionFrame {
  readonly progress: number;
  readonly outgoing: SpectralGainFrame;
  readonly incoming: SpectralGainFrame;
}

const MAX_OVERLAP_SEC = 30;
const MAX_BASS_CUT_DB = 4;
// Deliberately conservative until calibrated against a listening corpus.
const BASS_FRACTION_START = 0.42;
const BASS_FRACTION_FULL = 0.64;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lowFraction(energy: SpectralBandRms | null): number | null {
  if (!energy) return null;
  const { low, mid, high } = energy;
  if (![low, mid, high].every(value => Number.isFinite(value) && value >= 0)) return null;
  const total = low + mid + high;
  if (!Number.isFinite(total) || total <= 0) return null;
  return low / total;
}

/**
 * Build a control plan using only available, comparable boundary analyses.
 * Invalid/missing analyses fail to neutral EQ rather than guessing audio content.
 * Invalid overlap durations fail closed (null), never invent a transition.
 *
 * No audio is altered by this function. Integration and a live experiment
 * switch are deliberately deferred to later, separately verifiable stages.
 */
export function planSpectralAutodj(input: SpectralAutodjInput): SpectralAutodjPlan | null {
  const { overlapSec, outgoing, incoming } = input;
  if (!Number.isFinite(overlapSec) || overlapSec <= 0 || overlapSec > MAX_OVERLAP_SEC) {
    return null;
  }

  const aLow = lowFraction(outgoing);
  const bLow = lowFraction(incoming);
  const minLow = aLow !== null && bLow !== null ? Math.min(aLow, bLow) : 0;
  const strength = clamp01((minLow - BASS_FRACTION_START) / (BASS_FRACTION_FULL - BASS_FRACTION_START));
  const cutDb = strength > 0 ? -MAX_BASS_CUT_DB * strength : 0;

  return {
    version: 1,
    overlapSec,
    style: strength > 0 ? 'bass-handoff' : 'neutral',
    incomingLowCutDb: cutDb,
  };
}

function smoothstep(start: number, end: number, progress: number): number {
  const t = clamp01((progress - start) / (end - start));
  return t * t * (3 - 2 * t);
}

/**
 * Evaluate independent fader and EQ controls at a local transition time.
 * The original equal-power fader curves are preserved in both styles.
 * EQ returns decibels rather than a misleading shared gain scalar.
 */
export function sampleSpectralAutodj(
  plan: SpectralAutodjPlan,
  elapsedSec: number,
): SpectralTransitionFrame {
  const progress = Number.isFinite(elapsedSec)
    ? clamp01(elapsedSec / plan.overlapSec)
    : 0;
  const angle = progress * Math.PI / 2;
  const neutral = { low: 0, mid: 0, high: 0 };
  const bassRestore = smoothstep(0.1, 0.8, progress);
  return {
    progress,
    outgoing: { fader: Math.cos(angle), eqDb: { ...neutral } },
    incoming: {
      fader: Math.sin(angle),
      eqDb: { low: progress >= 0.8 ? 0 : plan.incomingLowCutDb * (1 - bassRestore), mid: 0, high: 0 },
    },
  };
}
