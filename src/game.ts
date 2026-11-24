// Game state machine: CitySelect → Loading → Round → Result → (next Round | GameOver).
// Pure logic (no DOM) — driven by main.ts/ui.ts and unit-tested in tests/game.test.ts.

import { BEST_SCORE_KEY, FORCE_TARGET_STREETS, ROUNDS_PER_GAME, scoreForDistance } from './config';
import { STR } from './i18n';
import {
  loadCities,
  loadCity,
  polylinesOfFeature,
  type CityData,
  type CityInfo,
  type StreetFeature,
} from './data';
import { bboxDiagonalMeters, nearestPointOnPolyline, type LatLng, type LngLatTuple } from './geo';

export type Screen = 'cityselect' | 'loading' | 'round' | 'result' | 'gameover';

export interface RoundRecord {
  round: number; // 1-based
  targetName: string;
  guess: LatLng | null;
  distanceM: number;
  points: number;
}

export interface Reveal {
  targetName: string;
  polylines: LngLatTuple[][];
  guess: LatLng;
  nearest: LatLng;
}

export interface GameState {
  screen: Screen;
  cities: CityInfo[];
  /** True when playing on the embedded mock city (data files unavailable). */
  usingMock: boolean;
  city: CityInfo | null;
  hardcore: boolean;
  /** 0-based index of the current round. */
  roundIndex: number;
  rounds: RoundRecord[];
  totalScore: number;
  best: number;
  /** True when the just-finished game set a new best score. */
  newBest: boolean;
  targetName: string | null;
  /** D = half the city bbox diagonal; the scoring scale. */
  scaleM: number;
  reveal: Reveal | null;
  error: string | null;
}

export type Listener = (state: GameState) => void;

export interface GameOptions {
  rng?: () => number;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Test hook: override the loaded city's street features. */
  features?: StreetFeature[];
}

function defaultStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export class Game {
  private state: GameState;
  private listeners = new Set<Listener>();
  private features: StreetFeature[] = [];
  private targets: StreetFeature[] = [];
  private readonly rng: () => number;
  private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  private readonly forcedFeatures: StreetFeature[] | null;

  constructor(opts: GameOptions = {}) {
    this.rng = opts.rng ?? Math.random;
    this.storage = opts.storage === undefined ? defaultStorage() : opts.storage;
    this.forcedFeatures = opts.features ?? null;
    this.state = {
      screen: 'loading',
      cities: [],
      usingMock: false,
      city: null,
      hardcore: false,
      roundIndex: 0,
      rounds: [],
      totalScore: 0,
      best: this.readBest(),
      newBest: false,
      targetName: null,
      scaleM: 0,
      reveal: null,
      error: null,
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): GameState {
    return this.state;
  }

  /** Streets of the currently loaded city (used to render the hardcore street layer). */
  getFeatures(): StreetFeature[] {
    return this.features;
  }

  /** Load the city index (or mock fallback) and go to the city select screen. */
  async init(): Promise<void> {
    const { cities, usingMock } = await loadCities();
    this.set({ cities, usingMock, screen: 'cityselect', error: null });
  }

  /** Pick a city and difficulty, load its streets, start round 1. */
  async selectCity(slug: string, hardcore: boolean): Promise<void> {
    const picked = this.state.cities.find((c) => c.slug === slug) ?? null;
    this.set({ screen: 'loading', hardcore, city: picked, error: null, reveal: null });
    let data: CityData;
    try {
      data = await loadCity(slug);
    } catch {
      this.set({ screen: 'cityselect', error: STR.cityError(slug) });
      return;
    }
    this.features = this.forcedFeatures ?? data.features;
    this.targets = this.pickTargets();
    const scaleM = bboxDiagonalMeters(data.city.bbox) / 2;
    this.set({
      city: data.city,
      usingMock: this.state.usingMock || data.usingMock,
      rounds: [],
      totalScore: 0,
      roundIndex: 0,
      scaleM,
      targetName: this.targets[0]?.properties.name ?? null,
      screen: 'round',
      reveal: null,
      error: null,
    });
  }

  /** Register a guess for the current round (only valid in `round` screen). */
  submitGuess(guess: LatLng): void {
    if (this.state.screen !== 'round') return;
    const target = this.targets[this.state.roundIndex];
    if (!target) return;
    let distanceM = Infinity;
    let nearest: LatLng = guess;
    for (const f of this.targetGroup(target)) {
      for (const coords of polylinesOfFeature(f)) {
        const np = nearestPointOnPolyline(guess, coords);
        if (np.distanceMeters < distanceM) {
          distanceM = np.distanceMeters;
          nearest = np.point;
        }
      }
    }
    const points = scoreForDistance(distanceM, this.state.scaleM);
    const record: RoundRecord = {
      round: this.state.roundIndex + 1,
      targetName: target.properties.name,
      guess,
      distanceM,
      points,
    };
    this.set({
      rounds: [...this.state.rounds, record],
      totalScore: this.state.totalScore + points,
      screen: 'result',
      reveal: {
        targetName: record.targetName,
        polylines: this.targetGroup(target).flatMap(polylinesOfFeature),
        guess,
        nearest,
      },
    });
  }

  /** Advance from the result screen to the next round or to game over. */
  next(): void {
    if (this.state.screen !== 'result') return;
    const nextIndex = this.state.roundIndex + 1;
    if (nextIndex >= this.targets.length || nextIndex >= ROUNDS_PER_GAME) {
      const newBest = this.state.totalScore > this.state.best;
      const best = Math.max(this.state.best, this.state.totalScore);
      this.writeBest(best);
      this.set({ screen: 'gameover', best, newBest, reveal: null });
    } else {
      this.set({
        roundIndex: nextIndex,
        targetName: this.targets[nextIndex]?.properties.name ?? null,
        screen: 'round',
        reveal: null,
      });
    }
  }

  /** Play again with the same city (new random targets). */
  playAgain(): void {
    if (this.features.length === 0) {
      this.set({ screen: 'cityselect', reveal: null });
      return;
    }
    this.targets = this.pickTargets();
    this.set({
      rounds: [],
      totalScore: 0,
      roundIndex: 0,
      targetName: this.targets[0]?.properties.name ?? null,
      screen: 'round',
      reveal: null,
      error: null,
    });
  }

  /** Back to the city select screen. */
  toCitySelect(): void {
    this.set({ screen: 'cityselect', reveal: null, error: null });
  }

  /**
   * Pick the rounds' target streets: distinct street *names* (OSM often splits
   * one street into many same-named ways). With FORCE_TARGET_STREETS set, only
   * those streets are picked (falls back to all if none match).
   */
  private pickTargets(): StreetFeature[] {
    const forced = FORCE_TARGET_STREETS;
    let pool = this.features;
    if (forced && forced.length > 0) {
      const matched = this.features.filter((f) => forced.includes(f.properties.name));
      if (matched.length > 0) pool = matched;
    }
    const byName = new Map<string, StreetFeature[]>();
    for (const f of pool) {
      const arr = byName.get(f.properties.name);
      if (arr) arr.push(f);
      else byName.set(f.properties.name, [f]);
    }
    const names = [...byName.keys()];
    if (forced && forced.length > 0 && names.length > 0) {
      // Test override: draw all rounds from the forced streets (repeats allowed).
      const out: StreetFeature[] = [];
      for (let i = 0; i < ROUNDS_PER_GAME; i++) {
        const n = names[Math.floor(this.rng() * names.length)];
        const arr = byName.get(n)!;
        out.push(arr[Math.floor(this.rng() * arr.length)]);
      }
      return out;
    }
    for (let i = names.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [names[i], names[j]] = [names[j], names[i]];
    }
    return names.slice(0, Math.min(ROUNDS_PER_GAME, names.length)).map((n) => {
      const arr = byName.get(n)!;
      return arr[Math.floor(this.rng() * arr.length)];
    });
  }

  /**
   * All OSM segments belonging to the target street: every feature with the
   * same name counts as one street, so the miss distance is measured to the
   * closest point on any of its segments.
   */
  private targetGroup(target: StreetFeature): StreetFeature[] {
    const group = this.features.filter((f) => f.properties.name === target.properties.name);
    return group.length > 0 ? group : [target];
  }

  private set(patch: Partial<GameState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  private readBest(): number {
    try {
      const v = this.storage?.getItem(BEST_SCORE_KEY);
      const n = v === null || v === undefined ? NaN : Number.parseInt(v, 10);
      return Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
      return 0;
    }
  }

  private writeBest(value: number): void {
    try {
      this.storage?.setItem(BEST_SCORE_KEY, String(value));
    } catch {
      // storage unavailable (private mode etc.) — best score just won't persist
    }
  }
}
