import { Driver, Constructor, Race, teamColors, drivers as mockDrivers, constructors as mockConstructors, races as mockRaces } from '../data/mock';
import { supabase, supabaseConfigured } from '../lib/supabase';
const OPENF1_URL = 'https://api.openf1.org/v1';

const WEEKEND_TTL = 5 * 60 * 1000; // 5 minutes
const WEEKDAY_TTL = 24 * 60 * 60 * 1000; // 24 hours

function getCacheTTL() {
  const day = new Date().getDay();
  // 0 = Sunday, 5 = Friday, 6 = Saturday
  const isWeekend = day === 0 || day === 5 || day === 6;
  return isWeekend ? WEEKEND_TTL : WEEKDAY_TTL;
}

interface CacheItem<T> {
  data: T;
  timestamp: number;
}

async function fetchWithCache<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  fallbackData: T,
  ttlMs?: number,
): Promise<T> {
  const ttl = ttlMs ?? getCacheTTL();
  try {
    const cachedString = localStorage.getItem(cacheKey);
    if (cachedString) {
      const cachedData: CacheItem<T> = JSON.parse(cachedString);
      const now = Date.now();
      if (now - cachedData.timestamp < ttl) {
        console.log(`[Cache Hit] Serving ${cacheKey} from localStorage`);
        return cachedData.data;
      }
    }
  } catch (e) {
    console.warn("localStorage error", e);
  }

  try {
    console.log(`[API Hit] Fetching fresh data for ${cacheKey}`);
    const data = await fetcher();
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ data, timestamp: Date.now() }));
    } catch (e) {
      console.warn("localStorage set error", e);
    }
    return data;
  } catch (err) {
    console.error(`[API Error] Failed to fetch ${cacheKey}. Attempting fallback.`, err);
    // Try to serve stale cache ignoring TTL if API is down
    try {
      const cachedString = localStorage.getItem(cacheKey);
      if (cachedString) {
        console.log(`[Cache Fallback] Serving stale ${cacheKey} due to API failure`);
        return JSON.parse(cachedString).data;
      }
    } catch (e) { }

    // Total failure -> serve mock fallback natively
    console.warn(`[Mock Fallback] Serving hardcoded safety net for ${cacheKey}`);
    return fallbackData; // Returns mock data directly into the stream
  }
}

function resolveDriverColor(teamName: string) {
  const norm = teamName.toLowerCase();
  if (norm.includes('red bull') || norm.includes('racing bulls')) return teamColors['Red Bull Racing'] || '#1E5BC6';
  if (norm.includes('mclaren')) return teamColors['McLaren'] || '#FF8000';
  if (norm.includes('ferrari')) return teamColors['Ferrari'] || '#E8002D';
  if (norm.includes('mercedes')) return teamColors['Mercedes'] || '#00B2A9';
  if (norm.includes('aston martin')) return teamColors['Aston Martin'] || '#229971';
  if (norm.includes('alpine')) return teamColors['Alpine'] || '#2293D1';
  if (norm.includes('williams')) return teamColors['Williams'] || '#1868DB';
  if (norm.includes('rb')) return teamColors['RB'] || '#6692FF';
  if (norm.includes('haas')) return teamColors['Haas'] || '#B6BABD';
  if (norm.includes('kick') || norm.includes('sauber')) return teamColors['Kick Sauber'] || '#52E252';
  return '#6b7280';
}

function resolveDriverImage(code: string) {
  return `/drivers/${code}.png`;
}

// ───── Season selection ────────────────────────────────────────────────────
// Pick the most-recent year OpenF1 has data for. OpenF1 currently confirms
// through 2026; if a given season hasn't started yet, we cascade back.

const OPENF1_YEARS = [new Date().getFullYear(), new Date().getFullYear() - 1, 2024]
  .filter((y, i, a) => a.indexOf(y) === i && y >= 2023);

// ───── Calendar ────────────────────────────────────────────────────────────
// Source: OpenF1 /meetings?year=X. Includes meeting_key so the session picker
// can look up sessions by key directly (no fragile name matching).

export async function fetchCalendar(): Promise<Race[]> {
  return fetchWithCache('f1_calendar_openf1_v3', async () => {
    // Try each candidate year until one returns meetings
    for (const year of OPENF1_YEARS) {
      const res = await fetch(`${OPENF1_URL}/meetings?year=${year}`);
      if (!res.ok) continue;
      const meetings = await res.json();
      if (!Array.isArray(meetings) || meetings.length === 0) continue;

      // Drop non-championship entries (pre-season testing, etc.) so they
      // don't show up in the home-page calendar or the Grand Prix picker.
      const championship = meetings.filter((m: any) => {
        const name = (m.meeting_name || '').toLowerCase();
        const official = (m.meeting_official_name || '').toLowerCase();
        if (name.includes('testing') || name.includes('test')) return false;
        if (official.includes('pre-season')) return false;
        return true;
      });
      if (championship.length === 0) continue;

      // Sort by date_start so rounds match the chronological calendar order
      const sorted = [...championship].sort(
        (a, b) => new Date(a.date_start).getTime() - new Date(b.date_start).getTime()
      );

      return sorted.map((m: any, idx: number): Race => {
        const raceDate = new Date(m.date_end || m.date_start);
        const raceEnd = new Date(raceDate.getTime() + 2 * 60 * 60 * 1000);
        const now = new Date();

        let status: 'completed' | 'live' | 'upcoming' | 'cancelled' = 'upcoming';
        if (m.is_cancelled) status = 'cancelled';
        else if (now > raceEnd) status = 'completed';
        else if (now >= new Date(m.date_start) && now <= raceEnd) status = 'live';

        return {
          round: idx + 1,
          name: m.meeting_name,
          location: m.circuit_short_name || m.location,
          country: m.country_name,
          date: raceDate.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }),
          time: raceDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }),
          status,
          meeting_key: m.meeting_key,
          date_iso: raceDate.toISOString(),
        };
      });
    }
    throw new Error('No OpenF1 calendar data available for any year');
  }, mockRaces);
}

// ───── Drivers & Standings ─────────────────────────────────────────────────
// OpenF1 has no aggregated championship endpoint, so standings are computed
// by summing `points` from /session_result across every Race + Sprint in
// the most recent season that actually has completed races.

async function getLatestSessionKey(): Promise<number | null> {
  try {
    for (const year of OPENF1_YEARS) {
      const res = await fetchT(`${OPENF1_URL}/sessions?year=${year}`);
      if (!res.ok) continue;
      const sessions = await res.json();
      if (!Array.isArray(sessions) || sessions.length === 0) continue;
      const latest = sessions.reduce((p: any, c: any) =>
        new Date(c.date_start) > new Date(p.date_start) ? c : p
      );
      return latest.session_key;
    }
  } catch (_) { }
  return null;
}

// Fetch the driver roster for a given session (name, number, team, colour).
// Kept as a low-level helper; championship-aware callers go through
// fetchOpenF1Standings below.
async function fetchDriverRosterForSession(sessionKey: number) {
  const res = await fetchT(`${OPENF1_URL}/drivers?session_key=${sessionKey}`);
  if (!res.ok) throw new Error('Failed to fetch OpenF1 drivers');
  const drivers = await res.json();

  const seen = new Set<number>();
  return (drivers as any[]).filter(d => {
    if (seen.has(d.driver_number)) return false;
    seen.add(d.driver_number);
    return true;
  });
}

// Standings are locked to the 2026 season (active championship). We do not
// cascade to older years — if 2026 has zero completed races we still want
// to show 2026 drivers with zero points rather than silently displaying
// last season's numbers.
const STANDINGS_YEAR = 2026;

async function pickStandingsYear(): Promise<{ year: number; sessions: any[] } | null> {
  try {
    const r = await fetchT(`${OPENF1_URL}/sessions?year=${STANDINGS_YEAR}`);
    if (!r.ok) return null;
    const sessions = await r.json();
    if (!Array.isArray(sessions) || sessions.length === 0) return null;
    return { year: STANDINGS_YEAR, sessions };
  } catch (_) {
    return null;
  }
}

// Returns fully-ranked drivers and constructors for the current season.
async function fetchOpenF1Standings(): Promise<{ drivers: Driver[]; constructors: Constructor[] }> {
  const picked = await pickStandingsYear();
  if (!picked) throw new Error('No OpenF1 season with completed races available');

  // 1. Roster pulled from the latest session so team assignments are current.
  const latestSession = picked.sessions.reduce((p: any, c: any) =>
    new Date(c.date_start) > new Date(p.date_start) ? c : p
  );
  const roster = await fetchDriverRosterForSession(latestSession.session_key);

  // 2. For each Race + Sprint session, fetch the result AND the driver
  //    roster for that specific session. This lets us credit constructor
  //    points to the team a driver was driving for at the time of the
  //    race, not the team they're on today.
  const raceSessions = picked.sessions.filter((s: any) =>
    s.session_name === 'Race' || s.session_name === 'Sprint'
  );

  if (raceSessions.length === 0) {
    throw new Error('No scoring sessions for standings');
  }

  // Bulk fetch (~2 requests) instead of 2× per session (was 60+ calls, very slow).
  const keysParam = raceSessions.map((s: any) => `session_key=${s.session_key}`).join('&');
  const [rRes, rDrv] = await Promise.all([
    fetchT(`${OPENF1_URL}/session_result?${keysParam}`, 20000),
    fetchT(`${OPENF1_URL}/drivers?${keysParam}`, 20000),
  ]);

  const results: any[] = rRes.ok ? await rRes.json() : [];
  const rosterRaw: any[] = rDrv.ok ? await rDrv.json() : [];

  const rosterBySession = new Map<number, Map<number, any>>();
  for (const r of rosterRaw) {
    const sk = r.session_key as number;
    if (!rosterBySession.has(sk)) rosterBySession.set(sk, new Map());
    const sessionMap = rosterBySession.get(sk)!;
    if (!sessionMap.has(r.driver_number)) sessionMap.set(r.driver_number, r);
  }

  const pointsByDriver = new Map<number, number>();
  const pointsByTeam = new Map<string, { points: number; color: string }>();

  for (const row of results) {
    if (!row || typeof row.driver_number !== 'number') continue;
    const pts = typeof row.points === 'number' ? row.points : 0;

    pointsByDriver.set(
      row.driver_number,
      (pointsByDriver.get(row.driver_number) || 0) + pts
    );

    const sessionRoster = rosterBySession.get(row.session_key);
    const drv = sessionRoster?.get(row.driver_number);
    const team = drv?.team_name;
    if (team) {
      const color = drv.team_colour
        ? `#${drv.team_colour}`
        : resolveDriverColor(team);
      const ex = pointsByTeam.get(team) || { points: 0, color };
      ex.points += pts;
      pointsByTeam.set(team, ex);
    }
  }

  // 3. Build Driver objects with real points, sort desc, reassign pos.
  const drivers: Driver[] = roster
    .map((d: any): Driver => ({
      pos: 0,
      name: d.full_name || `${d.first_name} ${d.last_name}`,
      team: d.team_name || 'Unknown',
      points: pointsByDriver.get(d.driver_number) || 0,
      image: resolveDriverImage(d.name_acronym),
      abbr: d.name_acronym,
      number: d.driver_number,
      color: d.team_colour ? `#${d.team_colour}` : resolveDriverColor(d.team_name || ''),
    }))
    .sort((a, b) => b.points - a.points)
    .map((d, i) => ({ ...d, pos: i + 1 }));

  // 4. Constructors: ranked by points summed PER-SESSION from the driver
  //    lineup at that race, so mid-season swaps are credited correctly.
  const constructors: Constructor[] = Array.from(pointsByTeam.entries())
    .map(([name, v]) => ({ pos: 0, name, points: v.points, color: v.color }))
    .sort((a, b) => b.points - a.points)
    .map((c, i) => ({ ...c, pos: i + 1 }));

  return { drivers, constructors };
}

// Home/Grid load drivers + constructors in parallel — share one OpenF1 fetch.
let openF1StandingsInflight: ReturnType<typeof fetchOpenF1Standings> | null = null;

function getOpenF1StandingsShared() {
  if (!openF1StandingsInflight) {
    openF1StandingsInflight = fetchOpenF1Standings().finally(() => {
      openF1StandingsInflight = null;
    });
  }
  return openF1StandingsInflight;
}

const DRIVER_NUMBERS: Record<string, number> = {
  NOR: 1, VER: 3, BOR: 5, HAD: 6, GAS: 10, PER: 11, ANT: 12, ALO: 14,
  LEC: 16, STR: 18, ALB: 23, HUL: 27, LAW: 30, OCO: 31, LIN: 41, COL: 43,
  HAM: 44, SAI: 55, RUS: 63, BOT: 77, PIA: 81, BEA: 87
};

function mapSupabaseDrivers(rows: any[]): Driver[] {
  return rows.map((d: any) => {
    const abbr = d.driver.split(' ').pop().substring(0, 3).toUpperCase();
    return {
      pos: d.position,
      name: d.driver,
      team: d.team || 'Unknown',
      points: d.points,
      image: resolveDriverImage(abbr),
      abbr,
      number: DRIVER_NUMBERS[abbr] || 0,
      color: resolveDriverColor(d.team || ''),
    };
  });
}

function mapSupabaseConstructors(rows: any[]): Constructor[] {
  return rows.map((c: any) => ({
    pos: c.position,
    name: c.team,
    points: c.points,
    color: resolveDriverColor(c.team),
  }));
}

async function fetchDriversFromSupabase(): Promise<Driver[] | null> {
  if (!supabaseConfigured) return null;
  const { data, error } = await supabase
    .from('vw_driver_standings')
    .select('*')
    .order('position', { ascending: true });
  if (error || !data?.length) {
    if (error) console.warn('[Standings] Supabase drivers:', error.message);
    return null;
  }
  return mapSupabaseDrivers(data);
}

async function fetchConstructorsFromSupabase(): Promise<Constructor[] | null> {
  if (!supabaseConfigured) return null;
  const { data, error } = await supabase
    .from('vw_constructor_standings')
    .select('*')
    .order('position', { ascending: true });
  if (error || !data?.length) {
    if (error) console.warn('[Standings] Supabase constructors:', error.message);
    return null;
  }
  return mapSupabaseConstructors(data);
}

const STANDINGS_CACHE_TTL = 10 * 60 * 1000; // 10 min — avoid stale points for days

function isDbStandingsStale(db: Driver[], live: Driver[]): boolean {
  if (!db.length || !live.length) return false;
  return (live[0]?.points ?? 0) > (db[0]?.points ?? 0);
}

async function fetchChampionshipStandings(): Promise<{
  drivers: Driver[];
  constructors: Constructor[];
}> {
  return fetchWithCache(
    'f1_championship_standings_v7',
    async () => {
      const [fromDbDrivers, fromDbConstructors, live] = await Promise.all([
        fetchDriversFromSupabase(),
        fetchConstructorsFromSupabase(),
        getOpenF1StandingsShared().catch((e) => {
          console.warn('[Standings] OpenF1 fetch failed:', e);
          return null;
        }),
      ]);

      const liveDrivers = live?.drivers ?? [];
      const liveConstructors = live?.constructors ?? [];

      if (
        liveDrivers.length &&
        (!fromDbDrivers?.length || isDbStandingsStale(fromDbDrivers, liveDrivers))
      ) {
        return { drivers: liveDrivers, constructors: liveConstructors };
      }

      if (fromDbDrivers?.length && fromDbConstructors?.length) {
        return { drivers: fromDbDrivers, constructors: fromDbConstructors };
      }

      if (liveDrivers.length) {
        return { drivers: liveDrivers, constructors: liveConstructors };
      }

      throw new Error('No championship standings available');
    },
    { drivers: mockDrivers, constructors: mockConstructors.map(c => ({ ...c, color: resolveDriverColor(c.name) })) },
    STANDINGS_CACHE_TTL,
  );
}

export async function fetchAllDrivers(): Promise<Driver[]> {
  const { drivers } = await fetchChampionshipStandings();
  return drivers;
}

export async function fetchDriversChampionship(): Promise<Driver[]> {
  const drivers = await fetchAllDrivers();
  return drivers.slice(0, 3);
}

export async function fetchAllConstructors(): Promise<Constructor[]> {
  const { constructors } = await fetchChampionshipStandings();
  return constructors;
}

export async function fetchConstructorsChampionship(): Promise<Constructor[]> {
  const constructors = await fetchAllConstructors();
  return constructors.slice(0, 3);
}

// ----- OPENF1 TELEMETRY API -----
export interface OpenF1Session {
  session_key: number;
  session_name: string;
  date_start: string;
  date_end: string;
  meeting_key: number;
}

// Wraps fetch with an AbortController timeout so requests never hang indefinitely.
export async function fetchT(url: string, timeoutMs = 9000): Promise<Response> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(tid);
  }
}

export async function fetchOpenF1Sessions(meetingKey: number): Promise<{ meeting: any; sessions: OpenF1Session[] }> {
  if (!meetingKey) return { meeting: null, sessions: [] };

  const cacheKey = `f1_sessions_mk_${meetingKey}`;

  // Serve from cache — sessions are historical and don't change.
  try {
    const hit = localStorage.getItem(cacheKey);
    if (hit) {
      const { data, timestamp } = JSON.parse(hit);
      if (Date.now() - timestamp < WEEKDAY_TTL) {
        console.log(`[Cache Hit] Sessions for meeting ${meetingKey}`);
        return data;
      }
    }
  } catch (_) { }

  try {
    const resS = await fetchT(`${OPENF1_URL}/sessions?meeting_key=${meetingKey}`);
    if (!resS.ok) return { meeting: null, sessions: [] };
    const sessions = await resS.json();
    if (!Array.isArray(sessions) || sessions.length === 0) {
      return { meeting: null, sessions: [] };
    }

    const result = { meeting: { meeting_key: meetingKey }, sessions };

    try {
      localStorage.setItem(cacheKey, JSON.stringify({ data: result, timestamp: Date.now() }));
    } catch (_) { }

    return result;
  } catch (_) {
    return { meeting: null, sessions: [] };
  }
}

export async function fetchFastestLapTelemetry(sessionKey: number, driverNumber: number) {
  const cacheKey = `f1_tely_${sessionKey}_${driverNumber}`;

  // Serve from cache when fresh (use weekday TTL — telemetry is historical)
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < WEEKDAY_TTL) {
        console.log(`[Cache Hit] Telemetry ${cacheKey}`);
        return data;
      }
    }
  } catch (_) { }

  try {
    const resL = await fetchT(`${OPENF1_URL}/laps?session_key=${sessionKey}&driver_number=${driverNumber}`);
    if (!resL.ok) return null;
    const laps = await resL.json();
    if (!Array.isArray(laps) || laps.length === 0) return null;

    // Filter to laps that actually have a recorded duration and start time,
    // then pick the fastest — avoids seeding reduce with an invalid lap.
    const validLaps = laps.filter((l: any) => l.lap_duration && l.date_start);
    if (validLaps.length === 0) return null;
    const fastestLap = validLaps.reduce((prev: any, curr: any) =>
      curr.lap_duration < prev.lap_duration ? curr : prev
    );

    const start = new Date(fastestLap.date_start).toISOString();
    const end = new Date(new Date(fastestLap.date_start).getTime() + fastestLap.lap_duration * 1000).toISOString();

    const [resCar, resLoc] = await Promise.all([
      fetchT(`${OPENF1_URL}/car_data?session_key=${sessionKey}&driver_number=${driverNumber}&date>=${start}&date<=${end}`),
      fetchT(`${OPENF1_URL}/location?session_key=${sessionKey}&driver_number=${driverNumber}&date>=${start}&date<=${end}`)
    ]);

    if (!resCar.ok) return null;

    const carData = await resCar.json();
    if (!Array.isArray(carData) || carData.length === 0) return null;

    // Location data is optional — track map will be hidden if unavailable.
    const locData = resLoc.ok ? await resLoc.json() : [];

    const result = {
      lap: fastestLap,
      carData,
      locData: Array.isArray(locData) ? locData : []
    };

    try {
      localStorage.setItem(cacheKey, JSON.stringify({ data: result, timestamp: Date.now() }));
    } catch (_) { }

    return result;
  } catch (e) {
    console.warn(`[API Error] Failed to resolve fastest lap telemetry for driver ${driverNumber}`);
    return null;
  }
}
