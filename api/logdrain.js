// Receives Vercel log drain events and forwards runtime errors to Discord.
// Set log drain source to HTTP and point to this endpoint.
// Vercel sends newline-delimited JSON (ndjson).

function parseNdjson(body) {
  return body
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

function buildErrorEmbed(entry) {
  return {
    title: '🔴 Runtime Error',
    color: 0xed4245,
    fields: [
      { name: 'Project',     value: entry.projectId ?? 'Unknown', inline: true },
      { name: 'Environment', value: entry.environment ?? 'Unknown', inline: true },
      { name: 'Region',      value: entry.region ?? 'Unknown', inline: true },
      { name: 'Message',     value: (entry.message ?? '').slice(0, 1024) || '(no message)', inline: false },
      entry.path ? { name: 'Path', value: entry.path, inline: false } : null,
    ].filter(Boolean),
    timestamp: entry.timestamp ? new Date(entry.timestamp).toISOString() : new Date().toISOString(),
    footer: { text: 'Vercel Log Drain' },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  const entries = parseNdjson(raw);

  const errors = entries.filter(
    (e) => e.level === 'error' || e.type === 'error' || /error|exception|fatal/i.test(e.message ?? ''),
  );

  if (errors.length === 0) return res.status(200).json({ ok: true, skipped: true });

  const webhookUrl = process.env.DISCORD_DEPLOYMENT_ALERTS_WEBHOOK;
  if (!webhookUrl) return res.status(500).json({ error: 'DISCORD_DEPLOYMENT_ALERTS_WEBHOOK not configured' });

  const embeds = errors.slice(0, 10).map(buildErrorEmbed);
  const discordRes = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds }),
  });

  if (!discordRes.ok) {
    const text = await discordRes.text();
    console.error('Discord webhook failed:', discordRes.status, text);
    return res.status(502).json({ error: 'Discord delivery failed' });
  }

  return res.status(200).json({ ok: true, forwarded: errors.length });
}
