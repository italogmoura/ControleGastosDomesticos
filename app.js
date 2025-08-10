'use strict';

// Persistência simples
const LS_KEYS = {
  sort: 'cg_sort_v1',
  filters: 'cg_filters_v1',
  rules: 'cg_rules_v1',
  data: 'cg_data_v1',
  decisions: 'cg_decisions_v1',
  split: 'cg_split_v1',
  insightsCollapsed: 'cg_insights_collapsed_v1',
  theme: 'cg_theme_v1',
  lancFuzzy: 'cg_lanc_fuzzy_v1'
};

const STATE = {
  transacoes: [], // todas as transacoes carregadas
  sort: JSON.parse(localStorage.getItem(LS_KEYS.sort) || 'null') || { key: 'data', dir: 'asc' },
  filters: JSON.parse(localStorage.getItem(LS_KEYS.filters) || 'null') || { banco: '', texto: '', dataInicio: '', dataFim: '', divisao: '' },
  regras: JSON.parse(localStorage.getItem(LS_KEYS.rules) || 'null') || {}, // descricaoNormalizada -> { divisao: 'Geral'|'Exclusiva', score: number }
  decisions: JSON.parse(localStorage.getItem(LS_KEYS.decisions) || 'null') || {}, // id -> { key, divisao }
  autoSave: { enabled: false, handle: null },
  split: JSON.parse(localStorage.getItem(LS_KEYS.split) || 'null') || { usuario: 60, esposa: 40 },
  insightsCollapsed: JSON.parse(localStorage.getItem(LS_KEYS.insightsCollapsed) || 'false') || false,
  theme: (function(){
    const saved = JSON.parse(localStorage.getItem(LS_KEYS.theme) || 'null');
    if (saved === 'light' || saved === 'dark') return saved;
    try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { return 'dark'; }
  })(),
  lancFuzzy: JSON.parse(localStorage.getItem(LS_KEYS.lancFuzzy) || 'null') || ''
};

// Reclassificação: mapa de overrides de categoria para itens originalmente marcados como Pagamento/Crédito
// Estrutura: { [idTransacao]: true } => true indica que a transação deve aparecer em Lançamentos
STATE.reclass = JSON.parse(localStorage.getItem('cg_reclass_v1') || 'null') || {};

function saveReclass() {
  localStorage.setItem('cg_reclass_v1', JSON.stringify(STATE.reclass || {}));
}

// Determina se um item deve ser tratado como pagamento/estorno (fora dos Lançamentos)
function isPagamento(t) {
  // Se foi forçado para Lançamentos, então não é pagamento
  if (STATE.reclass && STATE.reclass[t.id]) return false;
  return t.categoriaTipo === 'Pagamento/Crédito';
}

function reclassificarParaLancamentos(t) {
  STATE.reclass[t.id] = true;
  saveReclass();
}

function applySavedReclassifications() {
  if (!STATE.reclass) return;
  // Nada para alterar diretamente no objeto além da leitura em isPagamento();
  // mas podemos ajustar a categoria exibida, se desejado.
  for (const tr of STATE.transacoes) {
    if (STATE.reclass[tr.id] && tr.categoriaTipo === 'Pagamento/Crédito') {
      // mantém categoria como 'Pagamento/Crédito' para referência, porém aparecerá em Lançamentos.
      // Se preferir, poderíamos marcar observação.
      if (!tr.observacoes) tr.observacoes = '';
      if (!/\bReclassificado p\/ Lançamentos\b/.test(tr.observacoes)) {
        tr.observacoes = (tr.observacoes ? tr.observacoes + ' | ' : '') + 'Reclassificado p/ Lançamentos';
      }
    }
  }
}

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
  localStorage.setItem(LS_KEYS.split, JSON.stringify(STATE.split));
  localStorage.setItem(LS_KEYS.insightsCollapsed, JSON.stringify(STATE.insightsCollapsed));
  localStorage.setItem(LS_KEYS.theme, JSON.stringify(STATE.theme));
  localStorage.setItem(LS_KEYS.lancFuzzy, JSON.stringify(STATE.lancFuzzy));
}

function applyTheme() {
  const root = document.documentElement;
  root.setAttribute('data-theme', STATE.theme);
  const btn = document.getElementById('btn-theme');
  if (btn) btn.textContent = STATE.theme === 'dark' ? 'Tema: Escuro' : 'Tema: Claro';
}

// Cache de dados (transações) para persistir entre sessões
function saveDataCache() {
  try {
    const payload = { version: 1, savedAt: new Date().toISOString(), transacoes: STATE.transacoes || [] };
    localStorage.setItem(LS_KEYS.data, JSON.stringify(payload));
  } catch (e) {
    console.warn('Falha ao salvar cache de dados', e);
  }
}

function loadDataCache() {
  try {
    const raw = localStorage.getItem(LS_KEYS.data);
    if (!raw) return false;
    const obj = JSON.parse(raw);
    const arr = Array.isArray(obj?.transacoes) ? obj.transacoes : (Array.isArray(obj) ? obj : []);
    STATE.transacoes = arr;
    setStatus(`Dados restaurados do cache (${arr.length} lançamentos).`);
    return true;
  } catch (e) {
    console.warn('Falha ao carregar cache de dados', e);
    return false;
  }
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
    // novo esquema
    const idfF = f.identificacaoFatura || f.identificacao || {};
    const banco = idfF.banco || 'Desconhecido';
    const mesReferencia = idfF.mesReferencia || '';
    const valorTotalFatura = idfF.valorTotal == null ? null : Number(idfF.valorTotal);
    const dataVencimento = idfF.dataVencimento || '';
    const dataFechamento = idfF.dataFechamento || '';
    const periodoReferencia = idfF.periodoReferencia || '';

    // Se existir array de cartoes no novo esquema
    if (Array.isArray(f.cartoes)) {
      for (const c of f.cartoes) {
        const idfC = c.identificacaoCartao || {};
        const titular = idfC.titular || '';
        const bandeira = idfC.bandeira || '';
        const tipoCartao = idfC.tipoCartao || '';
        const finalCartao = idfC.finalCartao || '';
        const cartaoLabel = [bandeira || tipoCartao ? `${bandeira} ${tipoCartao}`.trim() : '', finalCartao ? `final ${finalCartao}` : ''].filter(Boolean).join(' ');
        const cartaoRaw = cartaoLabel || finalCartao || '';
        const trans = Array.isArray(c.transacoes) ? c.transacoes : [];
        for (const t of trans) {
          const dataISO = t.data || '';
          const d = dataISO ? new Date(dataISO) : null;
          const data = d && !isNaN(d) ? fmtDate(d) : '';
          const descricao = cleanDescricao(t.descricao || '', banco);
          const local = t.local || '';
          const estabelecimento = t.estabelecimento || '';
          const categoriaRaw = t.categoria || '';
          const valorBRLnum = Number(t.valorBRL ?? 0);
          const valorUSDnum = t.valorUSD == null ? '' : Number(t.valorUSD);
          const cotacao = t.cotacaoDolar == null ? '' : String(t.cotacaoDolar);
          const iof = t.iof == null ? '' : String(t.iof);
          const taxas = t.taxas == null ? '' : String(t.taxas);
          const parcelamento = t.parcelamento || '';
          const observacoes = t.observacoes || '';
          const tipoLancamento = t.tipoLancamento || '';
          const categoriaTipo = categoriaRaw || inferCategoria(descricao);
          const abs = Math.abs(valorBRLnum || 0);
          const isNegative = valorBRLnum < 0;
          const categoriaFinal = isNegative ? 'Pagamento/Crédito' : categoriaTipo;
          const valorAdj = isNegative ? -abs : abs;
          const id = `${banco}${cartaoRaw ? ' '+cartaoRaw:''}|${mesReferencia}|${data}|${descricao}|${valorAdj}`;
          out.push({
            id,
            banco: cartaoRaw ? `${banco} - ${cartaoRaw}` : banco,
            bancoRaw: banco,
            cartaoRaw: cartaoRaw,
            titular: titular,
            bandeira: bandeira,
            tipoCartao: tipoCartao,
            finalCartao: finalCartao,
            mesReferencia: mesReferencia,
            dataVencimento,
            dataFechamento,
            periodoReferencia,
            valorTotalFatura,
            data,
            descricao,
            estabelecimento,
            local,
            tipoLancamento,
            descricaoNormalizada: normalizeDesc(descricao),
            categoriaTipo: categoriaFinal,
            divisao: inferDivisaoSugerida(descricao),
            valorBRL: valorAdj,
            valorUSD: valorUSDnum === '' ? '' : valorUSDnum,
            cotacao: cotacao,
            iof: iof,
            taxas: taxas,
            parcelamento: parcelamento,
            observacoes
          });
        }
      }
    } else {
      // fallback: esquema antigo direto em f.transacoes
      const cartao = (idfF.cartao || '')
      const trans = Array.isArray(f.transacoes) ? f.transacoes : [];
      for (const t of trans) {
        const dataISO = t.data || '';
        const d = dataISO ? new Date(dataISO) : null;
        const data = d && !isNaN(d) ? fmtDate(d) : '';
        const descricao = cleanDescricao(t.descricao || '', banco);
        const local = t.local || '';
        const estabelecimento = t.estabelecimento || '';
        const categoriaRaw = t.categoria || '';
        const valorBRLnum = Number(t.valorBRL ?? 0);
        const valorUSDnum = t.valorUSD == null ? '' : Number(t.valorUSD);
        const cotacao = t.cotacaoDolar == null ? '' : String(t.cotacaoDolar);
        const taxas = t.taxas == null ? '' : String(t.taxas);
        const parcelamento = t.parcelamento || '';
        const observacoes = t.observacoes || '';
        const categoriaTipo = categoriaRaw || inferCategoria(descricao);
        const abs = Math.abs(valorBRLnum || 0);
        const isNegative = valorBRLnum < 0;
        const categoriaFinal = isNegative ? 'Pagamento/Crédito' : categoriaTipo;
        const valorAdj = isNegative ? -abs : abs;
        const id = `${banco}${cartao ? ' '+cartao:''}|${mesReferencia}|${data}|${descricao}|${valorAdj}`;
        out.push({
          id,
          banco: cartao ? `${banco} - ${cartao}` : banco,
          bancoRaw: banco,
          cartaoRaw: cartao,
          mesReferencia: mesReferencia,
          data,
          descricao,
          estabelecimento,
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
  saveDataCache();
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

// Busca: tokenizada, acento-insensível, exige substring contígua para cada token (mais precisa, menos falsos positivos)
function normalizeSearchText(s='') {
  const base = stripDiacritics(String(s || '').toLowerCase());
  return base.replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function tokensFromQuery(q='') {
  return normalizeSearchText(q).split(' ').filter(Boolean);
}
function lancamentoMatchesQuery(t, query) {
  const tokens = tokensFromQuery(query);
  if (!tokens.length) return true;
  const hay = normalizeSearchText([
    t.descricao,
    t.estabelecimento,
    t.local,
    t.banco,
    t.categoriaTipo
  ].filter(Boolean).join(' '));
  if (!hay) return false;
  // Regra: todos os tokens precisam estar presentes como substrings contíguas
  for (const tok of tokens) {
    // tokens pequenos (1-2) podem ser muito genéricos; exigimos início de palavra para reduzir ruído
    if (tok.length <= 2) {
      const re = new RegExp(`(^|\s)${tok}`);
      if (!re.test(hay)) return false;
    } else {
      if (!hay.includes(tok)) return false;
    }
  }
  return true;
}

function recalcSummary() {
  let totalGeral = 0;
  let totalExclusivas = 0;
  for (const t of STATE.transacoes) {
    const val = Number(t.valorBRL) || 0;
  // Ignora pagamentos/créditos nos totais de despesas (respeita reclassificação)
  if (isPagamento(t)) continue;
    const div = t.divisao.replace(' (sugerido)','');
    if (div === 'Exclusiva') totalExclusivas += val;
    else totalGeral += val;
  }
  const uPerc = Math.max(0, Math.min(100, Number(STATE.split.usuario) || 0));
  const ePerc = 100 - uPerc;
  const usuario = totalExclusivas + totalGeral * (uPerc / 100);
  const esposa = totalGeral * (ePerc / 100);
  document.getElementById('sum-geral').textContent = fmtBRL(totalGeral);
  document.getElementById('sum-exclusivas').textContent = fmtBRL(totalExclusivas);
  document.getElementById('sum-usuario').textContent = fmtBRL(usuario);
  document.getElementById('sum-esposa').textContent = fmtBRL(esposa);
  const lpU = document.getElementById('label-perc-usuario');
  const lpE = document.getElementById('label-perc-esposa');
  if (lpU) lpU.textContent = String(uPerc);
  if (lpE) lpE.textContent = String(ePerc);

  renderFaturasSummary();
}

// Gera cards por fatura com total da fatura e quantidade de transações detectadas
function renderFaturasSummary() {
  const wrap = document.getElementById('faturas-summary');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!STATE.transacoes.length) return;

  // Agrupar por (bancoRaw, cartaoRaw, mesReferencia)
  const groups = new Map();
  for (const t of STATE.transacoes) {
    const key = `${t.bancoRaw || ''}|||${t.cartaoRaw || ''}|||${t.mesReferencia || ''}`;
    if (!groups.has(key)) {
      groups.set(key, { banco: t.bancoRaw || 'Desconhecido', cartao: t.cartaoRaw || '', mesRef: t.mesReferencia || '', total: 0, count: 0 });
    }
    const g = groups.get(key);
    // contar tudo que não é pagamento/crédito para o total da fatura
    if (t.categoriaTipo !== 'Pagamento/Crédito') g.total += Number(t.valorBRL) || 0;
    g.count += 1; // total de transações detectadas (inclui pagamentos/estornos)
  }

  // Criar cards
  for (const g of groups.values()) {
    const card = document.createElement('div');
    card.className = 'fatura-card';
    const title = [g.banco, g.cartao].filter(Boolean).join(' - ') || 'Fatura';
    const head = document.createElement('div');
    head.className = 'fatura-head';
    const hTitle = document.createElement('div');
    hTitle.className = 'fatura-title';
    hTitle.textContent = title;
    const hRight = document.createElement('div');
    hRight.textContent = g.mesRef || '';
    head.appendChild(hTitle);
    head.appendChild(hRight);
    card.appendChild(head);

    const row1 = document.createElement('div');
    row1.className = 'row';
    row1.innerHTML = `<span class="label">Total da fatura</span><span class="value">${fmtBRL(g.total)}</span>`;
    const row2 = document.createElement('div');
    row2.className = 'row';
    row2.innerHTML = `<span class="label">Transações detectadas</span><span class="value">${g.count}</span>`;
    card.appendChild(row1);
    card.appendChild(row2);

    wrap.appendChild(card);
  }
}

function renderTable() {
  const body = document.getElementById('tabela-body');
  body.innerHTML = '';
  const data = applyFiltersSort();
  const pagamentos = data.filter(t => isPagamento(t));
  let despesas = data.filter(t => !isPagamento(t));

  // fuzzy filter only for Lançamentos
  const q = (STATE.lancFuzzy || '').trim();
  if (q) despesas = despesas.filter(t => lancamentoMatchesQuery(t, q));
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
  tr.appendChild(mk(t.iof !== '' ? Number(t.iof).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '', 'right'));
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
    // ação: reclassificar para Lançamentos
    const tdAcao = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary';
    btn.textContent = 'Incluir em Lançamentos';
    btn.addEventListener('click', () => {
      reclassificarParaLancamentos(p);
      recalcSummary();
      renderTable();
  saveDataCache();
    });
    tdAcao.appendChild(btn);
    tr.appendChild(tdAcao);
    pagBody.appendChild(tr);
  }
  const legend = document.getElementById('legend-pag-count');
  if (legend) legend.textContent = pagamentos.length ? `${pagamentos.length} registros` : 'Nenhum registro';

  // render tabela de Exclusivas
  const excBody = document.getElementById('tabela-exc-body');
  if (excBody) {
    excBody.innerHTML = '';
    let eidx = 1;
  let excTotal = 0;
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
      excTotal += Number(t.valorBRL) || 0;
      tr.appendChild(mk(t.valorUSD !== '' ? Number(t.valorUSD).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '', 'right'));
      tr.appendChild(mk(t.cotacao !== '' ? String(t.cotacao) : '', 'right'));
  tr.appendChild(mk(t.iof !== '' ? Number(t.iof).toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '', 'right'));
      tr.appendChild(mk(t.taxas));
      tr.appendChild(mk(t.parcelamento));
      tr.appendChild(mk(t.observacoes));

      excBody.appendChild(tr);
    }
    const legendExc = document.getElementById('legend-exc-count');
    if (legendExc) legendExc.textContent = despesasExclusivas.length ? `${despesasExclusivas.length} registros` : 'Nenhum registro';
    const legendExcSum = document.getElementById('legend-exc-sum');
    if (legendExcSum) legendExcSum.textContent = fmtBRL(excTotal);
  }

  // habilita export se há dados
  const has = STATE.transacoes.length > 0;
  document.getElementById('btn-export-csv').disabled = !has;
  document.getElementById('btn-export-xlsx').disabled = !has;

  renderInsights(despesas);
}

function updateBancoFiltroOptions() {
  const sel = document.getElementById('filtro-banco');
  const banks = [...new Set(STATE.transacoes.map(t => t.banco))];
  sel.innerHTML = '<option value="">Todos os bancos</option>' + banks.map(b => `<option value="${b}">${b}</option>`).join('');
  if (STATE.filters.banco) sel.value = STATE.filters.banco;
}

// CSV/XLSX export
function exportCSV() {
  const rows = [['Data','Banco/Cartão','Descrição','Local','Categoria','Divisão','Valor R$','Valor USD','Cotação','IOF','Taxas','Parcelamento','Observações']];
  const all = applyFiltersSort();
  const despesas = all.filter(t => !isPagamento(t));
  const pagamentos = all.filter(t => isPagamento(t));
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
      t.iof !== '' ? Number(t.iof).toFixed(2).replace('.',',') : '',
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
  const despesas = all.filter(t => !isPagamento(t));
  const pagamentos = all.filter(t => isPagamento(t));
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
  IOF: t.iof !== '' ? Number(t.iof) : '',
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
  const reviewBtn = document.getElementById('btn-review-mode');
  const reviewDlg = document.getElementById('review-dialog');
  const rv = {
    data: document.getElementById('rv-data'),
    banco: document.getElementById('rv-banco'),
    desc: document.getElementById('rv-desc'),
    local: document.getElementById('rv-local'),
    cat: document.getElementById('rv-cat'),
    valor: document.getElementById('rv-valor'),
    sugestao: document.getElementById('rv-sugestao'),
    progress: document.getElementById('review-progress'),
    btnGeral: document.getElementById('btn-review-geral'),
    btnEx: document.getElementById('btn-review-exclusiva'),
    btnPrev: document.getElementById('btn-review-prev'),
    btnSkip: document.getElementById('btn-review-skip'),
    btnConfirm: document.getElementById('btn-review-confirm'),
    btnApplySame: document.getElementById('btn-review-apply-same'),
    btnClose: document.getElementById('btn-review-close')
  };
  const REVIEW = { queue: [], index: 0, backingList: [] };

  // Manual transaction dialog elements
  const manualDlg = document.getElementById('manual-dialog');
  const manualForm = document.getElementById('manual-form');
  const manualBtn = document.getElementById('btn-add-manual');
  const mEls = {
    data: document.getElementById('manual-data'),
    banco: document.getElementById('manual-banco'),
    desc: document.getElementById('manual-descricao'),
    local: document.getElementById('manual-local'),
    cat: document.getElementById('manual-categoria'),
    valor: document.getElementById('manual-valor'),
    divisao: document.getElementById('manual-divisao'),
    obs: document.getElementById('manual-observacoes')
  };

  function buildReviewQueue() {
    // Pega despesas (não pagamentos), ordenadas como a tabela, priorizando pendentes (sugeridos) primeiro
    const sorted = applyFiltersSort();
    const despesas = sorted.filter(t => !isPagamento(t));
    const pend = [];
    const decid = [];
    for (const t of despesas) {
      if (STATE.decisions[t.id]) decid.push(t); else pend.push(t);
    }
    REVIEW.backingList = despesas;
    REVIEW.queue = pend.concat(decid);
    REVIEW.index = 0;
  }

  function currentItem() { return REVIEW.queue[REVIEW.index]; }
  function updateReviewUI() {
    const t = currentItem();
    if (!t) {
      rv.progress.textContent = 'Sem itens para revisar.';
      ['data','banco','desc','local','cat','valor','sugestao'].forEach(k => rv[k] && (rv[k].textContent = ''));
      return;
    }
    rv.progress.textContent = `${REVIEW.index + 1} / ${REVIEW.queue.length}`;
    rv.data.textContent = t.data || '';
    rv.banco.textContent = t.banco || '';
    rv.desc.textContent = t.descricao || '';
    rv.local.textContent = t.local || '';
    rv.cat.textContent = t.categoriaTipo || '';
    rv.valor.textContent = (Number(t.valorBRL)||0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
    const clean = (t.divisao || '').replace(' (sugerido)','');
    const sug = t.divisao?.endsWith('(sugerido)') ? `${clean} (sugerido)` : clean || '—';
    rv.sugestao.textContent = sug;
    rv.btnGeral.classList.toggle('active', clean === 'Geral');
    rv.btnEx.classList.toggle('active', clean === 'Exclusiva');
  }
  function reviewPrev() { if (REVIEW.index > 0) { REVIEW.index--; updateReviewUI(); } }
  function reviewNext() { if (REVIEW.index < REVIEW.queue.length - 1) { REVIEW.index++; updateReviewUI(); } }
  function reviewConfirm(next = true) {
    const t = currentItem(); if (!t) return;
    const clean = (t.divisao || '').replace(' (sugerido)','') || 'Geral';
    confirmarDivisao(t, clean);
    recalcSummary(); renderTable(); savePrefs(); saveDataCache();
    if (next) reviewNext();
  }
  function reviewSet(div) {
    const t = currentItem(); if (!t) return;
    t.divisao = div; // rótulo limpo na UI
    updateReviewUI();
  }
  function reviewApplySame() {
    const t = currentItem(); if (!t) return;
    const clean = (t.divisao || '').replace(' (sugerido)','') || 'Geral';
    const key = t.descricaoNormalizada;
    // aplica a todos na backing list que tenham a mesma chave
    const affected = REVIEW.backingList.filter(x => x.descricaoNormalizada === key);
    for (const x of affected) confirmarDivisao(x, clean);
    recalcSummary(); renderTable(); savePrefs(); saveDataCache();
    // pular para próxima chave diferente
    const curKey = key;
    let i = REVIEW.index + 1;
    while (i < REVIEW.queue.length && REVIEW.queue[i].descricaoNormalizada === curKey) i++;
    REVIEW.index = Math.min(i, REVIEW.queue.length - 1);
    updateReviewUI();
  }

  function openReview() {
    buildReviewQueue();
    try { reviewDlg.showModal(); } catch { /* fallback se dialog não suportado */ }
    updateReviewUI();
    // Captura atalhos enquanto o diálogo estiver aberto
    document.addEventListener('keydown', onReviewKeydown, { capture: true });
  }
  function closeReview() {
    try { reviewDlg.close(); } catch {}
    document.removeEventListener('keydown', onReviewKeydown, { capture: true });
  }
  function onReviewKeydown(ev) {
    if (!reviewDlg.open) return;
    const k = ev.key;
    if (k === 'ArrowLeft') { ev.preventDefault(); reviewSet('Geral'); return; }
    if (k === 'ArrowRight') { ev.preventDefault(); reviewSet('Exclusiva'); return; }
    if (k === 'ArrowDown' || k === 'Enter') { ev.preventDefault(); reviewConfirm(true); return; }
    if (k === 'ArrowUp') { ev.preventDefault(); reviewPrev(); return; }
    if (k === 'a' || k === 'A') { ev.preventDefault(); reviewApplySame(); return; }
    if (k === 'p' || k === 'P') { ev.preventDefault(); reviewNext(); return; }
    if (k === 'Escape') { ev.preventDefault(); closeReview(); return; }
  }

  // Ligações de botões
  if (reviewBtn) reviewBtn.addEventListener('click', openReview);
  if (rv.btnGeral) rv.btnGeral.addEventListener('click', () => reviewSet('Geral'));
  if (rv.btnEx) rv.btnEx.addEventListener('click', () => reviewSet('Exclusiva'));
  if (rv.btnPrev) rv.btnPrev.addEventListener('click', reviewPrev);
  if (rv.btnSkip) rv.btnSkip.addEventListener('click', reviewNext);
  if (rv.btnConfirm) rv.btnConfirm.addEventListener('click', () => reviewConfirm(true));
  if (rv.btnApplySame) rv.btnApplySame.addEventListener('click', reviewApplySame);
  if (rv.btnClose) rv.btnClose.addEventListener('click', closeReview);

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
  // aplicar reclassificações salvas
  applySavedReclassifications();
    updateBancoFiltroOptions();
    recalcSummary();
    renderTable();
    savePrefs();
  saveDataCache();
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
  applySavedReclassifications();
      updateBancoFiltroOptions();
      recalcSummary();
      renderTable();
      savePrefs();
  saveDataCache();
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

  // Adicionar lançamento manual
  if (manualBtn && manualDlg && manualForm) {
    manualBtn.addEventListener('click', () => {
      try { manualDlg.showModal(); } catch {}
    });
    manualForm.addEventListener('submit', (ev) => {
      ev.preventDefault();
      const dataISO = (mEls.data?.value || '').trim();
      const d = dataISO ? new Date(dataISO) : null;
      const dataFmt = d && !isNaN(d) ? fmtDate(d) : '';
      const banco = (mEls.banco?.value || '').trim() || 'Manual';
      const desc = (mEls.desc?.value || '').trim();
      const local = (mEls.local?.value || '').trim();
  const catIn = (mEls.cat?.value || '').trim();
      const valorNum = Number(mEls.valor?.value || 0) || 0;
      const divisao = (mEls.divisao?.value || 'Geral');
      const obs = (mEls.obs?.value || '').trim();
      if (!desc) { setStatus('Informe uma descrição.'); return; }
      if (!dataFmt) { setStatus('Informe uma data válida.'); return; }
      if (!isFinite(valorNum)) { setStatus('Informe um valor válido.'); return; }

      const isNegative = valorNum < 0;
      const valorAdj = isNegative ? -Math.abs(valorNum) : Math.abs(valorNum);
  const categoriaTipo = isNegative ? 'Pagamento/Crédito' : (catIn || inferCategoria(desc) || 'Outros');
      const descricao = cleanDescricao(desc, '');
      const id = `Manual|${dataFmt}|${descricao}|${valorAdj}|${Date.now()}`;
      const t = {
        id,
        banco,
        bancoRaw: banco,
        cartaoRaw: '',
        mesReferencia: '',
        data: dataFmt,
        descricao,
        estabelecimento: '',
        local,
        tipoLancamento: '',
        descricaoNormalizada: normalizeDesc(descricao),
        categoriaTipo,
        divisao,
        valorBRL: valorAdj,
        valorUSD: '',
        cotacao: '',
        iof: '',
        taxas: '',
        parcelamento: '',
        observacoes: obs
      };

      // Inserir e persistir
      STATE.transacoes.push(t);
      saveDataCache();
      savePrefs();
      recalcSummary();
      renderTable();
      setStatus('Lançamento manual adicionado.');
      try { manualDlg.close(); } catch {}
      manualForm.reset();
    });
  }

  // Fuzzy search handlers
  const fuzzyInput = document.getElementById('fuzzy-lanc-input');
  const fuzzyClear = document.getElementById('fuzzy-lanc-clear');
  if (fuzzyInput) {
    fuzzyInput.value = STATE.lancFuzzy || '';
    const onChange = () => {
      STATE.lancFuzzy = fuzzyInput.value || '';
      savePrefs();
      renderTable();
    };
    fuzzyInput.addEventListener('input', onChange);
    fuzzyInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') { fuzzyInput.value=''; onChange(); } });
  }
  if (fuzzyClear) fuzzyClear.addEventListener('click', () => { if (fuzzyInput) { fuzzyInput.value=''; STATE.lancFuzzy=''; savePrefs(); renderTable(); } });
  document.getElementById('btn-limpar').addEventListener('click', () => {
    if (!confirm('Limpar dados, filtros e regras salvas?')) return;
    STATE.transacoes = [];
    STATE.regras = {};
  STATE.decisions = {};
  STATE.reclass = {};
    STATE.filters = { banco: '', texto: '', dataInicio: '', dataFim: '', divisao: '' };
  STATE.split = { usuario: 60, esposa: 40 };
    localStorage.removeItem(LS_KEYS.data);
    localStorage.removeItem(LS_KEYS.rules);
    localStorage.removeItem(LS_KEYS.filters);
  localStorage.removeItem(LS_KEYS.decisions);
  localStorage.removeItem(LS_KEYS.split);
  localStorage.removeItem('cg_reclass_v1');
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

  // configurar UI de divisão
  const inputPerc = document.getElementById('input-perc-usuario');
  const lblEsposaLive = document.getElementById('perc-esposa-live');
  const btnResetSplit = document.getElementById('btn-reset-split');
  const salU = document.getElementById('input-sal-usuario');
  const salE = document.getElementById('input-sal-esposa');
  const btnCalcSal = document.getElementById('btn-calcular-salarios');
  if (inputPerc && lblEsposaLive) {
    const u = Math.max(0, Math.min(100, Number(STATE.split.usuario) || 0));
    inputPerc.value = String(u);
    lblEsposaLive.textContent = String(100 - u);
    inputPerc.addEventListener('input', () => {
      const val = Math.max(0, Math.min(100, Number(inputPerc.value || 0)));
      STATE.split.usuario = val;
      STATE.split.esposa = 100 - val;
      lblEsposaLive.textContent = String(STATE.split.esposa);
      savePrefs();
      recalcSummary();
    });
  }
  if (btnResetSplit) {
    btnResetSplit.addEventListener('click', () => {
      STATE.split = { usuario: 60, esposa: 40 };
      const u = document.getElementById('input-perc-usuario');
      const lbl = document.getElementById('perc-esposa-live');
      if (u) u.value = '60';
      if (lbl) lbl.textContent = '40';
      savePrefs();
      recalcSummary();
    });
  }
  if (btnCalcSal) {
    btnCalcSal.addEventListener('click', () => {
      const vU = Number((salU && salU.value) ? salU.value : 0) || 0;
      const vE = Number((salE && salE.value) ? salE.value : 0) || 0;
      const total = vU + vE;
      if (!isFinite(total) || total <= 0) {
        setStatus('Informe salários válidos para calcular a proporção.');
        return;
      }
      // proporção pelo salário: usuário = vU/total * 100
      const uPerc = Math.round((vU / total) * 100);
      const ePerc = 100 - uPerc; // garante soma 100
      STATE.split = { usuario: uPerc, esposa: ePerc };
      // refletir na UI manual também
      const inp = document.getElementById('input-perc-usuario');
      const lbl = document.getElementById('perc-esposa-live');
      if (inp) inp.value = String(uPerc);
      if (lbl) lbl.textContent = String(ePerc);
      savePrefs();
      recalcSummary();
      setStatus(`Proporção atualizada pelos salários: Usuário ${uPerc}% / Esposa ${ePerc}%.`);
    });
  }

  // estado inicial
  migrateRegrasInPlace();
  loadAutoSaveHandle();
  // Restaura dados do cache, se houver
  const restored = loadDataCache();
  if (restored) {
    updateBancoFiltroOptions();
  }
  // aplica reclassificações salvas (se houver) antes do primeiro render
  applySavedReclassifications();
  // Tema e toggle
  applyTheme();
  const btnTheme = document.getElementById('btn-theme');
  if (btnTheme) {
    btnTheme.addEventListener('click', () => {
      STATE.theme = STATE.theme === 'dark' ? 'light' : 'dark';
      applyTheme();
      savePrefs();
    });
  }
  // Se não houver tema salvo, refletir mudanças do SO
  if (!localStorage.getItem(LS_KEYS.theme) && window.matchMedia) {
    try {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      mq.addEventListener?.('change', (e) => {
        STATE.theme = e.matches ? 'dark' : 'light';
        applyTheme();
      });
    } catch {}
  }
  recalcSummary();
  renderTable();
  updateAutoSaveStatusUI();
  setupInsightsToggle();
}

window.addEventListener('DOMContentLoaded', initUI);

// --- Insights com Apache ECharts ---
let ECHARTS = { topcat:null, treemap:null, heatmap:null };
function renderInsights(despesas) {
  try {
    if (!window.echarts) return;
    // utilidades
    const sumBy = (arr, keyFn) => {
      const m = new Map();
      for (const t of arr) {
        const k = keyFn(t) || '—';
        m.set(k, (m.get(k) || 0) + (Number(t.valorBRL) || 0));
      }
      return [...m.entries()].sort((a,b) => b[1]-a[1]);
    };
    const topN = (entries, n=10) => entries.slice(0,n);
    const safeInit = (id) => {
      const el = document.getElementById(id);
      if (!el) return null;
      // dispose antes de criar
      if (el._echarts_instance_) {
        try { echarts.dispose(el); } catch {}
      }
      return echarts.init(el, null, { renderer: 'canvas' });
    };
    const total = despesas.reduce((a,t)=>a+(Number(t.valorBRL)||0),0);
    const porDiv = new Map();
    for (const t of despesas) {
      const d = (t.divisao || '').replace(' (sugerido)','') || 'Geral';
      porDiv.set(d, (porDiv.get(d)||0) + (Number(t.valorBRL)||0));
    }
    const categorias = topN(sumBy(despesas, t=>t.categoriaTipo));
    const estabelecimentos = topN(sumBy(despesas, t=>t.estabelecimento || t.descricao));
    // linha diária acumulada
    const byDay = new Map();
    for (const t of despesas) {
      const dt = parseDate(t.data);
      if (!dt) continue;
      const key = dt.toISOString().slice(0,10);
      byDay.set(key, (byDay.get(key)||0) + (Number(t.valorBRL)||0));
    }
    const daysSorted = [...byDay.entries()].sort((a,b)=> (a[0] < b[0] ? -1 : 1));
    let acc = 0; const serieAccum = daysSorted.map(([d,v]) => { acc+=v; return [d, Number(acc.toFixed(2))]; });
    // treemap por estabelecimento
    const treemapData = estabelecimentos.map(([name,val])=>({ name, value: Number(val.toFixed(2)) }));
    // heatmap: dia da semana vs semana do mês
    const heatAgg = new Map();
    for (const t of despesas) {
      const dt = parseDate(t.data); if (!dt) continue;
      const dow = dt.getDay(); // 0-dom
      const week = Math.floor((dt.getDate()-1)/7); // 0..4
      const key = `${dow}-${week}`;
      heatAgg.set(key, (heatAgg.get(key)||0) + (Number(t.valorBRL)||0));
    }
    const heatData = [...heatAgg.entries()].map(([k,v])=>{ const [d,w]=k.split('-').map(Number); return [d,w,Number(v.toFixed(2))]; });

  // 1) Barras horizontais - Top Categorias
    {
      const inst = safeInit('echart-topcat'); if (inst) {
        ECHARTS.topcat = inst;
        const labels = categorias.map(x=>x[0]).reverse();
        const values = categorias.map(x=>Number(x[1].toFixed(2))).reverse();
        inst.setOption({
          grid:{ left: 110, right: 30, top: 16, bottom: 28 },
          tooltip: { trigger: 'axis', axisPointer:{ type:'shadow' }, formatter: (p)=>{
            const v = p[0]?.value || 0; const pct = total? ((v/total)*100).toFixed(1):'0.0';
            return `${p[0].name}: ${fmtBRL(v)} (${pct}%)`;
          }},
          xAxis: { type: 'value', axisLabel:{ color:'#94a3b8', margin: 8, formatter: (v)=>fmtBRL(v) } },
          yAxis: { type: 'category', data: labels, axisLabel:{ color:'#94a3b8', margin: 10 } },
          series: [{ type:'bar', data: values, itemStyle:{ color:{ type:'linear', x:0, y:0, x2:1, y2:0, colorStops:[{offset:0,color:'#38bdf8'},{offset:1,color:'#22c55e'}]} } }]
        });
      }
    }
  // 2) Treemap por estabelecimento
    {
      const inst = safeInit('echart-treemap'); if (inst) {
        ECHARTS.treemap = inst;
        inst.setOption({
          tooltip: { formatter: ({data}) => `${data.name}: ${fmtBRL(data.value)}` },
          series: [{ type:'treemap', roam:true, nodeClick:'zoomToNode', breadcrumb:{ show:false }, data: treemapData }]
        });
      }
    }
  // 3) Heatmap padrão semanal (dow x semana)
    {
      const inst = safeInit('echart-heatmap'); if (inst) {
        ECHARTS.heatmap = inst;
        inst.setOption({
          tooltip: { formatter: (p)=>{ const d=['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'][p.value[0]]; return `${d} semana ${p.value[1]+1}: ${fmtBRL(p.value[2])}`; } },
        grid:{ left: 40, right: 20, top: 10, bottom: 20 },
          xAxis: { type:'category', data: [0,1,2,3,4].map(i=>'Sem '+(i+1)), axisLabel:{ color:'#94a3b8' } },
          yAxis: { type:'category', data: ['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'], axisLabel:{ color:'#94a3b8' } },
          visualMap: { min: 0, max: Math.max(1, ...heatData.map(x=>x[2])), calculable:true, orient:'horizontal', bottom:0, textStyle:{ color:'#94a3b8' } },
          series: [{ type:'heatmap', data: heatData }]
        });
      }
    }
  // (Gauge removido a pedido)
  } catch (e) {
    console.warn('Falha ao renderizar insights', e);
  }
}

// Toggle Insights (collapse/expand)
function setupInsightsToggle() {
  const btn = document.getElementById('toggle-insights');
  const panel = document.getElementById('insights');
  if (!btn || !panel) return;
  const applyState = () => {
    panel.style.display = STATE.insightsCollapsed ? 'none' : '';
    btn.setAttribute('aria-expanded', String(!STATE.insightsCollapsed));
    btn.textContent = STATE.insightsCollapsed ? 'Mostrar' : 'Esconder';
  };
  applyState();
  btn.addEventListener('click', () => {
    STATE.insightsCollapsed = !STATE.insightsCollapsed;
    applyState();
    savePrefs();
    // Recalcular gráficos ao expandir (para ajustar tamanhos)
    if (!STATE.insightsCollapsed) {
      try { renderInsights(applyFiltersSort().filter(t => !isPagamento(t))); } catch {}
    }
  });
}
