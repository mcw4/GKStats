'use strict';

/* ==========================================================================
   Pure functions (no DOM, no storage) — easy to test in the console or Node
   ========================================================================== */

const STORAGE_KEY = 'keeper-log-v1';
const PREFS_KEY = 'keeper-log-prefs-v1';
const EVENT_TYPES = ['save', 'goal', 'distGood', 'distBad', 'crossClaimed'];
const EVENT_NAMES = {
  save: 'Save',
  goal: 'Goal',
  distGood: 'Good dist.',
  distBad: 'Bad dist.',
  crossClaimed: 'Cross claimed',
};
const GOAL_PROMPT_MS = 5000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad2(n) {
  return String(n).padStart(2, '0');
}

// Seconds -> "mm:ss" (minutes keep counting past 59).
function formatClock(seconds) {
  const s = Math.max(0, Math.floor(seconds || 0));
  return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60);
}

// Whole seconds on the match clock at time `now` (epoch ms).
function clockSeconds(match, now) {
  const c = match.clock || { elapsed: 0, runningSince: null };
  let e = c.elapsed || 0;
  if (c.runningSince != null) e += (now - c.runningSince) / 1000;
  return Math.max(0, Math.floor(e));
}

function pct(n, d) {
  return d > 0 ? Math.round((n / d) * 100) : null;
}

function round1(x) {
  return Math.round(x * 10) / 10;
}

function stats(match) {
  const c = { save: 0, goal: 0, distGood: 0, distBad: 0, crossClaimed: 0 };
  let savableGoals = 0;
  for (const e of match.events) {
    c[e.type]++;
    if (e.type === 'goal' && e.savable === true) savableGoals++;
  }
  const shotsOnTarget = c.save + c.goal;
  return {
    saves: c.save,
    goals: c.goal,
    savableGoals,
    shotsOnTarget,
    savePct: pct(c.save, shotsOnTarget),
    distGood: c.distGood,
    distBad: c.distBad,
    distPct: pct(c.distGood, c.distGood + c.distBad),
    crossesClaimed: c.crossClaimed,
    cleanSheet: c.goal === 0,
  };
}

function fmtPct(v) {
  return v == null ? '–' : v + '%';
}

function todayLocal(d) {
  d = d || new Date();
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}

function parseDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// "Sat 18 Oct 2026"
function formatLongDate(iso) {
  const d = parseDate(iso);
  return DAYS[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear();
}

// "12 Oct"
function formatShortDate(iso) {
  const d = parseDate(iso);
  return d.getDate() + ' ' + MONTHS[d.getMonth()];
}

function newestFirst(a, b) {
  return a.date === b.date ? b.createdAt - a.createdAt : (a.date < b.date ? 1 : -1);
}

function oldestFirst(a, b) {
  return -newestFirst(a, b);
}

const isNum = (x) => typeof x === 'number' && isFinite(x);

// Checks a list of matches. Returns cleaned copies, or null if anything is wrong.
// Older data without a clock gets one: the last event's time, paused.
function validateMatches(list) {
  if (!Array.isArray(list)) return null;
  const ids = new Set();
  const out = [];
  for (const m of list) {
    if (!m || typeof m !== 'object') return null;
    if (typeof m.id !== 'string' || !m.id || ids.has(m.id)) return null;
    ids.add(m.id);
    if (typeof m.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(m.date)) return null;
    if (typeof m.opponent !== 'string') return null;
    if (m.finished !== undefined && typeof m.finished !== 'boolean') return null;
    if (m.createdAt !== undefined && !isNum(m.createdAt)) return null;
    if (!Array.isArray(m.events)) return null;
    const events = [];
    for (const e of m.events) {
      if (!e || typeof e !== 'object') return null;
      if (!EVENT_TYPES.includes(e.type) || !isNum(e.t)) return null;
      const ev = { type: e.type, t: e.t };
      if ('savable' in e) {
        if (e.savable !== true && e.savable !== false && e.savable !== null) return null;
        ev.savable = e.savable;
      }
      events.push(ev);
    }
    let clock;
    if (m.clock === undefined) {
      clock = { elapsed: events.reduce((max, e) => Math.max(max, e.t), 0), runningSince: null };
    } else {
      const c = m.clock;
      if (!c || typeof c !== 'object' || !isNum(c.elapsed) || c.elapsed < 0) return null;
      if (c.runningSince !== null && !isNum(c.runningSince)) return null;
      clock = { elapsed: c.elapsed, runningSince: c.runningSince };
    }
    out.push({
      id: m.id,
      date: m.date,
      opponent: m.opponent,
      createdAt: m.createdAt !== undefined ? m.createdAt : parseDate(m.date).getTime(),
      finished: m.finished === true,
      clock,
      events,
    });
  }
  return out;
}

function validateBackup(data) {
  if (!data || typeof data !== 'object' || data.app !== 'keeper-log') return { ok: false };
  const matches = validateMatches(data.matches);
  return matches ? { ok: true, matches } : { ok: false };
}

/* ---------- Progress ---------- */

const STAT_DEFS = {
  save: { label: 'Save %', chart: 'SAVE % BY MATCH', pct: true, lowerBetter: false },
  conceded: { label: 'Conceded / match', chart: 'CONCEDED BY MATCH', pct: false, lowerBetter: true },
  dist: { label: 'Distribution', chart: 'DISTRIBUTION % BY MATCH', pct: true, lowerBetter: false },
  crosses: { label: 'Crosses / match', chart: 'CROSSES CLAIMED BY MATCH', pct: false, lowerBetter: false },
};
const STAT_KEYS = Object.keys(STAT_DEFS);

function totals(matches) {
  const t = { n: matches.length, saves: 0, goals: 0, distGood: 0, distBad: 0, crosses: 0, cleanSheets: 0 };
  for (const m of matches) {
    const s = stats(m);
    t.saves += s.saves;
    t.goals += s.goals;
    t.distGood += s.distGood;
    t.distBad += s.distBad;
    t.crosses += s.crossesClaimed;
    if (s.cleanSheet) t.cleanSheets++;
  }
  return t;
}

// Value for a stat across a period: totals over the period, never an average of percentages.
function periodValue(key, t) {
  switch (key) {
    case 'save': return pct(t.saves, t.saves + t.goals);
    case 'conceded': return t.n ? round1(t.goals / t.n) : null;
    case 'dist': return pct(t.distGood, t.distGood + t.distBad);
    case 'crosses': return t.n ? round1(t.crosses / t.n) : null;
  }
  return null;
}

// Value for a stat in one match (null = no data).
function matchValue(key, match) {
  const s = stats(match);
  switch (key) {
    case 'save': return s.savePct;
    case 'conceded': return s.goals;
    case 'dist': return s.distPct;
    case 'crosses': return s.crossesClaimed;
  }
  return null;
}

function formatStat(key, v) {
  if (v == null) return '–';
  return STAT_DEFS[key].pct ? v + '%' : v.toFixed(1);
}

// Comparison against the previous 5. tone: "good" (green) or "muted" — never red.
function compareText(key, cur, prev) {
  if (cur == null || prev == null) return { text: 'Not enough data to compare', tone: 'muted' };
  const def = STAT_DEFS[key];
  const diff = def.pct ? cur - prev : round1(cur - prev);
  if (diff === 0) return { text: 'Same as previous 5', tone: 'muted' };
  const size = def.pct ? Math.abs(diff) + ' pts' : Math.abs(diff).toFixed(1);
  const better = def.lowerBetter ? diff < 0 : diff > 0;
  return { text: (diff > 0 ? '▲ ' : '▼ ') + size + ' vs previous 5', tone: better ? 'good' : 'muted' };
}

// Everything the Progress screen shows, from all matches.
function progress(allMatches, range) {
  const finished = allMatches.filter((m) => m.finished).sort(oldestFirst);
  const inRange = range === 'last5' ? finished.slice(-5) : finished;
  const prev = range === 'last5' ? finished.slice(-10, -5) : [];
  const cur = totals(inRange);
  const before = totals(prev);
  const tiles = {};
  for (const key of STAT_KEYS) {
    const value = periodValue(key, cur);
    let compare;
    if (range === 'season') compare = { text: 'Across ' + cur.n + ' match' + (cur.n === 1 ? '' : 'es'), tone: 'muted' };
    else if (finished.length < 10) compare = { text: 'Need 10 matches to compare', tone: 'muted' };
    else compare = compareText(key, value, periodValue(key, before));
    tiles[key] = { value, compare };
  }
  return { finished, matches: inRange, cleanSheets: cur.cleanSheets, tiles };
}

// Bars for the chart. Best match(es) flagged; percentages scale to 100.
function chartBars(key, matches) {
  const def = STAT_DEFS[key];
  const values = matches.map((m) => matchValue(key, m));
  const present = values.filter((v) => v != null);
  const best = present.length ? (def.lowerBetter ? Math.min(...present) : Math.max(...present)) : null;
  const max = def.pct ? 100 : Math.max(1, ...present);
  return matches.map((m, i) => {
    const v = values[i];
    return {
      id: m.id,
      value: v,
      height: v == null ? 0 : Math.max(4, (v / max) * 150),
      best: v != null && v === best,
      date: formatShortDate(m.date),
      opp: (m.opponent.trim().split(/\s+/)[0] || ''),
    };
  });
}

/* ---------- Demo data ---------- */

function demoMatches() {
  // Small seeded random so the demo is the same every time.
  let seed = 20261018;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
  const opponents = ['Riverside Rovers', 'Hilltop Colts', 'Ashford Juniors', 'Meadow Park', 'St Mary\'s Youth',
    'Northgate Athletic', 'Oakwood United', 'Kingsley Town', 'Brookside Lions', 'Westfield Wanderers'];
  const first = new Date(2026, 7, 15); // Sat 15 Aug 2026
  return opponents.map((opponent, i) => {
    const d = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i * 7);
    const length = 50 * 60;
    const events = [];
    const add = (type, count) => {
      for (let k = 0; k < count; k++) {
        const e = { type, t: between(20, length - 20) };
        if (type === 'goal') e.savable = [true, false, false, null][between(0, 3)];
        events.push(e);
      }
    };
    // Keeper gets gradually better through the season.
    add('save', between(2, 5) + Math.floor(i / 3));
    add('goal', Math.max(0, between(0, 4) - Math.floor(i / 4)));
    add('distGood', between(5, 9) + Math.floor(i / 2));
    add('distBad', between(1, 5));
    add('crossClaimed', between(0, 3));
    events.sort((a, b) => a.t - b.t);
    return {
      id: 'demo-' + (i + 1),
      date: todayLocal(d),
      opponent,
      createdAt: d.getTime() + 10 * 3600 * 1000,
      finished: true,
      clock: { elapsed: length, runningSince: null },
      events,
    };
  });
}

/* ==========================================================================
   App (DOM)
   ========================================================================== */

if (typeof document !== 'undefined') {
  const app = document.getElementById('app');

  const state = {
    matches: [],
    storageOk: true,
    screen: 'home', // home | live | summary | settings | progress
    matchId: null,
    sheet: null, // {kind:'new'} | {kind:'goal', openedAt} | {kind:'delete'} | {kind:'replace', matches, source}
    notice: null,
    prefs: { stat: 'save', range: 'last5' },
  };

  /* ---------- Storage ---------- */

  function load() {
    try {
      localStorage.setItem(STORAGE_KEY + '-test', '1');
      localStorage.removeItem(STORAGE_KEY + '-test');
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const matches = validateMatches(parsed && parsed.matches);
        if (matches) state.matches = matches;
        else state.storageOk = false; // Don't overwrite data we can't read.
      }
    } catch (err) {
      state.storageOk = false;
    }
    try {
      const p = JSON.parse(localStorage.getItem(PREFS_KEY) || 'null');
      if (p && STAT_KEYS.includes(p.stat)) state.prefs.stat = p.stat;
      if (p && (p.range === 'last5' || p.range === 'season')) state.prefs.range = p.range;
    } catch (err) { /* defaults are fine */ }
  }

  function save() {
    if (!state.storageOk) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ matches: state.matches }));
    } catch (err) {
      state.storageOk = false;
    }
  }

  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); } catch (err) { /* not important */ }
  }

  /* ---------- Helpers ---------- */

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const current = () => state.matches.find((m) => m.id === state.matchId) || null;
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : (many || one + 's'));

  function buzz(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (err) { /* ignore */ }
  }

  function go(screen, matchId) {
    state.screen = screen;
    if (matchId !== undefined) state.matchId = matchId;
    state.sheet = null;
    state.notice = null;
    render();
    window.scrollTo(0, 0);
  }

  function pauseClock(m) {
    if (m.clock.runningSince != null) {
      m.clock.elapsed += (Date.now() - m.clock.runningSince) / 1000;
      m.clock.runningSince = null;
    }
  }

  /* ---------- Screens ---------- */

  function screenHome() {
    const list = state.matches.slice().sort(newestFirst);
    const now = Date.now();
    const rows = list.map((m) => {
      const s = stats(m);
      const d = parseDate(m.date);
      const date = `<span class="mr-date"><span class="mr-day">${d.getDate()}</span><span class="mr-mon">${MONTHS[d.getMonth()]}</span></span>`;
      if (!m.finished) {
        return `<li><button class="match-row is-live" data-action="open-match" data-id="${esc(m.id)}">
          ${date}
          <span class="mr-main"><span class="mr-opp">${esc(m.opponent)}</span>
            <span class="mr-sub">In play · <span data-clock="${esc(m.id)}">${formatClock(clockSeconds(m, now))}</span></span></span>
          <span class="mr-stat"><span class="live-badge">Live</span></span>
        </button></li>`;
      }
      return `<li><button class="match-row" data-action="open-match" data-id="${esc(m.id)}">
        ${date}
        <span class="mr-main"><span class="mr-opp">${esc(m.opponent)}</span>
          <span class="mr-sub">${plural(s.saves, 'save')} · ${s.goals} conceded</span></span>
        <span class="mr-stat"><span class="mr-num">${fmtPct(s.savePct)}</span><span class="mr-lab">Save %</span></span>
      </button></li>`;
    }).join('');
    return `<div class="screen">
      <header class="topbar">
        <span class="wordmark">Keeper Log</span>
        <nav class="topnav">
          <button class="textbtn" data-action="go" data-to="progress">Progress</button>
          <button class="textbtn" data-action="go" data-to="settings">Settings</button>
        </nav>
      </header>
      <main class="content">
        <h1 class="title">Matches</h1>
        ${rows ? `<ul class="match-list">${rows}</ul>` : `<p class="empty">No matches yet. Tap New match at kick-off.</p>`}
      </main>
      <footer class="dock">
        <button class="btn btn-ink btn-primary" data-action="new-match">+ New match</button>
      </footer>
    </div>`;
  }

  function screenLive(m) {
    const now = Date.now();
    const s = stats(m);
    const running = m.clock.runningSince != null;
    const clockLabel = running ? 'Pause' : (m.clock.elapsed > 0 ? 'Resume' : 'Start');
    const last = m.events[m.events.length - 1];
    const undoSub = last ? `${EVENT_NAMES[last.type]} · ${formatClock(last.t)}` : 'Nothing to undo';
    const count = { save: s.saves, goal: s.goals, distGood: s.distGood, distBad: s.distBad, crossClaimed: s.crossesClaimed };
    return `<div class="screen live">
      <header class="live-head">
        <button class="iconbtn" data-action="go" data-to="home" aria-label="Back to matches">‹</button>
        <div class="live-title"><span class="eyebrow">Live vs</span><span class="live-opp">${esc(m.opponent)}</span></div>
        <button class="clock${running ? ' is-running' : ''}" data-action="clock" aria-label="Match clock, ${clockLabel}">
          <span class="clock-time" data-clock="${esc(m.id)}">${formatClock(clockSeconds(m, now))}</span>
          <span class="clock-lab">${clockLabel}</span>
        </button>
      </header>
      <p class="rule-strip">Only count a save if the shot would have gone in without the keeper.</p>
      <div class="log-grid">
        <button class="log log-fill log-save" data-action="log" data-type="save">
          <span class="log-label">Save</span><span class="log-count">${count.save}</span></button>
        <button class="log log-fill log-goal" data-action="log" data-type="goal">
          <span class="log-label">Goal conceded</span><span class="log-count">${count.goal}</span></button>
        <button class="log log-line" data-action="log" data-type="distGood">
          <span class="log-label"><span class="glyph">✓</span>Good dist.</span><span class="log-count">${count.distGood}</span></button>
        <button class="log log-line" data-action="log" data-type="distBad">
          <span class="log-label"><span class="glyph">✗</span>Bad dist.</span><span class="log-count">${count.distBad}</span></button>
        <button class="log log-line log-wide" data-action="log" data-type="crossClaimed">
          <span class="log-label">Cross claimed</span><span class="log-count">${count.crossClaimed}</span></button>
      </div>
      <div class="live-foot">
        <button class="btn btn-line btn-primary undo${last ? '' : ' is-empty'}" data-action="undo"${last ? '' : ' aria-disabled="true"'}>
          <span>↶ Undo</span><span class="btn-sub">${undoSub}</span></button>
        <button class="btn btn-ink btn-primary" data-action="finish">Finish match</button>
      </div>
    </div>`;
  }

  function screenSummary(m) {
    const s = stats(m);
    const tile = (label, value, sub) => `<div class="tile"><span class="tile-lab">${label}</span>
      <span class="tile-num">${value}</span>${sub ? `<span class="tile-sub">${sub}</span>` : ''}</div>`;
    return `<div class="screen">
      <header class="topbar"><button class="textbtn back" data-action="go" data-to="home">‹ Matches</button></header>
      <main class="content">
        <p class="eyebrow">${formatLongDate(m.date)}</p>
        <h1 class="title vs">vs ${esc(m.opponent)}</h1>
        <section class="hero">
          <div class="hero-text"><span class="hero-lab">Save %</span>
            <span class="hero-sub">${plural(s.saves, 'save')} from ${plural(s.shotsOnTarget, 'shot')} on target</span></div>
          <span class="hero-num">${fmtPct(s.savePct)}</span>
        </section>
        <div class="tiles">
          ${tile('Saves', s.saves, 'from ' + s.shotsOnTarget + ' on target')}
          ${tile('Conceded', s.goals, s.savableGoals + ' could have saved')}
          ${tile('Distribution', fmtPct(s.distPct), s.distGood + ' of ' + (s.distGood + s.distBad) + ' good')}
          ${tile('Crosses claimed', s.crossesClaimed, '')}
        </div>
        <div class="cs-row"><span>Clean sheet</span><strong class="${s.cleanSheet ? 'is-yes' : ''}">${s.cleanSheet ? 'Yes' : 'No'}</strong></div>
        ${m.finished ? '' : `<button class="btn btn-ink btn-primary" data-action="open-live">Resume match</button>`}
        <button class="btn btn-danger-line" data-action="ask-delete">Delete match</button>
      </main>
    </div>`;
  }

  function screenSettings() {
    const n = state.matches.length;
    const note = state.storageOk
      ? `<p class="note">Your ${plural(n, 'match', 'matches')} ${n === 1 ? 'is' : 'are'} saved on this phone only. Download a backup every few weeks, or before changing phones.</p>`
      : `<p class="note is-warning" role="alert"><strong>Storage isn't working on this phone.</strong> Matches will be lost when you close the app. Download a backup before you close it. Private browsing can cause this.</p>`;
    return `<div class="screen">
      <header class="topbar"><button class="textbtn back" data-action="go" data-to="home">‹ Matches</button></header>
      <main class="content">
        <h1 class="title">Settings</h1>
        ${note}
        ${state.notice ? `<p class="note is-warning" role="alert">${esc(state.notice)}</p>` : ''}
        <div class="stack">
          <button class="btn btn-ink btn-primary" data-action="download">Download backup</button>
          <label class="btn btn-line btn-primary file-btn">Restore from backup
            <input type="file" accept="application/json,.json" data-change="restore" hidden></label>
        </div>
        <button class="demo-btn" data-action="ask-demo">Load demo data</button>
      </main>
    </div>`;
  }

  function screenProgress() {
    const { stat, range } = state.prefs;
    const p = progress(state.matches, range);
    const seg = (val, label) => `<button class="seg-btn${range === val ? ' is-on' : ''}" data-action="range" data-range="${val}" aria-pressed="${range === val}">${label}</button>`;
    let body;
    if (!p.finished.length) {
      body = `<p class="empty">Finish a match to start seeing progress.</p>`;
    } else {
      const tiles = STAT_KEYS.map((key) => {
        const t = p.tiles[key];
        return `<button class="ptile${stat === key ? ' is-on' : ''}" data-action="stat" data-stat="${key}" aria-pressed="${stat === key}">
          <span class="tile-lab">${STAT_DEFS[key].label}</span>
          <span class="ptile-num">${formatStat(key, t.value)}</span>
          <span class="ptile-cmp tone-${t.compare.tone}">${t.compare.text}</span></button>`;
      }).join('');
      const bars = chartBars(stat, p.matches);
      const showLabels = bars.length <= 10;
      const def = STAT_DEFS[stat];
      const barHtml = bars.map((b) => `<div class="bar-col">
          <span class="bar-val">${b.value == null ? '–' : b.value}</span>
          ${b.value == null ? '' : `<span class="bar${b.best ? ' is-best' : ''}" style="height:${b.height.toFixed(1)}px"></span>`}
        </div>`).join('');
      const labelHtml = showLabels ? `<div class="bar-labels">${bars.map((b) => `<div class="bar-lab"><span>${b.date}</span><span>${esc(b.opp)}</span></div>`).join('')}</div>` : '';
      body = `<p class="meta">${plural(p.matches.length, 'match', 'matches')} · ${plural(p.cleanSheets, 'clean sheet')}</p>
        <div class="ptiles">${tiles}</div>
        <section class="chart-card">
          <h2 class="chart-title">${def.chart}</h2>
          <p class="chart-hint">${def.lowerBetter ? 'Lower is better · green bar = best' : 'Green bar = best'}</p>
          <div class="bars">${barHtml}</div>
          ${labelHtml}
        </section>`;
    }
    return `<div class="screen">
      <header class="topbar"><button class="textbtn back" data-action="go" data-to="home">‹ Matches</button></header>
      <main class="content">
        <h1 class="title">Progress</h1>
        <div class="seg" role="group" aria-label="Range">${seg('last5', 'Last 5')}${seg('season', 'Season')}</div>
        ${body}
      </main>
    </div>`;
  }

  /* ---------- Sheets ---------- */

  function sheetHtml() {
    const sh = state.sheet;
    if (!sh) return '';
    if (sh.kind === 'new') {
      return `<div class="overlay" data-action="close-sheet"></div>
        <form class="sheet" data-form="new-match" aria-label="New match">
          <h2 class="sheet-title">New match</h2>
          <label class="field"><span class="field-lab">Opponent</span>
            <input name="opponent" type="text" autocomplete="off" autocapitalize="words" placeholder="e.g. Riverside Rovers" maxlength="60"></label>
          <label class="field"><span class="field-lab">Date</span>
            <input name="date" type="date" value="${todayLocal()}" required></label>
          <button type="submit" class="btn btn-ink btn-primary">Start match</button>
          <button type="button" class="btn btn-line" data-action="close-sheet">Cancel</button>
        </form>`;
    }
    if (sh.kind === 'goal') {
      const m = current();
      const goal = m.events[m.events.length - 1];
      const left = Math.max(1, Math.ceil((GOAL_PROMPT_MS - (Date.now() - sh.openedAt)) / 1000));
      return `<div class="overlay is-dim" data-action="goal-skip"></div>
        <div class="sheet" role="dialog" aria-label="Could they have saved it?">
          <div class="sheet-row">
            <span class="sheet-meta">Goal logged · ${formatClock(goal.t)}</span>
            <button class="btn btn-line btn-small" data-action="undo">↶ Undo goal</button>
          </div>
          <h2 class="sheet-title">Could they have saved it?</h2>
          <div class="pair">
            <button class="btn btn-line btn-primary" data-action="goal-answer" data-value="yes">Yes</button>
            <button class="btn btn-line btn-primary" data-action="goal-answer" data-value="no">No</button>
          </div>
          <button class="btn btn-ink btn-skip" data-action="goal-skip">
            <span>Skip</span><span class="btn-sub" data-countdown>Auto-skips in ${left}s</span></button>
        </div>`;
    }
    if (sh.kind === 'delete') {
      return `<div class="overlay is-dim" data-action="close-sheet"></div>
        <div class="sheet" role="dialog" aria-label="Delete match">
          <h2 class="sheet-title">Delete this match?</h2>
          <p class="sheet-text">This can't be undone.</p>
          <button class="btn btn-danger btn-primary" data-action="delete">Delete</button>
          <button class="btn btn-line" data-action="close-sheet">Cancel</button>
        </div>`;
    }
    if (sh.kind === 'replace') {
      const n = state.matches.length;
      const from = sh.source === 'demo' ? plural(sh.matches.length, 'demo match', 'demo matches') : sh.matches.length + ' from the backup';
      return `<div class="overlay is-dim" data-action="close-sheet"></div>
        <div class="sheet" role="dialog" aria-label="Replace matches">
          <h2 class="sheet-title">Replace matches?</h2>
          <p class="sheet-text">This replaces the ${plural(n, 'match', 'matches')} on this phone with ${from}.</p>
          <button class="btn btn-ink btn-primary" data-action="replace">Replace</button>
          <button class="btn btn-line" data-action="close-sheet">Cancel</button>
        </div>`;
    }
    return '';
  }

  /* ---------- Render ---------- */

  function render() {
    let m = current();
    if ((state.screen === 'live' || state.screen === 'summary') && !m) state.screen = 'home';
    if (state.screen === 'live' && m.finished) state.screen = 'summary';
    let html;
    switch (state.screen) {
      case 'live': html = screenLive(m); break;
      case 'summary': html = screenSummary(m); break;
      case 'settings': html = screenSettings(); break;
      case 'progress': html = screenProgress(); break;
      default: html = screenHome();
    }
    app.innerHTML = html + sheetHtml();
    document.body.classList.toggle('is-live', state.screen === 'live');
    syncTimer();
  }

  /* ---------- Timer: only while a clock runs or the goal prompt is open ---------- */

  let timer = null;

  function syncTimer() {
    const anyRunning = (state.screen === 'live' || state.screen === 'home') &&
      state.matches.some((m) => !m.finished && m.clock.runningSince != null);
    const need = anyRunning || (state.sheet && state.sheet.kind === 'goal');
    if (need && !timer) timer = setInterval(tick, 250);
    if (!need && timer) { clearInterval(timer); timer = null; }
  }

  function tick() {
    const now = Date.now();
    const sh = state.sheet;
    if (sh && sh.kind === 'goal') {
      if (now - sh.openedAt >= GOAL_PROMPT_MS) { state.sheet = null; render(); return; }
      const el = app.querySelector('[data-countdown]');
      if (el) el.textContent = 'Auto-skips in ' + Math.max(1, Math.ceil((GOAL_PROMPT_MS - (now - sh.openedAt)) / 1000)) + 's';
    }
    app.querySelectorAll('[data-clock]').forEach((el) => {
      const m = state.matches.find((x) => x.id === el.dataset.clock);
      if (m) el.textContent = formatClock(clockSeconds(m, now));
    });
  }

  /* ---------- Actions ---------- */

  function flash(type) {
    const el = app.querySelector(`[data-type="${type}"]`);
    if (!el) return;
    el.classList.add('is-tapped');
    setTimeout(() => el.classList.remove('is-tapped'), 250);
  }

  function downloadBackup() {
    const payload = { app: 'keeper-log', version: 1, exportedAt: new Date().toISOString(), matches: state.matches };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'keeper-backup-' + todayLocal() + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const actions = {
    go(el) { go(el.dataset.to); },
    'new-match'() { state.sheet = { kind: 'new' }; render(); const i = app.querySelector('input[name="opponent"]'); if (i) i.focus(); },
    'close-sheet'() { state.sheet = null; render(); },
    'open-match'(el) {
      const m = state.matches.find((x) => x.id === el.dataset.id);
      if (m) go(m.finished ? 'summary' : 'live', m.id);
    },
    'open-live'() { go('live'); },
    clock() {
      const m = current();
      if (m.clock.runningSince != null) pauseClock(m);
      else m.clock.runningSince = Date.now();
      save();
      render();
    },
    log(el) {
      const m = current();
      const type = el.dataset.type;
      const e = { type, t: clockSeconds(m, Date.now()) };
      if (type === 'goal') e.savable = null;
      m.events.push(e);
      save();
      if (type === 'goal') {
        state.sheet = { kind: 'goal', openedAt: Date.now() };
        buzz([40, 40, 40]);
      } else {
        buzz(35);
      }
      render();
      flash(type);
    },
    undo() {
      const m = current();
      if (!m || !m.events.length) return;
      m.events.pop();
      if (state.sheet && state.sheet.kind === 'goal') state.sheet = null;
      save();
      buzz(35);
      render();
    },
    'goal-answer'(el) {
      const m = current();
      const goal = m.events[m.events.length - 1];
      if (goal && goal.type === 'goal') goal.savable = el.dataset.value === 'yes';
      state.sheet = null;
      save();
      render();
    },
    'goal-skip'() { state.sheet = null; render(); },
    finish() {
      const m = current();
      pauseClock(m);
      m.finished = true;
      save();
      go('summary');
    },
    'ask-delete'() { state.sheet = { kind: 'delete' }; render(); },
    delete() {
      state.matches = state.matches.filter((m) => m.id !== state.matchId);
      save();
      go('home', null);
    },
    download() { downloadBackup(); },
    'ask-demo'() { state.notice = null; state.sheet = { kind: 'replace', matches: demoMatches(), source: 'demo' }; render(); },
    replace() {
      state.matches = state.sheet.matches;
      save();
      go('home', null);
    },
    range(el) { state.prefs.range = el.dataset.range; savePrefs(); render(); },
    stat(el) { state.prefs.stat = el.dataset.stat; savePrefs(); render(); },
  };

  app.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-action]');
    if (!el || !app.contains(el)) return;
    const fn = actions[el.dataset.action];
    if (fn) { ev.preventDefault(); fn(el); }
  });

  app.addEventListener('submit', (ev) => {
    const form = ev.target;
    if (form.dataset.form !== 'new-match') return;
    ev.preventDefault();
    const data = new FormData(form);
    const opponent = String(data.get('opponent') || '').trim() || 'Opponent';
    const date = /^\d{4}-\d{2}-\d{2}$/.test(String(data.get('date'))) ? String(data.get('date')) : todayLocal();
    const now = Date.now();
    const m = {
      id: 'm' + now.toString(36) + Math.random().toString(36).slice(2, 6),
      date, opponent, createdAt: now, finished: false,
      clock: { elapsed: 0, runningSince: null },
      events: [],
    };
    state.matches.push(m);
    save();
    go('live', m.id);
  });

  app.addEventListener('change', (ev) => {
    const input = ev.target;
    if (input.dataset.change !== 'restore' || !input.files || !input.files[0]) return;
    const reader = new FileReader();
    const reject = () => { state.notice = "That file isn't a Keeper Log backup. Nothing was changed."; render(); };
    reader.onload = () => {
      let result;
      try { result = validateBackup(JSON.parse(String(reader.result))); } catch (err) { result = { ok: false }; }
      if (!result.ok) return reject();
      state.notice = null;
      state.sheet = { kind: 'replace', matches: result.matches, source: 'backup' };
      render();
    };
    reader.onerror = reject;
    reader.readAsText(input.files[0]);
    input.value = '';
  });

  // Keep the clock right when the phone wakes up.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

  load();
  // After a reload or the app being killed mid-match, go straight back to the running match.
  const running = state.matches.filter((m) => !m.finished && m.clock.runningSince != null).sort(newestFirst)[0];
  if (running) { state.screen = 'live'; state.matchId = running.id; }
  render();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    formatClock, clockSeconds, stats, validateBackup, validateMatches, progress, chartBars,
    compareText, periodValue, totals, demoMatches, todayLocal, formatLongDate, STAT_KEYS,
  };
}
