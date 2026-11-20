'use strict';

const { getSettings } = require('./store');

// Супер-админы из .env — всегда полный доступ (нужно для первой настройки)
function superAdminIds() {
  return String(process.env.ADMIN_DISCORD_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
}

function isSuperAdmin(userId) {
  return superAdminIds().includes(String(userId));
}

// Уровень пользователя по иерархии ролей из настроек сайта
function computeRoleLevel(memberRoleIds, hierarchy) {
  let max = 0;
  const roles = Array.isArray(memberRoleIds) ? memberRoleIds : [];
  for (const row of hierarchy || []) {
    if (row && row.roleId && roles.includes(String(row.roleId))) {
      const lvl = Number(row.level) || 0;
      if (lvl > max) max = lvl;
    }
  }
  return max;
}

// Возвращает { level, isApprover, isAdmin, isSuperAdmin }
function getPermissions(req) {
  const settings = getSettings();
  const user = req.session && req.session.user;
  if (!user) {
    return { settings, level: 0, isApprover: false, isAdmin: false, isSuperAdmin: false, authenticated: false };
  }

  let level = 0;
  if (user.demoAs) {
    // Демо-режим: роль выбирается кнопкой на сайте
    if (user.demoAs === 'admin') level = 99;
    else if (user.demoAs === 'instructor') level = Number(settings.approverMinLevel) || 2;
    else level = 0;
  } else {
    level = computeRoleLevel(user.roles, settings.hierarchy);
  }

  const superA = isSuperAdmin(user.id);
  const isAdmin = superA || level >= (Number(settings.adminMinLevel) || 99);
  const isApprover = superA || isAdmin || level >= (Number(settings.approverMinLevel) || 2);

  return { settings, level, isApprover, isAdmin, isSuperAdmin: superA, authenticated: true };
}

function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Нужно войти через Discord' });
  }
  next();
}

function requireApprover(req, res, next) {
  const perm = getPermissions(req);
  if (!perm.authenticated) return res.status(401).json({ error: 'Нужно войти через Discord' });
  if (!perm.isApprover) return res.status(403).json({ error: 'Нет доступа: нужна роль уровня «Инструктор» и выше' });
  req.perm = perm;
  next();
}

function requireAdmin(req, res, next) {
  const perm = getPermissions(req);
  if (!perm.authenticated) return res.status(401).json({ error: 'Нужно войти через Discord' });
  if (!perm.isAdmin) return res.status(403).json({ error: 'Нет доступа: только администрация' });
  req.perm = perm;
  next();
}

module.exports = { getPermissions, requireAuth, requireApprover, requireAdmin, isSuperAdmin };
