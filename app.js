'use strict';

// Persistência simples
const LS_KEYS = {
  sort: 'cg_sort_v1',
  filters: 'cg_filters_v1',
  rules: 'cg_rules_v1',
  data: 'cg_data_v1',
  decisions: 'cg_decisions_v1'
};

const STATE = {
  transacoes: [], // todas as transacoes carregadas
  sort: JSON.parse(localStorage.getItem(LS_KEYS.sort) || 'null') || { key: 'data', dir: 'asc' },
  filters: JSON.parse(localStorage.getItem(LS_KEYS.filters) || 'null') || { banco: '', texto: '', dataInicio: '', dataFim: '', divisao: '' },
  regras: JSON.parse(localStorage.getItem(LS_KEYS.rules) || 'null') || {}, // descricaoNormalizada -> { divisao: 'Geral'|'Exclusiva', score: number }
  decisions: JSON.parse(localStorage.getItem(LS_KEYS.decisions) || 'null') || {}, // id -> { key, divisao }
  autoSave: { enabled: false, handle: null }
};

// Utils
const fmtBRL = (n) => (n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const parseDate = (s) => {
  // aceita DD/MM, DD/MM/AA ou DD/MM/AAAA
  let m = /^(\d{2})\/(\d{2})(?:\/(\d{2,4}))?$/.exec(s);
  if (m) {
    const [_, dd, mm, yy] = m;
    const year = yy ? (yy.length === 2 ? (2000 + Number(yy)) : Number(yy)) : (new Date()).getFullYear();
    return new Date(year, Number(mm) - 1, Number(dd));
  }
  // aceita "DD mon" (pt-BR abreviado)
  m = /^(\d{1,2})\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)$/i.exec((s||'').trim());
  if (m) {
    const dd = Number(m[1]);
    const mon = m[2].toLowerCase();
    const mmMap = { jan:0, fev:1, mar:2, abr:3, mai:4, jun:5, jul:6, ago:7, set:8, out:9, nov:10, dez:11 };
    const year = (new Date()).getFullYear();
    return new Date(year, mmMap[mon] ?? 0, dd);
  }
  return null;
};
const fmtDate = (d) => {
  if (!d) return '';
  const dd = String(d.getDate()).padStart(2,'0');
  const mm = String(d.getMonth()+1).padStart(2,'0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
};
const normalizeDesc = (s='') => s.toLowerCase()
  .replace(/\s+/g,' ')
  .replace(/^ifd\*/,'')
  .replace(/^uber\s*\*/,'uber ')
  .replace(/[^a-z0-9ãõáéíóúâêîôûàèìòùç\s\.\-]/g,'')
  .trim();

// Remove prefixos de cartão mascarado (ex.: "•••• 9095 ") em descrições, sobretudo Nubank
function cleanDescricao(desc = '', banco = '') {
  let s = String(desc);
  if (banco === 'Nubank') {
    // Remover padrões iniciais como "•••• 9095 ", ".... 1234 ", "**** 1234 "
    s = s.replace(/^(?:[•·*\.]{2,}\s*)\d{4}\s+/u, '');
    // Remover variantes textuais ocasionais: "cartao final 1234" no início
    s = s.replace(/^cart[aã]o\s*(?:final\s*)?\d{4}\s*[:-]?\s*/i, '');
  }
  return s.trim().replace(/\s{2,}/g,' ');
}

const setStatus = (msg) => {
  document.getElementById('status').textContent = msg || '';
};

function savePrefs() {
  localStorage.setItem(LS_KEYS.sort, JSON.stringify(STATE.sort));
  localStorage.setItem(LS_KEYS.filters, JSON.stringify(STATE.filters));
  localStorage.setItem(LS_KEYS.rules, JSON.stringify(STATE.regras));
  localStorage.setItem(LS_KEYS.decisions, JSON.stringify(STATE.decisions));
}

// --- File System Access API helpers (opcional) ---
const FS_SUPPORT = !!(window.showSaveFilePicker && window.isSecureContext);

// Pequena camada IndexedDB para guardar o file handle (quando suportado)
const DB_NAME = 'cg_rules_db_v1';
const DB_STORE = 'handles';
function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(key, value) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readonly');
    const req = tx.objectStore(DB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbDel(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function setupAutoSaveHandle() {
  if (!FS_SUPPORT) throw new Error('Navegador sem suporte à File System Access API ou contexto não seguro.');
  const handle = await window.showSaveFilePicker({
    suggestedName: 'regras_divisao.json',
    types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }]
  });
  // Tenta permissão rw
  const perm = await handle.requestPermission({ mode: 'readwrite' });
  if (perm !== 'granted') throw new Error('Permissão negada para gravar arquivo.');
  await idbSet('rulesHandle', handle);
  STATE.autoSave = { enabled: true, handle };
  setStatus('Salvamento automático ativado.');
  updateAutoSaveStatusUI();
}

async function loadAutoSaveHandle() {
  if (!FS_SUPPORT) return;
  try {
    const handle = await idbGet('rulesHandle');
    if (handle) {
      const perm = await handle.requestPermission({ mode: 'readwrite' });
      if (perm === 'granted') {
        STATE.autoSave = { enabled: true, handle };
  updateAutoSaveStatusUI();
      }
    }
  } catch {}
}

let autoSaveTimer = null;
function scheduleAutoSaveRules() {
  if (!STATE.autoSave.enabled || !STATE.autoSave.handle) return;
  if (autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(async () => {
    try {
      const writable = await STATE.autoSave.handle.createWritable();
  const payload = { version: 2, exportedAt: new Date().toISOString(), regras: STATE.regras || {} };
      await writable.write(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
      await writable.close();
      setStatus('Regras salvas automaticamente.');
    } catch (e) {
      console.warn('Falha no auto-save:', e);
      setStatus('Falha ao salvar automaticamente. Verifique permissões.');
    }
  }, 400); // debounce
}

function updateAutoSaveStatusUI() {
  const statusEls = [
    document.getElementById('auto-save-status'),
    document.getElementById('auto-save-status-2')
  ].filter(Boolean);
  const btns = [
    document.getElementById('btn-setup-auto-save'),
    document.getElementById('btn-setup-auto-save-2')
  ].filter(Boolean);
  // Suporte
  if (!FS_SUPPORT) {
    btns.forEach(b => b.disabled = true);
    statusEls.forEach(el => { el.textContent = 'Auto-save indisponível'; el.className = 'badge badge-geral'; });
    return;
  }
  const active = !!(STATE.autoSave.enabled && STATE.autoSave.handle);
  btns.forEach(b => b.disabled = active ? true : false);
  statusEls.forEach(el => {
    if (active) { el.textContent = 'Auto-save ativo'; el.className = 'badge badge-sugerido'; }
    else { el.textContent = 'Auto-save inativo'; el.className = 'badge'; }
  });
}

// Migração e helpers de regras: de score único para contadores por rótulo
function migrateRegrasInPlace() {
  const regras = STATE.regras || {};
  let changed = false;
  for (const [k, r] of Object.entries(regras)) {
    if (!r) continue;
    if (typeof r.score === 'number' && r.divisao) {
      const counts = { Geral: 0, Exclusiva: 0 };
      counts[r.divisao] = r.score;
      regras[k] = { divisao: r.divisao, counts, lastUpdated: r.lastUpdated || new Date().toISOString() };
      changed = true;
    } else if (!r.counts) {
      regras[k] = { divisao: r.divisao || 'Geral', counts: { Geral: 0, Exclusiva: 0 }, lastUpdated: r.lastUpdated || new Date().toISOString() };
      changed = true;
    }
  }
  if (changed) savePrefs();
}

function ensureRule(key) {
  if (!STATE.regras[key]) STATE.regras[key] = { divisao: 'Geral', counts: { Geral: 0, Exclusiva: 0 }, lastUpdated: new Date().toISOString() };
  if (!STATE.regras[key].counts) STATE.regras[key].counts = { Geral: 0, Exclusiva: 0 };
  return STATE.regras[key];
}

// Banco detection heuristics (diacritic-insensitive + filename hints)
function stripDiacritics(s='') {
  try { return s.normalize('NFD').replace(/\p{Mn}+/gu, ''); } catch { return s; }
}
function detectBanco(text, filename='') {
  const t = (text || '').toLowerCase();
  const tn = stripDiacritics(t);
  const fn = stripDiacritics(String(filename || '').toLowerCase());

  // Nubank
  if (t.includes('nubank') || tn.includes('nu pagamentos') || fn.includes('nubank')) return 'Nubank';

  // Itaú (variações)
  if (
    tn.includes('banco itau') || tn.includes('itaucard') || tn.includes('itau') ||
    tn.includes('personnalite') || tn.includes('uniclass') || fn.includes('itau')
  ) return 'Itaú';

  // Amazon (cartões branded)
  if (
    t.includes('amazon') || tn.includes('bradescard amazon') || tn.includes('cartao amazon') ||
    fn.includes('amazon')
  ) return 'Amazon';

  // Rico (ou vinculado a Genial/visa infinite)
  if (t.includes('rico') || t.includes('visa infinite') || tn.includes('genial')) return 'Rico';

  return 'Desconhecido';
}

// Ingestão de JSON estruturado (novo fluxo)
async function readJSONFile(file) {
  const text = await file.text();
  try { return JSON.parse(text); } catch (e) { throw new Error(`JSON inválido em ${file.name}`); }
}

// Removidos pré-processamentos/parsings de PDF – fluxo agora é 100% via JSON

// Converte JSON padronizado para o formato interno do app
function mapJsonToTransactions(json, filename = '') {
  const out = [];
  if (!json || typeof json !== 'object') return out;
  const faturas = Array.isArray(json.faturas) ? json.faturas : [];
  for (const f of faturas) {
    const idf = f.identificacao || {};
    const banco = idf.banco || 'Desconhecido';
    const cartao = idf.cartao || '';
    const trans = Array.isArray(f.transacoes) ? f.transacoes : [];
    for (const t of trans) {
      const dataISO = t.data || '';
      const d = dataISO ? new Date(dataISO) : null;
      const data = d && !isNaN(d) ? fmtDate(d) : '';
      const descricao = cleanDescricao(t.descricao || '', banco);
      const local = t.local || '';
      const categoriaRaw = t.categoria || '';
      const valorBRLnum = Number(t.valorBRL ?? 0);
      const valorUSDnum = t.valorUSD == null ? '' : Number(t.valorUSD);
      const cotacao = t.cotacaoDolar == null ? '' : String(t.cotacaoDolar);
      const taxas = t.taxas == null ? '' : String(t.taxas);
      const parcelamento = t.parcelamento || '';
      const observacoes = t.observacoes || '';
      const categoriaTipo = categoriaRaw || inferCategoria(descricao);
      const abs = Math.abs(valorBRLnum || 0);
      // Mantém o sinal vindo do JSON; se for negativo consideramos pagamento/estorno
      const isNegative = valorBRLnum < 0;
      const categoriaFinal = isNegative ? 'Pagamento/Crédito' : categoriaTipo;
      const valorAdj = isNegative ? -abs : abs;
      const id = `${banco}${cartao ? ' '+cartao:''}|${data}|${descricao}|${valorAdj}`;
      out.push({
        id,
        banco: cartao ? `${banco} - ${cartao}` : banco,
        data,
        descricao,
        local,
        descricaoNormalizada: normalizeDesc(descricao),
        categoriaTipo: categoriaFinal,
        divisao: inferDivisaoSugerida(descricao),
        valorBRL: valorAdj,
        valorUSD: valorUSDnum === '' ? '' : valorUSDnum,
        cotacao: cotacao,
        taxas: taxas,
        parcelamento: parcelamento,
        observacoes
      });
    }
  }
  return out;
}

// Helpers de aprendizado e divisão (mantidos)
function inferDivisaoSugerida(desc) {
  const key = normalizeDesc(desc);
  const rule = STATE.regras[key];
  if (rule) return rule.divisao + ' (sugerido)';
  return 'Geral (sugerido)';
}

function aplicarAprendizado(t) {
  if (t.divisao && t.divisao.endsWith('(sugerido)')) {
    const key = t.descricaoNormalizada;
    const r = STATE.regras[key];
    if (r) t.divisao = r.divisao + ' (sugerido)';
  }
}

function confirmarDivisao(transacao, escolha) {
  transacao.divisao = escolha;
  const key = transacao.descricaoNormalizada;
  const rule = ensureRule(key);
  const decKey = transacao.id;
  const prevDecision = STATE.decisions[decKey]?.divisao;
  if (prevDecision && rule.counts[prevDecision] != null) {
    rule.counts[prevDecision] = Math.max(0, (rule.counts[prevDecision] || 0) - 1);
  }
  rule.counts[escolha] = (rule.counts[escolha] || 0) + 1;
  const g = rule.counts.Geral || 0;
  const e = rule.counts.Exclusiva || 0;
  rule.divisao = (g === e) ? escolha : (g > e ? 'Geral' : 'Exclusiva');
  rule.lastUpdated = new Date().toISOString();
  STATE.decisions[decKey] = { key, divisao: escolha };
  savePrefs();
  scheduleAutoSaveRules();
}

// Filtros e ordenação
function applyFiltersSort() {
  let data = [...STATE.transacoes];
  const F = STATE.filters;

  if (F.banco) data = data.filter(t => t.banco === F.banco);
  if (F.texto) {
    const q = F.texto.toLowerCase();
    data = data.filter(t => t.descricao.toLowerCase().includes(q));
  }
  if (F.dataInicio) {
    const d0 = new Date(F.dataInicio + 'T00:00:00');
    data = data.filter(t => {
      const dt = parseDate(t.data);
      return dt && dt >= d0;
    });
  }
  if (F.dataFim) {
    const d1 = new Date(F.dataFim + 'T23:59:59');
    data = data.filter(t => {
      const dt = parseDate(t.data);
      return dt && dt <= d1;
    });
  }
  if (F.divisao) {
    data = data.filter(t => t.divisao.replace(' (sugerido)','') === F.divisao);
  }

  // sort
  const { key, dir } = STATE.sort;
  data.sort((a,b) => {
    let va = a[key];
    let vb = b[key];
    if (key === 'data') {
      va = parseDate(a.data)?.getTime() || 0;
      vb = parseDate(b.data)?.getTime() || 0;
    }
    if (typeof va === 'string' && typeof vb === 'string') {
      const cmp = va.localeCompare(vb, 'pt-BR', { numeric: true });
      return dir === 'asc' ? cmp : -cmp;
    }
    const cmp = (va || 0) - (vb || 0);
    return dir === 'asc' ? cmp : -cmp;
  });

  return data;
}

function recalcSummary() {
  let totalGeral = 0;
  let totalExclusivas = 0;
  for (const t of STATE.transacoes) {
    const val = Number(t.valorBRL) || 0;
  // Ignora pagamentos/créditos nos totais de despesas
  if (t.categoriaTipo === 'Pagamento/Crédito') continue;
    const div = t.divisao.replace(' (sugerido)','');
    if (div === 'Exclusiva') totalExclusivas += val;
    else totalGeral += val;
  }
  const usuario = totalExclusivas + totalGeral * 0.6;
  const esposa = totalGeral * 0.4;
  document.getElementById('sum-geral').textContent = fmtBRL(totalGeral);
  document.getElementById('sum-exclusivas').textContent = fmtBRL(totalExclusivas);
  document.getElementById('sum-usuario').textContent = fmtBRL(usuario);
  document.getElementById('sum-esposa').textContent = fmtBRL(esposa);
}

function renderTable() {
  const body = document.getElementById('tabela-body');
  body.innerHTML = '';
  const data = applyFiltersSort();
  const pagamentos = data.filter(t => t.categoriaTipo === 'Pagamento/Crédito');
  const despesas = data.filter(t => t.categoriaTipo !== 'Pagamento/Crédito');
  // separar exclusivas
  const isExc = (t) => t.divisao.replace(' (sugerido)','') === 'Exclusiva';
  const despesasExclusivas = despesas.filter(isExc);
  const despesasGerais = despesas.filter(t => !isExc(t));

  let idx = 1;
  for (const t of despesasGerais) {
    const tr = document.createElement('tr');

    const mk = (text, cls) => {
      const td = document.createElement('td');
      if (cls) td.className = cls;
      td.textContent = text ?? '';
      return td;
    };

    // índice
    tr.appendChild(mk(String(idx++), 'right index-col'));
    tr.appendChild(mk(t.data));
    tr.appendChild(mk(t.banco));
  tr.appendChild(mk(t.descricao));
  tr.appendChild(mk(t.local || ''));
    tr.appendChild(mk(t.categoriaTipo));

    const tdDiv = document.createElement('td');
    tdDiv.className = 'cell-divisao';
    const select = document.createElement('select');
    const opts = ['Geral', 'Exclusiva'];
    for (const o of opts) {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
      select.appendChild(opt);
    }
    const cleanVal = t.divisao.replace(' (sugerido)','');
    select.value = cleanVal;
    if (t.divisao.endsWith('(sugerido)')) {
      const badge = document.createElement('span');
      badge.className = 'badge badge-sugerido';
      badge.style.marginLeft = '6px';
      badge.textContent = 'Sugerido';
      tdDiv.appendChild(badge);
    }
    select.addEventListener('change', () => {
      confirmarDivisao(t, select.value);
      recalcSummary();
      renderTable(); // rerender para atualizar badge
    });
    tdDiv.prepend(select);
    tr.appendChild(tdDiv);

    tr.appendChild(mk(t.valorBRL != null && t.valorBRL !== '' ? t.valorBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '', 'right'));
    tr.appendChild(mk(t.valorUSD !== '' ? Number(t.valorUSD).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '', 'right'));
    tr.appendChild(mk(t.cotacao !== '' ? String(t.cotacao) : '', 'right'));
    tr.appendChild(mk(t.taxas));
    tr.appendChild(mk(t.parcelamento));
    tr.appendChild(mk(t.observacoes));

  body.appendChild(tr);
  }

  // pagamentos/estornos em tabela separada
  const pagBody = document.getElementById('tabela-pag-body');
  pagBody.innerHTML = '';
  let pidx = 1;
  for (const p of pagamentos) {
    const tr = document.createElement('tr');
    const mk = (text, cls) => { const td = document.createElement('td'); if (cls) td.className = cls; td.textContent = text ?? ''; return td; };
    tr.appendChild(mk(String(pidx++), 'right index-col'));
    tr.appendChild(mk(p.data));
    tr.appendChild(mk(p.banco));
    tr.appendChild(mk(p.descricao));
  tr.appendChild(mk(p.local || ''));
    tr.appendChild(mk(p.categoriaTipo));
    tr.appendChild(mk(p.valorBRL != null && p.valorBRL !== '' ? p.valorBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '', 'right'));
    tr.appendChild(mk(p.observacoes || ''));
    pagBody.appendChild(tr);
  }
  const legend = document.getElementById('legend-pag-count');
  if (legend) legend.textContent = pagamentos.length ? `${pagamentos.length} registros` : 'Nenhum registro';

  // render tabela de Exclusivas
  const excBody = document.getElementById('tabela-exc-body');
  if (excBody) {
    excBody.innerHTML = '';
    let eidx = 1;
    for (const t of despesasExclusivas) {
      const tr = document.createElement('tr');
      const mk = (text, cls) => {
        const td = document.createElement('td');
        if (cls) td.className = cls;
        td.textContent = text ?? '';
        return td;
      };

      tr.appendChild(mk(String(eidx++), 'right index-col'));
      tr.appendChild(mk(t.data));
      tr.appendChild(mk(t.banco));
  tr.appendChild(mk(t.descricao));
  tr.appendChild(mk(t.local || ''));
      tr.appendChild(mk(t.categoriaTipo));

      const tdDiv = document.createElement('td');
      tdDiv.className = 'cell-divisao';
      const select = document.createElement('select');
      const opts = ['Geral', 'Exclusiva'];
      for (const o of opts) {
        const opt = document.createElement('option');
        opt.value = o;
        opt.textContent = o;
        select.appendChild(opt);
      }
      const cleanVal = t.divisao.replace(' (sugerido)','');
      select.value = cleanVal;
      if (t.divisao.endsWith('(sugerido)')) {
        const badge = document.createElement('span');
        badge.className = 'badge badge-sugerido';
        badge.style.marginLeft = '6px';
        badge.textContent = 'Sugerido';
        tdDiv.appendChild(badge);
      }
      select.addEventListener('change', () => {
        confirmarDivisao(t, select.value);
        recalcSummary();
        renderTable();
      });
      tdDiv.prepend(select);
      tr.appendChild(tdDiv);

      tr.appendChild(mk(t.valorBRL != null && t.valorBRL !== '' ? t.valorBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '', 'right'));
      tr.appendChild(mk(t.valorUSD !== '' ? Number(t.valorUSD).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '', 'right'));
      tr.appendChild(mk(t.cotacao !== '' ? String(t.cotacao) : '', 'right'));
      tr.appendChild(mk(t.taxas));
      tr.appendChild(mk(t.parcelamento));
      tr.appendChild(mk(t.observacoes));

      excBody.appendChild(tr);
    }
    const legendExc = document.getElementById('legend-exc-count');
    if (legendExc) legendExc.textContent = despesasExclusivas.length ? `${despesasExclusivas.length} registros` : 'Nenhum registro';
  }

  // habilita export se há dados
  const has = STATE.transacoes.length > 0;
  document.getElementById('btn-export-csv').disabled = !has;
  document.getElementById('btn-export-xlsx').disabled = !has;
}

function updateBancoFiltroOptions() {
  const sel = document.getElementById('filtro-banco');
  const banks = [...new Set(STATE.transacoes.map(t => t.banco))];
  sel.innerHTML = '<option value="">Todos os bancos</option>' + banks.map(b => `<option value="${b}">${b}</option>`).join('');
  if (STATE.filters.banco) sel.value = STATE.filters.banco;
}

// CSV/XLSX export
function exportCSV() {
  const rows = [['Data','Banco/Cartão','Descrição','Local','Categoria','Divisão','Valor R$','Valor USD','Cotação','Taxas','Parcelamento','Observações']];
  const all = applyFiltersSort();
  const despesas = all.filter(t => t.categoriaTipo !== 'Pagamento/Crédito');
  const pagamentos = all.filter(t => t.categoriaTipo === 'Pagamento/Crédito');
  for (const t of despesas.concat(pagamentos)) {
    rows.push([
      t.data,
      t.banco,
      t.descricao,
      t.local || '',
      t.categoriaTipo,
      t.divisao.replace(' (sugerido)',''),
      (Number(t.valorBRL)||0).toFixed(2).replace('.',','),
      t.valorUSD !== '' ? Number(t.valorUSD).toFixed(2).replace('.',',') : '',
      t.cotacao ?? '',
      t.taxas ?? '',
      t.parcelamento ?? '',
      t.observacoes ?? ''
    ]);
  }
  const csv = rows.map(r => r.map(v => {
    const s = String(v ?? '');
    if (s.includes(';') || s.includes(',') || s.includes('\"') || s.includes('\n')) {
      return '"' + s.replace(/\"/g,'""') + '"';
    }
    return s;
  }).join(';')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'transacoes.csv'; a.click();
  URL.revokeObjectURL(url);
}

function exportXLSX() {
  const all = applyFiltersSort();
  const despesas = all.filter(t => t.categoriaTipo !== 'Pagamento/Crédito');
  const pagamentos = all.filter(t => t.categoriaTipo === 'Pagamento/Crédito');
  const data = despesas.concat(pagamentos).map(t => ({
    Data: t.data,
    'Banco/Cartão': t.banco,
    Descrição: t.descricao,
    Local: t.local || '',
    Categoria: t.categoriaTipo,
    Divisão: t.divisao.replace(' (sugerido)',''),
    'Valor R$': Number(t.valorBRL)||0,
    'Valor USD': t.valorUSD !== '' ? Number(t.valorUSD) : '',
    Cotação: t.cotacao ?? '',
    Taxas: t.taxas ?? '',
    Parcelamento: t.parcelamento ?? '',
    Observações: t.observacoes ?? ''
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Transacoes');
  XLSX.writeFile(wb, 'transacoes.xlsx');
}

// Import/Export de regras (aprendizado) em JSON portátil
function exportRegrasJSON() {
  const payload = {
  version: 2,
    exportedAt: new Date().toISOString(),
    regras: STATE.regras || {}
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'regras_divisao.json'; a.click();
  URL.revokeObjectURL(url);
}

function importRegrasJSON(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const obj = JSON.parse(text);
        const incomingRaw = obj && (obj.regras || obj);
        if (!incomingRaw || typeof incomingRaw !== 'object') throw new Error('Arquivo inválido');
        const incoming = {};
        for (const [k, r] of Object.entries(incomingRaw)) {
          if (!r) continue;
          if (typeof r.score === 'number' && r.divisao) {
            // v1 -> v2
            const counts = { Geral: 0, Exclusiva: 0 };
            counts[r.divisao] = r.score;
            incoming[k] = { divisao: r.divisao, counts, lastUpdated: r.lastUpdated || new Date().toISOString() };
          } else {
            incoming[k] = {
              divisao: r.divisao || 'Geral',
              counts: (r.counts && typeof r.counts === 'object') ? { Geral: r.counts.Geral || 0, Exclusiva: r.counts.Exclusiva || 0 } : { Geral: 0, Exclusiva: 0 },
              lastUpdated: r.lastUpdated || new Date().toISOString()
            };
          }
        }
        // mesclar (importadas prevalecem)
        STATE.regras = { ...(STATE.regras || {}), ...incoming };
        savePrefs();
        // re-aplicar sugestão às transações carregadas
        for (const t of STATE.transacoes) {
          const key = t.descricaoNormalizada;
          if (STATE.regras[key]) t.divisao = STATE.regras[key].divisao + ' (sugerido)';
        }
        renderTable();
        scheduleAutoSaveRules();
        resolve();
      } catch (e) { reject(e); }
    };
    reader.readAsText(file);
  });
}

// Handlers UI
function initUI() {
  const dz = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const pasteBtn = document.getElementById('btn-paste-json');
  const pasteDlg = document.getElementById('paste-json-dialog');
  const pasteTxt = document.getElementById('paste-json-text');

  const onFiles = async (files) => {
    if (!files || files.length === 0) return;
    setStatus('Processando JSON...');
    const acc = [];
    for (const f of files) {
      try {
        const json = await readJSONFile(f);
        const trs = mapJsonToTransactions(json, f.name);
        trs.forEach(aplicarAprendizado);
        acc.push(...trs);
        setStatus(`Arquivo: ${f.name} — Lançamentos: ${trs.length}`);
      } catch (e) {
        console.error('Erro lendo JSON', f.name, e);
        setStatus(`Erro ao processar ${f.name}: ${e?.message || e}`);
      }
    }
    // merge com existentes e dedupe
    const map = new Map(STATE.transacoes.map(t => [t.id, t]));
    for (const t of acc) map.set(t.id, t);
    STATE.transacoes = [...map.values()];
    updateBancoFiltroOptions();
    recalcSummary();
    renderTable();
    savePrefs();
    setStatus(`Carregado${STATE.transacoes.length ? ': ' + STATE.transacoes.length + ' lançamentos' : ' (nenhum lançamento encontrado no JSON).'}`);
  };

  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault(); dz.classList.remove('dragover');
    const files = [...(e.dataTransfer?.files || [])].filter(f => f.type === 'application/json' || f.name.endsWith('.json'));
    onFiles(files);
  });

  fileInput.addEventListener('change', (e) => onFiles([...e.target.files]));

  // Colar JSON: abrir diálogo
  if (pasteBtn && pasteDlg && pasteTxt) {
    pasteBtn.addEventListener('click', () => {
      try {
        pasteDlg.showModal();
        // Seleciona e foca o textarea para colar
        setTimeout(() => { pasteTxt.focus(); pasteTxt.select(); }, 0);
      } catch (e) {
        // Fallback se dialog não suportado
        const raw = prompt('Cole o JSON padronizado aqui:');
        if (raw != null) handlePastedJSON(raw);
      }
    });

    // Intercepta submit do form dentro do dialog
    pasteDlg.addEventListener('close', () => {
      // nada; ações são tratadas no submit
    });

    pasteDlg.querySelector('form')?.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const raw = pasteTxt.value || '';
      handlePastedJSON(raw);
      try { pasteDlg.close(); } catch {}
      pasteTxt.value = '';
    });

    // Botão cancelar já fecha pelo method=dialog; apenas limpa texto
    document.getElementById('btn-paste-cancel')?.addEventListener('click', () => {
      pasteTxt.value = '';
    });
  }

  async function handlePastedJSON(raw) {
    const trimmed = (raw || '').trim();
    if (!trimmed) return;
    setStatus('Processando JSON colado...');
    try {
      const json = JSON.parse(trimmed);
      const trs = mapJsonToTransactions(json, 'pasted');
      trs.forEach(aplicarAprendizado);
      const map = new Map(STATE.transacoes.map(t => [t.id, t]));
      for (const t of trs) map.set(t.id, t);
      STATE.transacoes = [...map.values()];
      updateBancoFiltroOptions();
      recalcSummary();
      renderTable();
      savePrefs();
      setStatus(`Carregado: ${trs.length} lançamentos (via colar JSON)`);
    } catch (e) {
      console.error('Erro ao processar JSON colado', e);
      setStatus('Erro: JSON inválido. Verifique a estrutura.');
    }
  }

  document.getElementById('btn-aplicar-filtros').addEventListener('click', () => {
    STATE.filters = {
      banco: document.getElementById('filtro-banco').value,
      texto: document.getElementById('filtro-texto').value.trim(),
      dataInicio: document.getElementById('filtro-data-inicio').value,
      dataFim: document.getElementById('filtro-data-fim').value,
      divisao: document.getElementById('filtro-divisao').value,
    };
    savePrefs();
    renderTable();
  });

  document.getElementById('btn-export-csv').addEventListener('click', exportCSV);
  document.getElementById('btn-export-xlsx').addEventListener('click', exportXLSX);
  const btnExpReg = document.getElementById('btn-export-regras');
  if (btnExpReg) btnExpReg.addEventListener('click', exportRegrasJSON);
  const inpImpReg = document.getElementById('input-import-regras');
  if (inpImpReg) inpImpReg.addEventListener('change', async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setStatus('Importando regras...');
    try {
      await importRegrasJSON(f);
      setStatus('Regras importadas com sucesso.');
    } catch (err) {
      console.error(err);
      setStatus('Falha ao importar regras: ' + (err?.message || err));
    } finally {
      e.target.value = '';
    }
  });
  const btnAuto = document.getElementById('btn-setup-auto-save');
  if (btnAuto) btnAuto.addEventListener('click', async () => {
    try {
      await setupAutoSaveHandle();
      // salva imediatamente o estado atual
      scheduleAutoSaveRules();
    } catch (e) {
      setStatus(e?.message || String(e));
    }
  });
  const btnAuto2 = document.getElementById('btn-setup-auto-save-2');
  if (btnAuto2) btnAuto2.addEventListener('click', async () => {
    try {
      await setupAutoSaveHandle();
      scheduleAutoSaveRules();
    } catch (e) { setStatus(e?.message || String(e)); }
  });
  document.getElementById('btn-limpar').addEventListener('click', () => {
    if (!confirm('Limpar dados, filtros e regras salvas?')) return;
    STATE.transacoes = [];
    STATE.regras = {};
  STATE.decisions = {};
    STATE.filters = { banco: '', texto: '', dataInicio: '', dataFim: '', divisao: '' };
    localStorage.removeItem(LS_KEYS.data);
    localStorage.removeItem(LS_KEYS.rules);
    localStorage.removeItem(LS_KEYS.filters);
  localStorage.removeItem(LS_KEYS.decisions);
    setStatus('Dados limpos.');
    updateBancoFiltroOptions();
    recalcSummary();
    renderTable();
  scheduleAutoSaveRules();
  });

  // ordenar colunas (todas as tabelas com th.sortable)
  document.querySelectorAll('.data-table thead th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-key');
      if (STATE.sort.key === key) STATE.sort.dir = (STATE.sort.dir === 'asc' ? 'desc' : 'asc');
      else STATE.sort = { key, dir: 'asc' };
      savePrefs();
      renderTable();
    });
  });

  // carregar prefs
  document.getElementById('filtro-banco').value = STATE.filters.banco;
  document.getElementById('filtro-texto').value = STATE.filters.texto;
  document.getElementById('filtro-data-inicio').value = STATE.filters.dataInicio;
  document.getElementById('filtro-data-fim').value = STATE.filters.dataFim;
  document.getElementById('filtro-divisao').value = STATE.filters.divisao;

  // estado inicial
  migrateRegrasInPlace();
  loadAutoSaveHandle();
  recalcSummary();
  renderTable();
  updateAutoSaveStatusUI();
}

window.addEventListener('DOMContentLoaded', initUI);
