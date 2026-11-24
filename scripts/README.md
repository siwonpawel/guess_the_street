# Skrypty pipeline'u danych

Narzędzia działające w czasie builda, zamieniające dane OpenStreetMap na
statyczne pliki GeoJSON per miasto, z których gra korzysta w runtime. Nic tutaj
nie działa w przeglądarce i **nie ma żadnych zależności npm** — czysty Node
(>= 18, globalny `fetch`).

## Regeneracja danych

```sh
node scripts/fetch-streets.mjs              # wszystkie miasta z scripts/cities.json
node scripts/fetch-streets.mjs --only paris # jedno miasto (index.json zachowuje pozostałe)
```

Dla każdego miasta skrypt odpytuje Overpass API o nazwane drogi (way z tagiem
`name`) w bboxie miasta, zostawia klasy ulic nadające się do gry (`motorway`
… `residential`, plus `living_street`, `service`, `pedestrian`, `footway`),
upraszcza każdą linię algorytmem Douglasa–Peuckera (tolerancja ~8 m, podwajana
raz, gdyby plik miał przekroczyć 2,5 MB), kwantuje współrzędne do 5 miejsc
dziesiętnych i zapisuje:

- `public/data/cities/<slug>.geojson` — zwarta FeatureCollection, jeden Feature
  na ulicę, `properties: { name, highway }`
- `public/data/cities/index.json` — `[{ slug, name, country, center, bbox,
  streetCount, generatedAt, source }]`

Wygenerowane pliki są commitowane do repo, więc deploy jest w pełni statyczny
i nigdy nie zależy od Overpass w runtime.

## Dodanie miasta

1. Dopisz wpis do `scripts/cities.json`:
   `{ "slug": "szczecin", "name": "Szczecin", "country": "Polska",
      "center": [53.4302, 14.5528], "bbox": [53.388, 14.475, 53.472, 14.635] }`
   — `bbox` to `[south, west, north, east]`. Zostaw ręcznie narysowany prostokąt
   wokół samego miasta (nie całej aglomeracji), żeby plik był mały.
   Nazwy miast i krajów podawaj po polsku (wyświetlają się w grze).
2. Uruchom `node scripts/fetch-streets.mjs --only szczecin`.
3. Sprawdź zalogowany rozmiar pliku. Jeśli plik miasta przekracza ~2 MB,
   zacieśnij jego bbox w `scripts/cities.json` i uruchom ponownie; sam skrypt
   głośno się wywala powyżej 2,5 MB (po jednej automatycznej próbie z
   podwojoną tolerancją upraszczania).
4. Scommituj nowy `<slug>.geojson` i zaktualizowany `index.json`.

## Etykieta Overpass

- Skrypt wysyła opisowy `User-Agent` (wymagany — overpass-api.de odrzuca
  żądania bez niego kodem HTTP 406).
- Jedno zapytanie na miasto, wykonywane sekwencyjnie, tylko w czasie builda —
  nigdy w runtime.
- Mirrory są próbowane po kolei (`overpass-api.de`, `overpass.kumi.systems`,
  `overpass.private.coffee`) z ~4 próbami każdy, wykładniczym backoffem i
  jitterem, więc zajęty/429-ujący serwer jest obsługiwany gracefully.
- Jeśli zapytanie ciągle się nie udaje, odczekaj kilka minut i uruchom
  ponownie z `--only <slug>` zamiast bombardować API. Zapytania o duże miasta
  są ciężkie; preferuj godziny poza szczytem i trzymaj ciasne bboxy.
- Dane OSM są © OpenStreetMap contributors na licencji ODbL — gra pokazuje
  atrybucję; zachowaj ją przy ponownym użyciu wygenerowanych plików.
