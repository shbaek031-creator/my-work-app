// 정적 파일 + /api/ai (AI 밥상 물가 캐스터)
// 실행: ANTHROPIC_API_KEY 환경 변수를 둔 채로 `npm start`

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Anthropic from '@anthropic-ai/sdk';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 4175);
const MODEL = 'claude-opus-5-5';
const MAX_ITEMS = 5;
const MAX_BODY = 10_000;

// 화면에 내보내지 않을 경로
const HIDDEN = new Set(['node_modules', 'server.js', 'package.json', 'package-lock.json']);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const SYSTEM_PROMPT = `당신은 "AI 밥상 물가 캐스터"입니다. 사용자가 가격이 내린 식재료 목록을 주면, 그 식재료로 만들 수 있는 오늘 저녁 밥상 메뉴를 제안합니다.

- 세 문장 이내의 한국어 존댓말로, 다정한 방송 캐스터 말투로 씁니다.
  예: "오늘 저녁은 18.5% 내린 오이를 활용한 오이무침이나 오이냉국은 어떠세요?"
- 목록에 있는 식재료를 중심으로 메뉴를 고릅니다.
- 숫자는 목록에 적힌 하락률을 그대로만 씁니다. 가격, 금액, 다른 비율 등 목록에 없는 숫자는 새로 만들거나 바꾸지 않습니다.
- 목록에 없는 식재료의 가격이 내렸다고 말하지 않습니다.
- 인사말이나 머리말 없이 제안 문장만 씁니다.`;

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) return null;
  client ??= new Anthropic();
  return client;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// 화면이 계산해 보낸 { basis, items: [{ name, drop }] }를 검사
function parseRequest(text) {
  const body = JSON.parse(text);
  const basis = typeof body.basis === 'string' ? body.basis.slice(0, 20) : '';
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_ITEMS) return null;
  const items = body.items.map((it) => ({
    name: typeof it?.name === 'string' ? it.name.trim().slice(0, 40) : '',
    drop: typeof it?.drop === 'string' ? it.drop.trim() : '',
  }));
  if (items.some((it) => !it.name || !/^\d{1,4}(\.\d)?$/.test(it.drop))) return null;
  return { basis, items };
}

async function handleAi(req, res) {
  let input;
  try {
    input = parseRequest(await readBody(req));
  } catch {
    input = null;
  }
  if (!input) return sendJson(res, 400, { error: '보낸 품목 형식이 올바르지 않습니다' });

  const anthropic = getClient();
  if (!anthropic) return sendJson(res, 503, { error: '서버에 AI 키(ANTHROPIC_API_KEY)가 설정되지 않았습니다' });

  const list = input.items.map((it) => `- ${it.name}: ${it.drop}% 내림`).join('\n');
  const basisText = input.basis ? `${input.basis} 대비 ` : '';
  const userText = `${basisText}가격이 내린 식재료입니다.\n${list}\n\n이 식재료로 오늘 저녁 밥상 메뉴를 제안해 주세요.`;

  try {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 2048,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userText }],
    });

    if (response.stop_reason === 'refusal') {
      return sendJson(res, 502, { error: 'AI가 이번 요청에 답하지 않았습니다' });
    }
    const text = response.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('')
      .trim();
    if (!text) return sendJson(res, 502, { error: 'AI 답이 비어 있습니다' });
    return sendJson(res, 200, { text });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return sendJson(res, 502, { error: '서버의 AI 키가 올바르지 않습니다' });
    }
    if (err instanceof Anthropic.RateLimitError) {
      return sendJson(res, 429, { error: 'AI 요청이 많습니다. 잠시 뒤 다시 눌러 주세요' });
    }
    if (err instanceof Anthropic.APIError) {
      console.error('Anthropic API error', err.status, err.message);
      return sendJson(res, 502, { error: 'AI를 부르지 못했습니다' });
    }
    console.error(err);
    return sendJson(res, 500, { error: 'AI를 부르지 못했습니다' });
  }
}

function serveStatic(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  const first = pathname.split('/').filter(Boolean)[0] ?? '';
  let file = path.join(ROOT, pathname);
  if (!file.startsWith(ROOT) || HIDDEN.has(first) || first.startsWith('.')) {
    res.writeHead(404);
    return res.end('Not found');
  }
  fs.stat(file, (err, st) => {
    // 폴더 주소는 끝에 / 를 붙여야 상대 경로(styles.css 등)가 맞게 풀림
    if (!err && st.isDirectory() && !pathname.endsWith('/')) {
      res.writeHead(301, { Location: `${pathname}/` });
      return res.end();
    }
    if (!err && st.isDirectory()) file = path.join(file, 'index.html');
    fs.readFile(file, (err2, data) => {
      if (err2) {
        res.writeHead(404);
        return res.end('Not found');
      }
      res.writeHead(200, {
        'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    });
  });
}

http
  .createServer((req, res) => {
    if (req.url === '/api/ai') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'POST만 받습니다' });
      return handleAi(req, res);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405);
      return res.end();
    }
    return serveStatic(req, res);
  })
  .listen(PORT, '127.0.0.1', () => {
    const keyNote = getClient() ? '' : ' (ANTHROPIC_API_KEY 없음: /api/ai는 503)';
    console.log(`http://localhost:${PORT}/${keyNote}`);
  });
