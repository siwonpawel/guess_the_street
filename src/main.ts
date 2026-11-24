// Boot: wire the game state machine, the Leaflet map, and the UI together.

import 'leaflet/dist/leaflet.css';
import './styles.css';

import { ATTRIBUTION_OSM, DEBUG_SHOW_AREA_BORDER } from './config';
import { Game, type GameState } from './game';
import { GameMap } from './map';
import { UI } from './ui';

const app = document.getElementById('app');
const mapEl = document.getElementById('map');
const uiEl = document.getElementById('ui');
const footer = document.getElementById('footer');
if (!app || !mapEl || !uiEl || !footer) throw new Error('missing #app/#map/#ui/#footer');

// Required attribution in the footer as well as the map corner (ODbL).
footer.innerHTML = ATTRIBUTION_OSM;

const game = new Game();
const map = new GameMap(mapEl, (ll) => game.submitGuess(ll));

// Debug overlay: draw the area border (city bbox) while a game is running.
// Initial value comes from the config flag; the city-select checkbox can
// switch it live.
let debugAreaBorder = DEBUG_SHOW_AREA_BORDER;

function applyAreaBorder(s: GameState): void {
  if (debugAreaBorder && s.city && s.screen !== 'cityselect' && s.screen !== 'loading') {
    map.setAreaBorder(s.city.bbox, s.city.streetCount, s.boundary);
  } else {
    map.setAreaBorder(null);
  }
}

const ui = new UI(uiEl, game, {
  debugAreaBorder,
  onDebugAreaToggle: (on) => {
    debugAreaBorder = on;
    applyAreaBorder(game.getState());
  },
});

// Keep the map in sync with game state.
let mapCitySlug: string | null = null;
let mapHardcore: boolean | null = null;
let revealedRound = -1;
game.subscribe((s) => {
  ui.render(s);
  applyAreaBorder(s);
  if (!s.city || s.screen === 'cityselect') return;
  // (Re)fit the map when the city changes or a new game starts — also when the
  // same city is replayed, so the view resets from the last reveal zoom.
  const newGame = s.screen === 'round' && s.roundIndex === 0 && s.rounds.length === 0;
  if (mapCitySlug !== s.city.slug || newGame) {
    map.init(s.city); // idempotent; fits bounds to the city
    map.setStreets(game.getFeatures()); // hardcore layer source
    mapCitySlug = s.city.slug;
    revealedRound = -1;
  }
  if (mapHardcore !== s.hardcore) {
    map.setHardcore(s.hardcore);
    mapHardcore = s.hardcore;
  }
  if (s.screen === 'result' && s.reveal && revealedRound !== s.rounds.length) {
    map.reveal({ polylines: s.reveal.polylines, guess: s.reveal.guess, nearest: s.reveal.nearest });
    revealedRound = s.rounds.length;
  } else if (s.screen !== 'result') {
    map.clearRound();
  }
});

// Debug handle for devtools/tests, only when the area-border overlay is on.
if (DEBUG_SHOW_AREA_BORDER) {
  (window as unknown as { __gts?: { map: GameMap } }).__gts = { map };
}

void game.init();
