'use strict';

const DISCORD_API = 'https://discord.com/api/v10';
const OAUTH_AUTHORIZE = 'https://discord.com/api/oauth2/authorize';

function oauthReady() {
  return Boolean(process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET);
}

function buildAuthorizeUrl(state) {
  const redirectUri = process.env.DISCORD_REDIRECT_URI || 'http://localhost:3000/auth/discord/callback';
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID || '',
    redirect_uri: redirectUri,
    response_type: 'code',
    // identify — кто пользователь; guilds.members.read — его роли на сервере
    scope: 'identify guilds.members.read',
    state
  });
  return `${OAUTH_AUTHORIZE}?${params.toString()}`;
}

async function exchangeCode(code) {
  const redirectUri = process.env.DISCORD_REDIRECT_URI || 'http://localhost:3000/auth/discord/callback';
  const body = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID || '',
    client_secret: process.env.DISCORD_CLIENT_SECRET || '',
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  });
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Discord token exchange failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function fetchDiscord(path, accessToken) {
  const res = await fetch(`${DISCORD_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Discord API ${path} failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

// Профиль пользователя
function fetchUser(accessToken) {
  return fetchDiscord('/users/@me', accessToken);
}

// Участник конкретного сервера (нужен scope guilds.members.read)
// Возвращает { roles: [...], nick, ... } или null, если пользователя нет на сервере
async function fetchGuildMember(accessToken, guildId) {
  if (!guildId) return null;
  try {
    return await fetchDiscord(`/users/@me/guilds/${guildId}/member`, accessToken);
  } catch (err) {
    const msg = String(err && err.message || '');
    // 404 = не на сервере / нет доступа — не фатально, просто нет ролей
    if (msg.includes('(404)')) return null;
    throw err;
  }
}

function avatarUrl(user) {
  if (!user || !user.avatar) {
    // Дискорд отдаёт дефолтный аватар по (id >> 22) % 6
    try {
      const idx = Number(BigInt(user.id) >> 22n) % 6;
      return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
    } catch {
      return 'https://cdn.discordapp.com/embed/avatars/0.png';
    }
  }
  const ext = String(user.avatar).startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}?size=128`;
}

// ── Вебхук ────────────────────────────────────────────────────
function truncate(s, n) {
  s = String(s == null ? '' : s);
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

async function sendWebhook(webhookUrl, payload) {
  if (!webhookUrl) return { ok: false, error: 'Вебхук не настроен' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      return { ok: false, error: `Discord ответил ${res.status}: ${truncate(text, 200)}` };
    }
    return { ok: true };
  } catch (err) {
    const msg = err && err.name === 'AbortError' ? 'таймаут (8с)' : String(err && err.message || err);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(timer);
  }
}

// Итог по одобренному отчёту — красивым embedded-сообщением
async function sendReportApproved({ webhookUrl, webhookName, settings, report, fields, reviewerName, reviewerId }) {
  const labelOf = (fieldId) => {
    const f = (fields || []).find(x => x.id === fieldId);
    return f ? f.label : fieldId;
  };

  const embedFields = [];
  embedFields.push({
    name: 'От кого',
    value: truncate(`${report.userName}\n(ID: ${report.userId})`, 1024),
    inline: true
  });
  embedFields.push({
    name: 'Одобрил',
    value: truncate(reviewerName || '—', 1024),
    inline: true
  });

  for (const [key, value] of Object.entries(report.values || {})) {
    if (value === '' || value == null) continue;
    embedFields.push({
      name: truncate(labelOf(key), 250),
      value: truncate(value, 1024),
      inline: false
    });
  }

  const mention = (id, name) => (/^\d{15,25}$/.test(String(id || '')) ? `<@${id}>` : (name || ''));
  const authorPing = mention(report.userId, report.userName);
  const reviewerPing = mention(reviewerId, reviewerName);

  const payload = {
    username: webhookName || settings.siteTitle || 'RankUp',
    // Упоминания в тексте сообщения реально пингуют на телефоне и ПК
    content: `${authorPing} Ваш отчёт на повышение одобрен · одобрил ${reviewerPing}`,
    allowed_mentions: { parse: ['users'] },
    embeds: [{
      title: '✅ Отчёт на повышение одобрен',
      color: 0x57f287,
      fields: embedFields.slice(0, 25),
      footer: { text: `${settings.siteTitle || 'RankUp'} · заявка ${report.id}` },
      timestamp: new Date().toISOString()
    }]
  };

  return sendWebhook(webhookUrl, payload);
}

module.exports = {
  oauthReady,
  buildAuthorizeUrl,
  exchangeCode,
  fetchUser,
  fetchGuildMember,
  avatarUrl,
  sendWebhook,
  sendReportApproved
};
