import { describe, expect, it } from 'vitest';
import { planSpectralAutodj, sampleSpectralAutodj } from './spectralAutodj';

const bassHeavy = { low: 0.72, mid: 0.18, high: 0.10 };
const vocalHeavy = { low: 0.12, mid: 0.66, high: 0.22 };

function makePlan(outgoing = bassHeavy, incoming = bassHeavy, overlapSec = 6) {
  const plan = planSpectralAutodj({ outgoing, incoming, overlapSec });
  if (!plan) throw new Error('expected valid plan');
  return plan;
}

describe('Spectral AutoDJ isolated planner (not wired to playback)', () => {
  it('preserves the existing equal-power faders at start, middle and end', () => {
    const plan = makePlan();
    for (const seconds of [0, 1.5, 3, 4.5, 6]) {
      const frame = sampleSpectralAutodj(plan, seconds);
      expect(frame.outgoing.fader ** 2 + frame.incoming.fader ** 2).toBeCloseTo(1, 10);
    }
    expect(sampleSpectralAutodj(plan, 0).incoming.fader).toBe(0);
    expect(sampleSpectralAutodj(plan, 6).outgoing.fader).toBeCloseTo(0, 10);
  });

  it('keeps all EQ bands neutral when either track is not bass-heavy', () => {
    const plan = makePlan(bassHeavy, vocalHeavy);
    expect(plan.style).toBe('neutral');
    const frame = sampleSpectralAutodj(plan, 3);
    expect(frame.outgoing.eqDb).toEqual({ low: 0, mid: 0, high: 0 });
    expect(frame.incoming.eqDb).toEqual({ low: 0, mid: 0, high: 0 });
  });

  it('reduces only the incoming bass early, then restores unity EQ by the end', () => {
    const plan = makePlan();
    expect(plan.style).toBe('bass-handoff');
    const early = sampleSpectralAutodj(plan, 0.6);
    expect(early.incoming.eqDb.low).toBeLessThan(0);
    expect(early.incoming.eqDb.low).toBeGreaterThanOrEqual(-4);
    expect(early.incoming.eqDb.mid).toBe(0);
    expect(early.incoming.eqDb.high).toBe(0);
    expect(early.outgoing.eqDb.low).toBe(0);
    expect(sampleSpectralAutodj(plan, 6).incoming.eqDb.low).toBe(0);
  });

  it('falls back to neutral EQ on missing, negative, silent or non-finite analysis', () => {
    const invalid = [null, { low: -1, mid: 2, high: 3 }, { low: 0, mid: 0, high: 0 },
      { low: NaN, mid: 1, high: 1 }, { low: Infinity, mid: 1, high: 1 }];
    for (const outgoing of invalid) {
      const plan = planSpectralAutodj({ overlapSec: 6, outgoing, incoming: bassHeavy });
      expect(plan?.style).toBe('neutral');
      expect(plan?.incomingLowCutDb).toBe(0);
    }
  });

  it('rejects malformed or out-of-range durations without changing playback', () => {
    for (const overlapSec of [0, -1, NaN, Infinity, 31]) {
      expect(planSpectralAutodj({ overlapSec, outgoing: bassHeavy, incoming: bassHeavy })).toBeNull();
    }
  });

  it('clamps evaluation times and never boosts any EQ band', () => {
    const plan = makePlan();
    expect(sampleSpectralAutodj(plan, -10).progress).toBe(0);
    expect(sampleSpectralAutodj(plan, 50).progress).toBe(1);
    expect(sampleSpectralAutodj(plan, NaN).progress).toBe(0);
    for (let i = 0; i <= 100; i++) {
      const frame = sampleSpectralAutodj(plan, i * 0.06);
      for (const side of [frame.outgoing, frame.incoming]) {
        expect(side.fader).toBeGreaterThanOrEqual(0);
        expect(side.fader).toBeLessThanOrEqual(1);
        for (const db of Object.values(side.eqDb)) {
          expect(Number.isFinite(db)).toBe(true);
          expect(db).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  it('produces smooth incoming-bass automation without abrupt jumps', () => {
    const plan = makePlan();
    let prev = sampleSpectralAutodj(plan, 0).incoming.eqDb.low;
    for (let i = 1; i <= 600; i++) {
      const next = sampleSpectralAutodj(plan, i * 0.01).incoming.eqDb.low;
      expect(next).toBeGreaterThanOrEqual(prev);
      expect(Math.abs(next - prev)).toBeLessThan(0.05);
      prev = next;
    }
  });
});
