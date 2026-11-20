'use strict';

// ── Значения по умолчанию ──────────────────────────────────
// Всё это администратор может изменить прямо на сайте, в разделе «Управление».

const DEFAULT_RANKS = ['Рекрут', 'Боец', 'Старший боец', 'Ветеран', 'Элита'];

function defaultFields() {
  return [
    {
      id: 'nickname',
      label: 'Ваш никнейм',
      type: 'text',
      required: true,
      placeholder: 'Например: Shadow#1337',
      help: '',
      options: []
    },
    {
      id: 'current_rank',
      label: 'Текущий ранг',
      type: 'select',
      required: true,
      placeholder: '',
      help: '',
      options: [...DEFAULT_RANKS]
    },
    {
      id: 'target_rank',
      label: 'Ранг, на который претендуете',
      type: 'select',
      required: true,
      placeholder: '',
      help: '',
      options: [...DEFAULT_RANKS]
    },
    {
      id: 'activity',
      label: 'Что сделано / за что просите повышение',
      type: 'textarea',
      required: true,
      placeholder: 'Опишите проделанную работу, мероприятия, активность...',
      help: 'Чем подробнее — тем быстрее рассмотрят заявку',
      options: []
    },
    {
      id: 'proof',
      label: 'Ссылка на доказательство',
      type: 'url',
      required: false,
      placeholder: 'https://...',
      help: 'Скриншоты, вырезки, ссылки на посты',
      options: []
    }
  ];
}

function defaultHierarchy() {
  return [
    { id: 'h_moderator',  name: 'Модератор',          roleId: '', level: 1, color: '#57F287' },
    { id: 'h_instructor', name: 'Инструктор',         roleId: '', level: 2, color: '#5865F2' },
    { id: 'h_senior',     name: 'Старший инструктор', roleId: '', level: 3, color: '#FEE75C' },
    { id: 'h_admin',      name: 'Администратор',      roleId: '', level: 4, color: '#ED4245' }
  ];
}

function defaultSettings() {
  return {
    siteTitle: 'RankUp',
    siteTagline: 'Отчёты на повышение — быстро, прозрачно, в вашем Discord',
    guildId: '',
    webhookUrl: '',
    webhookName: '',
    approverMinLevel: 2,
    adminMinLevel: 4,
    fields: defaultFields(),
    hierarchy: defaultHierarchy()
  };
}

module.exports = { defaultSettings, defaultFields, defaultHierarchy, DEFAULT_RANKS };
