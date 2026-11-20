'use strict';

/* ══════════════════════════════════════════════════════════
   RankUp — клиентская логика
   ══════════════════════════════════════════════════════════ */

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => [...(root || document).querySelectorAll(sel)];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
}[c]));

const nl2br = (s) => esc(s).replace(/\n/g, '<br>');

const fmtDateTime = (iso) => {
  try {
    return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  } catch { return String(iso || ''); }
};

async function api(path, opts) {
  const res = await fetch(path, {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...(opts || {})
  });
  let data = null;
  try { data = await res.json(); } catch { /* пустое тело */ }
  if (!res.ok) {
    const msg = (data && data.error) || ('Ошибка ' + res.status);
    throw new Error(msg);
  }
  return data;
}

// ── Тосты ─────────────────────────────────────
function toast(message, type) {
  type = type || 'info';
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.innerHTML = '<div>' + esc(message) + '</div>';
  box.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(40px)';
    setTimeout(() => el.remove(), 250);
  }, 4600);
}

function fallbackAvatar(name) {
  const initials = String(name || '?').trim().split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#5865F2"/><text x="50%" y="53%" font-size="38" fill="#ffffff" font-family="Segoe UI, Arial" font-weight="700" text-anchor="middle" dominant-baseline="middle">${esc(initials)}</text></svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

const STATUS = { pending: 'Ожидает', approved: 'Одобрено', rejected: 'Отклонено' };
const ACTION_LABELS = {
  login: 'выполнил(а) вход',
  report_created: 'создал(а) отчёт',
  report_approved: 'одобрил(а) отчёт',
  report_rejected: 'отклонил(а) отчёт',
  report_deleted: 'удалил(а) отчёт',
  settings_updated: 'обновил(а) настройки',
  settings_reset: 'сбросил(а) настройки',
  webhook_sent: 'вебхук отправлен',
  webhook_failed: 'ошибка вебхука',
  webhook_test_ok: 'тест вебхука успешен',
  webhook_test_failed: 'тест вебхука не удался'
};

let me = null;              // /api/me
let currentFields = [];     // поля формы (из /api/me)
let fieldLabels = {};       // id -> label
let currentApproveStatus = 'pending';
let pendingReview = null;   // { id, decision, userName }

/* ══════════════════════════════════════════════════════════
   Запуск
   ══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', init);

async function init() {
  bindStaticHandlers();

  const params = new URLSearchParams(location.search);
  const err = params.get('error');
  if (err) {
    toast(err, 'error');
    history.replaceState(null, '', '/');
  }

  let boot = { siteTitle: 'RankUp', siteTagline: '', oauthReady: false, demoMode: false };
  try { boot = await api('/api/bootstrap'); } catch { /* сервер отвечает статикой — ок */ }
  applyBrand(boot.siteTitle, boot.siteTagline);

  try { me = await api('/api/me'); } catch { me = { authenticated: false }; }

  // Демо-баннер
  const demoOn = Boolean(boot.demoMode || (me && me.demoMode));
  $('#demoBanner').classList.toggle('hidden', !demoOn);

  if (!me || !me.authenticated) {
    showLanding(boot);
  } else {
    showApp(me);
  }
}

function applyBrand(title, tagline) {
  document.title = title + ' — Отчёты на повышение';
  $('#brandName').textContent = title;
  $('#footerBrand').textContent = title;
}

/* ══════════════════════════════════════════════════════════
   Лендинг
   ══════════════════════════════════════════════════════════ */
function showLanding(boot) {
  $('#landingView').classList.remove('hidden');
  $('#appView').classList.add('hidden');

  // Кнопка входа в шапке
  $('#topbarRight').innerHTML = '<a class="btn btn-discord btn-small" href="/auth/discord">Войти через Discord</a>';

  // Если OAuth не настроен — объясняем
  if (!boot.oauthReady) {
    const box = $('#oauthWarning');
    box.classList.remove('hidden');
    box.innerHTML = '<b>Discord OAuth ещё не настроен.</b>\n' +
      '1. Создайте приложение на discord.com/developers/applications\n' +
      '2. В разделе OAuth2 скопируйте Client ID и Client Secret\n' +
      '3. Добавьте Redirect URL: ' + location.origin + '/auth/discord/callback\n' +
      '4. Впишите ключи в .env и перезапустите сервер\n' +
      '(или включите DEMO_MODE=true в .env для предпросмотра)';
  }
}

/* ══════════════════════════════════════════════════════════
   Приложение (авторизован)
   ══════════════════════════════════════════════════════════ */
function showApp(data) {
  $('#landingView').classList.add('hidden');
  $('#appView').classList.remove('hidden');

  // Бренд/заголовок вкладки
  if (data.siteTitle) applyBrand(data.siteTitle, data.siteTagline);

  // Профиль
  const u = data.user;
  const avatarImg = $('#userAvatar');
  avatarImg.alt = u.displayName;
  avatarImg.onerror = () => { avatarImg.onerror = null; avatarImg.src = fallbackAvatar(u.displayName); };
  avatarImg.src = u.avatar || fallbackAvatar(u.displayName);
  $('#userDisplayName').textContent = u.displayName;
  $('#userName').textContent = u.username;
  $('#guildWarn').classList.toggle('hidden', u.onGuild !== false);
  applyReportLock(data.reportLock);

  // Бейдж уровня доступа
  const badge = $('#levelBadge');
  if (data.isAdmin) { badge.textContent = 'Администрация'; badge.classList.remove('hidden'); document.body.classList.add('is-admin'); }
  else if (data.isApprover) { badge.textContent = 'Инструктор и выше'; badge.classList.remove('hidden'); document.body.classList.add('is-approver'); }

  // Чип в шапке
  $('#topbarRight').innerHTML =
    '<div class="user-chip"><img alt="" src="' + esc(u.avatar || fallbackAvatar(u.displayName)) + '" onerror="this.onerror=null;this.src=\'' + fallbackAvatar(u.displayName).replace(/'/g, "\\'") + '\'">' +
    '<span><span class="chip-name">' + esc(u.displayName) + '</span><br><span class="chip-role">' + (data.isAdmin ? 'Администратор' : data.isApprover ? 'Инструктор+' : 'Участник') + '</span></span></div>';

  // Доступные вкладки
  $('#tabApprove').classList.toggle('hidden', !data.isApprover);
  $('#tabAdmin').classList.toggle('hidden', !data.isAdmin);

  // Поля формы
  currentFields = Array.isArray(data.fields) ? data.fields : [];
  fieldLabels = Object.fromEntries(currentFields.map(f => [f.id, f.label]));
  renderReportForm(currentFields);

  // Счётчики
  refreshMineBadge();
  if (data.isApprover) refreshPendingBadge();
}

/* ── Вкладки ─────────────────────────────────── */
function bindStaticHandlers() {
  // Вкладки приложения
  $('#tabsNav').addEventListener('click', (e) => {
    const btn = e.target.closest('.tab');
    if (!btn) return;
    activateTab(btn.dataset.tab);
  });

  // Демо-вход
  $$('#demoBanner [data-demo]').forEach(btn => {
    btn.addEventListener('click', async () => {
      try {
        await api('/api/demo/login', { method: 'POST', body: JSON.stringify({ as: btn.dataset.demo }) });
        location.reload();
      } catch (err) { toast(err.message, 'error'); }
    });
  });

  // Выход
  $('#logoutBtn').addEventListener('click', async () => {
    try { await api('/auth/logout', { method: 'POST' }); } catch { /* всё равно перезагружаем */ }
    location.reload();
  });

  // Отправка отчёта
  $('#reportForm').addEventListener('submit', onReportSubmit);

  // Фильтры очереди на одобрение
  $('#approveFilters').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg');
    if (!btn) return;
    currentApproveStatus = btn.dataset.status;
    $$('.seg', $('#approveFilters')).forEach(s => s.classList.toggle('active', s === btn));
    loadQueue();
  });

  // Фильтры лога заявок
  $('#logFilters').addEventListener('click', (e) => {
    const btn = e.target.closest('.seg');
    if (!btn) return;
    currentLogStatus = btn.dataset.status;
    $$('.seg', $('#logFilters')).forEach(s => s.classList.toggle('active', s === btn));
    loadLog();
  });

  // Кнопка «Мои отчёты» в баннере блокировки
  $('#lockGoMineBtn').addEventListener('click', () => activateTab('mine'));

  // Действия с отчётами (делегирование)
  document.addEventListener('click', onReportAction);

  // Модалка решения
  $('#reviewConfirmBtn').addEventListener('click', confirmReview);
  $$('#reviewModal [data-close-modal]').forEach(el => el.addEventListener('click', closeReviewModal));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeReviewModal(); });

  // Админ: поднавигация
  $('#adminNav').addEventListener('click', (e) => {
    const btn = e.target.closest('.admin-nav-item');
    if (!btn) return;
    const sub = btn.dataset.sub;
    $$('.admin-nav-item', $('#adminNav')).forEach(b => b.classList.toggle('active', b === btn));
    $$('.admin-sub').forEach(p => p.classList.toggle('hidden', p.id !== 'sub-' + sub));
    if (sub === 'log') loadLog();
    else if (sub === 'overview') loadAdminStats();
  });

  // Админ: сохранение секций
  $('#saveFieldsBtn').addEventListener('click', () => saveAdminSection('fields'));
  $('#saveRolesBtn').addEventListener('click', () => saveAdminSection('roles'));
  $('#saveWebhookBtn').addEventListener('click', () => saveAdminSection('webhook'));
  $('#saveSiteBtn').addEventListener('click', () => saveAdminSection('site'));

  // Админ: поля формы
  $('#addFieldBtn').addEventListener('click', addFieldRow);
  $('#fieldsEditor').addEventListener('click', onFieldEditorClick);
  $('#fieldsEditor').addEventListener('change', onFieldEditorChange);

  // Админ: иерархия ролей
  $('#addRoleRowBtn').addEventListener('click', addRoleRow);
  $('#hierarchyEditor').addEventListener('click', onHierarchyClick);

  // Админ: вебхук
  $('#toggleWebhookVisibility').addEventListener('click', () => {
    const input = $('#setWebhookUrl');
    input.type = input.type === 'password' ? 'text' : 'password';
    $('#toggleWebhookVisibility').textContent = input.type === 'password' ? 'Показать' : 'Скрыть';
  });
  $('#testWebhookBtn').addEventListener('click', testWebhook);

  // Админ: сброс настроек
  $('#resetSettingsBtn').addEventListener('click', resetSettings);
}

function activateTab(tab) {
  $$('.tab', $('#tabsNav')).forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $$('.tab-panel').forEach(p => p.classList.toggle('hidden', p.id !== 'panel-' + tab));
  if (tab === 'mine') loadMine();
  else if (tab === 'approve') loadQueue();
  else if (tab === 'admin') loadAdmin();
}

/* ══════════════════════════════════════════════════════════
   Форма отчёта
   ══════════════════════════════════════════════════════════ */
function renderReportForm(fields) {
  const host = $('#dynamicFields');
  host.innerHTML = '';

  // Пары «текущий/желаемый ранг» выводим в один ряд, если идут подряд
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    const next = fields[i + 1];
    const pairable = f.type === 'select' && next && next.type === 'select';
    if (pairable) {
      const row = document.createElement('div');
      row.className = 'form-row';
      row.appendChild(buildFieldControl(f));
      row.appendChild(buildFieldControl(next));
      host.appendChild(row);
      i++; // следующий уже добавлен
      continue;
    }
    host.appendChild(buildFieldControl(f));
  }
}

function buildFieldControl(f) {
  const wrap = document.createElement('div');
  wrap.className = 'form-field';
  const req = f.required ? '<span class="req">*</span>' : '';
  const id = 'field_' + f.id;

  let control = '';
  if (f.type === 'textarea') {
    control = `<textarea class="input textarea" id="${esc(id)}" data-field="${esc(f.id)}" rows="4" maxlength="4000" placeholder="${esc(f.placeholder || '')}"></textarea>`;
  } else if (f.type === 'select') {
    const options = (f.options || []).map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
    control = `<select class="input" id="${esc(id)}" data-field="${esc(f.id)}"><option value="">— выберите вариант —</option>${options}</select>`;
  } else {
    const typeMap = { text: 'text', url: 'url', number: 'number', date: 'date' };
    control = `<input class="input" id="${esc(id)}" data-field="${esc(f.id)}" type="${typeMap[f.type] || 'text'}" maxlength="4000" placeholder="${esc(f.placeholder || '')}" />`;
  }

  wrap.innerHTML =
    `<label class="field-label" for="${esc(id)}">${esc(f.label)}${req}</label>` +
    control +
    (f.help ? `<p class="hint">${esc(f.help)}</p>` : '');
  return wrap;
}

async function onReportSubmit(e) {
  e.preventDefault();
  const btn = $('#submitReportBtn');
  const values = {};
  $$('#dynamicFields [data-field]').forEach(el => { values[el.dataset.field] = el.value; });

  btn.disabled = true;
  try {
    await api('/api/reports', { method: 'POST', body: JSON.stringify({ values }) });
    toast('Отчёт отправлен на рассмотрение. Ожидайте решения Инструктора.', 'success');
    $('#reportForm').reset();
    refreshMineBadge();
    refreshLockState();
    if (me && me.isApprover) refreshPendingBadge();
    activateTab('mine');
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

/* ══════════════════════════════════════════════════════════
   Карточки отчётов
   ══════════════════════════════════════════════════════════ */
function valueCellHTML(fieldId, value) {
  const field = currentFields.find(f => f.id === fieldId);
  const isUrl = field && field.type === 'url';
  let v;
  if (isUrl && /^https?:\/\//i.test(String(value))) {
    const safe = esc(value);
    v = `<a href="${safe}" target="_blank" rel="noopener noreferrer">${safe}</a>`;
  } else {
    v = nl2br(String(value ?? ''));
  }
  return `<div class="kv-item"><div class="k">${esc(fieldLabels[fieldId] || fieldId)}</div><div class="v">${v || '—'}</div></div>`;
}

function webhookLineHTML(r) {
  if (r.status !== 'approved') return '';
  if (r.webhookSent === true) return '<div class="webhook-flag webhook-ok">✓ Итог отправлен в Discord по вебхуку</div>';
  if (r.webhookSent === false) return `<div class="webhook-flag webhook-fail">⚠ Вебхук не отправлен: ${esc(r.webhookError || 'ошибка')}</div>`;
  return '<div class="webhook-flag webhook-none">Вебхук не настроен — итог не отправлялся</div>';
}

function reportCardHTML(r, opts) {
  opts = opts || {};
  const values = Object.entries(r.values || {}).map(([k, v]) => valueCellHTML(k, v)).join('');
  const badge = `<span class="badge badge-${esc(r.status)}">${esc(STATUS[r.status] || r.status)}</span>`;

  let reviewLine = '';
  if (r.reviewerName) {
    const verb = r.status === 'approved' ? 'Одобрил' : 'Отклонил';
    reviewLine = `<div class="review-note"><b>${verb}:</b> ${esc(r.reviewerName)} · ${fmtDateTime(r.reviewedAt)}${r.reviewComment ? ` — «${esc(r.reviewComment)}»` : ''}</div>`;
  }

  let actions = '';
  if (opts.canReview && r.status === 'pending') {
    actions += `<button class="btn btn-green btn-small" data-action="approve" data-id="${esc(r.id)}" data-name="${esc(r.userName)}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>Одобрить</button>`;
    actions += `<button class="btn btn-red btn-small" data-action="reject" data-id="${esc(r.id)}" data-name="${esc(r.userName)}"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg>Отклонить</button>`;
  }
  if (opts.isAdmin && r.status === 'approved' && r.webhookSent === false) {
    actions += `<button class="btn btn-ghost btn-small" data-action="resend" data-id="${esc(r.id)}">Повторить отправку</button>`;
  }
  if (opts.isAdmin) {
    actions += `<button class="icon-btn danger" title="Удалить отчёт" data-action="delete" data-id="${esc(r.id)}"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>`;
  }

  const avatar = r.userAvatar
    ? `<img src="${esc(r.userAvatar)}" alt="" onerror="this.onerror=null;this.src='${fallbackAvatar(r.userName)}'">`
    : `<img src="${fallbackAvatar(r.userName)}" alt="">`;

  return `<article class="card report-card">
    <div class="report-top">
      <div class="report-user">${avatar}<div><div class="ru-name">${esc(r.userName)}</div><div class="ru-meta">${fmtDateTime(r.createdAt)} · #${esc(String(r.id).slice(-6))}</div></div></div>
      ${badge}
    </div>
    <div class="kv-grid">${values}</div>
    ${reviewLine}
    ${webhookLineHTML(r)}
    <div class="report-foot"><div class="report-actions">${actions}</div></div>
  </article>`;
}

function emptyStateHTML(title, sub) {
  return `<div class="card empty-state"><svg viewBox="0 0 24 24" width="52" height="52" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15l2 2 4-4"/></svg><h3>${esc(title)}</h3><p>${esc(sub)}</p></div>`;
}

/* ── Действия с отчётами (клик по кнопкам) ────── */
async function onReportAction(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id, name } = btn.dataset;

  if (action === 'approve' || action === 'reject') {
    openReviewModal(id, action, name);
    return;
  }
  if (action === 'resend') {
    btn.disabled = true;
    try {
      const data = await api(`/api/reports/${encodeURIComponent(id)}/resend-webhook`, { method: 'POST' });
      toast(data.webhook && data.webhook.ok ? 'Итог повторно отправлен в Discord.' : 'Не удалось отправить: ' + ((data.webhook && data.webhook.error) || 'ошибка вебхука'), data.webhook && data.webhook.ok ? 'success' : 'error');
      loadQueue();
    } catch (err) { toast(err.message, 'error'); } finally { btn.disabled = false; }
    return;
  }
  if (action === 'delete') {
    if (!confirm('Удалить этот отчёт без возможности восстановления?')) return;
    try {
      await api(`/api/reports/${encodeURIComponent(id)}`, { method: 'DELETE' });
      toast('Отчёт удалён.', 'success');
      loadQueue();
      refreshPendingBadge();
    } catch (err) { toast(err.message, 'error'); }
  }
}

/* ══════════════════════════════════════════════════════════
   Мои отчёты + очередь на одобрение
   ══════════════════════════════════════════════════════════ */
async function refreshMineBadge() {
  try {
    const data = await api('/api/reports/mine');
    const pending = (data.reports || []).filter(r => r.status === 'pending').length;
    const badge = $('#mineCount');
    badge.textContent = pending;
    badge.classList.toggle('hidden', pending === 0);
  } catch { /* не критично */ }
}

async function refreshPendingBadge() {
  try {
    const data = await api('/api/reports?status=pending');
    const n = (data.reports || []).length;
    const badge = $('#pendingCount');
    badge.textContent = n;
    badge.classList.toggle('hidden', n === 0);
  } catch { /* не критично */ }
}

async function loadMine() {
  const host = $('#mineList');
  host.innerHTML = '<div class="card report-card" style="color:var(--muted)">Загрузка…</div>';
  try {
    const data = await api('/api/reports/mine');
    const reports = data.reports || [];
    if (!reports.length) {
      host.innerHTML = emptyStateHTML('Отчётов пока нет', 'Нажмите «Отчёт на повышение» вверху и отправьте первую заявку.');
      return;
    }
    const isAdmin = Boolean(me && me.isAdmin);
    host.innerHTML = reports.map(r => reportCardHTML(r, { isAdmin })).join('');
  } catch (err) {
    host.innerHTML = '';
    toast(err.message, 'error');
  }
}

async function loadQueue() {
  const host = $('#queueList');
  host.innerHTML = '<div class="card report-card" style="color:var(--muted)">Загрузка…</div>';
  try {
    const data = await api('/api/reports?status=' + encodeURIComponent(currentApproveStatus));
    const reports = data.reports || [];
    if (!reports.length) {
      const msg = currentApproveStatus === 'pending'
        ? ['Очередь пуста', 'Все отчёты рассмотрены. Новые заявки появятся здесь автоматически.']
        : ['Ничего не найдено', 'В этом разделе пока пусто.'];
      host.innerHTML = emptyStateHTML(msg[0], msg[1]);
      return;
    }
    const isAdmin = Boolean(me && me.isAdmin);
    host.innerHTML = reports.map(r => reportCardHTML(r, { canReview: true, isAdmin })).join('');
  } catch (err) {
    host.innerHTML = '';
    toast(err.message, 'error');
  }
}

/* ── Модалка решения ─────────────────────────── */
function openReviewModal(id, decision, userName) {
  pendingReview = { id, decision, userName };
  const isApprove = decision === 'approve';
  $('#reviewModalTitle').textContent = isApprove ? 'Одобрить отчёт' : 'Отклонить отчёт';
  $('#reviewModalSub').textContent = 'От: ' + (userName || '');
  $('#reviewComment').value = '';
  const btn = $('#reviewConfirmBtn');
  btn.textContent = isApprove ? 'Одобрить' : 'Отклонить';
  btn.className = 'btn ' + (isApprove ? 'btn-green' : 'btn-red');
  $('#reviewModal').classList.remove('hidden');
  setTimeout(() => $('#reviewComment').focus(), 60);
}

function closeReviewModal() {
  pendingReview = null;
  $('#reviewModal').classList.add('hidden');
}

async function confirmReview() {
  if (!pendingReview) return;
  const { id, decision } = pendingReview;
  const comment = $('#reviewComment').value.trim();
  const btn = $('#reviewConfirmBtn');
  btn.disabled = true;
  try {
    const data = await api(`/api/reports/${encodeURIComponent(id)}/review`, {
      method: 'POST',
      body: JSON.stringify({ decision, comment })
    });
    const w = data.webhook;
    if (decision === 'approve') {
      if (w && w.ok) toast('Отчёт одобрен — итог отправлен в Discord.', 'success');
      else if (w === null || !w) toast('Отчёт одобрен. Вебхук не настроен — итог не отправлялся.', 'warn');
      else toast('Отчёт одобрен, но вебхук не сработал: ' + (w.error || 'ошибка'), 'warn');
    } else {
      toast('Отчёт отклонён.', 'success');
    }
    closeReviewModal();
    loadQueue();
    refreshPendingBadge();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

/* ══════════════════════════════════════════════════════════
   RankUp — админ-панель «Управление сайтом»
   Использует утилиты из app.js: $, $$, esc, api, toast,
   fmtDateTime, STATUS, ACTION_LABELS, applyBrand,
   refreshMineBadge, currentFields/fieldLabels (через /api/me)
   ══════════════════════════════════════════════════════════ */

const FIELD_TYPES = [
  ['text', 'Текст'],
  ['textarea', 'Длинный текст'],
  ['select', 'Выпадающий список'],
  ['number', 'Число'],
  ['date', 'Дата'],
  ['url', 'Ссылка']
];

let adminLoaded = false;
let editingFields = [];
let editingHierarchy = [];

/* ── Загрузка админки ────────────────────────── */
async function loadAdmin() {
  loadAdminStats();
  if (adminLoaded) return;
  try {
    const data = await api('/api/admin/settings');
    applySettingsToDOM(data.settings);
    adminLoaded = true;
  } catch (err) {
    toast(err.message || 'Не удалось загрузить настройки', 'error');
  }
}

async function loadAdminStats() {
  try {
    const s = await api('/api/admin/stats');
    renderStatGrid(s);
    renderActivity(s.activity);
    renderLatest(s.latest);
  } catch { /* обзор не критичен */ }
}

function renderStatGrid(s) {
  const cards = [
    ['stat-accent', s.total, 'Всего отчётов'],
    ['stat-warn', s.pending, 'Ожидают'],
    ['stat-ok', s.approved, 'Одобрено'],
    ['stat-bad', s.rejected, 'Отклонено'],
    ['stat-accent', s.today, 'Сегодня']
  ];
  $('#statGrid').innerHTML = cards.map(([cls, num, label]) =>
    `<div class="stat-card ${cls}"><div class="s-num">${Number(num) || 0}</div><div class="s-label">${esc(label)}</div></div>`
  ).join('');
}

function renderActivity(items) {
  const host = $('#activityFeed');
  if (!items || !items.length) { host.innerHTML = '<div class="activity-item">Пока пусто — действия появятся после первых событий.</div>'; return; }
  host.innerHTML = items.map(a =>
    `<div class="activity-item"><span class="a-dot"></span><div><b>${esc(a.actorName)}</b> — ${esc(ACTION_LABELS[a.action] || a.action)}${a.details ? `<br><span style="color:var(--muted)">${esc(a.details)}</span>` : ''}</div><span class="a-time">${fmtDateTime(a.at)}</span></div>`
  ).join('');
}

function renderLatest(reports) {
  const host = $('#latestReports');
  if (!reports || !reports.length) { host.innerHTML = '<div class="activity-item">Отчётов ещё нет</div>'; return; }
  host.innerHTML = reports.map(r =>
    `<div class="latest-item"><span class="badge badge-${esc(r.status)}" style="font-size:.68rem;padding:3px 9px">${esc(STATUS[r.status] || r.status)}</span><span>${esc(r.userName)}</span><span class="a-time">${fmtDateTime(r.createdAt)}</span></div>`
  ).join('');
}

/* ── Настройки <-> DOM ───────────────────────── */
function applySettingsToDOM(s) {
  $('#setGuildId').value = s.guildId || '';
  $('#setWebhookUrl').value = s.webhookUrl || '';
  $('#setWebhookName').value = s.webhookName || '';
  $('#setApproverMin').value = s.approverMinLevel;
  $('#setAdminMin').value = s.adminMinLevel;
  $('#setSiteTitle').value = s.siteTitle || '';
  $('#setSiteTagline').value = s.siteTagline || '';
  renderFieldsEditor(s.fields || []);
  renderHierarchyEditor(s.hierarchy || []);
}

function assembleSettingsFromDOM() {
  return {
    siteTitle: $('#setSiteTitle').value.trim(),
    siteTagline: $('#setSiteTagline').value.trim(),
    guildId: $('#setGuildId').value.trim(),
    webhookUrl: $('#setWebhookUrl').value.trim(),
    webhookName: $('#setWebhookName').value.trim(),
    approverMinLevel: Number($('#setApproverMin').value),
    adminMinLevel: Number($('#setAdminMin').value),
    fields: collectFieldsFromDOM(),
    hierarchy: collectHierarchyFromDOM()
  };
}

async function saveAdminSection() {
  const body = assembleSettingsFromDOM();
  try {
    const data = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(body) });
    applySettingsToDOM(data.settings);
    applyBrand(data.settings.siteTitle, data.settings.siteTagline);
    await refreshFormFields();
    toast('Настройки сохранены.', 'success');
    loadAdminStats();
  } catch (err) {
    toast(err.message, 'error');
  }
}

async function refreshFormFields() {
  try {
    const d = await api('/api/me');
    if (d.authenticated) {
      currentFields = d.fields || [];
      fieldLabels = Object.fromEntries((d.fields || []).map(f => [f.id, f.label]));
      renderReportForm(d.fields || []);
    }
  } catch { /* не критично */ }
}

/* ══════════════════════════════════════════════════════════
   Редактор полей отчёта
   ══════════════════════════════════════════════════════════ */
function renderFieldsEditor(fields) {
  editingFields = JSON.parse(JSON.stringify(fields));
  drawFieldRows();
}

function drawFieldRows() {
  $('#fieldsEditor').innerHTML = editingFields.map(fieldEditorRowHTML).join('');
}

function fieldEditorRowHTML(f) {
  const typeOptions = FIELD_TYPES.map(([v, label]) =>
    `<option value="${v}" ${f.type === v ? 'selected' : ''}>${label}</option>`).join('');
  const optionsVal = esc((f.options || []).join('\n'));
  return `<div class="field-editor" data-field-id="${esc(f.id)}">
    <div class="field-editor-top">
      <span class="grip" title="Порядок поля">⋮⋮</span>
      <input type="text" class="input fe-label" value="${esc(f.label)}" placeholder="Название поля" maxlength="150">
      <select class="mini-select fe-type">${typeOptions}</select>
      <label class="mini-check"><input type="checkbox" class="fe-required" ${f.required ? 'checked' : ''}> Обязательное</label>
      <button class="icon-btn" data-move="-1" title="Переместить выше" type="button">↑</button>
      <button class="icon-btn" data-move="1" title="Переместить ниже" type="button">↓</button>
      <button class="icon-btn danger fe-delete" title="Удалить поле" type="button"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg></button>
    </div>
    <div class="field-editor-meta">
      <input type="text" class="input fe-placeholder" value="${esc(f.placeholder || '')}" placeholder="Подсказка внутри поля (placeholder)">
      <input type="text" class="input fe-help" value="${esc(f.help || '')}" placeholder="Пояснение под полем (необязательно)">
      <div class="options-wrap ${f.type === 'select' ? '' : 'hidden'}">
        <label class="field-label">Варианты выбора — каждый с новой строки (например, ранги)</label>
        <textarea class="input fe-options" rows="4" placeholder="Рекрут&#10;Боец&#10;Ветеран">${optionsVal}</textarea>
      </div>
    </div>
  </div>`;
}

function collectFieldsFromDOM() {
  const host = $('#fieldsEditor');
  if (!host) return [];
  return $$('.field-editor', host).map(row => {
    const optionsRaw = (row.querySelector('.fe-options') || {}).value || '';
    return {
      id: row.dataset.fieldId,
      label: row.querySelector('.fe-label').value.trim(),
      type: row.querySelector('.fe-type').value,
      required: row.querySelector('.fe-required').checked,
      placeholder: row.querySelector('.fe-placeholder').value.trim(),
      help: row.querySelector('.fe-help').value.trim(),
      options: optionsRaw.split('\n').map(s => s.trim()).filter(Boolean)
    };
  });
}

function addFieldRow() {
  const arr = collectFieldsFromDOM();
  arr.push({
    id: 'field_' + Math.random().toString(36).slice(2, 8),
    label: 'Новое поле',
    type: 'text',
    required: false,
    placeholder: '',
    help: '',
    options: []
  });
  editingFields = arr;
  drawFieldRows();
}

function onFieldEditorClick(e) {
  const row = e.target.closest('.field-editor');
  if (!row) return;
  const rows = $$('.field-editor', $('#fieldsEditor'));
  const idx = rows.indexOf(row);

  const moveBtn = e.target.closest('[data-move]');
  if (moveBtn) {
    const arr = collectFieldsFromDOM();
    const j = idx + Number(moveBtn.dataset.move);
    if (j < 0 || j >= arr.length) return;
    const tmp = arr[idx]; arr[idx] = arr[j]; arr[j] = tmp;
    editingFields = arr;
    drawFieldRows();
    return;
  }
  if (e.target.closest('.fe-delete')) {
    const arr = collectFieldsFromDOM();
    arr.splice(idx, 1);
    editingFields = arr;
    drawFieldRows();
  }
}

function onFieldEditorChange(e) {
  if (e.target.classList.contains('fe-type')) {
    const wrap = e.target.closest('.field-editor').querySelector('.options-wrap');
    if (wrap) wrap.classList.toggle('hidden', e.target.value !== 'select');
  }
}

/* ══════════════════════════════════════════════════════════
   Редактор иерархии ролей
   ══════════════════════════════════════════════════════════ */
function renderHierarchyEditor(hierarchy) {
  editingHierarchy = JSON.parse(JSON.stringify(hierarchy));
  drawRoleRows();
}

function drawRoleRows() {
  $('#hierarchyEditor').innerHTML = editingHierarchy.map(r => `
    <div class="role-row" data-row-id="${esc(r.id)}">
      <input type="number" class="input hr-level" min="0" max="99" value="${Number(r.level) || 0}" title="Уровень (чем больше, тем выше роль)">
      <input type="text" class="input hr-name" value="${esc(r.name)}" placeholder="Название (например: Инструктор)" maxlength="100">
      <input type="text" class="input role-id-input hr-roleid" value="${esc(r.roleId || '')}" placeholder="ID роли: 123456789012345678" inputmode="numeric" maxlength="25" spellcheck="false">
      <input type="color" class="role-color hr-color" value="${esc(r.color || '#5865F2')}" title="Цвет роли">
      <button class="icon-btn danger hr-delete" title="Удалить роль" type="button"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18M6 6l12 12"/></svg></button>
    </div>`).join('');
}

function collectHierarchyFromDOM() {
  const host = $('#hierarchyEditor');
  if (!host) return [];
  return $$('.role-row', host).map(row => ({
    id: row.dataset.rowId,
    level: Number(row.querySelector('.hr-level').value),
    name: row.querySelector('.hr-name').value.trim(),
    roleId: row.querySelector('.hr-roleid').value.trim(),
    color: row.querySelector('.hr-color').value
  }));
}

function addRoleRow() {
  const arr = collectHierarchyFromDOM();
  const maxLevel = arr.reduce((m, r) => Math.max(m, Number(r.level) || 0), 0);
  arr.push({ id: 'h_' + Math.random().toString(36).slice(2, 8), name: '', roleId: '', level: maxLevel + 1, color: '#5865F2' });
  editingHierarchy = arr;
  drawRoleRows();
}

function onHierarchyClick(e) {
  const btn = e.target.closest('.hr-delete');
  if (!btn) return;
  const row = btn.closest('.role-row');
  const idx = $$('.role-row', $('#hierarchyEditor')).indexOf(row);
  const arr = collectHierarchyFromDOM();
  arr.splice(idx, 1);
  editingHierarchy = arr;
  drawRoleRows();
}

/* ══════════════════════════════════════════════════════════
   Вебхук и опасная зона
   ══════════════════════════════════════════════════════════ */
async function testWebhook() {
  const btn = $('#testWebhookBtn');
  btn.disabled = true;
  try {
    // Сначала сохраняем то, что вписано в форму — тест пойдёт по актуальному URL
    const body = assembleSettingsFromDOM();
    const saved = await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify(body) });
    applySettingsToDOM(saved.settings);
    const res = await api('/api/admin/test-webhook', { method: 'POST' });
    toast(res.ok ? 'Тестовое сообщение отправлено — проверьте канал.' : 'Вебхук не сработал: ' + (res.error || 'ошибка'), res.ok ? 'success' : 'error');
    loadAdminStats();
  } catch (err) {
    toast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

async function resetSettings() {
  if (!confirm('Сбросить все настройки (поля, роли, уровни, вебхук, название) к умолчаниям?\nОтчёты пользователей при этом сохранятся.')) return;
  try {
    const data = await api('/api/admin/reset-settings', { method: 'POST' });
    applySettingsToDOM(data.settings);
    applyBrand(data.settings.siteTitle, data.settings.siteTagline);
    await refreshFormFields();
    toast('Настройки сброшены к значениям по умолчанию.', 'success');
    loadAdminStats();
  } catch (err) {
    toast(err.message, 'error');
  }
}

/* ══════════════════════════════════════════════════════════
   Блокировка подачи (1 заявка в работе + кулдаун до 04:00 МСК)
   ══════════════════════════════════════════════════════════ */
function applyReportLock(lock) {
  const notice = $('#reportLockNotice');
  const wrap = $('#reportFormWrap');
  if (!notice || !wrap) return;
  if (lock && lock.locked) {
    $('#reportLockText').textContent = lock.message || '';
    notice.classList.remove('hidden');
    wrap.classList.add('hidden');
  } else {
    notice.classList.add('hidden');
    wrap.classList.remove('hidden');
  }
}

async function refreshLockState() {
  try {
    const d = await api('/api/me');
    if (d.authenticated) applyReportLock(d.reportLock);
  } catch { /* не критично */ }
}

/* ══════════════════════════════════════════════════════════
   Лог заявок (админка)
   ══════════════════════════════════════════════════════════ */
let currentLogStatus = 'all';

async function loadLog() {
  const host = $('#logList');
  if (!host) return;
  host.innerHTML = '<div class="card report-card" style="color:var(--muted)">Загрузка…</div>';
  try {
    const data = await api('/api/reports?status=' + encodeURIComponent(currentLogStatus));
    const reports = data.reports || [];
    if (!reports.length) {
      host.innerHTML = emptyStateHTML('Заявок нет', 'В выбранном фильтре пусто.');
      return;
    }
    host.innerHTML = reports.map(r => reportCardHTML(r, { isAdmin: Boolean(me && me.isAdmin) })).join('');
  } catch (err) {
    host.innerHTML = '';
    toast(err.message, 'error');
  }
}
