// Leaflet wrapper: street-only basemaps (normal / hardcore), click-to-guess
// (with a confirm pin on touch devices), and the round reveal drawing.

import L from 'leaflet';
import {
  ATTRIBUTION_CARTO,
  ATTRIBUTION_OSM,
  MAX_ZOOM,
  MIN_ZOOM,
  TILE_SUBDOMAINS,
  TILE_URL_HARDCORE,
  TILE_URL_NORMAL,
} from './config';
import type { CityInfo } from './data';
import type { LatLng, LngLatTuple } from './geo';

export interface RevealData {
  polylines: LngLatTuple[][];
  guess: LatLng;
  nearest: LatLng;
}

const ACCENT = '#e11d48';
const GUESS_COLOR = '#2563eb';

export class GameMap {
  private map: L.Map | null = null;
  private normalLayer: L.TileLayer | null = null;
  private hardcoreLayer: L.TileLayer | null = null;
  private revealGroup: L.LayerGroup | null = null;
  private pin: L.Marker | null = null;
  private confirmBtn: HTMLButtonElement | null = null;
  private touch = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly onGuess: (ll: LatLng) => void,
  ) {}

  /** Create the map once, then (re)fit it to the given city. Idempotent. */
  init(city: CityInfo): void {
    if (!this.map) {
      this.map = L.map(this.container, {
        attributionControl: false, // we add the required credits manually, prefix off
        zoomControl: true,
        minZoom: MIN_ZOOM,
        maxZoom: MAX_ZOOM,
        worldCopyJump: true,
      });
      const ctrl = L.control.attribution({ prefix: false });
      ctrl.addAttribution(ATTRIBUTION_OSM);
      ctrl.addAttribution(ATTRIBUTION_CARTO);
      ctrl.addTo(this.map);

      this.normalLayer = L.tileLayer(TILE_URL_NORMAL, {
        subdomains: TILE_SUBDOMAINS,
        maxZoom: MAX_ZOOM,
        attribution: '',
      });
      this.hardcoreLayer = L.tileLayer(TILE_URL_HARDCORE, {
        subdomains: TILE_SUBDOMAINS,
        maxZoom: MAX_ZOOM,
        attribution: '',
      });
      this.normalLayer.addTo(this.map);
      this.revealGroup = L.layerGroup().addTo(this.map);

      this.touch =
        (typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches) ||
        'ontouchstart' in window;
      this.map.on('click', (e: L.LeafletMouseEvent) => this.handleTap(e.latlng));

      this.confirmBtn = document.createElement('button');
      this.confirmBtn.type = 'button';
      this.confirmBtn.className = 'confirm-pin hidden';
      this.confirmBtn.textContent = 'Confirm guess at pin';
      this.confirmBtn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.confirmGuess();
      });
      this.container.parentElement?.appendChild(this.confirmBtn);
    }
    this.setCity(city);
  }

  /** Fit the map to a city bbox. */
  setCity(city: CityInfo): void {
    if (!this.map) return;
    this.clearRound();
    const [w, s, e, n] = city.bbox;
    this.map.fitBounds(
      L.latLngBounds([
        [s, w],
        [n, e],
      ]),
      { padding: [24, 24] },
    );
    this.map.invalidateSize();
  }

  /** Switch between normal (labels) and hardcore (no labels) street tiles. */
  setHardcore(hardcore: boolean): void {
    if (!this.map || !this.normalLayer || !this.hardcoreLayer) return;
    if (hardcore) {
      this.map.removeLayer(this.normalLayer);
      this.hardcoreLayer.addTo(this.map);
    } else {
      this.map.removeLayer(this.hardcoreLayer);
      this.normalLayer.addTo(this.map);
    }
  }

  /**
   * Draw the round reveal: target street in accent color, circle at the
   * nearest point on it, marker at the guess, dashed line between the two,
   * then fit the view to all of it.
   */
  reveal(data: RevealData): void {
    if (!this.map || !this.revealGroup) return;
    this.revealGroup.clearLayers();
    const toLatLngs = (line: LngLatTuple[]): L.LatLng[] =>
      line.map(([lon, lat]) => L.latLng(lat, lon));
    for (const line of data.polylines) {
      L.polyline(toLatLngs(line), { color: ACCENT, weight: 6, opacity: 0.9 }).addTo(this.revealGroup);
    }
    L.circleMarker([data.nearest.lat, data.nearest.lon], {
      radius: 9,
      color: ACCENT,
      fillColor: ACCENT,
      fillOpacity: 1,
      weight: 2,
    }).addTo(this.revealGroup);
    L.circleMarker([data.guess.lat, data.guess.lon], {
      radius: 8,
      color: GUESS_COLOR,
      fillColor: GUESS_COLOR,
      fillOpacity: 0.9,
      weight: 2,
    }).addTo(this.revealGroup);
    L.polyline(
      [L.latLng(data.guess.lat, data.guess.lon), L.latLng(data.nearest.lat, data.nearest.lon)],
      { color: '#111827', weight: 2, dashArray: '6 6', opacity: 0.8 },
    ).addTo(this.revealGroup);

    const bounds = L.latLngBounds([]);
    for (const line of data.polylines) {
      for (const ll of toLatLngs(line)) bounds.extend(ll);
    }
    bounds.extend([data.guess.lat, data.guess.lon]);
    bounds.extend([data.nearest.lat, data.nearest.lon]);
    this.map.fitBounds(bounds, { padding: [48, 48], maxZoom: 17 });
  }

  /** Remove reveal drawings and any pending pin. */
  clearRound(): void {
    this.revealGroup?.clearLayers();
    this.clearPin();
  }

  private handleTap(latlng: L.LatLng): void {
    if (!this.touch) {
      // Desktop: a single click is the guess.
      this.onGuess({ lat: latlng.lat, lon: latlng.lng });
      return;
    }
    // Touch: first tap places a pin, the floating button locks the guess.
    this.placePin(latlng);
  }

  private placePin(latlng: L.LatLng): void {
    if (!this.map) return;
    this.clearPin();
    const icon = L.divIcon({
      className: 'guess-pin',
      html: '📍',
      iconSize: [32, 32],
      iconAnchor: [16, 30],
    });
    this.pin = L.marker(latlng, { icon, interactive: false }).addTo(this.map);
    this.confirmBtn?.classList.remove('hidden');
  }

  private confirmGuess(): void {
    if (!this.pin) return;
    const ll = this.pin.getLatLng();
    this.clearPin();
    this.onGuess({ lat: ll.lat, lon: ll.lng });
  }

  private clearPin(): void {
    if (this.map && this.pin) this.map.removeLayer(this.pin);
    this.pin = null;
    this.confirmBtn?.classList.add('hidden');
  }
}
