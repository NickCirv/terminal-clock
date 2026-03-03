#!/usr/bin/env node
// terminal-clock — zero-dependency developer terminal clock
// Node 18+ ES modules required

import { createInterface } from 'readline';

// ─── ASCII 7-segment digits (3 wide × 5 tall) ───────────────────────────────
const DIGITS = {
  '0': ['███','█ █','█ █','█ █','███'],
  '1': ['  █','  █','  █','  █','  █'],
  '2': ['███','  █','███','█  ','███'],
  '3': ['███','  █','███','  █','███'],
  '4': ['█ █','█ █','███','  █','  █'],
  '5': ['███','█  ','███','  █','███'],
  '6': ['███','█  ','███','█ █','███'],
  '7': ['███','  █','  █','  █','  █'],
  '8': ['███','█ █','███','█ █','███'],
  '9': ['███','█ █','███','  █','███'],
  ':': ['   ',' █ ','   ',' █ ','   '],
  ' ': ['   ','   ','   ','   ','   '],
};

// ─── ANSI helpers ────────────────────────────────────────────────────────────
const ESC = '\x1b[';
const hide = () => process.stdout.write('\x1b[?25l');
const show = () => process.stdout.write('\x1b[?25h');
const clear = () => process.stdout.write('\x1b[2J\x1b[H');
const moveTo = (row, col) => process.stdout.write(`${ESC}${row};${col}H`);
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const beep = () => process.stdout.write('\x07');

// ─── Render ASCII big digits ─────────────────────────────────────────────────
function renderBigText(text, color = cyan) {
  const chars = text.split('').map(c => DIGITS[c] ?? DIGITS[' ']);
  const rows = [];
  for (let row = 0; row < 5; row++) {
    rows.push(chars.map(c => c[row]).join(' '));
  }
  return rows.map(r => color(r)).join('\n');
}

// ─── Format time string ──────────────────────────────────────────────────────
function formatTime(date, tz, use12h, showSeconds) {
  const opts = {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: use12h,
  };
  if (showSeconds) opts.second = '2-digit';
  let str = new Intl.DateTimeFormat('en-US', opts).format(date);
  str = str.replace(/\s*(AM|PM)$/i, '');
  return str;
}

function formatAmPm(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    hour12: true,
  }).formatToParts(date);
  return parts.find(p => p.type === 'dayPeriod')?.value ?? '';
}

function formatDate(date, tz) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
}

function getTzLabel(tz) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'short',
    }).formatToParts(new Date());
    return parts.find(p => p.type === 'timeZoneName')?.value ?? tz;
  } catch {
    return tz;
  }
}

// ─── Duration parsing ─────────────────────────────────────────────────────────
function parseDuration(str) {
  const re = /(\d+)(h|m|s)/gi;
  let total = 0;
  let match;
  while ((match = re.exec(str)) !== null) {
    const n = parseInt(match[1], 10);
    const unit = match[2].toLowerCase();
    if (unit === 'h') total += n * 3600;
    else if (unit === 'm') total += n * 60;
    else if (unit === 's') total += n;
  }
  if (total === 0) {
    const plain = parseInt(str, 10);
    if (!isNaN(plain)) total = plain * 60;
  }
  return total;
}

function fmtDuration(secs, showMs) {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  const ms = Math.floor((secs % 1) * 100);
  if (h > 0) {
    return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }
  if (showMs) {
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}.${String(ms).padStart(2,'0')}`;
  }
  return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
}

// ─── Terminal helpers ─────────────────────────────────────────────────────────
function getTermSize() {
  return { cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 };
}

function centerPad(str, width) {
  const visLen = str.replace(/\x1b\[[0-9;]*m/g, '').length;
  const pad = Math.max(0, Math.floor((width - visLen) / 2));
  return ' '.repeat(pad) + str;
}

// ─── Setup raw keyboard input ────────────────────────────────────────────────
function setupKeys(handler) {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
  }
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (key) => {
    if (key === '\u0003') {
      cleanup();
      process.exit(0);
    }
    handler(key);
  });
}

function cleanup() {
  show();
  if (process.stdin.isTTY) {
    try { process.stdin.setRawMode(false); } catch (_) {}
  }
  process.stdin.pause();
  process.stdout.write('\x1b[0m\n');
}

// ─── MODE: Clock ─────────────────────────────────────────────────────────────
function modeClock(timezones, use12h, showSeconds) {
  hide();
  clear();

  function render() {
    const now = new Date();
    const { cols } = getTermSize();
    clear();

    timezones.forEach((tz, i) => {
      const timeStr = formatTime(now, tz, use12h, showSeconds);
      const ampm = use12h ? formatAmPm(now, tz) : '';
      const dateStr = formatDate(now, tz);
      const tzLabel = getTzLabel(tz);
      const displayTz = tz.split('/').pop().replace(/_/g, ' ');

      const big = renderBigText(timeStr);
      const lines = big.split('\n');

      const offset = i * 8;
      lines.forEach((line, li) => {
        moveTo(offset + 2 + li, 1);
        process.stdout.write(centerPad(line, cols));
      });

      if (use12h && ampm) {
        moveTo(offset + 3, 1);
        const bigVisLen = lines[2].replace(/\x1b\[[0-9;]*m/g, '').length;
        const startCol = Math.floor((cols - bigVisLen) / 2) + bigVisLen + 3;
        moveTo(offset + 3, startCol);
        process.stdout.write(yellow(bold(ampm)));
      }

      moveTo(offset + 7, 1);
      process.stdout.write(centerPad(dim(`${displayTz} (${tzLabel})  |  ${dateStr}`), cols));
    });

    const helpRow = timezones.length * 8 + 2;
    moveTo(helpRow, 1);
    process.stdout.write(centerPad(dim('q to quit'), cols));
  }

  render();
  const iv = setInterval(render, 1000);

  setupKeys((key) => {
    if (key === 'q' || key === 'Q') {
      clearInterval(iv);
      cleanup();
      process.exit(0);
    }
  });
}

// ─── MODE: Stopwatch ─────────────────────────────────────────────────────────
function modeStopwatch() {
  hide();
  clear();

  let running = false;
  let elapsed = 0;
  let startedAt = null;
  let laps = [];
  let lastLapTime = 0;

  function getElapsed() {
    if (!running) return elapsed;
    return elapsed + (Date.now() - startedAt) / 1000;
  }

  function render() {
    const { cols, rows } = getTermSize();
    const e = getElapsed();
    clear();

    moveTo(1, 1);
    process.stdout.write(centerPad(bold(cyan('STOPWATCH')), cols));

    const colorFn = running ? green : yellow;
    const big = renderBigText(fmtDuration(e, true), colorFn);
    big.split('\n').forEach((line, i) => {
      moveTo(3 + i, 1);
      process.stdout.write(centerPad(line, cols));
    });

    const status = running
      ? green('RUNNING')
      : (elapsed > 0 ? yellow('PAUSED') : dim('READY'));
    moveTo(9, 1);
    process.stdout.write(centerPad(status, cols));

    if (laps.length > 0) {
      moveTo(11, 1);
      process.stdout.write(centerPad(bold('Laps'), cols));
      const visible = laps.slice(-8);
      const startIdx = laps.length - visible.length;
      visible.forEach((lap, i) => {
        moveTo(12 + i, 1);
        const lapNum = String(startIdx + i + 1).padStart(2);
        const line = dim(`  Lap ${lapNum}  `) +
          cyan(fmtDuration(lap.split, true)) +
          dim('  total: ') +
          yellow(fmtDuration(lap.total, true));
        process.stdout.write(centerPad(line, cols));
      });
    }

    moveTo(Math.min(22, rows - 2), 1);
    process.stdout.write(centerPad(dim('Space: start/pause  |  L: lap  |  R: reset  |  q: quit'), cols));
  }

  render();
  const iv = setInterval(render, 50);

  setupKeys((key) => {
    const k = key.toLowerCase();
    if (k === 'q') {
      clearInterval(iv);
      cleanup();
      process.exit(0);
    } else if (key === ' ') {
      if (running) {
        elapsed += (Date.now() - startedAt) / 1000;
        running = false;
      } else {
        startedAt = Date.now();
        running = true;
      }
    } else if (k === 'l') {
      if (running || elapsed > 0) {
        const total = getElapsed();
        const split = total - lastLapTime;
        lastLapTime = total;
        laps.push({ split, total });
      }
    } else if (k === 'r') {
      running = false;
      elapsed = 0;
      laps = [];
      lastLapTime = 0;
      startedAt = null;
    }
  });
}

// ─── MODE: Timer ─────────────────────────────────────────────────────────────
function modeTimer(durationSecs) {
  if (durationSecs <= 0) {
    process.stderr.write('Invalid duration. Use formats like: 25m, 1h30m, 90s\n');
    process.exit(1);
  }

  hide();
  clear();

  const startedAt = Date.now();
  let done = false;
  let beeped = false;

  function getRemaining() {
    const elapsed = (Date.now() - startedAt) / 1000;
    return Math.max(0, durationSecs - elapsed);
  }

  function render() {
    const { cols, rows } = getTermSize();
    const rem = getRemaining();
    clear();

    moveTo(1, 1);
    process.stdout.write(centerPad(bold(cyan('COUNTDOWN TIMER')), cols));

    const pct = 1 - (rem / durationSecs);
    const barWidth = Math.min(50, cols - 4);
    const filled = Math.floor(pct * barWidth);
    const bar = green('█'.repeat(filled)) + dim('░'.repeat(barWidth - filled));

    const colorFn = rem < 60 ? red : (rem < 300 ? yellow : green);
    const big = renderBigText(fmtDuration(rem), colorFn);
    big.split('\n').forEach((line, i) => {
      moveTo(3 + i, 1);
      process.stdout.write(centerPad(line, cols));
    });

    moveTo(9, 1);
    process.stdout.write(centerPad(`[${bar}]`, cols));

    moveTo(11, 1);
    process.stdout.write(centerPad(dim(`Total: ${fmtDuration(durationSecs)}`), cols));

    if (done) {
      moveTo(13, 1);
      process.stdout.write(centerPad(bold(green('DONE! Timer complete.')), cols));
    }

    moveTo(Math.min(15, rows - 2), 1);
    process.stdout.write(centerPad(dim('q to quit'), cols));
  }

  render();

  const iv = setInterval(() => {
    const rem = getRemaining();
    if (rem <= 0 && !beeped) {
      done = true;
      beeped = true;
      beep();
      setTimeout(beep, 300);
      setTimeout(beep, 600);
    }
    render();
  }, 100);

  setupKeys((key) => {
    if (key === 'q' || key === 'Q') {
      clearInterval(iv);
      cleanup();
      process.exit(0);
    }
  });
}

// ─── MODE: Pomodoro ──────────────────────────────────────────────────────────
function modePomodoro() {
  hide();
  clear();

  const WORK_SECS = 25 * 60;
  const BREAK_SECS = 5 * 60;

  let phase = 'work';
  let session = 1;
  let startedAt = Date.now();
  let phaseLen = WORK_SECS;
  let totalCompleted = 0;
  let transitioning = false;

  function getRemaining() {
    const elapsed = (Date.now() - startedAt) / 1000;
    return Math.max(0, phaseLen - elapsed);
  }

  function nextPhase() {
    if (transitioning) return;
    transitioning = true;
    beep();
    setTimeout(beep, 400);
    setTimeout(beep, 800);

    setTimeout(() => {
      if (phase === 'work') {
        totalCompleted++;
        phase = 'break';
        phaseLen = BREAK_SECS;
      } else {
        phase = 'work';
        session++;
        phaseLen = WORK_SECS;
      }
      startedAt = Date.now();
      transitioning = false;
    }, 1200);
  }

  function render() {
    const { cols, rows } = getTermSize();
    const rem = getRemaining();
    clear();

    const phaseLabel = phase === 'work' ? red('WORK') : green('BREAK');
    moveTo(1, 1);
    process.stdout.write(centerPad(bold(`POMODORO - ${phase === 'work' ? 'WORK' : 'BREAK'}`), cols));
    moveTo(2, 1);
    process.stdout.write(centerPad(dim(`Session ${session}  |  Completed: ${totalCompleted}`), cols));

    const colorFn = phase === 'work' ? (rem < 60 ? red : cyan) : green;
    const big = renderBigText(fmtDuration(rem), colorFn);
    big.split('\n').forEach((line, i) => {
      moveTo(4 + i, 1);
      process.stdout.write(centerPad(line, cols));
    });

    const total = phase === 'work' ? WORK_SECS : BREAK_SECS;
    const pct = 1 - (rem / total);
    const barWidth = Math.min(50, cols - 4);
    const filled = Math.floor(pct * barWidth);
    const barColorFn = phase === 'work' ? red : green;
    const bar = barColorFn('█'.repeat(filled)) + dim('░'.repeat(barWidth - filled));
    moveTo(10, 1);
    process.stdout.write(centerPad(`[${bar}]`, cols));

    moveTo(12, 1);
    const nextLabel = phase === 'work' ? green('BREAK') : red('WORK');
    process.stdout.write(centerPad(`Phase: ${phaseLabel}  |  Next: ${nextLabel}`, cols));

    if (transitioning) {
      moveTo(14, 1);
      process.stdout.write(centerPad(bold(yellow('TRANSITIONING...')), cols));
    }

    moveTo(Math.min(16, rows - 2), 1);
    process.stdout.write(centerPad(dim('q to quit'), cols));
  }

  render();

  const iv = setInterval(() => {
    const rem = getRemaining();
    if (rem <= 0 && !transitioning) {
      nextPhase();
    }
    render();
  }, 200);

  setupKeys((key) => {
    if (key === 'q' || key === 'Q') {
      clearInterval(iv);
      cleanup();
      process.exit(0);
    }
  });
}

// ─── Help ─────────────────────────────────────────────────────────────────────
function showHelp() {
  const b = bold;
  const c = cyan;
  console.log(`
${b(c('terminal-clock'))} - zero-dependency developer terminal clock

${b('USAGE')}
  tclock                              Live clock (local timezone)
  tclock --tz "TZ1,TZ2,TZ3"          Multi-timezone world clock
  tclock stopwatch                    Stopwatch with laps
  tclock timer <duration>             Countdown timer
  tclock pomodoro                     25/5 Pomodoro cycles

${b('OPTIONS')}
  --tz <zones>        Comma-separated IANA timezones
  --format 12         12-hour clock format (default: 24h)
  --no-seconds        Hide seconds

${b('TIMER FORMATS')}
  tclock timer 25m    25 minutes
  tclock timer 1h30m  1 hour 30 minutes
  tclock timer 90s    90 seconds

${b('STOPWATCH KEYS')}
  Space               Start / Pause
  L                   Lap
  R                   Reset
  q                   Quit

${b('EXAMPLES')}
  tclock --tz "America/New_York,Europe/London,Asia/Dubai"
  tclock timer 45m
  tclock --format 12 --no-seconds
  tclock pomodoro

${b('TIMEZONES')}
  America/New_York  |  America/Los_Angeles  |  America/Chicago
  Europe/London     |  Europe/Paris         |  Europe/Berlin
  Asia/Dubai        |  Asia/Tokyo           |  Asia/Singapore
  Australia/Sydney  |  Pacific/Auckland
`);
}

// ─── CLI entry ────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  showHelp();
  process.exit(0);
}

// Parse flags
let use12h = false;
let showSeconds = true;
let timezones = [Intl.DateTimeFormat().resolvedOptions().timeZone];

const tzIdx = args.indexOf('--tz');
if (tzIdx !== -1 && args[tzIdx + 1]) {
  timezones = args[tzIdx + 1].split(',').map(s => s.trim()).filter(Boolean);
}

const fmtIdx = args.indexOf('--format');
if (fmtIdx !== -1 && args[fmtIdx + 1] === '12') {
  use12h = true;
}

if (args.includes('--no-seconds')) {
  showSeconds = false;
}

// Validate timezones
for (const tz of timezones) {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
  } catch (_) {
    process.stderr.write(`Invalid timezone: ${tz}\n`);
    process.exit(1);
  }
}

// Positional args (exclude flag values)
const flagValues = new Set();
if (tzIdx !== -1 && args[tzIdx + 1]) flagValues.add(args[tzIdx + 1]);
if (fmtIdx !== -1 && args[fmtIdx + 1]) flagValues.add(args[fmtIdx + 1]);

const positional = args.filter(a => !a.startsWith('--') && !flagValues.has(a));

process.on('SIGINT', () => { cleanup(); process.exit(0); });
process.on('SIGTERM', () => { cleanup(); process.exit(0); });

if (positional[0] === 'stopwatch') {
  modeStopwatch();
} else if (positional[0] === 'timer') {
  const durStr = positional[1];
  if (!durStr) {
    process.stderr.write('Usage: tclock timer <duration> (e.g. 25m, 1h30m, 90s)\n');
    process.exit(1);
  }
  modeTimer(parseDuration(durStr));
} else if (positional[0] === 'pomodoro') {
  modePomodoro();
} else {
  modeClock(timezones, use12h, showSeconds);
}
