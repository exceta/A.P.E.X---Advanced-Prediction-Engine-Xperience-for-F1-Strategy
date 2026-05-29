// F1 2026 predictions client (Supabase-backed).
import { Race, teamColors } from '../data/mock';
import { supabase } from '../lib/supabase';
import { fetchT } from './f1';

export interface RacePredictionRow {
  gp_name: string;
  driver_abbr: string;
  driver_name: string | null;
  driver_number: string | null;
  team_name: string | null;
  grid_position: number | null;
  win_pct: number | null;
  podium_pct: number | null;
  top10_pct: number | null;
  expected_finish: number | null;
  predicted_rank: number | null;
  created_at: string | null;
}

export interface QualiPredictionRow {
  gp_name: string;
  driver_abbr: string;
  driver_name: string | null;
  driver_number: string | null;
  team_name: string | null;
  expected_grid: number | null;
  pole_pct: number | null;
  q3_pct: number | null;
  predicted_grid: number | null;
  created_at: string | null;
}

// ── UI-friendly shape used by the PredictionList component ───────────
export interface PredictionItem {
  driver: string;          // 3-letter abbreviation
  name: string;            // full driver name
  team: string;
  prob: number;            // 0-100
  color: string;
  // Extra fields available if needed
  gridPosition?: number;
  expectedFinish?: number;
  podiumPct?: number;
  top10Pct?: number;
  poleHint?: number;
  q3Hint?: number;
  // Actual result (filled when race is completed)
  actualPosition?: number;
  predictedPosition?: number;
}

// ─────────────────────────────────────────────────────────────────────
//  Team colour resolution
// ─────────────────────────────────────────────────────────────────────
function resolveTeamColor(teamName: string | null | undefined): string {
  if (!teamName) return '#6b7280';
  const n = teamName.toLowerCase();
  if (n.includes('mclaren')) return teamColors['McLaren'];
  if (n.includes('ferrari')) return teamColors['Ferrari'];
  if (n.includes('red bull')) return teamColors['Red Bull Racing'];
  if (n.includes('mercedes')) return teamColors['Mercedes'];
  if (n.includes('aston martin')) return teamColors['Aston Martin'];
  if (n.includes('alpine')) return teamColors['Alpine'];
  if (n.includes('williams')) return teamColors['Williams'];
  if (n.includes('racing bulls') || n.includes('visa cash') || n === 'rb')
    return teamColors['RB'] ?? '#6692FF';
  if (n.includes('haas')) return teamColors['Haas'] ?? '#B6BABD';
  if (n.includes('audi') || n.includes('kick') || n.includes('sauber'))
    return teamColors['Kick Sauber'] ?? '#52E252';
  if (n.includes('cadillac')) return '#C0C0C0';
  return '#6b7280';
}

// ─────────────────────────────────────────────────────────────────────
//  Shape conversion for the UI
// ─────────────────────────────────────────────────────────────────────
export function racePredictionsToItems(
  rows: RacePredictionRow[],
  limit = 10,
): PredictionItem[] {
  return [...rows]
    .sort((a, b) => (a.predicted_rank ?? 999) - (b.predicted_rank ?? 999))
    .slice(0, limit)
    .map(r => ({
      driver: r.driver_abbr,
      name: r.driver_name ?? r.driver_abbr,
      team: r.team_name ?? 'Unknown',
      prob: r.win_pct ?? 0,
      color: resolveTeamColor(r.team_name),
      gridPosition: r.grid_position ?? undefined,
      expectedFinish: r.expected_finish ?? undefined,
      podiumPct: r.podium_pct ?? undefined,
      top10Pct: r.top10_pct ?? undefined,
    }));
}

export function qualiPredictionsToItems(
  rows: QualiPredictionRow[],
  limit = 10,
): PredictionItem[] {
  return [...rows]
    .sort((a, b) => (a.predicted_grid ?? 999) - (b.predicted_grid ?? 999))
    .slice(0, limit)
    .map(r => ({
      driver: r.driver_abbr,
      name: r.driver_name ?? r.driver_abbr,
      team: r.team_name ?? 'Unknown',
      prob: r.pole_pct ?? 0,
      color: resolveTeamColor(r.team_name),
      poleHint: r.pole_pct ?? undefined,
      q3Hint: r.q3_pct ?? undefined,
    }));
}

// ─────────────────────────────────────────────────────────────────────
//  GP-name mapping:  Race (from OpenF1)  →  full "XYZ Grand Prix"
//
//  The predictor API uses canonical names like "Japanese Grand Prix".
//  OpenF1 meeting names can vary (e.g. "Japanese Grand Prix", "Italian
//  Grand Prix", "Las Vegas Grand Prix"), and some calendar events
//  include things like "São Paulo Grand Prix" ≈ "Brazilian Grand Prix".
// ─────────────────────────────────────────────────────────────────────
const OPENF1_TO_PREDICTOR: Record<string, string> = {
  'São Paulo Grand Prix':    'Brazilian Grand Prix',
  'Sao Paulo Grand Prix':    'Brazilian Grand Prix',
  'Grande Prêmio de São Paulo': 'Brazilian Grand Prix',
};

const COUNTRY_TO_PREDICTOR: Record<string, string> = {
  'Australia':          'Australian Grand Prix',
  'China':              'Chinese Grand Prix',
  'Japan':              'Japanese Grand Prix',
  'Bahrain':            'Bahrain Grand Prix',
  'Saudi Arabia':       'Saudi Arabian Grand Prix',
  'USA':                'United States Grand Prix',
  'United States':      'United States Grand Prix',
  'Italy':              'Italian Grand Prix',  // Imola is also Italy → must override via event name
  'Monaco':             'Monaco Grand Prix',
  'Spain':              'Spanish Grand Prix',
  'Canada':             'Canadian Grand Prix',
  'Austria':            'Austrian Grand Prix',
  'UK':                 'British Grand Prix',
  'United Kingdom':     'British Grand Prix',
  'Hungary':            'Hungarian Grand Prix',
  'Belgium':            'Belgian Grand Prix',
  'Netherlands':        'Dutch Grand Prix',
  'Azerbaijan':         'Azerbaijan Grand Prix',
  'Singapore':          'Singapore Grand Prix',
  'Mexico':             'Mexican Grand Prix',
  'Brazil':             'Brazilian Grand Prix',
  'Qatar':              'Qatar Grand Prix',
  'UAE':                'Abu Dhabi Grand Prix',
  'Abu Dhabi':          'Abu Dhabi Grand Prix',
  'United Arab Emirates': 'Abu Dhabi Grand Prix',
};

export function resolvePredictorGpName(race: Race): string {
  if (OPENF1_TO_PREDICTOR[race.name]) return OPENF1_TO_PREDICTOR[race.name];
  if (/emilia[\s-]*romagna/i.test(race.name) || /imola/i.test(race.name))
    return 'Emilia Romagna Grand Prix';
  if (/miami/i.test(race.name))                return 'Miami Grand Prix';
  if (/las vegas/i.test(race.name))            return 'Las Vegas Grand Prix';
  if (race.name.toLowerCase().endsWith('grand prix')) return race.name;
  return COUNTRY_TO_PREDICTOR[race.country] ?? race.name;
}

// ─────────────────────────────────────────────────────────────────────
//  Actual results from Jolpica / Ergast
// ─────────────────────────────────────────────────────────────────────
export interface ActualResults {
  race: Map<string, number>;   // driver code → finishing position
  quali: Map<string, number>;  // driver code → qualifying position
}

// Our OpenF1-derived round numbers can differ from the official FIA / Ergast
// round numbers (e.g. cancelled races inflate our index). This helper resolves
// the correct Jolpica round by matching the GP name from the Ergast schedule.
let _jolpicaScheduleCache: { raceName: string; round: number }[] | null = null;

async function resolveJolpicaRound(raceObj: Race): Promise<number | null> {
  // 1. Try to load (and cache) the full Jolpica 2026 schedule
  if (!_jolpicaScheduleCache) {
    try {
      const res = await fetchT('https://api.jolpi.ca/ergast/f1/2026.json', 10000);
      if (res.ok) {
        const json = await res.json();
        const races = json?.MRData?.RaceTable?.Races;
        if (Array.isArray(races)) {
          _jolpicaScheduleCache = races.map((r: any) => ({
            raceName: (r.raceName || '').toLowerCase(),
            round: parseInt(r.round),
          }));
        }
      }
    } catch (e) {
      console.warn('[Predictions] Failed to fetch Jolpica schedule for round resolution:', e);
    }
  }

  if (!_jolpicaScheduleCache) return null;

  // 2. Match by GP name (our resolvePredictorGpName maps to canonical names
  //    like "Miami Grand Prix" which matches Jolpica's "Miami Grand Prix").
  const predictorName = resolvePredictorGpName(raceObj).toLowerCase();
  const openf1Name = raceObj.name.toLowerCase();

  const match = _jolpicaScheduleCache.find(
    (r) => r.raceName === predictorName || r.raceName === openf1Name
  );
  if (match) return match.round;

  // 3. Fuzzy fallback: check if any schedule entry name contains the key word
  //    from our race name (e.g. "miami", "canadian")
  const keyword = openf1Name.replace(/grand prix$/i, '').trim();
  if (keyword) {
    const fuzzy = _jolpicaScheduleCache.find((r) => r.raceName.includes(keyword));
    if (fuzzy) return fuzzy.round;
  }

  return null;
}

export async function fetchActualResults(raceObj: Race): Promise<ActualResults> {
  const race = new Map<string, number>();
  const quali = new Map<string, number>();

  // Resolve the correct Jolpica round (may differ from our synthetic round)
  const jolpicaRound = await resolveJolpicaRound(raceObj);
  if (jolpicaRound == null) {
    console.warn(`[Predictions] Could not resolve Jolpica round for "${raceObj.name}" — skipping actual results`);
    return { race, quali };
  }

  console.log(`[Predictions] Resolved "${raceObj.name}" (app round ${raceObj.round}) → Jolpica round ${jolpicaRound}`);

  try {
    const [raceRes, qualiRes] = await Promise.all([
      fetchT(`https://api.jolpi.ca/ergast/f1/2026/${jolpicaRound}/results.json`, 10000),
      fetchT(`https://api.jolpi.ca/ergast/f1/2026/${jolpicaRound}/qualifying.json`, 10000),
    ]);

    if (raceRes.ok) {
      const json = await raceRes.json();
      const results = json?.MRData?.RaceTable?.Races?.[0]?.Results;
      if (Array.isArray(results)) {
        for (const r of results) {
          const code = r.Driver?.code;
          const pos = parseInt(r.position);
          if (code && !isNaN(pos)) race.set(code, pos);
        }
      }
    }

    if (qualiRes.ok) {
      const json = await qualiRes.json();
      const results = json?.MRData?.RaceTable?.Races?.[0]?.QualifyingResults;
      if (Array.isArray(results)) {
        for (const r of results) {
          const code = r.Driver?.code;
          const pos = parseInt(r.position);
          if (code && !isNaN(pos)) quali.set(code, pos);
        }
      }
    }
  } catch (e) {
    console.warn('[Predictions] Failed to fetch actual results:', e);
  }

  return { race, quali };
}

// ─────────────────────────────────────────────────────────────────────
//  Supabase reads
// ─────────────────────────────────────────────────────────────────────
export async function fetchPredictionsForRace(
  race: Race,
): Promise<{
  raceItems: PredictionItem[];
  qualiItems: PredictionItem[];
  predictorGp: string;
}> {
  const predictorGp = resolvePredictorGpName(race);

  // Fetch predictions and actual results in parallel
  const [raceRes, qualiRes, actuals] = await Promise.all([
    supabase
      .from('race_predictions')
      .select('*')
      .eq('gp_name', predictorGp)
      .order('predicted_rank', { ascending: true }),
    supabase
      .from('quali_predictions')
      .select('*')
      .eq('gp_name', predictorGp)
      .order('predicted_grid', { ascending: true }),
    race.status === 'completed' ? fetchActualResults(race) : Promise.resolve(null),
  ]);

  if (raceRes.error) throw new Error(`Race predictions fetch failed: ${raceRes.error.message}`);
  if (qualiRes.error) throw new Error(`Qualifying predictions fetch failed: ${qualiRes.error.message}`);

  const raceRows = (raceRes.data ?? []) as RacePredictionRow[];
  const qualiRows = (qualiRes.data ?? []) as QualiPredictionRow[];

  let raceItems = racePredictionsToItems(raceRows);
  let qualiItems = qualiPredictionsToItems(qualiRows);

  // Merge actual positions into prediction items
  if (actuals) {
    raceItems = raceItems.map((item, i) => ({
      ...item,
      predictedPosition: i + 1,
      actualPosition: actuals.race.get(item.driver),
    }));
    qualiItems = qualiItems.map((item, i) => ({
      ...item,
      predictedPosition: i + 1,
      actualPosition: actuals.quali.get(item.driver),
    }));
  }

  return {
    predictorGp,
    raceItems,
    qualiItems,
  };
}
