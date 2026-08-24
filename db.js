// Banco de dados (SQLite embutido no Node.js — não precisa instalar nada)
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const DB_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
const DB_PATH = path.join(DB_DIR, 'obras.db');

const db = new DatabaseSync(DB_PATH);

db.exec(`
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  usuario TEXT NOT NULL UNIQUE,
  senha_hash TEXT NOT NULL,
  senha_salt TEXT NOT NULL,
  papel TEXT NOT NULL DEFAULT 'encarregado', -- admin | encarregado
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS casas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  endereco TEXT,
  cidade TEXT,
  orcamento_previsto REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'em andamento', -- em andamento | concluida | pausada
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS fornecedores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL,
  contato TEXT,
  telefone TEXT,
  cidade TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS compras (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  casa_id INTEGER NOT NULL REFERENCES casas(id),
  fornecedor_id INTEGER REFERENCES fornecedores(id),
  categoria TEXT,
  material TEXT NOT NULL,
  quantidade REAL NOT NULL DEFAULT 1,
  unidade TEXT,
  valor_unitario REAL NOT NULL DEFAULT 0,
  valor_total REAL NOT NULL DEFAULT 0,
  data_compra TEXT NOT NULL,
  forma_pagamento TEXT,
  status_pagamento TEXT NOT NULL DEFAULT 'pendente', -- pago | pendente
  data_pagamento TEXT,
  usuario_id INTEGER REFERENCES usuarios(id),
  observacao TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS receitas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  casa_id INTEGER REFERENCES casas(id), -- pode ser geral (sem casa vinculada)
  categoria TEXT, -- Venda, Entrada/Sinal, Parcela, Financiamento, Aluguel, Outro
  descricao TEXT NOT NULL,
  valor REAL NOT NULL DEFAULT 0,
  data_receita TEXT NOT NULL,
  forma_recebimento TEXT,
  status_recebimento TEXT NOT NULL DEFAULT 'pendente', -- recebido | pendente
  data_recebimento TEXT,
  usuario_id INTEGER REFERENCES usuarios(id),
  observacao TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function hashPassword(senha, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(senha, salt, 64).toString('hex');
  return { hash, salt };
}

function verifyPassword(senha, hash, salt) {
  const check = crypto.scryptSync(senha, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(check, 'hex'), Buffer.from(hash, 'hex'));
}

// Seed: cria usuário admin inicial se não houver nenhum usuário
const countUsers = db.prepare('SELECT COUNT(*) as c FROM usuarios').get().c;
if (countUsers === 0) {
  const senhaInicial = process.env.ADMIN_SENHA_INICIAL || 'mudar123';
  const { hash, salt } = hashPassword(senhaInicial);
  db.prepare(`INSERT INTO usuarios (nome, usuario, senha_hash, senha_salt, papel) VALUES (?, ?, ?, ?, 'admin')`)
    .run('Administrador', 'admin', hash, salt);
  console.log('=========================================================');
  console.log('Usuário admin criado automaticamente:');
  console.log('  usuário: admin');
  console.log('  senha:   ' + senhaInicial);
  console.log('Troque essa senha assim que entrar no sistema.');
  console.log('=========================================================');
}

module.exports = { db, hashPassword, verifyPassword };
