'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const session = require('express-session');

const app = express();
app.set('trust proxy', 1); // чтобы secure-cookie работали за HTTPS-прокси

// Динамика (API и авторизация) — запрещаем кешировать на edge/прокси
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) {
    res.setHeader('Cache-Control', 'no-store');
  }
  next();
});

// Базовые security-заголовки
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(express.json({ limit: '256kb' }));

const demoMode = String(process.env.DEMO_MODE || '').toLowerCase() === 'true';
const secret = process.env.SESSION_SECRET;
if (!secret && process.env.NODE_ENV === 'production') {
  console.warn('⚠  SESSION_SECRET не задан — сессии будут подписаны временным секретом. Задайте SESSION_SECRET в .env!');
}
if (demoMode) {
  console.warn('⚠  DEMO_MODE=true — любой посетитель может войти как Инструктор/Админ. Не используйте на боевом сервере!');
}

app.use(session({
  name: 'rankup.sid',
  secret: secret || 'rankup-dev-secret-do-not-use-in-prod',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: 'auto',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

// Маршруты
app.use('/auth', require('./src/routes-auth'));
app.use('/api', require('./src/routes-api'));

// Статика
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));

// SPA-fallback для остальных путей
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/auth/')) return next();
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 для API
app.use('/api', (req, res) => res.status(404).json({ error: 'Метод не найден' }));

// Единый обработчик ошибок
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

const PORT = Number(process.env.PORT) || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✓ RankUp запущен: http://localhost:${PORT}`);
  if (!process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET) {
    console.log('ℹ  Discord OAuth не настроен. Заполните .env (см. README.md) или включите DEMO_MODE=true для предпросмотра.');
  }
});
