#!/usr/bin/env node
// set-effort.js — переводит extra_data_json сессии на другой порог рассуждения.
//
// Использование:
//   node set-effort.js <low|medium|high|xhigh|max> [--in <файл>]
//   <blob> | node set-effort.js medium
//
// На stdout — исправленный blob одной строкой (compact JSON), готовый к передаче
// в session_update.extra_data_json. Диагностика — в stderr.
//
// Скрипт меняет только значения effort. Все остальные поля (query, team_policy,
// device_platform, model_resolution, provider_id, model_id, context_limit)
// сохраняются как есть — иначе сессия теряет настройки.
//
// Глубину рассуждения определяет ПЛОСКОЕ поле model.thinking_effort — замерено:
// flat=low при nested=max даёт low-глубину, flat=max при nested=low даёт max.
// Вложенное model.thinking.effort — зеркало: само по себе глубину не меняет,
// но пишется синхронно, чтобы поля не расходились.

const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'];

function fail(msg) {
  process.stderr.write('set-effort: ' + msg + '\n');
  process.exit(1);
}

function usage() {
  process.stderr.write(
    'Использование:\n' +
    '  node set-effort.js <' + LEVELS.join('|') + '> [--in <файл>]\n' +
    '  <blob> | node set-effort.js ' + LEVELS[1] + '\n'
  );
}

const argv = process.argv.slice(2);
if (argv.includes('--help') || argv.includes('-h')) {
  usage();
  process.exit(0);
}

let effort = null;
let inFile = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--in') {
    inFile = argv[++i];
    if (!inFile) fail('--in требует путь к файлу');
  } else if (a.startsWith('--')) {
    fail('неизвестный флаг ' + a);
  } else if (effort === null) {
    effort = a;
  } else {
    fail('лишний аргумент ' + a);
  }
}

if (!effort) {
  usage();
  fail('не указан порог рассуждения');
}
if (!LEVELS.includes(effort)) {
  fail('порог «' + effort + '» неизвестен; допустимы: ' + LEVELS.join(', '));
}

const fs = require('fs');

function readInput() {
  if (inFile) {
    try {
      return fs.readFileSync(inFile, 'utf8');
    } catch (e) {
      fail('не читается ' + inFile + ': ' + e.message);
    }
  }
  try {
    return fs.readFileSync(0, 'utf8');
  } catch (e) {
    fail('не читается stdin: ' + e.message);
  }
}

const raw = readInput().trim();
if (!raw) fail('пустой вход — нечего патчить');

let blob;
try {
  blob = JSON.parse(raw);
} catch (e) {
  fail('вход не разбирается как JSON: ' + e.message);
}
if (blob === null || typeof blob !== 'object' || Array.isArray(blob)) {
  fail('ожидался JSON-объект extra_data_json, получено: ' + (Array.isArray(blob) ? 'массив' : typeof blob));
}

// Снимок того, что не должно измениться.
const beforeTop = Object.keys(blob).sort();
const beforeModel = blob.model && typeof blob.model === 'object' ? Object.keys(blob.model).sort() : null;

if ('model' in blob && (typeof blob.model !== 'object' || blob.model === null || Array.isArray(blob.model))) {
  fail('поле model не объект — переписывать его нельзя; разбираться вручную');
}
if (!('model' in blob)) {
  blob.model = {};
}
if (!blob.model.thinking || typeof blob.model.thinking !== 'object' || Array.isArray(blob.model.thinking)) {
  blob.model.thinking = {};
}
if (!('variant' in blob.model)) {
  blob.model.variant = 'thinking';
}

blob.model.thinking.effort = effort;
blob.model.thinking_effort = effort;
// Верхнеуровневый thinking_effort встречается в части сессий — синхронизируем,
// если он там есть, но не создаём новый.
if ('thinking_effort' in blob) blob.thinking_effort = effort;

// Контроль: удалять ключи нельзя, добавлять в model — только из белого списка.
const afterTop = Object.keys(blob).sort();
const afterModel = Object.keys(blob.model).sort();
const addedTop = afterTop.filter(k => !beforeTop.includes(k));
const removedTop = beforeTop.filter(k => !afterTop.includes(k));
if (addedTop.length || removedTop.length) {
  fail('состав ключей изменился — отмена; добавлены: ' + JSON.stringify(addedTop) +
       ', удалены: ' + JSON.stringify(removedTop));
}
if (beforeModel) {
  const ALLOWED = ['thinking', 'thinking_effort', 'variant'];
  const addedModel = afterModel.filter(k => !beforeModel.includes(k) && !ALLOWED.includes(k));
  const removedModel = beforeModel.filter(k => !afterModel.includes(k));
  if (addedModel.length || removedModel.length) {
    fail('состав ключей model изменился — отмена; добавлены: ' + JSON.stringify(addedModel) +
         ', удалены: ' + JSON.stringify(removedModel));
  }
}

const out = JSON.stringify(blob);
const parsed = JSON.parse(out);
// Контролируем оба поля: плоское — эффективное, вложенное — зеркало.
if (parsed.model.thinking_effort !== effort || parsed.model.thinking.effort !== effort) {
  fail('контроль не пройден: effort не записан');
}

process.stdout.write(out + '\n');
