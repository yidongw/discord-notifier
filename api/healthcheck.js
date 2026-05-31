// Vercel cron endpoint — checks HTTP accessibility of all carbon/* and jilio/* projects.
// Alerts Discord if any project is unreachable or returns 5xx.

const PREFIXES = ['carbon', 'jilio'];
const CHECK_TIMEOUT_MS = 10_000;
const VERCEL_API = 'https://api.vercel.com';

async function fetchProjects(prefix, token, teamId) {
  const params = new URLSearchParams({ search: prefix, limit: '100' });
  if (teamId) params.set('teamId', teamId);
  const res = await fetch(`${VERCEL_API}/v9/projects?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error(`Vercel API error listing "${prefix}" projects: ${res.status}`);
    return [];
  }
  const data = await res.json();
  return (data.projects ?? []).filter(p =>
    p.name.toLowerCase().startsWith(prefix.toLowerCase())
  );
}

async function checkUrl(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHECK_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'follow' });
    clearTimeout(timer);
    return { healthy: res.status < 500, status: res.status };
  } catch (err) {
    clearTimeout(timer);
    return { healthy: false, status: null, reason: err.name === 'AbortError' ? 'timeout' : err.message };
  }
}

function buildHealthEmbed(failed) {
  return {
    title: '🚨 Health Check Failed',
    color: 0xed4245,
    description: `${failed.length} app${failed.length !== 1 ? 's are' : ' is'} unreachable`,
    fields: failed.map(({ name, url, status, reason }) => ({
      name,
      value: `URL: ${url}\nStatus: ${reason ?? status}`,
      inline: false,
    })),
    timestamp: new Date().toISOString(),
    footer: { text: 'Vercel Health Monitor' },
  };
}

export default async function handler(req, res) {
  const token = process.env.VERCEL_TOKEN;
  const teamId = process.env.VERCEL_TEAM_ID;
  const webhookUrl = process.env.DISCORD_HEALTH_ALERTS_WEBHOOK
    ?? process.env.DISCORD_DEPLOYMENT_ALERTS_WEBHOOK;

  if (!token) return res.status(500).json({ error: 'VERCEL_TOKEN not configured' });
  if (!webhookUrl) return res.status(500).json({ error: 'Discord webhook not configured' });

  const allProjects = (await Promise.all(
    PREFIXES.map(p => fetchProjects(p, token, teamId))
  )).flat();

  if (allProjects.length === 0) {
    return res.status(200).json({ ok: true, message: 'No matching projects found', prefixes: PREFIXES });
  }

  const checks = allProjects.map(project => {
    // Prefer non-vercel.app custom domain, fall back to generated alias, then to name.vercel.app
    const alias = project.alias?.find(a => !a.domain?.endsWith('.vercel.app'))?.domain
      ?? project.alias?.[0]?.domain
      ?? `${project.name}.vercel.app`;
    return { name: project.name, url: `https://${alias}/health` };
  });

  const results = await Promise.all(
    checks.map(async ({ name, url }) => ({ name, url, ...(await checkUrl(url)) }))
  );

  const failed = results.filter(r => !r.healthy);

  if (failed.length === 0) {
    return res.status(200).json({ ok: true, checked: results.length });
  }

  const discordRes = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [buildHealthEmbed(failed)] }),
  });

  if (!discordRes.ok) {
    const text = await discordRes.text();
    console.error('Discord webhook failed:', discordRes.status, text);
    return res.status(502).json({ error: 'Discord delivery failed' });
  }

  return res.status(200).json({ ok: true, checked: results.length, failed: failed.length });
}
