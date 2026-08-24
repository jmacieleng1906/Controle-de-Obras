// Autenticação simples por sessão assinada (sem dependências externas)
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// Segredo usado para assinar os tokens de sessão. Gerado uma vez e salvo em disco
// para sobreviver a reinícios do servidor (todas as sessões continuam válidas).
const SECRET_PATH = path.join(__dirname, 'data', '.session_secret');
let SECRET;
if (fs.existsSync(SECRET_PATH)) {
  SECRET = fs.readFileSync(SECRET_PATH, 'utf8').trim();
} else {
  SECRET = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
  fs.writeFileSync(SECRET_PATH, SECRET, { mode: 0o600 });
}

const SESSION_DAYS = 30;

function sign(payloadObj) {
  const payload = Buffer.from(JSON.stringify(payloadObj)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verify(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  if (sig !== expected) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (obj.exp && Date.now() > obj.exp) return null;
    return obj;
  } catch {
    return null;
  }
}

function createSessionToken(user) {
  return sign({
    uid: user.id,
    nome: user.nome,
    usuario: user.usuario,
    papel: user.papel,
    exp: Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000,
  });
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const cookies = {};
  if (!header) return cookies;
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    cookies[key] = decodeURIComponent(val);
  });
  return cookies;
}

function getSessionUser(req) {
  const cookies = parseCookies(req);
  const token = cookies['obras_session'];
  return verify(token);
}

module.exports = { createSessionToken, getSessionUser, parseCookies, SESSION_DAYS };
