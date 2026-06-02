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
      predictedPosition: r.predicted_rank ?? undefined,
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
      predictedPosition: r.predicted_grid ?? undefined,
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
//  Actual results (OpenF1 — same source as standings sync)
// ─────────────────────────────────────────────────────────────────────
export interface ActualResults {
  race: Map<string, number>;   // driver code → finishing position
  quali: Map<string, number>;  // driver code → qualifying position
}

const OPENF1_URL = 'https://api.openf1.org/v1';

async function loadSessionPositions(
  sessionKey: number,
  target: Map<string, number>,
): Promise<void> {
  const [resRes, drvRes] = await Promise.all([
    fetchT(`${OPENF1_URL}/session_result?session_key=${sessionKey}`, 12000),
    fetchT(`${OPENF1_URL}/drivers?session_key=${sessionKey}`, 12000),
  ]);

  if (!resRes.ok) return;

  const results = await resRes.json();
  const drivers = drvRes.ok ? await drvRes.json() : [];
  if (!Array.isArray(results)) return;

  const abbrByNumber = new Map<number, string>();
  if (Array.isArray(drivers)) {
    for (const d of drivers) {
      if (d.name_acronym && typeof d.driver_number === 'number') {
        abbrByNumber.set(d.driver_number, d.name_acronym);
      }
    }
  }

  for (const row of results) {
    const abbr = abbrByNumber.get(row.driver_number);
    const pos = row.position;
    if (abbr && typeof pos === 'number') {
      target.set(abbr, pos);
    }
  }
}

async function fetchActualResultsOpenF1(raceObj: Race): Promise<ActualResults> {
  const race = new Map<string, number>();
  const quali = new Map<string, number>();

  if (!raceObj.meeting_key) {
    return { race, quali };
  }

  const sessionsRes = await fetchT(
    `${OPENF1_URL}/sessions?meeting_key=${raceObj.meeting_key}`,
    12000,
  );
  if (!sessionsRes.ok) return { race, quali };

  const sessions = await sessionsRes.json();
  if (!Array.isArray(sessions)) return { race, quali };

  const raceSession = sessions.find((s: { session_name?: string }) => s.session_name === 'Race');
  const qualiSession = sessions.find((s: { session_name?: string }) => {
    const name = s.session_name ?? '';
    return name === 'Qualifying' || /sprint qualifying/i.test(name);
  });

  await Promise.all([
    raceSession ? loadSessionPositions(raceSession.session_key, race) : Promise.resolve(),
    qualiSession ? loadSessionPositions(qualiSession.session_key, quali) : Promise.resolve(),
  ]);

  return { race, quali };
}

export async function fetchActualResults(raceObj: Race): Promise<ActualResults> {
  const openF1 = await fetchActualResultsOpenF1(raceObj);
  if (openF1.race.size > 0 || openF1.quali.size > 0) {
    console.log(
      `[Predictions] Actuals from OpenF1 for "${raceObj.name}":`,
      openF1.race.size,
      'race,',
      openF1.quali.size,
      'quali',
    );
    return openF1;
  }

  console.warn(`[Predictions] No OpenF1 results for "${raceObj.name}" (meeting_key=${raceObj.meeting_key})`);
  return openF1;
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
    raceItems = raceItems.map((item) => ({
      ...item,
      actualPosition: actuals.race.get(item.driver),
    }));
    qualiItems = qualiItems.map((item) => ({
      ...item,
      actualPosition: actuals.quali.get(item.driver),
    }));
  }

  return {
    predictorGp,
    raceItems,
    qualiItems,
  };
}
