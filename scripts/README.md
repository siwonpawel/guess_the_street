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

## Granica administracyjna miasta (boundaryRelation)

Sam prostokątny bbox potrafi zahaczyć o sąsiednią miejscowość (tak było w
przypadku Szczecina, którego bbox zahaczał o Mierzyn — stąd np. ulica
„Gabriela” spoza miasta mogła zostać wylosowana jako cel). Dlatego miasto może
zadeklarować prawdziwą granicę administracyjną przez pole `boundaryRelation`
w `scripts/cities.json` — id relacji OSM z `admin_level=8` (gmina miejska), np.
Szczecin: `"boundaryRelation": 342935`. Bbox wpisu powinien wtedy być na tyle
szeroki, żeby cała granica się w nim mieściła (bbox dalej służy tylko jako
początkowy widok mapy i zakres zapytania o ulice).

Gdy miasto ma `boundaryRelation`, skrypt wykonuje dodatkowe zapytanie Overpass:

```
[out:json][timeout:180];relation(<id>);out geom;
```

Z otrzymanej relacji bierze członyków-`way` z rolą `outer` i skleja je w jeden
lub więcej zamkniętych pierścieni (ringów): łańcuchy są łączone przez
dopasowywanie końców odcinków, w razie potrzeby odwracane, a końce oddalone o
mniej niż ~1e-4 stopnia (~11 m) są „przyciągane” do siebie.

Następnie filtruje ulice testem punkt-w-wielokącie (ray casting, reguła
even-odd po wszystkich ringach; wierzchołek leżący na granicy liczy się jako
„w środku”): ulica zostaje w pliku tylko wtedy, gdy **co najmniej jeden jej
wierzchołek leży wewnątrz granicy**. Ulice leżące w bboxie, ale poza granicą
(np. w Mierzynie), są odrzucane, a liczba odrzuconych ulic jest logowana.

Pierścień granicy zapisywany jest osobno jako
`public/data/cities/<slug>-boundary.geojson` — FeatureCollection z jednym
Feature typu `Polygon` (lub `MultiPolygon`, gdy granica ma kilka pierścieni),
żeby aplikacja mogła później narysować prawdziwą granicę miasta na mapie.

Test `tests/boundary.test.ts` pilnuje tego kontraktu dla Szczecina: każda ulica
w `szczecin.geojson` ma co najmniej jeden wierzchołek wewnątrz wielokąta z
`szczecin-boundary.geojson`, a ulice spoza miasta (np. „Gabriela” z Mierzyna)
nie występują.

## Dodanie miasta

1. Dopisz wpis do `scripts/cities.json`:
   `{ "slug": "szczecin", "name": "Szczecin", "country": "Polska",
      "center": [53.4302, 14.5528], "bbox": [53.388, 14.475, 53.472, 14.635] }`
   — `bbox` to `[south, west, north, east]`. Zostaw ręcznie narysowany prostokąt
   wokół samego miasta (nie całej aglomeracji), żeby plik był mały.
   Opcjonalnie dodaj `"boundaryRelation": <id relacji OSM>` (granica gminy,
   `admin_level=8`), jeśli chcesz, żeby wybór ulic trzymał się prawdziwej
   granicy administracyjnej zamiast prostokąta — bbox powinien wtedy zawierać
   całą granicę. Nazwy miast i krajów podawaj po polsku (wyświetlają się w grze).
2. Uruchom `node scripts/fetch-streets.mjs --only szczecin`.
3. Sprawdź zalogowany rozmiar pliku. Jeśli plik miasta przekracza ~2 MB,
   zacieśnij jego bbox w `scripts/cities.json` i uruchom ponownie; sam skrypt
   głośno się wywala powyżej 2,5 MB (po jednej automatycznej próbie z
   podwojoną tolerancją upraszczania).
4. Scommituj nowy `<slug>.geojson`, ewentualnie `<slug>-boundary.geojson` (gdy
   miasto ma `boundaryRelation`) i zaktualizowany `index.json`.

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
