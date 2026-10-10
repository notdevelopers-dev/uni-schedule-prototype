// Мок експорту деканату для перевірки збирача без запитів до справжнього сервера.
//   node scripts/mock-dekanat.mjs [пакет.json]        (за замовчуванням site/data.json)
//   ENDPOINT=http://127.0.0.1:8765/ OUT=/tmp/out.json node scripts/fetch-schedule.mjs
// Віддає obj_list і розклади груп з наявного пакета. CODE=-8 (чи інший код) — так відповідатиме кожен rozklad.
// Кожен запит пишеться в stderr, щоб було видно, скільки їх зробив збирач.

import http from 'node:http';
import { readFileSync } from 'node:fs';

const file = process.argv[2] ?? new URL('../site/data.json', import.meta.url).pathname;
const bundle = JSON.parse(readFileSync(file, 'utf8'));
const byId = new Map((bundle.schedules ?? []).map((s) => [String(s.id), s.export]));
const port = Number(process.env.PORT ?? 8765);

http.createServer((req, res) => {
  const q = new URL(req.url, 'http://mock').searchParams;
  console.error(`запит: ${q.get('req_type')} ${q.get('OBJ_ID') ?? ''} ${q.get('begin_date') ?? ''}–${q.get('end_date') ?? ''}`);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  let body;
  if (q.get('req_type') === 'obj_list') body = bundle.lists?.group ?? { psrozklad_export: { departments: [], code: '0' } };
  else if (process.env.CODE) body = { psrozklad_export: { roz_items: [], code: process.env.CODE } };
  else body = byId.get(q.get('OBJ_ID')) ?? { psrozklad_export: { roz_items: [], code: '-4' } };
  res.end(JSON.stringify(body));
}).listen(port, () => console.error(`мок деканату: http://127.0.0.1:${port}/ (дані з ${file})`));
