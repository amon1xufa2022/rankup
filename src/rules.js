'use strict';

const { listReports } = require('./store');

// Москва — UTC+3 круглый год (без перехода на летнее время)
const MSK_OFFSET_MS = 3 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// Ближайшее 04:00 МСК строго ПОСЛЕ указанного момента
function nextMsk4amAfter(d) {
  const t = d.getTime();
  const msk = new Date(t + MSK_OFFSET_MS);
  let candidate = Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate(), 4, 0, 0) - MSK_OFFSET_MS;
  if (candidate <= t) candidate += DAY_MS;
  return new Date(candidate);
}

// «20 ноября в 04:00» по-московски
function formatMsk(d) {
  try {
    return new Intl.DateTimeFormat('ru-RU', {
      timeZone: 'Europe/Moscow',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit'
    }).format(d) + ' МСК';
  } catch {
    return d.toISOString();
  }
}

// Можно ли пользователю подать новый отчёт прямо сейчас
// Возвращает { locked, reason, message, until (ISO|null) }
function getReportLock(userId) {
  const uid = String(userId);
  const mine = listReports().filter(r => r.userId === uid);

  // 1) Есть заявка на рассмотрении → вторая недоступна
  const pending = mine.find(r => r.status === 'pending');
  if (pending) {
    return {
      locked: true,
      reason: 'pending',
      message: 'У вас уже есть отчёт на рассмотрении. Дождитесь решения Инструктора — тогда можно будет подать следующий.',
      until: null
    };
  }

  // 2) Отчёт одобрен → до 04:00 МСК следующего отсчёта подавать нельзя
  const latestApproved = mine
    .filter(r => r.status === 'approved' && r.reviewedAt)
    .sort((a, b) => new Date(b.reviewedAt) - new Date(a.reviewedAt))[0];

  if (latestApproved) {
    const until = nextMsk4amAfter(new Date(latestApproved.reviewedAt));
    if (Date.now() < until.getTime()) {
      return {
        locked: true,
        reason: 'cooldown',
        message: 'Ваш отчёт одобрен. Следующий можно будет подать после 04:00 МСК — ' + formatMsk(until) + '.',
        until: until.toISOString()
      };
    }
  }

  return { locked: false, reason: null, message: null, until: null };
}

module.exports = { getReportLock, nextMsk4amAfter };
