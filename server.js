// Servidor do app "Controle de Obras" — 100% Node.js nativo (sem dependências externas,
// não precisa de `npm install`). Usa node:http, node:sqlite e node:crypto.
const http = require('node:http');
const url = require('node:url');
const path = require('node:path');
const fs = require('node:fs');

const { db, hashPassword, verifyPassword } = require('./db.js');
const { createSessionToken, getSessionUser, SESSION_DAYS } = require('./auth.js');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- utilidades ----------

function sendJSON(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 5 * 1024 * 1024) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function setSessionCookie(res, token) {
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  res.setHeader('Set-Cookie', `obras_session=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'obras_session=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, '');
  const fullPath = path.join(PUBLIC_DIR, filePath);
  if (!fullPath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  fs.readFile(fullPath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Não encontrado');
    }
    const ext = path.extname(fullPath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

// ---------- helpers de dados ----------

function publicUser(u) {
  if (!u) return null;
  return { id: u.id, nome: u.nome, usuario: u.usuario, papel: u.papel, ativo: !!u.ativo };
}

function casaComResumo(casa) {
  const resumo = db.prepare(`
    SELECT
      COALESCE(SUM(valor_total), 0) as gasto_total,
      COALESCE(SUM(CASE WHEN status_pagamento = 'pago' THEN valor_total ELSE 0 END), 0) as pago_total,
      COALESCE(SUM(CASE WHEN status_pagamento = 'pendente' THEN valor_total ELSE 0 END), 0) as pendente_total,
      COUNT(*) as total_compras
    FROM compras WHERE casa_id = ?
  `).get(casa.id);
  const resumoReceita = db.prepare(`
    SELECT
      COALESCE(SUM(valor), 0) as receita_total,
      COALESCE(SUM(CASE WHEN status_recebimento = 'recebido' THEN valor ELSE 0 END), 0) as recebido_total,
      COALESCE(SUM(CASE WHEN status_recebimento = 'pendente' THEN valor ELSE 0 END), 0) as receita_pendente_total,
      COUNT(*) as total_receitas
    FROM receitas WHERE casa_id = ?
  `).get(casa.id);
  return {
    ...casa,
    gasto_total: round2(resumo.gasto_total),
    pago_total: round2(resumo.pago_total),
    pendente_total: round2(resumo.pendente_total),
    total_compras: resumo.total_compras,
    receita_total: round2(resumoReceita.receita_total),
    recebido_total: round2(resumoReceita.recebido_total),
    receita_pendente_total: round2(resumoReceita.receita_pendente_total),
    total_receitas: resumoReceita.total_receitas,
    saldo_casa: round2(resumoReceita.receita_total - resumo.gasto_total),
    saldo_orcamento: round2(casa.orcamento_previsto - resumo.gasto_total),
    percentual_orcamento: casa.orcamento_previsto > 0
      ? round2((resumo.gasto_total / casa.orcamento_previsto) * 100)
      : null,
  };
}

// ---------- rotas da API ----------
// cada handler recebe (req, res, ctx) onde ctx = { user, query, params }

const routes = [];
function route(method, pattern, handler, opts = {}) {
  // pattern tipo /api/casas/:id vira regex
  const paramNames = [];
  const regexStr = pattern.replace(/:[^/]+/g, (m) => {
    paramNames.push(m.slice(1));
    return '([^/]+)';
  });
  const regex = new RegExp(`^${regexStr}$`);
  routes.push({ method, regex, paramNames, handler, opts });
}

function requireAuth(user, res) {
  if (!user) {
    sendJSON(res, 401, { erro: 'Não autenticado' });
    return false;
  }
  return true;
}

function requireAdmin(user, res) {
  if (!user || user.papel !== 'admin') {
    sendJSON(res, 403, { erro: 'Apenas administradores podem fazer isso' });
    return false;
  }
  return true;
}

// --- autenticação ---

route('POST', '/api/login', async (req, res, ctx) => {
  const body = await readBody(req);
  const { usuario, senha } = body;
  if (!usuario || !senha) return sendJSON(res, 400, { erro: 'Informe usuário e senha' });
  const u = db.prepare('SELECT * FROM usuarios WHERE usuario = ? AND ativo = 1').get(usuario.trim());
  if (!u || !verifyPassword(senha, u.senha_hash, u.senha_salt)) {
    return sendJSON(res, 401, { erro: 'Usuário ou senha inválidos' });
  }
  const token = createSessionToken(u);
  setSessionCookie(res, token);
  sendJSON(res, 200, { usuario: publicUser(u) });
});

route('POST', '/api/logout', async (req, res) => {
  clearSessionCookie(res);
  sendJSON(res, 200, { ok: true });
});

route('GET', '/api/me', async (req, res, ctx) => {
  if (!requireAuth(ctx.user, res)) return;
  sendJSON(res, 200, { usuario: ctx.user });
});

// --- usuários (apenas admin) ---

route('GET', '/api/usuarios', async (req, res, ctx) => {
  if (!requireAdmin(ctx.user, res)) return;
  const rows = db.prepare('SELECT * FROM usuarios ORDER BY nome').all();
  sendJSON(res, 200, rows.map(publicUser));
});

route('POST', '/api/usuarios', async (req, res, ctx) => {
  if (!requireAdmin(ctx.user, res)) return;
  const body = await readBody(req);
  const { nome, usuario, senha, papel } = body;
  if (!nome || !usuario || !senha) return sendJSON(res, 400, { erro: 'Preencha nome, usuário e senha' });
  const existente = db.prepare('SELECT id FROM usuarios WHERE usuario = ?').get(usuario.trim());
  if (existente) return sendJSON(res, 400, { erro: 'Já existe um usuário com esse login' });
  const { hash, salt } = hashPassword(senha);
  const info = db.prepare(`INSERT INTO usuarios (nome, usuario, senha_hash, senha_salt, papel) VALUES (?, ?, ?, ?, ?)`)
    .run(nome.trim(), usuario.trim(), hash, salt, papel === 'admin' ? 'admin' : 'encarregado');
  const novo = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(info.lastInsertRowid);
  sendJSON(res, 201, publicUser(novo));
});

route('PUT', '/api/usuarios/:id', async (req, res, ctx) => {
  if (!requireAdmin(ctx.user, res)) return;
  const body = await readBody(req);
  const existente = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(ctx.params.id);
  if (!existente) return sendJSON(res, 404, { erro: 'Usuário não encontrado' });
  const nome = body.nome ?? existente.nome;
  const papel = body.papel === 'admin' ? 'admin' : (body.papel === 'encarregado' ? 'encarregado' : existente.papel);
  const ativo = body.ativo === undefined ? existente.ativo : (body.ativo ? 1 : 0);
  if (body.senha) {
    const { hash, salt } = hashPassword(body.senha);
    db.prepare('UPDATE usuarios SET nome=?, papel=?, ativo=?, senha_hash=?, senha_salt=? WHERE id=?')
      .run(nome, papel, ativo, hash, salt, ctx.params.id);
  } else {
    db.prepare('UPDATE usuarios SET nome=?, papel=?, ativo=? WHERE id=?').run(nome, papel, ativo, ctx.params.id);
  }
  const atualizado = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(ctx.params.id);
  sendJSON(res, 200, publicUser(atualizado));
});

// --- casas / obras ---

route('GET', '/api/casas', async (req, res, ctx) => {
  if (!requireAuth(ctx.user, res)) return;
  const rows = db.prepare('SELECT * FROM casas ORDER BY criado_em DESC').all();
  sendJSON(res, 200, rows.map(casaComResumo));
});

route('GET', '/api/casas/:id', async (req, res, ctx) => {
  if (!requireAuth(ctx.user, res)) return;
  const casa = db.prepare('SELECT * FROM casas WHERE id = ?').get(ctx.params.id);
  if (!casa) return sendJSON(res, 404, { erro: 'Casa não encontrada' });
  sendJSON(res, 200, casaComResumo(casa));
});

route('POST', '/api/casas', async (req, res, ctx) => {
  if (!requireAuth(ctx.user, res)) return;
  const body = await readBody(req);
  if (!body.nome) return sendJSON(res, 400, { erro: 'Informe o nome da casa/obra' });
  const info = db.prepare(`INSERT INTO casas (nome, endereco, cidade, orcamento_previsto, status) VALUES (?, ?, ?, ?, ?)`)
    .run(body.nome.trim(), body.endereco || '', body.cidade || '', Number(body.orcamento_previsto) || 0, body.status || 'em andamento');
  const nova = db.prepare('SELECT * FROM casas WHERE id = ?').get(info.lastInsertRowid);
  sendJSON(res, 201, casaComResumo(nova));
});

route('PUT', '/api/casas/:id', async (req, res, ctx) => {
  if (!requireAuth(ctx.user, res)) return;
  const body = await readBody(req);
  const existente = db.prepare('SELECT * FROM casas WHERE id = ?').get(ctx.params.id);
  if (!existente) return sendJSON(res, 404, { erro: 'Casa não encontrada' });
  db.prepare(`UPDATE casas SET nome=?, endereco=?, cidade=?, orcamento_previsto=?, status=? WHERE id=?`).run(
    body.nome ?? existente.nome,
    body.endereco ?? existente.endereco,
    body.cidade ?? existente.cidade,
    body.orcamento_previsto !== undefined ? Number(body.orcamento_previsto) : existente.orcamento_previsto,
    body.status ?? existente.status,
    ctx.params.id
  );
  const atualizada = db.prepare('SELECT * FROM casas WHERE id = ?').get(ctx.params.id);
  sendJSON(res, 200, casaComResumo(atualizada));
});

route('DELETE', '/api/casas/:id', async (req, res, ctx) => {
  if (!requireAdmin(ctx.user, res)) return;
  const emUsoCompras = db.prepare('SELECT COUNT(*) c FROM compras WHERE casa_id = ?').get(ctx.params.id).c;
  if (emUsoCompras > 0) return sendJSON(res, 400, { erro: 'Não é possível excluir: essa casa já tem despesas lançadas' });
  const emUsoReceitas = db.prepare('SELECT COUNT(*) c FROM receitas WHERE casa_id = ?').get(ctx.params.id).c;
  if (emUsoReceitas > 0) return sendJSON(res, 400, { erro: 'Não é possível excluir: essa casa já tem receitas lançadas' });
  db.prepare('DELETE FROM casas WHERE id = ?').run(ctx.params.id);
  sendJSON(res, 200, { ok: true });
});

// --- fornecedores ---

route('GET', '/api/fornecedores', async (req, res, ctx) => {
  if (!requireAuth(ctx.user, res)) return;
  const rows = db.prepare('SELECT * FROM fornecedores ORDER BY nome').all();
  sendJSON(res, 200, rows);
});

route('POST', '/api/fornecedores', async (req, res, ctx) => {
  if (!requireAuth(ctx.user, res)) return;
  const body = await readBody(req);
  if (!body.nome) return sendJSON(res, 400, { erro: 'Informe o nome do fornecedor' });
  const info = db.prepare(`INSERT INTO fornecedores (nome, contato, telefone, cidade) VALUES (?, ?, ?, ?)`)
    .run(body.nome.trim(), body.contato || '', body.telefone || '', body.cidade || '');
  const novo = db.prepare('SELECT * FROM fornecedores WHERE id = ?').get(info.lastInsertRowid);
  sendJSON(res, 201, novo);
});

route('PUT', '/api/fornecedores/:id', async (req, res, ctx) => {
  if (!requireAuth(ctx.user, res)) return;
  const body = await readBody(req);
  const existente = db.prepare('SELECT * FROM fornecedores WHERE id = ?').get(ctx.params.id);
  if (!existente) return sendJSON(res, 404, { erro: 'Fornecedor não encontrado' });
  db.prepare('UPDATE fornecedores SET nome=?, contato=?, telefone=?, cidade=? WHERE id=?').run(
    body.nome ?? existente.nome, body.contato ?? existente.contato, body.telefone ?? existente.telefone, body.cidade ?? existente.cidade, ctx.params.id
  );
  sendJSON(res, 200, db.prepare('SELECT * FROM fornecedores WHERE id = ?').get(ctx.params.id));
});

route('DELETE', '/api/fornecedores/:id', async (req, res, ctx) => {
  if (!requireAdmin(ctx.user, res)) return;
  const emUso = db.prepare('SELECT COUNT(*) c FROM compras WHERE fornecedor_id = ?').get(ctx.params.id).c;
  if (emUso > 0) return sendJSON(res, 400, { erro: 'Não é possível excluir: esse fornecedor já tem compras lançadas' });
  db.prepare('DELETE FROM fornecedores WHERE id = ?').run(ctx.params.id);
  sendJSON(res, 200, { ok: true });
});

// --- compras / materiais ---

route('GET', '/api/compras', async (req, res, ctx) => {
  if (!requireAuth(ctx.user, res)) return;
  let sql = `
    SELECT c.*, f.nome as fornecedor_nome, u.nome as usuario_nome, ca.nome as casa_nome
    FROM compras c
    LEFT JOIN fornecedores f ON f.id = c.fornecedor_id
    LEFT JOIN usuarios u ON u.id = c.usuario_id
    LEFT JOIN casas ca ON ca.id = c.casa_id
    WHERE 1=1
  `;
  const params = [];
  if (ctx.query.casa_id) { sql += ' AND c.casa_id = ?'; params.push(ctx.query.casa_id); }
  if (ctx.query.fornecedor_id) { sql += ' AND c.fornecedor_id = ?'; params.push(ctx.query.fornecedor_id); }
  if (ctx.query.status_pagamento) { sql += ' AND c.status_pagamento = ?'; params.push(ctx.query.status_pagamento); }
  if (ctx.query.categoria) { sql += ' AND c.categoria = ?'; params.push(ctx.query.categoria); }
  sql += ' ORDER BY c.data_compra DESC, c.id DESC';
  const rows = db.prepare(sql).all(...params);
  sendJSON(res, 200, rows);
});

route('POST', '/api/compras', async (req, res, ctx) => {
  if (!requireAuth(ctx.user, res)) return;
  const body = await readBody(req);
  if (!body.casa_id || !body.material || !body.data_compra) {
    return sendJSON(res, 400, { erro: 'Informe casa, material e data da compra' });
  }
  const quantidade = Number(body.quantidade) || 1;
  const valorUnitario = Number(body.valor_unitario) || 0;
  const valorTotal = body.valor_total !== undefined && body.valor_total !== ''
    ? Number(body.valor_total)
    : round2(quantidade * valorUnitario);
  const info = db.prepare(`
    INSERT INTO compras (casa_id, fornecedor_id, categoria, material, quantidade, unidade, valor_unitario, valor_total, data_compra, forma_pagamento, status_pagamento, data_pagamento, usuario_id, observacao)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    body.casa_id, body.fornecedor_id || null, body.categoria || '', body.material.trim(), quantidade, body.unidade || '',
    valorUnitario, valorTotal, body.data_compra, body.forma_pagamento || '', body.status_pagamento === 'pago' ? 'pago' : 'pendente',
    body.status_pagamento === 'pago' ? (body.data_pagamento || body.data_compra) : null,
    ctx.user.uid, body.observacao || ''
  );
  const nova = db.prepare('SELECT * FROM compras WHERE id = ?').get(info.lastInsertRowid);
  sendJSON(res, 201, nova);
});

route('PUT', '/api/compras/:id', async (req, res, ctx) => {
  if (!requireAuth(ctx.user, res)) return;
  const body = await readBody(req);
  const existente = db.prepare('SELECT * FROM compras WHERE id = ?').get(ctx.params.id);
  if (!existente) return sendJSON(res, 404, { erro: 'Compra não encontrada' });
  const quantidade = body.quantidade !== undefined ? Number(body.quantidade) : existente.quantidade;
  const valorUnitario = body.valor_unitario !== undefined ? Number(body.valor_unitario) : existente.valor_unitario;
  const valorTotal = body.valor_total !== undefined && body.valor_total !== ''
    ? Number(body.valor_total)
    : round2(quantidade * valorUnitario);
  const statusPagamento = body.status_pagamento === 'pago' ? 'pago' : (body.status_pagamento === 'pendente' ? 'pendente' : existente.status_pagamento);
  const dataPagamento = statusPagamento === 'pago' ? (body.data_pagamento || existente.data_pagamento || existente.data_compra) : null;
  db.prepare(`
    UPDATE compras SET casa_id=?, fornecedor_id=?, categoria=?, material=?, quantidade=?, unidade=?, valor_unitario=?, valor_total=?, data_compra=?, forma_pagamento=?, status_pagamento=?, data_pagamento=?, observacao=?
    WHERE id=?
  `).run(
    body.casa_id ?? existente.casa_id,
    body.fornecedor_id !== undefined ? (body.fornecedor_id || null) : existente.fornecedor_id,
    body.categoria ?? existente.categoria,
    body.material ?? existente.material,
    quantidade, body.unidade ?? existente.unidade,
    valorUnitario, valorTotal,
    body.data_compra ?? existente.data_compra,
    body.forma_pagamento ?? existente.forma_pagamento,
    statusPagamento, dataPagamento,
    body.observacao ?? existente.observacao,
    ctx.params.id
  );
  sendJSON(res, 200, db.prepare('SELECT * FROM compras WHERE id = ?').get(ctx.params.id));
});

route('DELETE', '/api/compras/:id', async (req, res, ctx) => {
  if (!requireAuth(ctx.user, res)) return;
  db.prepare('DELETE FROM compras WHERE id = ?').run(ctx.params.id);
  sendJSON(res, 200, { ok: true });
});

// --- receitas ---

route('GET', '/api/receitas', async (req, res, ctx) => {
  if (!requireAuth(ctx.user, res)) return;
  let sql = `
    SELECT r.*, u.nome as usuario_nome, ca.nome as casa_nome
    FROM receitas r
    LEFT JOIN usuarios u ON u.id = r.usuario_id
    LEFT JOIN casas ca ON ca.id = r.casa_id
    WHERE 1=1
  `;
  const params = [];
  if (ctx.query.casa_id) { sql += ' AND r.casa_id = ?'; params.push(ctx.query.casa_id); }
  if (ctx.query.status_recebimento) { sql += ' AND r.status_recebimento = ?'; params.push(ctx.query.status_recebimento); }
  if (ctx.query.categoria) { sql += ' AND r.categoria = ?'; params.push(ctx.query.categoria); }
  sql += ' ORDER BY r.data_receita DESC, r.id DESC';
  const rows = db.prepare(sql).all(...params);
  sendJSON(res, 200, rows);
});

route('POST', '/api/receitas', async (req, res, ctx) => {
  if (!requireAuth(ctx.user, res)) return;
  const body = await readBody(req);
  if (!body.descricao || !body.valor || !body.data_receita) {
    return sendJSON(res, 400, { erro: 'Informe descrição, valor e data da receita' });
  }
  const valor = Number(body.valor) || 0;
  const info = db.prepare(`
    INSERT INTO receitas (casa_id, categoria, descricao, valor, data_receita, forma_recebimento, status_recebimento, data_recebimento, usuario_id, observacao)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    body.casa_id || null, body.categoria || '', body.descricao.trim(), valor, body.data_receita,
    body.forma_recebimento || '', body.status_recebimento === 'recebido' ? 'recebido' : 'pendente',
    body.status_recebimento === 'recebido' ? (body.data_recebimento || body.data_receita) : null,
    ctx.user.uid, body.observacao || ''
  );
  const nova = db.prepare('SELECT * FROM receitas WHERE id = ?').get(info.lastInsertRowid);
  sendJSON(res, 201, nova);
});

route('PUT', '/api/receitas/:id', async (req, res, ctx) => {
  if (!requireAuth(ctx.user, res)) return;
  const body = await readBody(req);
  const existente = db.prepare('SELECT * FROM receitas WHERE id = ?').get(ctx.params.id);
  if (!existente) return sendJSON(res, 404, { erro: 'Receita não encontrada' });
  const valor = body.valor !== undefined ? Number(body.valor) : existente.valor;
  const statusRecebimento = body.status_recebimento === 'recebido' ? 'recebido' : (body.status_recebimento === 'pendente' ? 'pendente' : existente.status_recebimento);
  const dataRecebimento = statusRecebimento === 'recebido' ? (body.data_recebimento || existente.data_recebimento || existente.data_receita) : null;
  db.prepare(`
    UPDATE receitas SET casa_id=?, categoria=?, descricao=?, valor=?, data_receita=?, forma_recebimento=?, status_recebimento=?, data_recebimento=?, observacao=?
    WHERE id=?
  `).run(
    body.casa_id !== undefined ? (body.casa_id || null) : existente.casa_id,
    body.categoria ?? existente.categoria,
    body.descricao ?? existente.descricao,
    valor,
    body.data_receita ?? existente.data_receita,
    body.forma_recebimento ?? existente.forma_recebimento,
    statusRecebimento, dataRecebimento,
    body.observacao ?? existente.observacao,
    ctx.params.id
  );
  sendJSON(res, 200, db.prepare('SELECT * FROM receitas WHERE id = ?').get(ctx.params.id));
});

route('DELETE', '/api/receitas/:id', async (req, res, ctx) => {
  if (!requireAuth(ctx.user, res)) return;
  db.prepare('DELETE FROM receitas WHERE id = ?').run(ctx.params.id);
  sendJSON(res, 200, { ok: true });
});

// --- dashboard geral ---

route('GET', '/api/dashboard', async (req, res, ctx) => {
  if (!requireAuth(ctx.user, res)) return;
  const casas = db.prepare('SELECT * FROM casas ORDER BY criado_em DESC').all().map(casaComResumo);
  const totaisDespesa = db.prepare(`
    SELECT
      COALESCE(SUM(valor_total), 0) as gasto_total,
      COALESCE(SUM(CASE WHEN status_pagamento = 'pendente' THEN valor_total ELSE 0 END), 0) as pendente_total
    FROM compras
  `).get();
  const totaisReceita = db.prepare(`
    SELECT
      COALESCE(SUM(valor), 0) as receita_total,
      COALESCE(SUM(CASE WHEN status_recebimento = 'pendente' THEN valor ELSE 0 END), 0) as receita_pendente_total
    FROM receitas
  `).get();
  sendJSON(res, 200, {
    casas,
    total_orcamento: round2(casas.reduce((s, c) => s + c.orcamento_previsto, 0)),
    total_gasto: round2(totaisDespesa.gasto_total),
    total_pendente: round2(totaisDespesa.pendente_total),
    total_receita: round2(totaisReceita.receita_total),
    total_receita_pendente: round2(totaisReceita.receita_pendente_total),
    saldo_geral: round2(totaisReceita.receita_total - totaisDespesa.gasto_total),
  });
});

// --- relatório mensal (despesas x receitas) ---

route('GET', '/api/relatorio-mensal', async (req, res, ctx) => {
  if (!requireAuth(ctx.user, res)) return;
  const mes = ctx.query.mes; // formato 'YYYY-MM'
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) return sendJSON(res, 400, { erro: 'Informe o mês no formato AAAA-MM' });
  const inicio = mes + '-01';
  const fim = mes + '-31';

  const despesas = db.prepare(`
    SELECT c.*, f.nome as fornecedor_nome, u.nome as usuario_nome, ca.nome as casa_nome
    FROM compras c
    LEFT JOIN fornecedores f ON f.id = c.fornecedor_id
    LEFT JOIN usuarios u ON u.id = c.usuario_id
    LEFT JOIN casas ca ON ca.id = c.casa_id
    WHERE c.data_compra BETWEEN ? AND ?
    ORDER BY c.data_compra
  `).all(inicio, fim);

  const receitas = db.prepare(`
    SELECT r.*, u.nome as usuario_nome, ca.nome as casa_nome
    FROM receitas r
    LEFT JOIN usuarios u ON u.id = r.usuario_id
    LEFT JOIN casas ca ON ca.id = r.casa_id
    WHERE r.data_receita BETWEEN ? AND ?
    ORDER BY r.data_receita
  `).all(inicio, fim);

  function agruparPorCasa(lista, campoValor, campoNomeCasa) {
    const porCasa = {};
    for (const item of lista) {
      const chave = item.casa_id || 0;
      if (!porCasa[chave]) porCasa[chave] = { casa_id: item.casa_id, casa_nome: item[campoNomeCasa] || 'Geral (sem casa)', total: 0 };
      porCasa[chave].total += item[campoValor];
    }
    return Object.values(porCasa).map((x) => ({ ...x, total: round2(x.total) }));
  }

  function agruparPorCategoria(lista, campoValor) {
    const porCat = {};
    for (const item of lista) {
      const chave = item.categoria || 'Sem categoria';
      porCat[chave] = (porCat[chave] || 0) + item[campoValor];
    }
    return Object.entries(porCat).map(([categoria, total]) => ({ categoria, total: round2(total) }));
  }

  const totalDespesas = round2(despesas.reduce((s, d) => s + d.valor_total, 0));
  const totalReceitas = round2(receitas.reduce((s, r) => s + r.valor, 0));

  sendJSON(res, 200, {
    mes,
    total_despesas: totalDespesas,
    total_receitas: totalReceitas,
    saldo: round2(totalReceitas - totalDespesas),
    despesas_por_casa: agruparPorCasa(despesas, 'valor_total', 'casa_nome'),
    receitas_por_casa: agruparPorCasa(receitas, 'valor', 'casa_nome'),
    despesas_por_categoria: agruparPorCategoria(despesas, 'valor_total'),
    receitas_por_categoria: agruparPorCategoria(receitas, 'valor'),
    despesas,
    receitas,
  });
});

// ---------- servidor http ----------

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname);

  if (pathname.startsWith('/api/')) {
    const user = getSessionUser(req);
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = pathname.match(r.regex);
      if (!m) continue;
      const params = {};
      r.paramNames.forEach((name, i) => { params[name] = m[i + 1]; });
      try {
        await r.handler(req, res, { user, query: parsed.query, params });
      } catch (e) {
        console.error(e);
        if (!res.headersSent) sendJSON(res, 500, { erro: 'Erro interno no servidor' });
      }
      return;
    }
    return sendJSON(res, 404, { erro: 'Rota não encontrada' });
  }

  serveStatic(req, res, pathname);
});

server.listen(PORT, () => {
  console.log(`Controle de Obras rodando em http://localhost:${PORT}`);
});
