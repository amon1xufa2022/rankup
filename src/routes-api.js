'use strict';

const express = require('express');
const store = require('./store');
const discord = require('./discord');
const { getPermissions, requireAuth, requireApprover, requireAdmin } = require('./auth');
const { effectiveWebhookUrl } = require('./routes-auth');
const { getReportLock } = require('./rules');

const router = express.Router();

const DEMO_MODE = () => String(process.env.DEMO_MODE || '').toLowerCase() === 'true';

// ── Простой rate-limit для создания отчётов ──────────────────
const reportHits = new Map();
function reportRateLimit(req, res, next) {
  const key = (req.ip || 'unknown');
  const now = Date.now();
  const windowMs = 10 * 60 * 1000;
  const limit = 20;
  let bucket = reportHits.get(key);
  if (!bucket || bucket.resetAt < now) {
    bucket = { count: 0, resetAt: now + windowMs };
    reportHits.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return res.status(429).json({ error: 'Слишком много отчётов подряд. Подождите немного и попробуйте снова.' });
  }
  next();
}

// ── Валидация значений отчёта по описанию полей ───────────────
function validateValues(fields, values) {
  const errors = [];
  const clean = {};
  const input = values && typeof values === 'object' ? values : {};

  for (const f of fields) {
    let v = input[f.id];
    if (v == null) v = '';
    v = String(v).trim().slice(0, 4000);

    if (f.required && !v) {
      errors.push(`Поле «${f.label}» обязательно для заполнения`);
      clean[f.id] = v;
      continue;
    }
    if (v) {
      if (f.type === 'select') {
        if (!(f.options || []).includes(v)) errors.push(`В поле «${f.label}» выбран недопустимый вариант`);
      } else if (f.type === 'url') {
        try {
          const u = new URL(v);
          if (!/^https?:$/.test(u.protocol)) throw new Error('protocol');
        } catch {
          errors.push(`Поле «${f.label}»: нужна корректная ссылка (https://...)`);
        }
      } else if (f.type === 'number') {
        if (Number.isNaN(Number(v))) errors.push(`Поле «${f.label}»: должно быть числом`);
      } else if (f.type === 'date') {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) errors.push(`Поле «${f.label}»: некорректная дата`);
      }
    }
    clean[f.id] = v;
  }
  return { clean, errors };
}

// ── Санитизация настроек из админ-панели ───────────────────────
function sanitizeSettings(body, base) {
  const errors = [];
  const out = JSON.parse(JSON.stringify(base));

  const pick = (v, fallback) => (v === undefined || v === null ? fallback : v);
  out.siteTitle = String(pick(body.siteTitle, base.siteTitle)).trim().slice(0, 80) || 'RankUp';
  out.siteTagline = String(pick(body.siteTagline, base.siteTagline)).trim().slice(0, 200);

  const guildId = String(pick(body.guildId, base.guildId) || '').trim();
  if (guildId && !/^\d{15,25}$/.test(guildId)) errors.push('Guild ID: 15–25 цифр (ПКМ по серверу → Копировать ID)');
  else out.guildId = guildId;

  const webhookUrl = String(pick(body.webhookUrl, base.webhookUrl) || '').trim().slice(0, 500);
  if (webhookUrl && !(webhookUrl.startsWith('https://') && webhookUrl.includes('/api/webhooks/'))) {
    errors.push('Вебхук должен быть вида https://discord.com/api/webhooks/...');
  }
  out.webhookUrl = webhookUrl;
  out.webhookName = String(pick(body.webhookName, base.webhookName) || '').trim().slice(0, 80);

  for (const key of ['approverMinLevel', 'adminMinLevel']) {
    const n = Number(pick(body[key], base[key]));
    if (!Number.isFinite(n) || n < 0 || n > 99) errors.push(`${key}: уровень от 0 до 99`);
    else out[key] = Math.floor(n);
  }

  // Поля отчёта
  if (body.fields !== undefined && !Array.isArray(body.fields)) {
    errors.push('Поля отчёта повреждены');
  } else if (body.fields !== undefined && body.fields.length === 0) {
    errors.push('Должно остаться хотя бы одно поле отчёта');
  } else if (Array.isArray(body.fields)) {
    const seenIds = new Set();
    const fields = [];
    for (const raw of body.fields.slice(0, 40)) {
      const f = {};
      f.id = String(raw.id || '')
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 40);
      if (!f.id) f.id = 'field_' + Math.random().toString(36).slice(2, 8);
      if (seenIds.has(f.id)) { errors.push(`Повторяющийся идентификатор поля «${f.id}»`); continue; }
      seenIds.add(f.id);

      f.label = String(raw.label || '').trim().slice(0, 150);
      if (!f.label) errors.push('У каждого поля должно быть название');
      f.type = ['text', 'textarea', 'select', 'number', 'date', 'url'].includes(raw.type) ? raw.type : 'text';
      f.required = Boolean(raw.required);
      f.placeholder = String(raw.placeholder || '').slice(0, 200);
      f.help = String(raw.help || '').slice(0, 300);
      if (f.type === 'select') {
        const opts = (Array.isArray(raw.options) ? raw.options : [])
          .map(o => String(o).trim().slice(0, 120))
          .filter(Boolean);
        f.options = [...new Set(opts)].slice(0, 100);
        if (f.options.length === 0) errors.push(`Поле «${f.label || f.id}»: нужен хотя бы один вариант выбора`);
      } else {
        f.options = [];
      }
      fields.push(f);
    }
    out.fields = fields;
  }

  // Иерархия ролей
  if (body.hierarchy !== undefined && !Array.isArray(body.hierarchy)) {
    errors.push('Иерархия ролей повреждена');
  } else if (Array.isArray(body.hierarchy)) {
    const seenLevels = new Set();
    const hierarchy = [];
    for (const raw of body.hierarchy.slice(0, 20)) {
      const row = {};
      row.id = String(raw.id || '') || ('h_' + Math.random().toString(36).slice(2, 8));
      row.name = String(raw.name || '').trim().slice(0, 100);
      if (!row.name) errors.push('У каждой роли должно быть название');
      row.roleId = String(raw.roleId || '').trim();
      if (row.roleId && !/^\d{15,25}$/.test(row.roleId)) {
        errors.push(`Роль «${row.name || row.id}»: ID должен состоять из 15–25 цифр`);
      }
      const lvl = Number(raw.level);
      if (!Number.isFinite(lvl) || lvl < 0 || lvl > 99) {
        errors.push(`Роль «${row.name || row.id}»: уровень от 0 до 99`);
        continue;
      }
      row.level = Math.floor(lvl);
      if (seenLevels.has(row.level)) errors.push(`Уровень ${row.level} указан дважды — уровни должны быть уникальны`);
      seenLevels.add(row.level);
      row.color = /^#[0-9a-fA-F]{6}$/.test(raw.color || '') ? raw.color : '#5865F2';
      hierarchy.push(row);
    }
    hierarchy.sort((a, b) => a.level - b.level);
    out.hierarchy = hierarchy;
  }

  return { out, errors };
}

function currentUser(req) {
  const u = req.session.user;
  return { id: u.id, name: u.displayName || u.username };
}

function publicSettings(settings) {
  return {
    siteTitle: settings.siteTitle,
    siteTagline: settings.siteTagline,
    fields: settings.fields,
    approverMinLevel: settings.approverMinLevel,
    adminMinLevel: settings.adminMinLevel
  };
}

// ═══════════════════════════════════════════════════════════
//  Базовое
// ═══════════════════════════════════════════════════════════

router.get('/bootstrap', (req, res) => {
  const settings = store.getSettings();
  res.json({
    siteTitle: settings.siteTitle,
    siteTagline: settings.siteTagline,
    oauthReady: discord.oauthReady(),
    demoMode: DEMO_MODE()
  });
});

router.get('/me', (req, res) => {
  const perm = getPermissions(req);
  if (!perm.authenticated) {
    return res.json({ authenticated: false, demoMode: DEMO_MODE(), oauthReady: discord.oauthReady() });
  }
  const u = req.session.user;
  res.json({
    authenticated: true,
    demoMode: DEMO_MODE(),
    oauthReady: discord.oauthReady(),
    ...publicSettings(perm.settings),
    user: {
      id: u.id,
      username: u.username,
      displayName: u.displayName,
      avatar: u.avatar,
      onGuild: u.onGuild !== false
    },
    reportLock: getReportLock(u.id),
    level: perm.level,
    isApprover: perm.isApprover,
    isAdmin: perm.isAdmin,
    isSuperAdmin: perm.isSuperAdmin
  });
});

// Демо-вход без ключей Discord (только если DEMO_MODE=true)
router.post('/demo/login', (req, res) => {
  if (!DEMO_MODE()) return res.status(403).json({ error: 'Демо-режим выключен' });
  const as = ['user', 'instructor', 'admin'].includes(req.body && req.body.as) ? req.body.as : 'user';
  const names = { user: 'DemoИгрок', instructor: 'DemoИнструктор', admin: 'DemoАдмин' };
  req.session.user = {
    id: 'demo-' + as,
    username: names[as].toLowerCase(),
    displayName: names[as],
    avatar: '',
    roles: [],
    demoAs: as,
    onGuild: true
  };
  store.logActivity({ id: 'demo-' + as, name: names[as] }, 'login', 'Демо-вход как ' + as);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════
//  Отчёты
// ═══════════════════════════════════════════════════════════

// Создать отчёт
router.post('/reports', requireAuth, reportRateLimit, (req, res) => {
  // Правило: один отчёт «в работе» + кулдаун до 04:00 МСК после одобрения
  const lock = getReportLock(req.session.user.id);
  if (lock.locked) {
    return res.status(403).json({ error: lock.message, lock });
  }

  const settings = store.getSettings();
  const { clean, errors } = validateValues(settings.fields, req.body && req.body.values);
  if (errors.length) return res.status(400).json({ error: errors.join('. '), errors });

  const u = req.session.user;
  const report = {
    id: store.uid('rep'),
    userId: String(u.id),
    userName: u.displayName || u.username,
    userAvatar: u.avatar || '',
    values: clean,
    status: 'pending',
    createdAt: new Date().toISOString(),
    reviewedAt: null,
    reviewerId: null,
    reviewerName: null,
    reviewComment: '',
    webhookSent: null,
    webhookError: null
  };
  store.addReport(report);
  store.logActivity(currentUser(req), 'report_created', `Новый отчёт ${report.id}`);
  res.status(201).json({ report });
});

// Мои отчёты
router.get('/reports/mine', requireAuth, (req, res) => {
  const uid_ = String(req.session.user.id);
  const mine = store.listReports().filter(r => r.userId === uid_);
  res.json({ reports: mine });
});

// Очередь на рассмотрение (Инструктор+)
router.get('/reports', requireApprover, (req, res) => {
  const status = String(req.query.status || 'pending');
  let reports = store.listReports();
  if (status !== 'all') reports = reports.filter(r => r.status === status);
  res.json({ reports });
});

// Одобрить / отклонить (Инструктор+)
router.post('/reports/:id/review', requireApprover, async (req, res) => {
  const { decision, comment } = req.body || {};
  if (!['approve', 'reject'].includes(decision)) {
    return res.status(400).json({ error: 'decision должен быть approve или reject' });
  }
  const report = store.getReport(req.params.id);
  if (!report) return res.status(404).json({ error: 'Отчёт не найден' });
  if (report.status !== 'pending') {
    return res.status(409).json({ error: 'Отчёт уже рассмотрен', status: report.status });
  }

  const reviewer = currentUser(req);
  const isApprove = decision === 'approve';
  const reviewComment = String(comment || '').trim().slice(0, 1000);

  let updated = store.updateReport(report.id, {
    status: isApprove ? 'approved' : 'rejected',
    reviewedAt: new Date().toISOString(),
    reviewerId: String(reviewer.id),
    reviewerName: reviewer.name,
    reviewComment
  });

  store.logActivity(
    reviewer,
    isApprove ? 'report_approved' : 'report_rejected',
    `Отчёт ${report.id} от ${report.userName}${reviewComment ? ' · комментарий: ' + reviewComment.slice(0, 140) : ''}`
  );

  // После одобрения — итог в Discord-канал через вебхук
  let webhook = null;
  if (isApprove) {
    const settings = store.getSettings();
    const webhookUrl = effectiveWebhookUrl(settings);
    if (webhookUrl) {
      webhook = await discord.sendReportApproved({
        webhookUrl,
        webhookName: settings.webhookName,
        settings,
        report: updated,
        fields: settings.fields,
        reviewerName: reviewer.name,
        reviewerId: reviewer.id
      });
      updated = store.updateReport(report.id, {
        webhookSent: Boolean(webhook.ok),
        webhookError: webhook.ok ? null : webhook.error || 'unknown error'
      });
      store.logActivity(reviewer, webhook.ok ? 'webhook_sent' : 'webhook_failed',
        webhook.ok ? `Итог по ${report.id} отправлен в Discord` : `Вебхук не отправлен: ${webhook.error || 'ошибка'}`);
    } else {
      updated = store.updateReport(report.id, { webhookSent: null, webhookError: 'Вебхук не настроен' });
    }
  }

  res.json({ report: updated, webhook });
});

// Повторно отправить итог в вебхук (Админ)
router.post('/reports/:id/resend-webhook', requireAdmin, async (req, res) => {
  const report = store.getReport(req.params.id);
  if (!report) return res.status(404).json({ error: 'Отчёт не найден' });
  if (report.status !== 'approved') return res.status(400).json({ error: 'Можно отправить только одобренный отчёт' });

  const settings = store.getSettings();
  const webhookUrl = effectiveWebhookUrl(settings);
  if (!webhookUrl) return res.status(400).json({ error: 'Вебхук не настроен — укажите его в «Управлении» → «Вебхук»' });

  const reviewer = req.perm || {};
  const webhook = await discord.sendReportApproved({
    webhookUrl,
    webhookName: settings.webhookName,
    settings,
    report,
    fields: settings.fields,
    reviewerName: report.reviewerName || (reviewer && req.session.user.displayName) || '—',
    reviewerId: report.reviewerId || req.session.user.id
  });
  const updated = store.updateReport(report.id, {
    webhookSent: Boolean(webhook.ok),
    webhookError: webhook.ok ? null : webhook.error || 'unknown error'
  });
  store.logActivity(currentUser(req), webhook.ok ? 'webhook_sent' : 'webhook_failed',
    webhook.ok ? `Повторная отправка итога ${report.id}` : `Повторная отправка не удалась: ${webhook.error || 'ошибка'}`);
  res.json({ report: updated, webhook });
});

// Удалить отчёт (Админ)
router.delete('/reports/:id', requireAdmin, (req, res) => {
  const report = store.getReport(req.params.id);
  if (!report) return res.status(404).json({ error: 'Отчёт не найден' });
  store.deleteReport(report.id);
  store.logActivity(currentUser(req), 'report_deleted', `Удалён отчёт ${report.id} от ${report.userName}`);
  res.json({ ok: true });
});

// ═══════════════════════════════════════════════════════════
//  Админ-панель «Управление сайтом»
// ═══════════════════════════════════════════════════════════

router.get('/admin/settings', requireAdmin, (req, res) => {
  res.json({ settings: store.getSettings() });
});

router.put('/admin/settings', requireAdmin, (req, res) => {
  const base = store.getSettings();
  const { out, errors } = sanitizeSettings(req.body || {}, base);
  if (errors.length) return res.status(400).json({ error: errors.join('. '), errors });
  store.saveSettings(out);
  store.logActivity(currentUser(req), 'settings_updated', 'Обновлены настройки сайта');
  res.json({ settings: out });
});

router.post('/admin/reset-settings', requireAdmin, (req, res) => {
  const fresh = store.resetSettings();
  store.logActivity(currentUser(req), 'settings_reset', 'Настройки сброшены к значениям по умолчанию');
  res.json({ settings: fresh });
});

router.post('/admin/test-webhook', requireAdmin, async (req, res) => {
  const settings = store.getSettings();
  const webhookUrl = effectiveWebhookUrl(settings);
  if (!webhookUrl) return res.status(400).json({ error: 'Вебхук не настроен' });
  const result = await discord.sendWebhook(webhookUrl, {
    username: settings.webhookName || settings.siteTitle || 'RankUp',
    embeds: [{
      title: '🔔 Тестовое сообщение',
      description: 'Вебхук настроен верно — итоги одобренных отчётов будут приходить сюда.',
      color: 0x5865f2,
      footer: { text: settings.siteTitle || 'RankUp' },
      timestamp: new Date().toISOString()
    }]
  });
  store.logActivity(currentUser(req), result.ok ? 'webhook_test_ok' : 'webhook_test_failed',
    result.ok ? 'Тестовое сообщение отправлено' : `Тест вебхука не удался: ${result.error || 'ошибка'}`);
  res.json(result);
});

router.get('/admin/stats', requireAdmin, (req, res) => {
  const reports = store.listReports();
  const counts = { total: reports.length, pending: 0, approved: 0, rejected: 0 };
  const today = new Date().toISOString().slice(0, 10);
  let todayCount = 0;
  for (const r of reports) {
    if (counts[r.status] !== undefined) counts[r.status] += 1;
    if (String(r.createdAt || '').slice(0, 10) === today) todayCount += 1;
  }
  res.json({
    ...counts,
    today: todayCount,
    latest: reports.slice(0, 6),
    activity: store.listActivity(15)
  });
});

router.get('/healthz', (req, res) => res.json({ ok: true }));

module.exports = router;
