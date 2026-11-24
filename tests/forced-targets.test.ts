// Tests for multi-segment streets ("Santocka", "26 Kwietnia") using the real
// Szczecin GeoJSON: the forced-target override, name grouping (all same-named
// OSM segments = one street), and distance measured across the whole group.

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// Force the debug override explicitly for these tests, regardless of the
// current value in src/config.ts.
vi.mock('../src/config', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/config')>();
  return { ...orig, FORCE_TARGET_STREETS: ['Santocka', '26 Kwietnia'] };
});

import { ROUNDS_PER_GAME } from '../src/config';
import { __resetDataCaches, polylinesOfFeature, type StreetFeature } from '../src/data';
import { Game } from '../src/game';
import { pointToPolylineMeters, type LatLng } from '../src/geo';
import { MOCK_CITY } from '../src/mock-data';

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

const gj = JSON.parse(
  readFileSync(new URL('../public/data/cities/szczecin.geojson', import.meta.url), 'utf8'),
);
const FEATURES: StreetFeature[] = gj.features;
const FORCED = ['Santocka', '26 Kwietnia'];
const byName = (n: string) => FEATURES.filter((f) => f.properties.name === n);

/** A point exactly on the k-th segment's midpoint of street `name`. */
function pointOnStreet(name: string, k: number): LatLng {
  const lines = byName(name).flatMap(polylinesOfFeature);
  const line = lines[k % lines.length];
  const mid = Math.floor(line.length / 2);
  const [lon, lat] = line[mid];
  return { lat, lon };
}

describe('real Szczecin data: Santocka / 26 Kwietnia', () => {
  it('both streets exist as multiple OSM segments', () => {
    expect(byName('Santocka').length).toBeGreaterThan(1);
    expect(byName('26 Kwietnia').length).toBeGreaterThan(1);
    console.log(`Santocka: ${byName('Santocka').length} segments, 26 Kwietnia: ${byName('26 Kwietnia').length} segments`);
  });

  it('forced override picks only the listed streets for all rounds', async () => {
    __resetDataCaches();
    const game = new Game({ rng: mulberry32(99), storage: new FakeStorage(), features: FEATURES });
    await game.init();
    await game.selectCity(MOCK_CITY.slug, false);
    const seen = new Set<string>();
    for (let i = 0; i < ROUNDS_PER_GAME; i++) {
      const s = game.getState();
      expect(s.screen).toBe('round');
      expect(FORCED).toContain(s.targetName);
      seen.add(s.targetName!);
      game.submitGuess({ lat: 53.43, lon: 14.55 });
      game.next();
    }
    expect(game.getState().screen).toBe('gameover');
    expect(seen.size).toBeGreaterThanOrEqual(1);
    expect([...seen].every((n) => FORCED.includes(n))).toBe(true);
  });

  it('a guess on ANY segment of the target street counts as on the street', async () => {
    __resetDataCaches();
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12 && seen.size < FORCED.length; seed++) {
      __resetDataCaches();
      const game = new Game({ rng: mulberry32(seed), storage: new FakeStorage(), features: FEATURES });
      await game.init();
      await game.selectCity(MOCK_CITY.slug, false);
      const targetName = game.getState().targetName!;
      seen.add(targetName);
      const group = byName(targetName);

      // guess exactly on a middle segment of the street (not necessarily the
      // representative feature the game picked)
      const guess = pointOnStreet(targetName, Math.floor(group.length / 2));
      game.submitGuess(guess);
      const s = game.getState();
      const rec = s.rounds[0];
      expect(rec.targetName).toBe(targetName);
      expect(rec.distanceM).toBeLessThan(1); // "na ulicy!"
      // the reveal highlights every same-named segment of the street
      expect(s.reveal!.polylines.length).toBe(group.flatMap(polylinesOfFeature).length);
      // independent recomputation: min distance over the whole group
      const expected = Math.min(
        ...group.flatMap((f) => polylinesOfFeature(f)).map((c) => pointToPolylineMeters(guess, c)),
      );
      expect(rec.distanceM).toBeCloseTo(expected, 9);
    }
    expect(seen.size).toBe(FORCED.length); // both streets were exercised
  });

  it('a guess far from the target street measures a large distance', async () => {
    __resetDataCaches();
    const game = new Game({ rng: mulberry32(7), storage: new FakeStorage(), features: FEATURES });
    await game.init();
    await game.selectCity(MOCK_CITY.slug, false);
    const targetName = game.getState().targetName!;
    // opposite corner of the city from the street: use a vertex of the other forced street
    const other = FORCED.find((n) => n !== targetName)!;
    const guess = pointOnStreet(other, 0);
    const minOther = Math.min(
      ...byName(targetName).flatMap((f) => polylinesOfFeature(f)).map((c) => pointToPolylineMeters(guess, c)),
    );
    game.submitGuess(guess);
    const rec = game.getState().rounds[0];
    expect(rec.distanceM).toBeCloseTo(minOther, 6);
    expect(rec.distanceM).toBeGreaterThan(50); // the two streets are distinct
  });
});
