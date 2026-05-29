const ALERT_TYPES = new Set(['deployment.error', 'deployment.cancelled']);

const DEPLOY_COLORS = {
  'deployment.succeeded': 0x57f287,
  'deployment.error':     0xed4245,
  'deployment.cancelled': 0xfee75c,
  'deployment.created':   0x5865f2,
  'deployment.promoted':  0x57f287,
};

const DEPLOY_TITLES = {
  'deployment.succeeded': '✅ Deployment Succeeded',
  'deployment.error':     '❌ Deployment Failed',
  'deployment.cancelled': '⚠️ Deployment Cancelled',
  'deployment.created':   '🚀 Deployment Started',
  'deployment.promoted':  '🎉 Promoted to Production',
};

function buildDeployEmbed(type, payload) {
  const { deployment, project } = payload ?? {};
  const url = deployment?.url ? `https://${deployment.url}` : null;
  const branch = deployment?.meta?.githubCommitRef ?? deployment?.meta?.gitlabCommitRef ?? null;
  const commit = deployment?.meta?.githubCommitMessage ?? deployment?.meta?.gitlabCommitMessage ?? null;
  const author = deployment?.meta?.githubCommitAuthorName ?? deployment?.meta?.gitlabCommitAuthorName ?? null;

  const fields = [
    { name: 'Project',     value: deployment?.name ?? project?.name ?? 'Unknown', inline: true },
    { name: 'Environment', value: deployment?.target ?? 'preview', inline: true },
  ];
  if (branch) fields.push({ name: 'Branch', value: branch, inline: true });
  if (commit) fields.push({ name: 'Commit', value: commit.slice(0, 72), inline: false });
  if (author) fields.push({ name: 'Author', value: author, inline: true });
  if (url)    fields.push({ name: 'URL',    value: url, inline: false });

  return {
    title: DEPLOY_TITLES[type] ?? type,
    color: DEPLOY_COLORS[type] ?? 0x000000,
    fields,
    timestamp: new Date().toISOString(),
    footer: { text: 'Vercel' },
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { type, payload } = req.body ?? {};
  if (!type) return res.status(400).json({ error: 'Missing event type' });

  if (!type.startsWith('deployment.')) {
    return res.status(200).json({ ok: true, skipped: true });
  }

  const isAlert = ALERT_TYPES.has(type);
  const webhookUrl = isAlert
    ? process.env.DISCORD_DEPLOYMENT_ALERTS_WEBHOOK
    : process.env.DISCORD_DEPLOYMENT_EVENTS_WEBHOOK;

  if (!webhookUrl) return res.status(200).json({ ok: true, skipped: true });

  const embed = buildDeployEmbed(type, payload);
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
