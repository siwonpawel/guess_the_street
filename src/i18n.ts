// Wszystkie teksty widoczne dla użytkownika (język polski).

/** Polski wariant liczebnika dla „ulica”: 1 ulica, 2–4 ulice, dalej ulic. */
function pluralStreet(n: number): string {
  if (n === 1) return 'ulica';
  const r10 = n % 10;
  const r100 = n % 100;
  if (r10 >= 2 && r10 <= 4 && (r100 < 12 || r100 > 14)) return 'ulice';
  return 'ulic';
}

export const STR = {
  docTitle: 'Zgadnij Ulicę',
  docDescription:
    'Zgadnij Ulicę — wybierz miasto, wylosujemy nazwę ulicy, a Ty klikasz na mapie OpenStreetMap (same warstwy ulic, bez zdjęć), gdzie Twoim zdaniem się ona znajduje.',

  h1: 'Zgadnij Ulicę',
  tagline:
    'Wybierz miasto. Losujemy w nim losową ulicę. Kliknij na mapie z samymi warstwami ulic OpenStreetMap, gdzie Twoim zdaniem ona przebiega — bez zdjęć satelitarnych, a w trybie hardcore także bez nazw ulic.',
  searchPlaceholder: 'Szukaj miast…',
  difficultyLabel: 'Poziom trudności',
  diffNormal: 'Normalny (z nazwami)',
  diffHardcore: 'Hardcore (bez nazw)',
  roundsLabel: 'Liczba rund',
  mockBadge: 'dane demo — nie znaleziono wygenerowanych plików miast',
  cityError: (slug: string) => `Nie udało się wczytać danych ulic dla „${slug}”.`,
  noCities: 'Brak miast pasujących do wyszukiwania.',
  cityMeta: (country: string, count: number) => `${country} · ${count} ulic`,

  loading: 'Ładowanie…',
  loadingCity: (name: string) => `Ładowanie danych ulic: ${name}…`,

  round: (i: number, n: number) => `Runda ${i}/${n}`,
  find: (name: string) => `Znajdź: ${name}`,
  score: (s: number) => `Wynik: ${s}`,
  hint: 'Kliknij mapę, aby zgadnąć',

  resultTarget: 'Cel: ',
  points: (p: number) => `+${p} pkt`,
  total: (t: number) => `Razem: ${t}`,
  nextRound: 'Następna runda',
  seeResults: 'Zobacz wyniki',

  gameOver: 'Koniec gry',
  totalScore: (s: number) => `Wynik całkowity: ${s}`,
  best: (b: number) => `Rekord: ${b}`,
  newBest: 'Nowy rekord!',
  thRound: '#',
  thStreet: 'Ulica',
  thMissed: 'Pudło',
  thPoints: 'Punkty',
  playAgain: 'Zagraj ponownie (to samo miasto)',
  changeCity: 'Zmień miasto',

  confirmPin: 'Potwierdź zgadywanie na pinezkę',

  debugArea: 'Pokaż granicę obszaru losowania (debug)',
  areaStreets: (n: number) => `obszar: ${n} ${pluralStreet(n)}`,


  // formatDistance
  onStreet: 'na ulicy!',
  meters: (m: number) => `${m} m`,
  kilometers: (km: number) => `${km.toFixed(2).replace('.', ',')} km`,
} as const;
