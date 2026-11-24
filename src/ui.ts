// DOM overlay screens: CitySelect, Loading, Round HUD, Result panel, GameOver.

import { DEBUG_SHOW_AREA_BORDER, ROUND_OPTIONS, ROUNDS_PER_GAME } from './config';
import type { Game, GameState } from './game';
import { formatDistance } from './geo';
import { STR } from './i18n';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      default: return '&#39;';
    }
  });
}

export interface UIOptions {
  /** Initial state of the debug area-border checkbox (config default). */
  debugAreaBorder?: boolean;
  /** Called when the debug checkbox is toggled (live switch). */
  onDebugAreaToggle?: (on: boolean) => void;
}

export class UI {
  private lastState: GameState | null = null;
  private hardcoreChoice = false;
  private debugAreaBorder: boolean;
  private readonly onDebugAreaToggle: ((on: boolean) => void) | null;

  constructor(
    private readonly root: HTMLElement,
    private readonly game: Game,
    opts: UIOptions = {},
  ) {
    this.debugAreaBorder = opts.debugAreaBorder ?? DEBUG_SHOW_AREA_BORDER;
    this.onDebugAreaToggle = opts.onDebugAreaToggle ?? null;
    this.build();
    this.bind();
  }

  private el<T extends HTMLElement>(id: string): T {
    const found = this.root.querySelector<T>(`#${id}`);
    if (!found) throw new Error(`missing element #${id}`);
    return found;
  }

  private build(): void {
    this.root.innerHTML = `
      <section id="scr-cityselect" class="screen">
        <div class="panel cityselect-panel">
          <h1>${STR.h1}</h1>
          <p class="tagline">${STR.tagline}</p>
          <input id="city-search" type="search" placeholder="${STR.searchPlaceholder}" autocomplete="off" />
          <div class="difficulty" role="group" aria-label="${STR.difficultyLabel}">
            <button type="button" id="diff-normal" class="seg active">${STR.diffNormal}</button>
            <button type="button" id="diff-hardcore" class="seg">${STR.diffHardcore}</button>
          </div>
          <div class="difficulty" role="group" aria-label="${STR.roundsLabel}">
            ${ROUND_OPTIONS.map((n) => `<button type="button" class="seg rounds-seg${n === ROUNDS_PER_GAME ? ' active' : ''}" data-rounds="${n}">${n}</button>`).join('')}
            <span class="seg-label">${STR.roundsLabel}</span>
          </div>
          <label class="debug-toggle" for="debug-area">
            <input type="checkbox" id="debug-area"${this.debugAreaBorder ? ' checked' : ''} />
            <span>${STR.debugArea}</span>
          </label>
          <div id="mock-badge" class="mock-badge hidden">${STR.mockBadge}</div>
          <div id="city-error" class="error hidden"></div>
          <div id="city-grid" class="city-grid"></div>
        </div>
      </section>

      <section id="scr-loading" class="screen hidden">
        <div class="loading-box">
          <div class="spinner" aria-hidden="true"></div>
          <p id="loading-text">${STR.loading}</p>
        </div>
      </section>

      <section id="scr-gameover" class="screen hidden">
        <div class="panel gameover-panel">
          <h2>${STR.gameOver}</h2>
          <div id="go-total" class="go-total"></div>
          <div id="go-best" class="go-best"></div>
          <div id="go-newbest" class="newbest hidden">${STR.newBest}</div>
          <table class="go-table">
            <thead>
              <tr><th>${STR.thRound}</th><th>${STR.thStreet}</th><th>${STR.thMissed}</th><th>${STR.thPoints}</th></tr>
            </thead>
            <tbody id="go-tbody"></tbody>
          </table>
          <div class="btn-row">
            <button type="button" id="btn-again" class="btn primary">${STR.playAgain}</button>
            <button type="button" id="btn-change" class="btn">${STR.changeCity}</button>
          </div>
        </div>
      </section>

      <div id="hud" class="hidden">
        <div class="hud-top">
          <span id="hud-round" class="hud-chip"></span>
          <span id="hud-find" class="hud-chip hud-find"></span>
          <span id="hud-score" class="hud-chip"></span>
          <button type="button" id="btn-share" class="hud-chip hud-btn hidden" title="${STR.shareLink}">🔗</button>
        </div>
        <div id="hud-hint" class="hud-hint">${STR.hint}</div>
      </div>

      <section id="result-panel" class="panel hidden">
        <div class="result-target">${STR.resultTarget}<strong id="res-name"></strong></div>
        <div id="res-dist" class="result-dist"></div>
        <div class="result-sub"><span id="res-points"></span> · <span id="res-total"></span></div>
        <button type="button" id="btn-next" class="btn primary">${STR.nextRound}</button>
      </section>
    `;
  }

  private bind(): void {
    this.el('city-search').addEventListener('input', () => {
      if (this.lastState) this.renderCities(this.lastState);
    });
    this.el('diff-normal').addEventListener('click', () => this.setDifficulty(false));
    this.el('diff-hardcore').addEventListener('click', () => this.setDifficulty(true));
    for (const btn of Array.from(this.root.querySelectorAll<HTMLButtonElement>('.rounds-seg'))) {
      btn.addEventListener('click', () => {
        for (const b of Array.from(this.root.querySelectorAll('.rounds-seg'))) {
          b.classList.toggle('active', b === btn);
        }
        this.game.setRoundsPerGame(Number(btn.dataset.rounds));
      });
    }
    this.el<HTMLInputElement>('debug-area').addEventListener('change', (e) => {
      const input = e.currentTarget as HTMLInputElement | null;
      this.debugAreaBorder = input?.checked ?? false;
      this.onDebugAreaToggle?.(this.debugAreaBorder);
    });
    this.el('btn-share').addEventListener('click', async (ev) => {
      const s = this.game.getState();
      if (!s.gameSeed) return;
      const p = new URLSearchParams({ seed: s.gameSeed, rounds: String(s.roundsPerGame) });
      const url = `${window.location.origin}${window.location.pathname}?${p.toString()}`;
      try {
        await navigator.clipboard.writeText(url);
      } catch {
        window.prompt(STR.shareLink, url);
      }
      const btn = ev.currentTarget as HTMLButtonElement;
      btn.textContent = '✓';
      window.setTimeout(() => (btn.textContent = '🔗'), 1200);
    });
    this.el('btn-next').addEventListener('click', () => this.game.next());
    this.el('btn-again').addEventListener('click', () => this.game.playAgain());
    this.el('btn-change').addEventListener('click', () => this.game.toCitySelect());
  }

  private setDifficulty(hardcore: boolean): void {
    this.hardcoreChoice = hardcore;
    this.el('diff-normal').classList.toggle('active', !hardcore);
    this.el('diff-hardcore').classList.toggle('active', hardcore);
  }

  render(s: GameState): void {
    this.lastState = s;
    const show = (id: string, on: boolean) => this.el(id).classList.toggle('hidden', !on);

    show('scr-cityselect', s.screen === 'cityselect');
    show('scr-loading', s.screen === 'loading');
    show('scr-gameover', s.screen === 'gameover');
    const inGame = s.screen === 'round' || s.screen === 'result';
    show('hud', inGame);
    show('result-panel', s.screen === 'result');
    show('mock-badge', s.usingMock && s.screen === 'cityselect');

    const err = this.el('city-error');
    err.classList.toggle('hidden', !s.error);
    if (s.error) err.textContent = s.error;

    if (s.screen === 'cityselect') this.renderCities(s);
    if (s.screen === 'loading') {
      this.el('loading-text').textContent = s.city ? STR.loadingCity(s.city.name) : STR.loading;
    }

    if (inGame) {
      this.el('hud-round').textContent = STR.round(
        Math.min(s.roundIndex + 1, s.roundsPerGame),
        s.roundsPerGame,
      );
      this.el('hud-find').textContent = STR.find(s.targetName ?? '—');
      this.el('hud-score').textContent = STR.score(s.totalScore);
      this.el('btn-share').classList.toggle('hidden', !s.gameSeed);
      this.el('hud-hint').textContent = s.screen === 'round' ? STR.hint : '';
    }

    if (s.screen === 'result' && s.rounds.length > 0) {
      const r = s.rounds[s.rounds.length - 1];
      this.el('res-name').textContent = r.targetName;
      this.el('res-dist').textContent = formatDistance(r.distanceM);
      this.el('res-points').textContent = STR.points(r.points);
      this.el('res-total').textContent = STR.total(s.totalScore);
      const last = s.roundIndex + 1 >= s.roundsPerGame;
      this.el<HTMLButtonElement>('btn-next').textContent = last ? STR.seeResults : STR.nextRound;
    }

    if (s.screen === 'gameover') this.renderGameOver(s);
  }

  private renderCities(s: GameState): void {
    const grid = this.el('city-grid');
    const q = this.el<HTMLInputElement>('city-search').value.trim().toLowerCase();
    const cities = s.cities.filter(
      (c) => !q || c.name.toLowerCase().includes(q) || c.country.toLowerCase().includes(q),
    );
    grid.innerHTML = '';
    if (cities.length === 0) {
      const p = document.createElement('p');
      p.className = 'empty';
      p.textContent = STR.noCities;
      grid.appendChild(p);
      return;
    }
    for (const c of cities) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'city-card';
      card.innerHTML = `
        <span class="city-name">${escapeHtml(c.name)}</span>
        <span class="city-meta">${escapeHtml(STR.cityMeta(c.country, c.streetCount))}</span>
      `;
      card.addEventListener('click', () => {
        void this.game.selectCity(c.slug, this.hardcoreChoice);
      });
      grid.appendChild(card);
    }
  }

  private renderGameOver(s: GameState): void {
    this.el('go-total').textContent = STR.totalScore(s.totalScore);
    this.el('go-best').textContent = STR.best(s.best);
    this.el('go-newbest').classList.toggle('hidden', !s.newBest);
    const tbody = this.el('go-tbody');
    tbody.innerHTML = '';
    for (const r of s.rounds) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.round}</td>
        <td>${escapeHtml(r.targetName)}</td>
        <td>${escapeHtml(formatDistance(r.distanceM))}</td>
        <td>${r.points}</td>
      `;
      tbody.appendChild(tr);
    }
  }
}
