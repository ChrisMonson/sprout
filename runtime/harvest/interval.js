// '15m', '1h', '30s' or milliseconds → milliseconds (same rules as the Mac SDK).
const UNITS = { s: 1000, m: 60_000, h: 3_600_000 };

export function intervalMs(every) {
  if (typeof every === 'number') return every;
  const m = String(every).trim().match(/^(\d+(?:\.\d+)?)\s*([smh])$/);
  if (!m) throw new Error(`every(): use a number of milliseconds or a string like '15m' (got ${JSON.stringify(every)}).`);
  return Number(m[1]) * UNITS[m[2]];
}
