// DOM overlay screens: CitySelect, Loading, Round HUD, Result panel, GameOver.

import { ROUNDS_PER_GAME } from './config';
import type { Game, GameState } from './game';
import { formatDistance } from './geo';

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

export class UI {
  private lastState: GameState | null = null;
  private hardcoreChoice = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly game: Game,
  ) {
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
          <h1>Guess the Street</h1>
          <p class="tagline">
            Pick a city. We name a random street in it. You click on a
            street-only OpenStreetMap map where you think it is — no imagery,
            and no labels in hardcore mode.
          </p>
          <input id="city-search" type="search" placeholder="Search cities…" autocomplete="off" />
          <div class="difficulty" role="group" aria-label="Difficulty">
            <button type="button" id="diff-normal" class="seg active">Normal (labels)</button>
            <button type="button" id="diff-hardcore" class="seg">Hardcore (no labels)</button>
          </div>
          <div id="mock-badge" class="mock-badge hidden">demo data — generated city files not found</div>
          <div id="city-error" class="error hidden"></div>
          <div id="city-grid" class="city-grid"></div>
        </div>
      </section>

      <section id="scr-loading" class="screen hidden">
        <div class="loading-box">
          <div class="spinner" aria-hidden="true"></div>
          <p id="loading-text">Loading…</p>
        </div>
      </section>

      <section id="scr-gameover" class="screen hidden">
        <div class="panel gameover-panel">
          <h2>Game over</h2>
          <div id="go-total" class="go-total"></div>
          <div id="go-best" class="go-best"></div>
          <div id="go-newbest" class="newbest hidden">New best!</div>
          <table class="go-table">
            <thead>
              <tr><th>#</th><th>Street</th><th>Missed by</th><th>Points</th></tr>
            </thead>
            <tbody id="go-tbody"></tbody>
          </table>
          <div class="btn-row">
            <button type="button" id="btn-again" class="btn primary">Play again (same city)</button>
            <button type="button" id="btn-change" class="btn">Change city</button>
          </div>
        </div>
      </section>

      <div id="hud" class="hidden">
        <div class="hud-top">
          <span id="hud-round" class="hud-chip"></span>
          <span id="hud-find" class="hud-chip hud-find"></span>
          <span id="hud-score" class="hud-chip"></span>
        </div>
        <div id="hud-hint" class="hud-hint">Click the map to guess</div>
      </div>

      <section id="result-panel" class="panel hidden">
        <div class="result-target">Target: <strong id="res-name"></strong></div>
        <div id="res-dist" class="result-dist"></div>
        <div class="result-sub"><span id="res-points"></span> · <span id="res-total"></span></div>
        <button type="button" id="btn-next" class="btn primary">Next round</button>
      </section>
    `;
  }

  private bind(): void {
    this.el('city-search').addEventListener('input', () => {
      if (this.lastState) this.renderCities(this.lastState);
    });
    this.el('diff-normal').addEventListener('click', () => this.setDifficulty(false));
    this.el('diff-hardcore').addEventListener('click', () => this.setDifficulty(true));
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
      this.el('loading-text').textContent = `Loading ${s.city ? s.city.name : 'city'}…`;
    }

    if (inGame) {
      this.el('hud-round').textContent = `Round ${Math.min(s.roundIndex + 1, ROUNDS_PER_GAME)}/${ROUNDS_PER_GAME}`;
      this.el('hud-find').textContent = `Find: ${s.targetName ?? '—'}`;
      this.el('hud-score').textContent = `Score ${s.totalScore}`;
      this.el('hud-hint').textContent = s.screen === 'round' ? 'Click the map to guess' : '';
    }

    if (s.screen === 'result' && s.rounds.length > 0) {
      const r = s.rounds[s.rounds.length - 1];
      this.el('res-name').textContent = r.targetName;
      this.el('res-dist').textContent = formatDistance(r.distanceM);
      this.el('res-points').textContent = `+${r.points} pts`;
      this.el('res-total').textContent = `Total ${s.totalScore}`;
      const last = s.roundIndex + 1 >= ROUNDS_PER_GAME;
      this.el<HTMLButtonElement>('btn-next').textContent = last ? 'See results' : 'Next round';
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
      p.textContent = 'No cities match your search.';
      grid.appendChild(p);
      return;
    }
    for (const c of cities) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'city-card';
      card.innerHTML = `
        <span class="city-name">${escapeHtml(c.name)}</span>
        <span class="city-meta">${escapeHtml(c.country)} · ${c.streetCount} streets</span>
      `;
      card.addEventListener('click', () => {
        void this.game.selectCity(c.slug, this.hardcoreChoice);
      });
      grid.appendChild(card);
    }
  }

  private renderGameOver(s: GameState): void {
    this.el('go-total').textContent = `Total score: ${s.totalScore}`;
    this.el('go-best').textContent = `Best: ${s.best}`;
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
