import { describe, expect, it } from 'vitest';
import { BEST_SCORE_KEY, BULLSEYE_METERS, ROUNDS_PER_GAME, scoreForDistance } from '../src/config';
import { __resetDataCaches, pickTargetStreets, polylinesOfFeature, type StreetFeature } from '../src/data';
import { Game } from '../src/game';
import { pointToPolylineMeters } from '../src/geo';
import { MOCK_CITY, MOCK_STREET_FEATURES } from '../src/mock-data';

/** Deterministic PRNG for tests. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

class FakeStorage implements Pick<Storage, 'getItem' | 'setItem'> {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? (this.m.get(k) as string) : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
}

function makeFeatures(n: number): StreetFeature[] {
  return Array.from({ length: n }, (_, i) => ({
    type: 'Feature',
    properties: { name: `Street ${i}` },
    geometry: {
      type: 'LineString',
      coordinates: [
        [19 + i * 0.001, 50],
        [19 + i * 0.001, 50.01],
      ],
    },
  }));
}

describe('scoreForDistance', () => {
  const D = 5000;

  it('gives 1000 for a bullseye (0 m and at the bullseye radius)', () => {
    expect(scoreForDistance(0, D)).toBe(1000);
    expect(scoreForDistance(BULLSEYE_METERS, D)).toBe(1000);
  });

  it('follows round(1000 * max(0, 1 - d/D)) just outside the bullseye', () => {
    const d = BULLSEYE_METERS + 1;
    expect(scoreForDistance(d, D)).toBe(Math.round(1000 * (1 - d / D)));
  });

  it('scores ~500 halfway across the city', () => {
    expect(scoreForDistance(D / 2, D)).toBe(500);
  });

  it('is zero at d = D and beyond (clamped at 0)', () => {
    expect(scoreForDistance(D, D)).toBe(0);
    expect(scoreForDistance(2 * D, D)).toBe(0);
  });
});

describe('pickTargetStreets', () => {
  it('returns n distinct streets', () => {
    const picked = pickTargetStreets(makeFeatures(50), 5, mulberry32(1234));
    expect(picked).toHaveLength(5);
    expect(new Set(picked.map((f) => f.properties.name)).size).toBe(5);
  });

  it('never repeats a street within a game, across many seeds', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const picked = pickTargetStreets(makeFeatures(20), ROUNDS_PER_GAME, mulberry32(seed));
      expect(picked).toHaveLength(ROUNDS_PER_GAME);
      expect(new Set(picked.map((f) => f.properties.name)).size).toBe(ROUNDS_PER_GAME);
    }
  });

  it('caps at the number of available features', () => {
    expect(pickTargetStreets(makeFeatures(3), 5, mulberry32(1))).toHaveLength(3);
  });
});

describe('Game state machine (mock-data fallback)', () => {
  it('runs cityselect → loading → 5 rounds → gameover and persists the best score', async () => {
    __resetDataCaches();
    const storage = new FakeStorage();
    const game = new Game({ rng: mulberry32(42), storage });
    await game.init();
    let s = game.getState();
    expect(s.screen).toBe('cityselect');
    // No generated data files in this worktree → embedded demo city.
    expect(s.usingMock).toBe(true);
    expect(s.cities.map((c) => c.slug)).toContain(MOCK_CITY.slug);

    await game.selectCity(MOCK_CITY.slug, false);
    s = game.getState();
    expect(s.screen).toBe('round');
    expect(s.targetName).toBeTruthy();
    expect(s.scaleM).toBeGreaterThan(0);

    let expectedTotal = 0;
    for (let i = 0; i < ROUNDS_PER_GAME; i++) {
      expect(s.screen).toBe('round');
      game.submitGuess({ lat: 50.0605, lon: 19.9425 });
      s = game.getState();
      expect(s.screen).toBe('result');
      const rec = s.rounds[s.rounds.length - 1];
      expect(rec.round).toBe(i + 1);
      expect(rec.distanceM).toBeGreaterThanOrEqual(0);
      expect(rec.points).toBeGreaterThanOrEqual(0);
      expect(rec.points).toBeLessThanOrEqual(1000);
      expectedTotal += rec.points;
      expect(s.totalScore).toBe(expectedTotal);
      expect(s.reveal).not.toBeNull();
      expect(s.reveal!.polylines.length).toBeGreaterThan(0);
      game.next();
      s = game.getState();
    }
    expect(s.screen).toBe('gameover');
    expect(s.rounds).toHaveLength(ROUNDS_PER_GAME);
    expect(s.best).toBe(expectedTotal);
    expect(storage.getItem(BEST_SCORE_KEY)).toBe(String(expectedTotal));

    game.playAgain();
    s = game.getState();
    expect(s.screen).toBe('round');
    expect(s.rounds).toHaveLength(0);
    expect(s.totalScore).toBe(0);

    game.toCitySelect();
    expect(game.getState().screen).toBe('cityselect');
  });

  it('ignores guesses submitted outside the round screen', async () => {
    __resetDataCaches();
    const game = new Game({ rng: mulberry32(7), storage: new FakeStorage() });
    await game.init();
    game.submitGuess({ lat: 50, lon: 19 }); // still on cityselect
    expect(game.getState().rounds).toHaveLength(0);
    expect(game.getState().screen).toBe('cityselect');

    await game.selectCity(MOCK_CITY.slug, true);
    expect(game.getState().hardcore).toBe(true);
    const guess = { lat: 50.0605, lon: 19.9425 };
    game.submitGuess(guess);
    const s = game.getState();
    expect(s.rounds).toHaveLength(1);
    // independently recompute the miss distance against the picked target
    const target = MOCK_STREET_FEATURES.find((f) => f.properties.name === s.rounds[0].targetName);
    expect(target).toBeDefined();
    const expected = Math.min(
      ...polylinesOfFeature(target!).map((c) => pointToPolylineMeters(guess, c)),
    );
    expect(s.rounds[0].distanceM).toBeCloseTo(expected, 6);
    expect(s.rounds[0].points).toBe(scoreForDistance(expected, s.scaleM));
    expect(s.reveal!.nearest).toBeDefined();
  });
});
