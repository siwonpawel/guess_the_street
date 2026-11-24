// Leaflet wrapper: street-only map (normal: OSM raster street tiles;
// hardcore: the baked OSM street geometry rendered without labels),
// click-to-guess (with a confirm pin on touch devices), and the round reveal.

import L from 'leaflet';
import {
  ATTRIBUTION_OSM,
  MAX_ZOOM,
  MIN_ZOOM,
  TILE_SUBDOMAINS,
  TILE_URL_NORMAL,
} from './config';
import { polylinesOfFeature, type CityInfo, type StreetFeature } from './data';
import type { LatLng, LngLatTuple } from './geo';
import { STR } from './i18n';

export interface RevealData {
  polylines: LngLatTuple[][];
  guess: LatLng;
  nearest: LatLng;
}

const ACCENT = '#e11d48';
const GUESS_COLOR = '#2563eb';

/** Look of one hardcore street class (OSM-carto-like palette, no labels). */
interface HardcoreStyle {
  color: string;
  weight: number;
  /** Slightly wider, darker line drawn underneath (major roads only). */
  casing?: { color: string; weight: number };
  dashArray?: string;
}

/**
 * OSM-carto-like styling for the baked street geometry. There is no keyless
 * raster tile style without labels, so hardcore mode draws the GeoJSON street
 * segments on a canvas in the standard OSM palette instead of using tiles.
 */
function hardcoreStyle(highway?: string): HardcoreStyle {
  switch (highway) {
    case 'motorway':
    case 'trunk':
      return { color: '#e892a2', weight: 5, casing: { color: '#cf7d8c', weight: 7 } };
    case 'primary':
      return { color: '#fcd6a4', weight: 4, casing: { color: '#e0b184', weight: 5.5 } };
    case 'secondary':
      return { color: '#f7fabf', weight: 3.5, casing: { color: '#dde0a8', weight: 5 } };
    case 'tertiary':
      return { color: '#f7fabf', weight: 2.5 };
    case 'residential':
    case 'unclassified':
    case 'living_street':
    case 'service':
      return { color: '#ffffff', weight: 2.5 };
    case 'pedestrian':
    case 'footway':
    case 'path':
    case 'steps':
    case 'cycleway':
      return { color: '#ffffff', weight: 1.5, dashArray: '4 3' };
    default:
      return { color: '#ffffff', weight: 2 };
  }
}

export class GameMap {
  private map: L.Map | null = null;
  private normalLayer: L.TileLayer | null = null;
  private streetLayer: L.LayerGroup | null = null;
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
      ctrl.addTo(this.map);

      this.normalLayer = L.tileLayer(TILE_URL_NORMAL, {
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
      this.confirmBtn.textContent = STR.confirmPin;
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

  /**
   * Provide the city's streets (baked OSM GeoJSON) for hardcore mode, where
   * the map shows only street geometry styled like the OSM map — no raster
   * tiles, no labels.
   */
  setStreets(features: StreetFeature[]): void {
    if (!this.map) return;
    if (this.streetLayer) {
      this.map.removeLayer(this.streetLayer);
      this.streetLayer = null;
    }
    // One shared canvas renderer keeps ~9k segments fast.
    const renderer = L.canvas({ padding: 0.5 });
    const group = L.layerGroup();
    for (const f of features) {
      const style = hardcoreStyle(f.properties?.highway);
      for (const line of polylinesOfFeature(f)) {
        const latlngs = line.map(([lon, lat]) => L.latLng(lat, lon));
        if (style.casing) {
          L.polyline(latlngs, {
            renderer,
            color: style.casing.color,
            weight: style.casing.weight,
            opacity: 0.9,
            interactive: false,
          }).addTo(group);
        }
        L.polyline(latlngs, {
          renderer,
          color: style.color,
          weight: style.weight,
          opacity: 0.95,
          ...(style.dashArray ? { dashArray: style.dashArray } : {}),
          interactive: false,
        }).addTo(group);
      }
    }
    this.streetLayer = group;
    if (this.hardcore) group.addTo(this.map);
  }

  /**
   * Switch between normal (OSM street tiles with labels) and hardcore
   * (baked street geometry in the OSM palette, no labels, OSM land background).
   */
  private hardcore = false;

  setHardcore(hardcore: boolean): void {
    if (!this.map || !this.normalLayer) return;
    this.hardcore = hardcore;
    this.container.classList.toggle('hardcore-mode', hardcore);
    if (hardcore) {
      this.map.removeLayer(this.normalLayer);
      this.streetLayer?.addTo(this.map);
    } else {
      this.streetLayer?.removeFrom(this.map);
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
