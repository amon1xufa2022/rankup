'use strict';

const express = require('express');
const crypto = require('crypto');
const store = require('./store');
const discord = require('./discord');

const router = express.Router();

function effectiveGuildId(settings) {
  return settings.guildId || process.env.GUILD_ID || '';
}

function effectiveWebhookUrl(settings) {
  return settings.webhookUrl || process.env.DISCORD_WEBHOOK_URL || '';
}

// GET /auth/discord — старт OAuth-потока
router.get('/discord', (req, res) => {
  if (!discord.oauthReady()) {
    return res.redirect('/?error=' + encodeURIComponent('Discord OAuth не настроен: заполните DISCORD_CLIENT_ID и DISCORD_CLIENT_SECRET в .env'));
  }
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  res.redirect(discord.buildAuthorizeUrl(state));
});

// GET /auth/discord/callback — возврат от Discord
router.get('/discord/callback', async (req, res) => {
  const fail = (msg) => res.redirect('/?error=' + encodeURIComponent(msg));
  try {
    if (req.query.error) return fail('Discord вернул ошибку: ' + req.query.error);
    const { code, state } = req.query;
    if (!code || !state || state !== req.session.oauthState) {
      return fail('Некорректный state — попробуйте войти ещё раз');
    }
    delete req.session.oauthState;

    const tokens = await discord.exchangeCode(String(code));
    const accessToken = tokens.access_token;

    const user = await discord.fetchUser(accessToken);
    const settings = store.getSettings();
    const guildId = effectiveGuildId(settings);

    let member = null;
    try {
      member = await discord.fetchGuildMember(accessToken, guildId);
    } catch (err) {
      // Роли не критичны для входа — просто логируем
      console.error('[auth] не удалось получить роли участника:', err.message);
    }

    const sessionUser = {
      id: String(user.id),
      username: user.username,
      displayName: user.global_name || user.username,
      avatar: discord.avatarUrl(user),
      // роли участника на сервере — из них считается уровень доступа
      roles: member && Array.isArray(member.roles) ? member.roles.map(String) : [],
      onGuild: Boolean(member) || !guildId
    };

    // Защита от фиксации сессии
    await new Promise((resolve, reject) => {
      req.session.regenerate(err => (err ? reject(err) : resolve()));
    });
    req.session.user = sessionUser;
    await new Promise((resolve, reject) => {
      req.session.save(err => (err ? reject(err) : resolve()));
    });

    store.logActivity({ id: sessionUser.id, name: sessionUser.displayName }, 'login', 'Вход через Discord');
    res.redirect('/');
  } catch (err) {
    console.error('[auth/callback]', err);
    fail('Не удалось завершить вход: ' + String(err.message || err).slice(0, 200));
  }
});

// POST /auth/logout
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('rankup.sid');
    res.json({ ok: true });
  });
});

module.exports = router;
module.exports.effectiveGuildId = effectiveGuildId;
module.exports.effectiveWebhookUrl = effectiveWebhookUrl;
