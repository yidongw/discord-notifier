// Receives GitHub Actions migration run results and forwards to Discord.
// Called by supabase-envs.yml on success and failure.

const COLORS = {
  success: 0x57f287,
  failure: 0xed4245,
};

const TITLES = {
  success: '✅ Migration Succeeded',
  failure: '❌ Migration Failed',
};

const ENV_LABELS = {
  dev: '🔵 Dev',
  staging: '🟡 Staging',
  prod: '🔴 Prod',
};

function buildEmbed({ env, status, branch, run_url, repo }) {
  return {
    title: TITLES[status] ?? status,
    color: COLORS[status] ?? 0x000000,
    fields: [
      { name: 'Environment', value: ENV_LABELS[env] ?? env, inline: true },
      { name: 'Branch', value: branch, inline: true },
      { name: 'Repo', value: repo ?? 'Unknown', inline: true },
      run_url ? { name: 'Run', value: run_url, inline: false } : null,
    ].filter(Boolean),
    timestamp: new Date().toISOString(),
    footer: { text: 'Supabase Migrations' },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { env, status, branch, run_url, repo } = req.body ?? {};

  if (!env || !status) {
    return res.status(400).json({ error: 'Missing env or status' });
  }

  const webhookUrl = process.env.DISCORD_MIGRATIONS_WEBHOOK
    ?? process.env.DISCORD_DEPLOYMENTS_WEBHOOK;

  if (!webhookUrl) {
    return res.status(500).json({ error: 'No Discord webhook configured' });
  }

  const embed = buildEmbed({ env, status, branch, run_url, repo });

  const discordRes = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ embeds: [embed] }),
  });

  if (!discordRes.ok) {
    const text = await discordRes.text();
    console.error('Discord webhook failed:', discordRes.status, text);
    return res.status(502).json({ error: 'Discord delivery failed' });
  }

  return res.status(200).json({ ok: true });
}
