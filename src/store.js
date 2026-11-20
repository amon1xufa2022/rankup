'use strict';

const fs = require('fs');
const path = require('path');
const { defaultSettings } = require('./defaults');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILES = {
  settings: path.join(DATA_DIR, 'settings.json'),
  reports: path.join(DATA_DIR, 'reports.json'),
  activity: path.join(DATA_DIR, 'activity.json')
};

// ── Низкоуровневое атомарное JSON-хранилище ───────────────────
function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return typeof fallback === 'function' ? fallback() : fallback;
  }
}

function writeJSON(file, obj) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  fs.renameSync(tmp, file); // атомарная замена — файл не «побьётся» при сбое
}

function uid(prefix) {
  return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Настройки ────────────────────────────────────────────────
function getSettings() {
  const stored = readJSON(FILES.settings, null);
  if (!stored || typeof stored !== 'object') return defaultSettings();
  // Мягкое слияние: новые ключи из дефолтов появятся сами
  const merged = { ...defaultSettings(), ...stored };
  if (!Array.isArray(merged.fields)) merged.fields = defaultSettings().fields;
  if (!Array.isArray(merged.hierarchy)) merged.hierarchy = defaultSettings().hierarchy;
  return merged;
}

function saveSettings(settings) {
  writeJSON(FILES.settings, settings);
}

function resetSettings() {
  const fresh = defaultSettings();
  saveSettings(fresh);
  return fresh;
}

// ── Отчёты ───────────────────────────────────────────────────
function listReports() {
  return readJSON(FILES.reports, []);
}

function getReport(id) {
  return listReports().find(r => r.id === id) || null;
}

function addReport(report) {
  const reports = listReports();
  reports.unshift(report);
  writeJSON(FILES.reports, reports);
  return report;
}

function updateReport(id, patch) {
  const reports = listReports();
  const idx = reports.findIndex(r => r.id === id);
  if (idx === -1) return null;
  reports[idx] = { ...reports[idx], ...patch };
  writeJSON(FILES.reports, reports);
  return reports[idx];
}

function deleteReport(id) {
  const reports = listReports();
  const idx = reports.findIndex(r => r.id === id);
  if (idx === -1) return false;
  reports.splice(idx, 1);
  writeJSON(FILES.reports, reports);
  return true;
}

// ── Журнал активности ────────────────────────────────────────
function listActivity(limit) {
  const items = readJSON(FILES.activity, []);
  return typeof limit === 'number' ? items.slice(0, limit) : items;
}

function logActivity(actor, action, details) {
  const items = readJSON(FILES.activity, []);
  items.unshift({
    id: uid('log'),
    at: new Date().toISOString(),
    actorId: actor && actor.id ? String(actor.id) : null,
    actorName: actor && actor.name ? actor.name : 'Система',
    action,
    details: details || ''
  });
  writeJSON(FILES.activity, items.slice(0, 300));
}

module.exports = {
  getSettings,
  saveSettings,
  resetSettings,
  listReports,
  getReport,
  addReport,
  updateReport,
  deleteReport,
  listActivity,
  logActivity,
  uid
};
