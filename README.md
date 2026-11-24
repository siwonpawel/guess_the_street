# Zgadnij Ulicę

Gra w całości frontendowa, bez backendu. Wybierasz miasto, gra losuje w nim
losową nazwę ulicy, a Ty klikasz na mapie OpenStreetMap **tylko z warstwami
ulic** (bez zdjęć satelitarnych) tam, gdzie Twoim zdaniem ona przebiega. Po
każdym strzale dostajesz podsumowanie, jak bardzo się pomyliłeś („pudło:
137 m”) oraz zdobyte punkty.

Pełny plan zakresu (zasady, architektura, strategia danych, kamienie
milowe, ryzyka) znajdziesz w [SCOPING.md](SCOPING.md) (po angielsku).

## Uruchomienie deweloperskie

```sh
npm install
npm run dev
```

Jeśli `public/data/cities/` nie zostało jeszcze wygenerowane, aplikacja
automatycznie przełącza się na wbudowane demo miasto (fikcyjna siatka ulic
„w Krakowie”, `src/mock-data.ts`) i pokazuje plakietkę „dane demo”, więc gra
jest w pełni grywalna bez uruchamiania pipeline'u danych.

Na ekranie wyboru miasta pokazuje się tylko **Szczecin** — sterowane przez
`VISIBLE_CITY_SLUGS` w `src/config.ts` (ustaw `null`, aby pokazać wszystkie
miasta z indeksu danych). Pliki danych pozostałych miast zostają w repo.

Odległość „pudła” liczona jest zawsze do **najbliższego punktu na całej ulicy**:
wszystkie segmenty OSM o tej samej nazwie traktowane są jako jedna ulica
(OSM często dzieli ulicę na wiele części). Do testów ręcznych:
`FORCE_TARGET_STREETS` w `src/config.ts` ogranicza cele rund do podanych ulic
(np. `['Santocka', '26 Kwietnia']`; `null` = losowe ulice z całego miasta).

## Tryby trudności

- **Normalny** — klasyczne kafelki OpenStreetMap z nazwami ulic.
- **Hardcore (bez nazw)** — kafelki są wyłączone; geometria ulic z
  przygotowanego GeoJSON (OSM) jest rysowana bezpośrednio na płótnie w palecie
  zbliżonej do standardowej mapy OSM (tło `#f2efe9`, arterie kolorowe
  (`#e892a2` / `#fcd6a4` / `#f7fabf`), ulice osiedlowe białe, piesze cieńsze i
  przerywane), ale **bez żadnych nazw** — trzeba rozpoznać ulicę po jej
  przebiegu. Nie ma keylessowych kafelków bez etykiet, więc tryb hardcore
  rysuje zap bakowaną geometrię ulic zamiast kafelków.

## Build

```sh
npm run build
```

Type-check (`tsc --noEmit`) i statyczna strona w `dist/`.

## Testy

```sh
npm test
```

Testy jednostkowe Vitest: geometria (`src/geo.ts`), wzór punktacji, losowanie
ulic-celów oraz maszyna stanów gry (`tests/geo.test.ts`, `tests/game.test.ts`).

## Podgląd buildu produkcyjnego

```sh
npm run preview
```

## Dane (GeoJSON ulic miast)

W czasie działania aplikacja pobiera wyłącznie pliki statyczne z własnej
domeny: `data/cities/` (`index.json` + `<slug>.geojson`, serwowane z
`public/data/cities/`) oraz kafelki mapy z `tile.openstreetmap.org`. Nigdy
nie wywołuje openstreetmap.org ani Overpass w runtime. GeoJSON jest
przygotowywany z wyprzedzeniem przez pipeline danych — zobacz
`scripts/README.md`, jak go regenerować.

## Wdrożenie

`npm run build`, potem serwuj `dist/` na dowolnym hostingu statycznym
(GitHub Pages, Netlify, Cloudflare Pages). Vite jest skonfigurowany z
`base: './'`, więc build działa z każdej ścieżki. Wymagana atrybucja
(© OpenStreetMap contributors) jest widoczna w rogu mapy i w stopce.

### GitHub Pages (automatycznie)

`.github/workflows/deploy.yml` buduje i testuje projekt przy każdym pushu
do `main` i wdraża `dist/` na GitHub Pages. Aby włączyć raz:

1. W ustawieniach repo → Pages ustaw **Source** na *GitHub Actions*.
2. Push do `main` (lub ręcznie uruchom workflow przez *Run workflow*).

Gra będzie dostępna pod adresem `https://<użytkownik>.github.io/<repo>/`.
