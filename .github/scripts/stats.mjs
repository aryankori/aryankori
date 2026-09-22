// Renders stats/stats-dark.svg and stats/stats-light.svg from public GitHub data.
// Env: GITHUB_TOKEN, GH_LOGIN. Optional OUT_DIR (default: stats).
import fs from 'node:fs';
import path from 'node:path';

const login = process.env.GH_LOGIN || 'aryankori';
const token = process.env.GITHUB_TOKEN;
const outDir = process.env.OUT_DIR || 'stats';
if (!token) throw new Error('GITHUB_TOKEN is required');

async function gql(query, variables) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'profile-stats' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(JSON.stringify(body.errors || body));
  return body.data;
}

const repoQuery = `query($login: String!, $after: String) {
  user(login: $login) {
    repositories(ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC, first: 100, after: $after) {
      totalCount
      pageInfo { hasNextPage endCursor }
      nodes { stargazerCount languages(first: 10, orderBy: {field: SIZE, direction: DESC}) { edges { size node { name color } } } }
    }
  }
}`;

const calendarQuery = `query($login: String!) {
  user(login: $login) {
    contributionsCollection { contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } }
  }
}`;

let repoCount = 0, stars = 0, after = null;
const langs = new Map();
do {
  const { user } = await gql(repoQuery, { login, after });
  const r = user.repositories;
  repoCount = r.totalCount;
  for (const n of r.nodes) {
    stars += n.stargazerCount;
    for (const e of n.languages.edges) {
      const cur = langs.get(e.node.name) || { size: 0, color: e.node.color || '#8b949e' };
      cur.size += e.size;
      langs.set(e.node.name, cur);
    }
  }
  after = r.pageInfo.hasNextPage ? r.pageInfo.endCursor : null;
} while (after);

// The contribution calendar is optional: if it cannot be read, the card still renders.
let total = null, current = null, longest = null;
try {
  const { user } = await gql(calendarQuery, { login });
  const cal = user.contributionsCollection.contributionCalendar;
  total = cal.totalContributions;
  const days = cal.weeks.flatMap(w => w.contributionDays);
  let run = 0;
  longest = 0;
  for (const d of days) { run = d.contributionCount > 0 ? run + 1 : 0; longest = Math.max(longest, run); }
  // Today may still be empty, so the current streak can end yesterday.
  let i = days.length - 1;
  if (days[i] && days[i].contributionCount === 0) i--;
  current = 0;
  while (i >= 0 && days[i].contributionCount > 0) { current++; i--; }
} catch (err) {
  console.warn('contribution calendar unavailable:', err.message);
}

const totalBytes = [...langs.values()].reduce((s, l) => s + l.size, 0);
const top = [...langs.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 6)
  .map(([name, l]) => ({ name, color: l.color, pct: totalBytes ? (l.size / totalBytes) * 100 : 0 }));

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = n => (n === null ? 'n/a' : n.toLocaleString('en-US'));

function render({ value, label, track }) {
  const W = 480, font = `-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif`;
  const stats = [
    ['contributions (1y)', fmt(total)],
    ['current streak', current === null ? 'n/a' : `${current}d`],
    ['longest streak (1y)', longest === null ? 'n/a' : `${longest}d`],
    ['public repos', fmt(repoCount)],
  ];
  if (stars > 0) stats.push(['stars', fmt(stars)]);
  const colW = W / stats.length;
  const cells = stats.map(([l, v], i) => `
    <text x="${i * colW}" y="20" fill="${value}" font-size="16" font-weight="600">${esc(v)}</text>
    <text x="${i * colW}" y="38" fill="${label}" font-size="11">${esc(l)}</text>`).join('');

  let x = 0;
  const bar = top.map(t => {
    const w = (t.pct / 100) * W;
    const seg = `<rect x="${x.toFixed(2)}" y="58" width="${w.toFixed(2)}" height="6" fill="${t.color}"/>`;
    x += w;
    return seg;
  }).join('');
  const legend = top.map((t, i) => {
    const lx = (i % 3) * 160, ly = 86 + Math.floor(i / 3) * 18;
    return `<circle cx="${lx + 4}" cy="${ly - 4}" r="4" fill="${t.color}"/>
    <text x="${lx + 14}" y="${ly}" fill="${label}" font-size="11">${esc(t.name)} ${t.pct.toFixed(1)}%</text>`;
  }).join('');
  const H = top.length > 3 ? 112 : 94;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${font}" role="img" aria-label="GitHub stats for ${esc(login)}">
  <title>GitHub stats for ${esc(login)}</title>${cells}
  <clipPath id="r"><rect x="0" y="58" width="${W}" height="6" rx="3"/></clipPath>
  <rect x="0" y="58" width="${W}" height="6" rx="3" fill="${track}"/>
  <g clip-path="url(#r)">${bar}</g>${legend}
</svg>
`;
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'stats-dark.svg'), render({ value: '#e6edf3', label: '#7d8590', track: '#30363d' }));
fs.writeFileSync(path.join(outDir, 'stats-light.svg'), render({ value: '#1f2328', label: '#656d76', track: '#d0d7de' }));
console.log(JSON.stringify({ repoCount, stars, total, current, longest, top: top.map(t => `${t.name} ${t.pct.toFixed(1)}%`) }));
