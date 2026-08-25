// App "Controle de Obras" — frontend em JavaScript puro (sem frameworks)

const state = {
  user: null,
  casas: [],
  fornecedores: [],
};

const viewEl = document.getElementById('view');

// ---------- utilidades ----------

function fmtMoeda(v) {
  return (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtData(d) {
  if (!d) return '—';
  const [ano, mes, dia] = d.split('-');
  if (!dia) return d;
  return `${dia}/${mes}/${ano}`;
}

function hojeISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset();
  const local = new Date(d.getTime() - tz * 60000);
  return local.toISOString().slice(0, 10);
}

function toast(msg, isErro) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  el.className = 'toast' + (isErro ? ' erro-toast' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.hidden = true; }, 3000);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    method: opts.method || 'GET',
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const msg = (data && data.erro) || `Erro (${res.status})`;
    throw new Error(msg);
  }
  return data;
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// ---------- login ----------

document.getElementById('login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const usuario = document.getElementById('login-usuario').value.trim();
  const senha = document.getElementById('login-senha').value;
  const erroEl = document.getElementById('login-erro');
  erroEl.hidden = true;
  try {
    const data = await api('/api/login', { method: 'POST', body: { usuario, senha } });
    state.user = data.usuario;
    await afterLogin();
  } catch (e) {
    erroEl.textContent = e.message;
    erroEl.hidden = false;
  }
});

document.getElementById('btn-logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  state.user = null;
  location.hash = '';
  document.getElementById('app-screen').hidden = true;
  document.getElementById('login-screen').hidden = false;
});

async function afterLogin() {
  document.getElementById('login-screen').hidden = true;
  document.getElementById('app-screen').hidden = false;
  document.getElementById('user-nome').textContent = state.user.nome + (state.user.papel === 'admin' ? ' (admin)' : '');
  document.getElementById('nav-usuarios').hidden = state.user.papel !== 'admin';
  await Promise.all([carregarFornecedores(), carregarCasas()]);
  if (!location.hash) location.hash = '#/dashboard';
  router();
}

async function carregarCasas() {
  state.casas = await api('/api/casas');
}
async function carregarFornecedores() {
  state.fornecedores = await api('/api/fornecedores');
}

// ---------- navegação ----------

document.querySelectorAll('.nav-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    location.hash = '#/' + btn.dataset.view;
  });
});

window.addEventListener('hashchange', router);

function setActiveNav(viewName) {
  document.querySelectorAll('.nav-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.view === viewName);
  });
}

function router() {
  const hash = location.hash.replace('#/', '') || 'dashboard';
  const [view, param, param2] = hash.split('/');
  setActiveNav(view);
  if (view === 'dashboard') return renderDashboard();
  if (view === 'casas') return renderCasas();
  if (view === 'casa') return renderCasaDetalhe(param, param2);
  if (view === 'fornecedores') return renderFornecedores();
  if (view === 'usuarios') return renderUsuarios();
  if (view === 'nova-compra') return abrirEscolhaLancamento();
  if (view === 'relatorio') return renderRelatorioMensal(param);
  renderDashboard();
}

// ---------- painel (dashboard) ----------

async function renderDashboard() {
  viewEl.innerHTML = '<p class="empty-state">Carregando…</p>';
  let data;
  try {
    data = await api('/api/dashboard');
  } catch (e) {
    viewEl.innerHTML = `<p class="empty-state">${e.message}</p>`;
    return;
  }
  state.casas = data.casas;

  const resumoFinanceiro = `
    <div class="resumo-grid">
      <div class="resumo-item"><div class="label">Receitas</div><div class="valor" style="color:#2e8b57">${fmtMoeda(data.total_receita)}</div></div>
      <div class="resumo-item"><div class="label">Despesas</div><div class="valor">${fmtMoeda(data.total_gasto)}</div></div>
      <div class="resumo-item"><div class="label">Saldo geral</div><div class="valor" style="color:${data.saldo_geral >= 0 ? '#2e8b57' : '#c0392b'}">${fmtMoeda(data.saldo_geral)}</div></div>
      <div class="resumo-item"><div class="label">A receber</div><div class="valor" style="color:#b3760f">${fmtMoeda(data.total_receita_pendente)}</div></div>
    </div>
  `;

  const resumo = `
    <div class="resumo-grid">
      <div class="resumo-item"><div class="label">Orçamento total</div><div class="valor">${fmtMoeda(data.total_orcamento)}</div></div>
      <div class="resumo-item"><div class="label">Gasto total</div><div class="valor">${fmtMoeda(data.total_gasto)}</div></div>
      <div class="resumo-item"><div class="label">Pendente de pagamento</div><div class="valor" style="color:#b3760f">${fmtMoeda(data.total_pendente)}</div></div>
      <div class="resumo-item"><div class="label">Casas cadastradas</div><div class="valor">${data.casas.length}</div></div>
    </div>
  `;

  const botaoRelatorio = `<button class="relatorio-link" onclick="location.hash='#/relatorio'">📄 Relatório mensal em PDF — despesas x receitas</button>`;

  if (data.casas.length === 0) {
    viewEl.innerHTML = `
      <h2 class="page-title">Painel</h2>
      ${resumoFinanceiro}
      ${botaoRelatorio}
      ${resumo}
      <div class="empty-state">Nenhuma casa/obra cadastrada ainda.<br><button class="small-link" onclick="location.hash='#/casas'">Cadastrar a primeira casa</button></div>
    `;
    return;
  }

  viewEl.innerHTML = `
    <h2 class="page-title">Painel</h2>
    ${resumoFinanceiro}
    ${botaoRelatorio}
    ${resumo}
    <div id="lista-casas-dashboard"></div>
  `;
  const cont = document.getElementById('lista-casas-dashboard');
  data.casas.forEach((casa) => cont.appendChild(cardCasa(casa)));
}

function cardCasa(casa) {
  const pct = casa.percentual_orcamento;
  let corClasse = '';
  if (pct !== null) {
    if (pct >= 100) corClasse = 'estourado';
    else if (pct >= 85) corClasse = 'alerta';
  }
  const card = el(`
    <div class="card" style="cursor:pointer">
      <div class="card-title">${casa.nome}</div>
      <div class="card-sub">${[casa.cidade, casa.endereco].filter(Boolean).join(' · ') || 'Sem endereço cadastrado'} <span class="badge badge-status">${casa.status}</span></div>
      ${casa.orcamento_previsto > 0 ? `
        <div class="progress-bar"><div class="progress-fill ${corClasse}" style="width:${Math.min(pct, 100)}%"></div></div>
        <div class="valores-row">
          <span>Gasto: <strong>${fmtMoeda(casa.gasto_total)}</strong></span>
          <span>${pct}% do orçamento</span>
        </div>
      ` : `
        <div class="valores-row"><span>Gasto até agora: <strong>${fmtMoeda(casa.gasto_total)}</strong></span></div>
      `}
      ${casa.pendente_total > 0 ? `<div class="valores-row"><span class="badge badge-pendente">${fmtMoeda(casa.pendente_total)} pendente</span></div>` : ''}
    </div>
  `);
  card.addEventListener('click', () => { location.hash = '#/casa/' + casa.id; });
  return card;
}

// ---------- casas ----------

async function renderCasas() {
  await carregarCasas();
  viewEl.innerHTML = `
    <div class="top-actions">
      <h2 class="page-title" style="margin:0">Casas / Obras</h2>
      <button class="btn-primary" style="width:auto;margin:0;padding:9px 14px;font-size:13px" onclick="abrirModalCasa()">+ Nova casa</button>
    </div>
    <div id="lista-casas"></div>
  `;
  const cont = document.getElementById('lista-casas');
  if (state.casas.length === 0) {
    cont.innerHTML = '<div class="empty-state">Nenhuma casa cadastrada ainda.</div>';
    return;
  }
  state.casas.forEach((casa) => cont.appendChild(cardCasa(casa)));
}

function abrirModalCasa(casaExistente) {
  const c = casaExistente || {};
  const modal = abrirModal(`${c.id ? 'Editar casa' : 'Nova casa/obra'}`, `
    <div class="form-grid">
      <label>Nome da casa/obra *</label>
      <input id="f-nome" value="${c.nome || ''}" placeholder="Ex: Casa Rua das Flores">
      <label>Cidade</label>
      <input id="f-cidade" value="${c.cidade || ''}">
      <label>Endereço</label>
      <input id="f-endereco" value="${c.endereco || ''}">
      <label>Orçamento previsto (R$)</label>
      <input id="f-orcamento" type="number" step="0.01" value="${c.orcamento_previsto || ''}">
      <label>Status</label>
      <select id="f-status">
        <option value="em andamento" ${c.status === 'em andamento' || !c.status ? 'selected' : ''}>Em andamento</option>
        <option value="pausada" ${c.status === 'pausada' ? 'selected' : ''}>Pausada</option>
        <option value="concluida" ${c.status === 'concluida' ? 'selected' : ''}>Concluída</option>
      </select>
    </div>
    <div class="btn-row">
      <button class="btn-secundario" id="f-cancelar">Cancelar</button>
      <button class="btn-primary" style="margin:0" id="f-salvar">Salvar</button>
    </div>
  `);
  modal.querySelector('#f-cancelar').addEventListener('click', fecharModal);
  modal.querySelector('#f-salvar').addEventListener('click', async () => {
    const body = {
      nome: modal.querySelector('#f-nome').value.trim(),
      cidade: modal.querySelector('#f-cidade').value.trim(),
      endereco: modal.querySelector('#f-endereco').value.trim(),
      orcamento_previsto: modal.querySelector('#f-orcamento').value,
      status: modal.querySelector('#f-status').value,
    };
    if (!body.nome) return toast('Informe o nome da casa', true);
    try {
      if (c.id) await api('/api/casas/' + c.id, { method: 'PUT', body });
      else await api('/api/casas', { method: 'POST', body });
      fecharModal();
      toast('Casa salva com sucesso');
      router();
    } catch (e) { toast(e.message, true); }
  });
}

// ---------- detalhe da casa ----------

async function renderCasaDetalhe(id, aba) {
  aba = aba === 'receitas' ? 'receitas' : 'despesas';
  viewEl.innerHTML = '<p class="empty-state">Carregando…</p>';
  let casa, compras, receitas;
  try {
    [casa, compras, receitas] = await Promise.all([
      api('/api/casas/' + id),
      api('/api/compras?casa_id=' + id),
      api('/api/receitas?casa_id=' + id),
    ]);
  } catch (e) {
    viewEl.innerHTML = `<p class="empty-state">${e.message}</p>`;
    return;
  }
  setActiveNav('casas');

  const pct = casa.percentual_orcamento;
  viewEl.innerHTML = `
    <button class="small-link" onclick="location.hash='#/casas'">‹ Voltar para Casas</button>
    <div class="top-actions">
      <h2 class="page-title" style="margin:0">${casa.nome}</h2>
      <button class="icon-btn" onclick='abrirModalCasa(${JSON.stringify(casa).replace(/'/g, "&#39;")})'>✏️ Editar</button>
    </div>
    <div class="card-sub" style="margin-bottom:12px">${[casa.cidade, casa.endereco].filter(Boolean).join(' · ')} · <span class="badge badge-status">${casa.status}</span></div>

    <div class="resumo-grid">
      <div class="resumo-item"><div class="label">Receitas</div><div class="valor" style="color:#2e8b57">${fmtMoeda(casa.receita_total)}</div></div>
      <div class="resumo-item"><div class="label">Despesas</div><div class="valor">${fmtMoeda(casa.gasto_total)}</div></div>
      <div class="resumo-item"><div class="label">Saldo da casa</div><div class="valor" style="color:${casa.saldo_casa >= 0 ? '#2e8b57' : '#c0392b'}">${fmtMoeda(casa.saldo_casa)}</div></div>
      <div class="resumo-item"><div class="label">Orçamento previsto</div><div class="valor">${casa.orcamento_previsto > 0 ? fmtMoeda(casa.orcamento_previsto) : '—'}</div></div>
    </div>
    ${casa.orcamento_previsto > 0 ? `
      <div class="progress-bar"><div class="progress-fill ${pct >= 100 ? 'estourado' : pct >= 85 ? 'alerta' : ''}" style="width:${Math.min(pct,100)}%"></div></div>
      <div class="valores-row" style="margin-bottom:16px"><span>${pct}% do orçamento usado em despesas</span><span>Saldo do orçamento: <strong>${fmtMoeda(casa.saldo_orcamento)}</strong></span></div>
    ` : ''}

    <div class="tag-toggle">
      <button type="button" id="aba-despesas" class="${aba === 'despesas' ? 'active' : ''}">Despesas (${compras.length})</button>
      <button type="button" id="aba-receitas" class="${aba === 'receitas' ? 'active' : ''}">Receitas (${receitas.length})</button>
    </div>

    <div class="top-actions">
      <h2 class="page-title" style="margin:0;font-size:16px">${aba === 'despesas' ? 'Despesas' : 'Receitas'}</h2>
      ${aba === 'despesas'
        ? `<button class="btn-primary btn-small" onclick="abrirModalCompra(${casa.id})">+ Lançar despesa</button>`
        : `<button class="btn-primary btn-small" onclick="abrirModalReceita(${casa.id})">+ Lançar receita</button>`}
    </div>
    <div id="lista-lancamentos"></div>
  `;

  document.getElementById('aba-despesas').addEventListener('click', () => { location.hash = '#/casa/' + id + '/despesas'; });
  document.getElementById('aba-receitas').addEventListener('click', () => { location.hash = '#/casa/' + id + '/receitas'; });

  const cont = document.getElementById('lista-lancamentos');
  if (aba === 'despesas') {
    if (compras.length === 0) { cont.innerHTML = '<div class="empty-state">Nenhuma despesa lançada para essa casa ainda.</div>'; return; }
    const card = el('<div class="card"></div>');
    compras.forEach((compra) => card.appendChild(linhaCompra(compra)));
    cont.appendChild(card);
  } else {
    if (receitas.length === 0) { cont.innerHTML = '<div class="empty-state">Nenhuma receita lançada para essa casa ainda.</div>'; return; }
    const card = el('<div class="card"></div>');
    receitas.forEach((receita) => card.appendChild(linhaReceita(receita)));
    cont.appendChild(card);
  }
}

function linhaCompra(compra) {
  const row = el(`
    <div class="compra-row" style="cursor:pointer">
      <div class="compra-info">
        <div class="compra-material">${compra.material}</div>
        <div class="compra-meta">${fmtData(compra.data_compra)} · ${compra.fornecedor_nome || 'sem fornecedor'}${compra.categoria ? ' · ' + compra.categoria : ''}</div>
        <div class="compra-meta">${compra.quantidade}${compra.unidade ? ' ' + compra.unidade : ''} · lançado por ${compra.usuario_nome || '—'}</div>
      </div>
      <div class="compra-valor">
        ${fmtMoeda(compra.valor_total)}
        <small><span class="badge ${compra.status_pagamento === 'pago' ? 'badge-pago' : 'badge-pendente'}">${compra.status_pagamento}</span></small>
      </div>
    </div>
  `);
  row.addEventListener('click', () => abrirModalCompra(compra.casa_id, compra));
  return row;
}

function linhaReceita(receita) {
  const row = el(`
    <div class="compra-row" style="cursor:pointer">
      <div class="compra-info">
        <div class="compra-material">${receita.descricao}</div>
        <div class="compra-meta">${fmtData(receita.data_receita)}${receita.casa_nome ? ' · ' + receita.casa_nome : ' · geral (sem casa)'}${receita.categoria ? ' · ' + receita.categoria : ''}</div>
        <div class="compra-meta">lançado por ${receita.usuario_nome || '—'}</div>
      </div>
      <div class="compra-valor" style="color:#2e8b57">
        ${fmtMoeda(receita.valor)}
        <small><span class="badge ${receita.status_recebimento === 'recebido' ? 'badge-pago' : 'badge-pendente'}">${receita.status_recebimento}</span></small>
      </div>
    </div>
  `);
  row.addEventListener('click', () => abrirModalReceita(receita.casa_id, receita));
  return row;
}

// ---------- escolha do tipo de lançamento ----------

function abrirEscolhaLancamento() {
  const modal = abrirModal('O que você quer lançar?', `
    <div class="escolha-lancamento">
      <button type="button" class="escolha-btn" id="escolha-despesa">
        <span class="escolha-icon">💸</span>
        <span><strong>Despesa</strong><br>Compra de material, mão de obra, etc.</span>
      </button>
      <button type="button" class="escolha-btn" id="escolha-receita">
        <span class="escolha-icon">💰</span>
        <span><strong>Receita</strong><br>Venda, entrada, parcela recebida, etc.</span>
      </button>
    </div>
  `);
  modal.querySelector('#escolha-despesa').addEventListener('click', () => { fecharModal(); abrirModalCompra(); });
  modal.querySelector('#escolha-receita').addEventListener('click', () => { fecharModal(); abrirModalReceita(); });
}

// ---------- nova compra / editar compra ----------

function abrirModalCompra(casaIdPreSelecionada, compraExistente) {
  const c = compraExistente || {};
  if (state.casas.length === 0) {
    toast('Cadastre uma casa antes de lançar uma compra', true);
    location.hash = '#/casas';
    return;
  }
  const casasOptions = state.casas.map((casa) =>
    `<option value="${casa.id}" ${(c.casa_id || casaIdPreSelecionada) == casa.id ? 'selected' : ''}>${casa.nome}</option>`
  ).join('');
  const fornecedoresOptions = '<option value="">— sem fornecedor —</option>' + state.fornecedores.map((f) =>
    `<option value="${f.id}" ${c.fornecedor_id == f.id ? 'selected' : ''}>${f.nome}</option>`
  ).join('');

  const modal = abrirModal(c.id ? 'Editar compra' : 'Lançar compra de material', `
    <div class="form-grid">
      <label>Casa/obra *</label>
      <select id="f-casa">${casasOptions}</select>
      <label>Material *</label>
      <input id="f-material" value="${c.material || ''}" placeholder="Ex: Cimento CP-II 50kg">
      <label>Categoria</label>
      <input id="f-categoria" value="${c.categoria || ''}" placeholder="Ex: Alvenaria, Elétrica, Hidráulica…" list="lista-categorias">
      <datalist id="lista-categorias">
        <option value="Alvenaria"><option value="Elétrica"><option value="Hidráulica">
        <option value="Acabamento"><option value="Estrutura"><option value="Cobertura">
        <option value="Mão de obra"><option value="Ferramentas"><option value="Outros">
      </datalist>
      <div class="form-row-2">
        <div><label>Quantidade</label><input id="f-quantidade" type="number" step="0.01" value="${c.quantidade || 1}"></div>
        <div><label>Unidade</label><input id="f-unidade" value="${c.unidade || ''}" placeholder="un, kg, m², saco…"></div>
      </div>
      <div class="form-row-2">
        <div><label>Valor unitário (R$)</label><input id="f-valor-unit" type="number" step="0.01" value="${c.valor_unitario || ''}"></div>
        <div><label>Valor total (R$)</label><input id="f-valor-total" type="number" step="0.01" value="${c.valor_total || ''}"></div>
      </div>
      <label>Fornecedor</label>
      <select id="f-fornecedor">${fornecedoresOptions}</select>
      <label>Data da compra *</label>
      <input id="f-data" type="date" value="${c.data_compra || hojeISO()}">
      <label>Forma de pagamento</label>
      <input id="f-forma-pagamento" value="${c.forma_pagamento || ''}" placeholder="Pix, boleto, dinheiro, cartão…">
      <label>Status do pagamento</label>
      <div class="tag-toggle">
        <button type="button" id="f-status-pendente" class="${c.status_pagamento !== 'pago' ? 'active' : ''}">Pendente</button>
        <button type="button" id="f-status-pago" class="${c.status_pagamento === 'pago' ? 'active' : ''}">Pago</button>
      </div>
      <label>Observação</label>
      <textarea id="f-observacao" rows="2">${c.observacao || ''}</textarea>
    </div>
    <div class="btn-row">
      ${c.id ? '<button class="btn-secundario" id="f-excluir" style="color:#c0392b">Excluir</button>' : '<button class="btn-secundario" id="f-cancelar">Cancelar</button>'}
      <button class="btn-primary" style="margin:0" id="f-salvar">Salvar</button>
    </div>
  `);

  let statusPagamento = c.status_pagamento === 'pago' ? 'pago' : 'pendente';
  modal.querySelector('#f-status-pendente').addEventListener('click', () => {
    statusPagamento = 'pendente';
    modal.querySelector('#f-status-pendente').classList.add('active');
    modal.querySelector('#f-status-pago').classList.remove('active');
  });
  modal.querySelector('#f-status-pago').addEventListener('click', () => {
    statusPagamento = 'pago';
    modal.querySelector('#f-status-pago').classList.add('active');
    modal.querySelector('#f-status-pendente').classList.remove('active');
  });

  // auto-calcula valor total a partir de quantidade x valor unitário, se o usuário não digitou o total manualmente
  let totalEditadoManualmente = !!c.valor_total;
  const qtdEl = modal.querySelector('#f-quantidade');
  const vuEl = modal.querySelector('#f-valor-unit');
  const vtEl = modal.querySelector('#f-valor-total');
  function recalcTotal() {
    if (totalEditadoManualmente) return;
    const t = (Number(qtdEl.value) || 0) * (Number(vuEl.value) || 0);
    vtEl.value = t ? t.toFixed(2) : '';
  }
  qtdEl.addEventListener('input', recalcTotal);
  vuEl.addEventListener('input', recalcTotal);
  vtEl.addEventListener('input', () => { totalEditadoManualmente = true; });

  const cancelar = modal.querySelector('#f-cancelar');
  if (cancelar) cancelar.addEventListener('click', () => { fecharModal(); if (!casaIdPreSelecionada && !compraExistente) location.hash = '#/dashboard'; });

  const excluirBtn = modal.querySelector('#f-excluir');
  if (excluirBtn) excluirBtn.addEventListener('click', async () => {
    if (!confirm('Excluir essa compra?')) return;
    try {
      await api('/api/compras/' + c.id, { method: 'DELETE' });
      fecharModal();
      toast('Compra excluída');
      router();
    } catch (e) { toast(e.message, true); }
  });

  modal.querySelector('#f-salvar').addEventListener('click', async () => {
    const body = {
      casa_id: modal.querySelector('#f-casa').value,
      material: modal.querySelector('#f-material').value.trim(),
      categoria: modal.querySelector('#f-categoria').value.trim(),
      quantidade: modal.querySelector('#f-quantidade').value,
      unidade: modal.querySelector('#f-unidade').value.trim(),
      valor_unitario: modal.querySelector('#f-valor-unit').value,
      valor_total: modal.querySelector('#f-valor-total').value,
      fornecedor_id: modal.querySelector('#f-fornecedor').value || null,
      data_compra: modal.querySelector('#f-data').value,
      forma_pagamento: modal.querySelector('#f-forma-pagamento').value.trim(),
      status_pagamento: statusPagamento,
      observacao: modal.querySelector('#f-observacao').value.trim(),
    };
    if (!body.casa_id || !body.material || !body.data_compra) return toast('Preencha casa, material e data', true);
    try {
      if (c.id) await api('/api/compras/' + c.id, { method: 'PUT', body });
      else await api('/api/compras', { method: 'POST', body });
      fecharModal();
      toast('Compra salva com sucesso');
      if (location.hash.startsWith('#/casa/')) router();
      else location.hash = '#/casa/' + body.casa_id;
    } catch (e) { toast(e.message, true); }
  });
}

// ---------- nova receita / editar receita ----------

function abrirModalReceita(casaIdPreSelecionada, receitaExistente) {
  const r = receitaExistente || {};
  const casasOptions = '<option value="">— geral (sem casa vinculada) —</option>' + state.casas.map((casa) =>
    `<option value="${casa.id}" ${(r.casa_id || casaIdPreSelecionada) == casa.id ? 'selected' : ''}>${casa.nome}</option>`
  ).join('');

  const modal = abrirModal(r.id ? 'Editar receita' : 'Lançar receita', `
    <div class="form-grid">
      <label>Casa/obra (opcional)</label>
      <select id="f-casa">${casasOptions}</select>
      <label>Descrição *</label>
      <input id="f-descricao" value="${r.descricao || ''}" placeholder="Ex: Entrada da venda, parcela 3/10…">
      <label>Categoria</label>
      <input id="f-categoria" value="${r.categoria || ''}" placeholder="Ex: Venda, Entrada, Parcela…" list="lista-categorias-receita">
      <datalist id="lista-categorias-receita">
        <option value="Venda"><option value="Entrada/Sinal"><option value="Parcela">
        <option value="Financiamento"><option value="Aluguel"><option value="Outro">
      </datalist>
      <label>Valor (R$) *</label>
      <input id="f-valor" type="number" step="0.01" value="${r.valor || ''}">
      <label>Data da receita *</label>
      <input id="f-data" type="date" value="${r.data_receita || hojeISO()}">
      <label>Forma de recebimento</label>
      <input id="f-forma-recebimento" value="${r.forma_recebimento || ''}" placeholder="Pix, boleto, dinheiro, cartão…">
      <label>Status do recebimento</label>
      <div class="tag-toggle">
        <button type="button" id="f-status-pendente" class="${r.status_recebimento !== 'recebido' ? 'active' : ''}">Pendente</button>
        <button type="button" id="f-status-recebido" class="${r.status_recebimento === 'recebido' ? 'active' : ''}">Recebido</button>
      </div>
      <label>Observação</label>
      <textarea id="f-observacao" rows="2">${r.observacao || ''}</textarea>
    </div>
    <div class="btn-row">
      ${r.id ? '<button class="btn-secundario" id="f-excluir" style="color:#c0392b">Excluir</button>' : '<button class="btn-secundario" id="f-cancelar">Cancelar</button>'}
      <button class="btn-primary" style="margin:0" id="f-salvar">Salvar</button>
    </div>
  `);

  let statusRecebimento = r.status_recebimento === 'recebido' ? 'recebido' : 'pendente';
  modal.querySelector('#f-status-pendente').addEventListener('click', () => {
    statusRecebimento = 'pendente';
    modal.querySelector('#f-status-pendente').classList.add('active');
    modal.querySelector('#f-status-recebido').classList.remove('active');
  });
  modal.querySelector('#f-status-recebido').addEventListener('click', () => {
    statusRecebimento = 'recebido';
    modal.querySelector('#f-status-recebido').classList.add('active');
    modal.querySelector('#f-status-pendente').classList.remove('active');
  });

  const cancelar = modal.querySelector('#f-cancelar');
  if (cancelar) cancelar.addEventListener('click', () => { fecharModal(); if (!casaIdPreSelecionada && !receitaExistente) location.hash = '#/dashboard'; });

  const excluirBtn = modal.querySelector('#f-excluir');
  if (excluirBtn) excluirBtn.addEventListener('click', async () => {
    if (!confirm('Excluir essa receita?')) return;
    try {
      await api('/api/receitas/' + r.id, { method: 'DELETE' });
      fecharModal();
      toast('Receita excluída');
      router();
    } catch (e) { toast(e.message, true); }
  });

  modal.querySelector('#f-salvar').addEventListener('click', async () => {
    const casaId = modal.querySelector('#f-casa').value;
    const body = {
      casa_id: casaId || null,
      descricao: modal.querySelector('#f-descricao').value.trim(),
      categoria: modal.querySelector('#f-categoria').value.trim(),
      valor: modal.querySelector('#f-valor').value,
      data_receita: modal.querySelector('#f-data').value,
      forma_recebimento: modal.querySelector('#f-forma-recebimento').value.trim(),
      status_recebimento: statusRecebimento,
      observacao: modal.querySelector('#f-observacao').value.trim(),
    };
    if (!body.descricao || !body.valor || !body.data_receita) return toast('Preencha descrição, valor e data', true);
    try {
      if (r.id) await api('/api/receitas/' + r.id, { method: 'PUT', body });
      else await api('/api/receitas', { method: 'POST', body });
      fecharModal();
      toast('Receita salva com sucesso');
      if (location.hash.startsWith('#/casa/')) router();
      else if (casaId) location.hash = '#/casa/' + casaId + '/receitas';
      else location.hash = '#/dashboard';
    } catch (e) { toast(e.message, true); }
  });
}

// ---------- fornecedores ----------

async function renderFornecedores() {
  await carregarFornecedores();
  viewEl.innerHTML = `
    <div class="top-actions">
      <h2 class="page-title" style="margin:0">Fornecedores</h2>
      <button class="btn-primary" style="width:auto;margin:0;padding:9px 14px;font-size:13px" onclick="abrirModalFornecedor()">+ Novo</button>
    </div>
    <div class="card" id="lista-fornecedores"></div>
  `;
  const cont = document.getElementById('lista-fornecedores');
  if (state.fornecedores.length === 0) {
    cont.outerHTML = '<div class="empty-state">Nenhum fornecedor cadastrado ainda.</div>';
    return;
  }
  state.fornecedores.forEach((f) => {
    const item = el(`
      <div class="list-item" style="cursor:pointer">
        <div>
          <div class="list-item-title">${f.nome}</div>
          <div class="list-item-sub">${[f.cidade, f.telefone, f.contato].filter(Boolean).join(' · ') || 'Sem dados de contato'}</div>
        </div>
        <span class="icon-btn">✏️</span>
      </div>
    `);
    item.addEventListener('click', () => abrirModalFornecedor(f));
    cont.appendChild(item);
  });
}

function abrirModalFornecedor(fExistente) {
  const f = fExistente || {};
  const modal = abrirModal(f.id ? 'Editar fornecedor' : 'Novo fornecedor', `
    <div class="form-grid">
      <label>Nome *</label>
      <input id="f-nome" value="${f.nome || ''}">
      <label>Cidade</label>
      <input id="f-cidade" value="${f.cidade || ''}">
      <label>Telefone</label>
      <input id="f-telefone" value="${f.telefone || ''}">
      <label>Contato / observação</label>
      <input id="f-contato" value="${f.contato || ''}">
    </div>
    <div class="btn-row">
      <button class="btn-secundario" id="f-cancelar">Cancelar</button>
      <button class="btn-primary" style="margin:0" id="f-salvar">Salvar</button>
    </div>
  `);
  modal.querySelector('#f-cancelar').addEventListener('click', fecharModal);
  modal.querySelector('#f-salvar').addEventListener('click', async () => {
    const body = {
      nome: modal.querySelector('#f-nome').value.trim(),
      cidade: modal.querySelector('#f-cidade').value.trim(),
      telefone: modal.querySelector('#f-telefone').value.trim(),
      contato: modal.querySelector('#f-contato').value.trim(),
    };
    if (!body.nome) return toast('Informe o nome do fornecedor', true);
    try {
      if (f.id) await api('/api/fornecedores/' + f.id, { method: 'PUT', body });
      else await api('/api/fornecedores', { method: 'POST', body });
      fecharModal();
      toast('Fornecedor salvo');
      router();
    } catch (e) { toast(e.message, true); }
  });
}

// ---------- usuários (equipe) ----------

async function renderUsuarios() {
  if (state.user.papel !== 'admin') { location.hash = '#/dashboard'; return; }
  let usuarios;
  try {
    usuarios = await api('/api/usuarios');
  } catch (e) {
    viewEl.innerHTML = `<p class="empty-state">${e.message}</p>`;
    return;
  }
  viewEl.innerHTML = `
    <div class="top-actions">
      <h2 class="page-title" style="margin:0">Equipe</h2>
      <button class="btn-primary" style="width:auto;margin:0;padding:9px 14px;font-size:13px" onclick="abrirModalUsuario()">+ Novo</button>
    </div>
    <div class="card" id="lista-usuarios"></div>
  `;
  const cont = document.getElementById('lista-usuarios');
  usuarios.forEach((u) => {
    const item = el(`
      <div class="list-item" style="cursor:pointer">
        <div>
          <div class="list-item-title">${u.nome} ${!u.ativo ? '<span class="badge badge-pendente">inativo</span>' : ''}</div>
          <div class="list-item-sub">login: ${u.usuario} · ${u.papel === 'admin' ? 'Administrador' : 'Encarregado'}</div>
        </div>
        <span class="icon-btn">✏️</span>
      </div>
    `);
    item.addEventListener('click', () => abrirModalUsuario(u));
    cont.appendChild(item);
  });
}

function abrirModalUsuario(uExistente) {
  const u = uExistente || {};
  const modal = abrirModal(u.id ? 'Editar usuário' : 'Novo usuário', `
    <div class="form-grid">
      <label>Nome *</label>
      <input id="f-nome" value="${u.nome || ''}">
      <label>Usuário (login) *</label>
      <input id="f-usuario" value="${u.usuario || ''}" ${u.id ? 'readonly style="background:#f4f5f7;color:#888"' : ''}>
      <label>${u.id ? 'Nova senha (deixe em branco para não alterar)' : 'Senha *'}</label>
      <input id="f-senha" type="password">
      <label>Função</label>
      <select id="f-papel">
        <option value="encarregado" ${u.papel !== 'admin' ? 'selected' : ''}>Encarregado</option>
        <option value="admin" ${u.papel === 'admin' ? 'selected' : ''}>Administrador</option>
      </select>
      ${u.id ? `
        <label>Situação</label>
        <select id="f-ativo">
          <option value="1" ${u.ativo !== false ? 'selected' : ''}>Ativo</option>
          <option value="0" ${u.ativo === false ? 'selected' : ''}>Inativo</option>
        </select>
      ` : ''}
    </div>
    <div class="btn-row">
      <button class="btn-secundario" id="f-cancelar">Cancelar</button>
      <button class="btn-primary" style="margin:0" id="f-salvar">Salvar</button>
    </div>
  `);
  modal.querySelector('#f-cancelar').addEventListener('click', fecharModal);
  modal.querySelector('#f-salvar').addEventListener('click', async () => {
    const body = {
      nome: modal.querySelector('#f-nome').value.trim(),
      usuario: modal.querySelector('#f-usuario').value.trim(),
      senha: modal.querySelector('#f-senha').value,
      papel: modal.querySelector('#f-papel').value,
    };
    const ativoEl = modal.querySelector('#f-ativo');
    if (ativoEl) body.ativo = ativoEl.value === '1';
    if (!body.nome || (!u.id && (!body.usuario || !body.senha))) return toast('Preencha os campos obrigatórios', true);
    try {
      if (u.id) await api('/api/usuarios/' + u.id, { method: 'PUT', body });
      else await api('/api/usuarios', { method: 'POST', body });
      fecharModal();
      toast('Usuário salvo');
      router();
    } catch (e) { toast(e.message, true); }
  });
}

// ---------- relatório mensal (PDF) ----------

function mesAtualISO() {
  const d = new Date();
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function fmtMesAno(mesISO) {
  const [ano, mes] = mesISO.split('-');
  const nomes = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
  return `${nomes[Number(mes) - 1]} de ${ano}`;
}

async function renderRelatorioMensal(mesParam) {
  const mes = mesParam && /^\d{4}-\d{2}$/.test(mesParam) ? mesParam : mesAtualISO();
  setActiveNav('dashboard');
  viewEl.innerHTML = '<p class="empty-state">Carregando…</p>';

  let dados;
  try {
    dados = await api('/api/relatorio-mensal?mes=' + mes);
  } catch (e) {
    viewEl.innerHTML = `<p class="empty-state">${e.message}</p>`;
    return;
  }

  const lancamentos = [
    ...dados.despesas.map((d) => ({ tipo: 'despesa', data: d.data_compra, descricao: d.material, casa_nome: d.casa_nome, categoria: d.categoria, valor: d.valor_total, status: d.status_pagamento })),
    ...dados.receitas.map((r) => ({ tipo: 'receita', data: r.data_receita, descricao: r.descricao, casa_nome: r.casa_nome, categoria: r.categoria, valor: r.valor, status: r.status_recebimento })),
  ].sort((a, b) => a.data.localeCompare(b.data));

  const linhasPorCasa = () => {
    const casasSet = new Map();
    dados.despesas_por_casa.forEach((c) => casasSet.set(c.casa_nome, { casa_nome: c.casa_nome, despesa: c.total, receita: 0 }));
    dados.receitas_por_casa.forEach((c) => {
      const existente = casasSet.get(c.casa_nome) || { casa_nome: c.casa_nome, despesa: 0, receita: 0 };
      existente.receita = c.total;
      casasSet.set(c.casa_nome, existente);
    });
    return Array.from(casasSet.values());
  };

  viewEl.innerHTML = `
    <button class="small-link no-imprimir" onclick="location.hash='#/dashboard'">‹ Voltar para o Painel</button>

    <div class="top-actions no-imprimir">
      <h2 class="page-title" style="margin:0">Relatório mensal</h2>
    </div>
    <div class="relatorio-controles no-imprimir">
      <input type="month" id="f-mes-relatorio" value="${mes}">
      <button class="btn-primary btn-small" id="btn-gerar-pdf">🖨️ Gerar PDF</button>
    </div>

    <div id="relatorio-imprimivel">
      <div class="relatorio-cabecalho">
        <img src="/logo-dark.png" alt="Abrelar" class="relatorio-logo">
        <div>
          <h2 class="relatorio-titulo">Demonstrativo financeiro</h2>
          <div class="relatorio-periodo">Referente a ${fmtMesAno(mes)}</div>
        </div>
      </div>

      <div class="resumo-grid">
        <div class="resumo-item"><div class="label">Receitas do mês</div><div class="valor" style="color:#2e8b57">${fmtMoeda(dados.total_receitas)}</div></div>
        <div class="resumo-item"><div class="label">Despesas do mês</div><div class="valor">${fmtMoeda(dados.total_despesas)}</div></div>
        <div class="resumo-item"><div class="label">Saldo do mês</div><div class="valor" style="color:${dados.saldo >= 0 ? '#2e8b57' : '#c0392b'}">${fmtMoeda(dados.saldo)}</div></div>
      </div>

      <h3 class="relatorio-secao">Por casa/obra</h3>
      ${linhasPorCasa().length === 0 ? '<p class="empty-state">Nenhum lançamento nesse mês.</p>' : `
        <table class="relatorio-tabela">
          <thead><tr><th>Casa</th><th>Receitas</th><th>Despesas</th><th>Saldo</th></tr></thead>
          <tbody>
            ${linhasPorCasa().map((c) => `
              <tr>
                <td>${c.casa_nome}</td>
                <td class="valor">${fmtMoeda(c.receita)}</td>
                <td class="valor">${fmtMoeda(c.despesa)}</td>
                <td class="valor" style="color:${c.receita - c.despesa >= 0 ? '#2e8b57' : '#c0392b'}">${fmtMoeda(c.receita - c.despesa)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}

      <h3 class="relatorio-secao">Despesas por categoria</h3>
      ${dados.despesas_por_categoria.length === 0 ? '<p class="empty-state">Nenhuma despesa nesse mês.</p>' : `
        <table class="relatorio-tabela">
          <thead><tr><th>Categoria</th><th>Total</th></tr></thead>
          <tbody>${dados.despesas_por_categoria.map((c) => `<tr><td>${c.categoria}</td><td class="valor">${fmtMoeda(c.total)}</td></tr>`).join('')}</tbody>
        </table>
      `}

      <h3 class="relatorio-secao">Receitas por categoria</h3>
      ${dados.receitas_por_categoria.length === 0 ? '<p class="empty-state">Nenhuma receita nesse mês.</p>' : `
        <table class="relatorio-tabela">
          <thead><tr><th>Categoria</th><th>Total</th></tr></thead>
          <tbody>${dados.receitas_por_categoria.map((c) => `<tr><td>${c.categoria}</td><td class="valor">${fmtMoeda(c.total)}</td></tr>`).join('')}</tbody>
        </table>
      `}

      <h3 class="relatorio-secao">Lançamentos do mês</h3>
      ${lancamentos.length === 0 ? '<p class="empty-state">Nenhum lançamento nesse mês.</p>' : `
        <table class="relatorio-tabela">
          <thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th>Casa</th><th>Status</th><th>Valor</th></tr></thead>
          <tbody>
            ${lancamentos.map((l) => `
              <tr>
                <td>${fmtData(l.data)}</td>
                <td>${l.tipo === 'receita' ? 'Receita' : 'Despesa'}</td>
                <td>${l.descricao}</td>
                <td>${l.casa_nome || '—'}</td>
                <td>${l.status}</td>
                <td class="valor" style="color:${l.tipo === 'receita' ? '#2e8b57' : '#c0392b'}">${l.tipo === 'receita' ? '+' : '−'} ${fmtMoeda(l.valor)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `}

      <div class="relatorio-rodape">Abrelar · Controle de Obras · gerado em ${new Date().toLocaleDateString('pt-BR')}</div>
    </div>
  `;

  document.getElementById('f-mes-relatorio').addEventListener('change', (e) => {
    location.hash = '#/relatorio/' + e.target.value;
  });
  document.getElementById('btn-gerar-pdf').addEventListener('click', () => {
    window.print();
  });
}

// ---------- modal genérico ----------

function abrirModal(titulo, conteudoHtml) {
  fecharModal();
  const overlay = el(`
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal">
        <div class="modal-header"><h3>${titulo}</h3><button class="close-btn" id="modal-fechar">✕</button></div>
        <div id="modal-conteudo">${conteudoHtml}</div>
      </div>
    </div>
  `);
  document.body.appendChild(overlay);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) fecharModal(); });
  document.getElementById('modal-fechar').addEventListener('click', fecharModal);
  return overlay;
}

function fecharModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.remove();
}

// ---------- inicialização ----------

(async function init() {
  try {
    const data = await api('/api/me');
    state.user = data.usuario;
    await afterLogin();
  } catch {
    document.getElementById('login-screen').hidden = false;
  }
})();
