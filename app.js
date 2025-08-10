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

// PDF parsing
async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  // Desabilita o worker para funcionar via file:// sem problemas de CORS
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, disableWorker: true, useWorkerFetch: false }).promise;
  let fullText = '';
  const allRows = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const items = content.items || [];
    const strings = items.map(it => it.str);
    fullText += strings.join('\n') + '\n';

    // Agrupar por Y aproximado para reconstruir linhas visuais
    const rowsMap = [];
    const tolY = 2.5; // tolerância de Y
    const points = items.map(it => ({
      x: (it.transform && typeof it.transform[4] === 'number') ? it.transform[4] : 0,
      y: (it.transform && typeof it.transform[5] === 'number') ? it.transform[5] : 0,
      t: it.str
    })).filter(p => p.t && p.t.trim());
    // ordenar por y desc (topo->baixo dependendo do sistema), e x asc depois por linha
    points.sort((a,b) => {
      if (Math.abs(b.y - a.y) > tolY) return b.y - a.y; // y
      return a.x - b.x; // x
    });
    for (const p of points) {
      // encontrar grupo por y
      let grp = rowsMap.find(r => Math.abs(r.y - p.y) <= tolY);
      if (!grp) { grp = { y: p.y, cells: [] }; rowsMap.push(grp); }
      grp.cells.push(p);
    }
    // ordenar grupos por y invertido (crescente visual) e cells por x
    rowsMap.sort((a,b) => b.y - a.y);
    for (const r of rowsMap) {
      r.cells.sort((a,b) => a.x - b.x);
      const line = r.cells.map(c => c.t).join(' ').replace(/\s{2,}/g,' ').trim();
      if (line) allRows.push(line);
    }
  }
  return { text: fullText, pages: pdf.numPages, rows: allRows };
}

// Pré-processamento específico para Itaú: divide linhas que contêm múltiplas datas
// Em faturas Itaú, a seção "Lançamentos: compras e saques" pode vir em duas colunas.
// Esta função detecta múltiplas datas na mesma linha e a quebra em segmentos por lançamento.
function itauPreprocessRows(rows = []) {
  const out = [];
  // Datas no formato DD/MM ou DD/MM/AA(AA), e também "DD mon" (abr pt-BR)
  const reDateToken = /(?:^|\s)(\d{2}\/\d{2}(?:\/\d{2,4})?|\d{1,2}\s+(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez))/ig;
  
  for (const raw of rows) {
    const line = String(raw || '').trim();
    if (!line) continue;
    
    // Detectar múltiplas datas na mesma linha (problema de duas colunas)
    const indices = [];
    reDateToken.lastIndex = 0;
    let m;
    while ((m = reDateToken.exec(line)) !== null) {
      const span = m[0];
      const offset = span.startsWith(' ') ? 1 : 0;
      indices.push(m.index + offset);
      if (reDateToken.lastIndex <= m.index) reDateToken.lastIndex = m.index + 1;
    }
    
    // Se há múltiplas datas, provavelmente é uma linha onde duas colunas foram concatenadas
    if (indices.length >= 2) {
      // Quebrar em segmentos por data
      for (let i = 0; i < indices.length; i++) {
        const start = indices[i];
        const end = indices[i + 1] ?? line.length;
        const seg = line.slice(start, end).replace(/\s{2,}/g, ' ').trim();
        if (seg) out.push(seg);
      }
    } else {
      // Linha normal, manter como está
      out.push(line);
    }
  }
  
  return out;
}

// Parsers por banco (heurística inicial simples)
function parseTransacoesGeneric(text, banco) {
  // Heurística 1: linhas únicas com data + descrição + valor
  // Use linhas reconstruídas quando houver; fallback para separar por \n
  let lines = (Array.isArray(text?.rows) ? text.rows : String(text || '').split(/\n+/))
    .map(l => (typeof l === 'string' ? l.trim() : '')).filter(Boolean);
  const trans = [];

  const reDMY = /^(\d{2})\/(\d{2})\/(\d{2,4})\b/;
  const reDM  = /^(\d{2})\/(\d{2})\b/;
  const reDMon= /^(\d{1,2})\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\b/i;
  // Aceita separador decimal vírgula ou ponto, com ou sem separador de milhar, e hífen à direita
  const reVAL = /R?\$?\s*\(?-?\s*\d+(?:[\.,]\d{3})*[\.,]\d{2}\)?\s*-?$/; // valor ao final (pode terminar com '-')
  const reVALany = /R?\$?\s*\(?-?\s*\d+(?:[\.,]\d{3})*[\.,]\d{2}\)?\s*-?/; // valor em qualquer pos (pode ter '-' à direita)
  const reUSD = /(US\$|USD)\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  const reParc= /(\b\d{1,2})\s*\/\s*(\d{1,2}\b)/;
  const reCot = /(cot[aã]o|c[aâ]mbio)\s*[:\-]?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  const rePagamento = /\b(pagamento|pagto|cr[eé]dito|estorno)\b/i;
  const reCabecalho = /(resumo|lan[çc]amentos|nacionais em reais|vencimento|fechamento|limite|cart[aã]o|n[ou]mero|cliente|fatura|internacionais)/i;

  function isMaskedCardLine(s) {
    // Linhas como 5373.63**.****.8018 ou com muitos asteriscos e dígitos
    return /\*{2,}/.test(s) && /\d/.test(s);
  }

  function isResumoOuTotal(desc) {
    const n = normalizeDesc(desc);
    return /(total a pagar|valor total|total da fatura|saldo|resumo|pagamento minimo|minimo|encargos|juros|anuidade)/.test(n);
  }

  function parseValor(str) {
    const raw = String(str);
    const s = raw.replace(/[^0-9.,()\-]/g,'');
    const trimmed = s.trim();
    const neg = trimmed.includes('-') || (trimmed.startsWith('(') && trimmed.endsWith(')')) || /-\s*$/.test(raw);
    let core = trimmed.replace(/[()\-]/g,'');
    const lastComma = core.lastIndexOf(',');
    const lastDot = core.lastIndexOf('.');
    let dec = null;
    if (lastComma !== -1 || lastDot !== -1) {
      dec = (lastComma > lastDot) ? ',' : (lastDot > lastComma ? '.' : null);
    }
    if (dec) {
      const thou = dec === ',' ? /\./g : /,/g;
      core = core.replace(thou, '').replace(dec, '.');
    }
    const num = parseFloat(core) || 0;
    return neg ? -num : num;
  }

  function trySingleLine(l) {
  let data = null;
    if (reDMY.test(l)) {
      const m = /^(\d{2})\/(\d{2})\/(\d{2,4})/.exec(l);
      data = parseDate(m[0]);
    } else if (reDM.test(l)) {
      const m = /^(\d{2})\/(\d{2})/.exec(l);
      data = parseDate(m[0]);
    } else if (reDMon.test(l)) {
      const m = reDMon.exec(l);
      data = parseDate(`${m[1]} ${m[2]}`);
    }
    if (!data) return null;
    if (!reVALany.test(l)) return null;
    const valMatch = l.match(reVALany);
  const rawValStr = valMatch[0];
  const valorBRL = parseValor(rawValStr);
    // descrição = linha sem data e sem valor no fim
  let desc = l
      .replace(/^(\d{2}\/\d{2}(?:\/\d{2,4})?)/,'')
      .replace(reDMon, '')
      .replace(valMatch[0], '')
      .trim()
      .replace(/\s{2,}/g,' ');
  desc = cleanDescricao(desc, banco);
  if (!desc || reCabecalho.test(desc) || isResumoOuTotal(desc) || isMaskedCardLine(l)) return null;
    let categoriaTipo = inferCategoria(desc);
    let observacoes = '';
    const trailingMinus = /-\s*$/.test(rawValStr);
    const isNegative = valorBRL < 0;
    if (categoriaTipo === 'Pagamento/Crédito' || trailingMinus || isNegative) {
      categoriaTipo = 'Pagamento/Crédito';
      if (/pagamento|pagamentos|pagto|obrigado/i.test(desc)) observacoes = 'Pagamento Fatura';
      else if (/estorno|chargeback/i.test(desc) || trailingMinus || isNegative) observacoes = 'Estorno';
    }
    const abs = Math.abs(valorBRL);
    const valorAdj = (categoriaTipo === 'Pagamento/Crédito') ? -abs : abs;
    const usdM = l.match(reUSD);
    const valorUSD = usdM ? parseValor(usdM[2]) : '';
    const cotM = l.match(reCot);
    const cotacao = cotM ? cotM[2] : '';
    const parcM = l.match(reParc);
    const parcelamento = parcM ? `${parcM[1]}/${parcM[2]}` : '';
    return {
      id: `${banco}|${fmtDate(data)}|${desc}|${valorAdj}`,
      banco,
      data: fmtDate(data),
      descricao: desc,
  local: '',
      descricaoNormalizada: normalizeDesc(desc),
      categoriaTipo,
      divisao: inferDivisaoSugerida(desc),
      valorBRL: valorAdj,
      valorUSD: valorUSD || '',
      cotacao: cotacao || '',
      taxas: '',
      parcelamento,
  observacoes
    };
  }

  // Passo 1: capturar linhas diretas
  // Amazon: usar parser dedicado baseado em linhas reconstruídas
  if (banco === 'Amazon' && lines.length) {
    const amazon = parseTransacoesAmazon(lines, banco);
    if (amazon.length) {
      // dedupe e retornar já que o parser é específico
      const map = new Map();
      for (const t of amazon) map.set(t.id, t);
      return [...map.values()];
    }
  }
  
  // Itaú: usar parser dedicado baseado no texto completo (padrões multilinha)
  if (banco === 'Itaú' && lines.length) {
    // Primeiro aplicar pré-processamento para separar colunas misturadas
    const preprocessedRows = itauPreprocessRows(lines);
    const itau = parseItauFromText({ text: text?.text || lines.join('\n'), rows: preprocessedRows }, banco);
    if (itau.length) {
      // dedupe e retornar
      const map = new Map();
      for (const t of itau) map.set(t.id, t);
      return [...map.values()];
    }
  }

  // Genérico
  for (const l of lines) {
    const t = trySingleLine(l);
    if (t) trans.push(t);
  }

  // Passo 2: se poucos resultados, tentar janela de proximidade
  if (trans.length < 3) {
    for (let i = 0; i < lines.length; i++) {
      const l = lines[i];
      if (reCabecalho.test(l)) continue;
      // detectar data na linha i
      let dataStr = null;
      const dmy = l.match(/^(\d{2}\/\d{2}(?:\/\d{2,4})?)/);
      const dmon = l.match(reDMon);
      if (dmy) dataStr = dmy[0];
      else if (dmon) dataStr = `${dmon[1]} ${dmon[2]}`;
      if (!dataStr) continue;
      const data = parseDate(dataStr);
      // buscar valor nas próximas 1-3 linhas
      let val = null, jFound = -1, rawValStr = '';
      for (let j = i; j <= Math.min(i+3, lines.length-1); j++) {
        const lj = lines[j];
        const m = lj.match(reVALany);
        if (m) { rawValStr = m[0]; val = parseValor(m[0]); jFound = j; break; }
      }
      if (val == null) continue;
      // descrição: concat das linhas i..jFound removendo data e valor
      const descParts = [];
  for (let k = i; k <= jFound; k++) {
        let s = lines[k];
    if (isMaskedCardLine(s)) continue;
        if (k === i) s = s.replace(/^(\d{2}\/\d{2}(?:\/\d{2,4})?)/,'').replace(reDMon, '').trim();
        if (k === jFound) s = s.replace(reVALany,'').trim();
        s = s.replace(/\s{2,}/g,' ').trim();
        if (s) descParts.push(s);
      }
  let desc = descParts.join(' ').trim();
  desc = cleanDescricao(desc, banco);
  if (!desc || reCabecalho.test(desc) || isResumoOuTotal(desc)) continue;
      let categoriaTipo = inferCategoria(desc);
      let observacoes = '';
      const trailingMinus = /-\s*$/.test(rawValStr || '');
      const isNegative = val < 0;
      if (categoriaTipo === 'Pagamento/Crédito' || trailingMinus || isNegative) {
        categoriaTipo = 'Pagamento/Crédito';
        if (/pagamento|pagamentos|pagto|obrigado/i.test(desc)) observacoes = 'Pagamento Fatura';
        else if (/estorno|chargeback/i.test(desc) || trailingMinus || isNegative) observacoes = 'Estorno';
      }
      const abs = Math.abs(val);
      const valorAdj = (categoriaTipo === 'Pagamento/Crédito') ? -abs : abs;
      // USD/cotação/parcelas na janela
      let valorUSD = '', cotacao = '', parcelamento = '';
      for (let k = i; k <= jFound; k++) {
        const s = lines[k];
        const um = s.match(reUSD); if (um) valorUSD = parseValor(um[2]);
        const cm = s.match(reCot); if (cm) cotacao = cm[2];
        const pm = s.match(reParc); if (pm) parcelamento = `${pm[1]}/${pm[2]}`;
      }
      const t = {
        id: `${banco}|${fmtDate(data)}|${desc}|${valorAdj}`,
        banco,
        data: fmtDate(data),
        descricao: desc,
        descricaoNormalizada: normalizeDesc(desc),
        categoriaTipo,
        divisao: inferDivisaoSugerida(desc),
        valorBRL: valorAdj,
        valorUSD: valorUSD || '',
        cotacao: cotacao || '',
        taxas: '',
        parcelamento,
        observacoes
      };
      trans.push(t);
    }
  }

  // Dedupe por id
  const map = new Map();
  for (const t of trans) map.set(t.id, t);
  return [...map.values()];
}

// Parser específico para Amazon utilizando linhas reconstruídas (x/y) e valor no final, frequentemente com hífen à direita
function parseTransacoesAmazon(lines, banco) {
  const out = [];
  const reDMY = /^(\d{2})\/(\d{2})\/(\d{2,4})\b/;
  const reDM  = /^(\d{2})\/(\d{2})\b/;
  const reDMon= /^(\d{1,2})\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\b/i;
  const reVALtrail = /R?\$?\s*\(?-?\s*\d+(?:[\.,]\d{3})*[\.,]\d{2}\)?\s*-?$/;
  const reCab = /(lan[çc]amentos|nacionais em reais|em reais|internacionais|resumo|total|vencimento|fechamento|limite|cart[aã]o|fatura|cliente|n[ou]mero)/i;

  function isMasked(s) { return /\*{2,}/.test(s) && /\d/.test(s); }
  function isResumoTotal(s) {
    const n = normalizeDesc(s);
    return /(total a pagar|valor total|total da fatura|saldo|resumo|pagamento minimo|minimo|encargos|juros|anuidade)/.test(n);
  }
  function parseValor(str) {
    const raw = String(str);
    const s = raw.replace(/[^0-9.,()\-]/g,'');
    const neg = /-\s*$/.test(raw) || /-/.test(s) || (s.startsWith('(') && s.endsWith(')'));
    let core = s.replace(/[()\-]/g,'');
    const lastComma = core.lastIndexOf(',');
    const lastDot = core.lastIndexOf('.');
    let dec = null;
    if (lastComma !== -1 || lastDot !== -1) dec = (lastComma > lastDot) ? ',' : (lastDot > lastComma ? '.' : null);
    if (dec) {
      const thou = dec === ',' ? /\./g : /,/g;
      core = core.replace(thou,'').replace(dec,'.');
    }
    const num = parseFloat(core) || 0;
    return neg ? -num : num;
  }

  function extract(line) {
    if (isMasked(line)) return null;
    if (reCab.test(line)) return null;
    if (isResumoTotal(line)) return null;

    let m = reDMY.exec(line) || reDM.exec(line) || reDMon.exec(line);
    if (!m) return null;
    const dateStr = m[0];
    const data = parseDate(dateStr);
    // valor no final
  const valM = line.match(reVALtrail);
    if (!valM) return null;
  const rawValStr = valM[0];
  const valor = parseValor(rawValStr);
    // descricao: entre fim da data e inicio do valor
    const start = line.indexOf(dateStr) + dateStr.length;
    const end = line.lastIndexOf(valM[0]);
    let desc = line.slice(start, end).replace(/\s{2,}/g,' ').trim();
    desc = cleanDescricao(desc, banco);
    if (!desc) return null;
    let categoriaTipo = inferCategoria(desc);
    let observacoes = '';
    const trailingMinus = /-\s*$/.test(rawValStr);
    const isNegative = valor < 0;
    if (categoriaTipo === 'Pagamento/Crédito' || trailingMinus || isNegative) {
      categoriaTipo = 'Pagamento/Crédito';
      if (/pagamento|pagamentos|pagto|obrigado/i.test(desc)) observacoes = 'Pagamento Fatura';
      else if (/estorno|chargeback/i.test(desc) || trailingMinus || isNegative) observacoes = 'Estorno';
    }
    const abs = Math.abs(valor);
    const valorAdj = (categoriaTipo === 'Pagamento/Crédito') ? -abs : abs;
    // USD/cotação/parcelas na linha
    const reUSD = /(US\$|USD)\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;
    const reParc= /(\b\d{1,2})\s*\/\s*(\d{1,2}\b)/;
    const reCot = /(cot[aã]o|c[aâ]mbio)\s*[:\-]?\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;
    const usdM = line.match(reUSD);
    const valorUSD = usdM ? parseValor(usdM[2]) : '';
    const cotM = line.match(reCot);
    const cotacao = cotM ? cotM[2] : '';
    const parcM = line.match(reParc);
    const parcelamento = parcM ? `${parcM[1]}/${parcM[2]}` : '';

    return {
      id: `${banco}|${fmtDate(data)}|${desc}|${valorAdj}`,
      banco,
      data: fmtDate(data),
      descricao: desc,
  local: '',
      descricaoNormalizada: normalizeDesc(desc),
      categoriaTipo,
      divisao: inferDivisaoSugerida(desc),
      valorBRL: valorAdj,
      valorUSD: valorUSD || '',
      cotacao: cotacao || '',
      taxas: '',
      parcelamento,
      observacoes
    };
  }

  for (const l of lines) {
    const t = extract(l);
    if (t) out.push(t);
  }
  return out;
}

// Parser específico para Itaú - evita concatenação de múltiplas transações
function parseItauPDF(lines, banco) {
  const out = [];
  const reCab = /(^|\b)(lan[çc]amentos(?::\s*compras e saques)?|compras e saques|nacionais em reais|internacionais(?:\s*em\s*reais)?|total dos lan[çc]amentos|subtotal|total\b|total da fatura|pagamentos efetuados|saldo (?:anterior|financiado)|vencimento|fechamento|limite|cart[aã]o|fatura|cliente|resumo)\b/i;
  const reDateStart = /^(\d{2}\/\d{2}(?:\/\d{2,4})?|\d{1,2}\s+(?:jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez))\b/i;
  const reVALany = /R?\$?\s*\(?-?\s*\d+(?:[\.,]\d{3})*[\.,]\d{2}\)?\s*-?/g;
  const reUSD = /(US\$|USD)\s*(\d{1,3}(?:\.\d{3})*,\d{2})/i;
  const reCot = /(cot[aã]o|c[aâ]mbio)\s*[:\-]?\s*(\d{1,3}(?:\.\d{3})*,\d{2,4})/i; // aceita 2-4 decimais
  const reParc = /(\b\d{1,2})\s*\/\s*(\d{1,2}\b)/;
  const reIOF = /iof[^\d]*(\d{1,3}(?:[\.,]\d{3})*[\.,]\d{2})/i;

  function isResumoTotal(s) {
    const n = normalizeDesc(s);
    if (!n) return true;
    // Começam com rótulos de somatórios/seções
    if (/^(total|subtotal|total dos lancamentos|resumo|nacionais em reais|internacionais|compras e saques)\b/i.test(n)) return true;
    // Indicadores globais da fatura
    if (/(valor total|total da fatura|total a pagar|saldo (anterior|financiado)|pagamentos efetuados|pagamento minimo|minimo|encargos|juros|anuidade)/i.test(n)) return true;
    // Linhas curtas com "total ..." geralmente são somatórios
    if (/\btotal\b/.test(n) && n.split(' ').length <= 5) return true;
    return false;
  }

  function parseValor(str) {
    const raw = String(str);
    const s = raw.replace(/[^0-9.,()\-]/g, '');
    const trimmed = s.trim();
    const neg = trimmed.includes('-') || (trimmed.startsWith('(') && trimmed.endsWith(')')) || /-\s*$/.test(raw);
    let core = trimmed.replace(/[()\-]/g, '');
    const lastComma = core.lastIndexOf(',');
    const lastDot = core.lastIndexOf('.');
    let dec = null;
    if (lastComma !== -1 || lastDot !== -1) {
      dec = (lastComma > lastDot) ? ',' : (lastDot > lastComma ? '.' : null);
    }
    if (dec) {
      const thou = dec === ',' ? /\./g : /,/g;
      core = core.replace(thou, '').replace(dec, '.');
    }
    const num = parseFloat(core) || 0;
    return neg ? -num : num;
  }

  // Se ainda restou linha com mais de uma data, quebre novamente
  function splitByDates(line) {
    const parts = [];
    const s = String(line || '').trim();
    if (!s) return parts;
    // colete inícios de datas
    const idxs = [];
  const reAllDates = new RegExp(reDateStart.source, 'ig');
    let m;
    while ((m = reAllDates.exec(s)) !== null) {
      idxs.push(m.index);
      if (reAllDates.lastIndex <= m.index) reAllDates.lastIndex = m.index + 1;
    }
    if (idxs.length <= 1) return [s];
    for (let i = 0; i < idxs.length; i++) {
      const start = idxs[i];
      const end = idxs[i + 1] ?? s.length;
      const seg = s.slice(start, end).replace(/\s{2,}/g, ' ').trim();
      if (seg) parts.push(seg);
    }
    return parts;
  }

  function processSegment(seg) {
    let line = String(seg || '').trim();
    if (!line) return null;
    if (reCab.test(line) || isResumoTotal(line)) return null;

    // Data
  const dm = line.match(reDateStart);
    if (!dm) return null;
    const dateStr = dm[0];
    const data = parseDate(dateStr);
    if (!data) return null;

    // USD, Cotação, IOF, Parcelas
    const usdM = line.match(reUSD);
    const cotM = line.match(reCot);
    const iofM = line.match(reIOF);
    const parcM = line.match(reParc);
    const valorUSD = usdM ? parseValor(usdM[2]) : '';
    const cotacao = cotM ? cotM[2] : '';
    const taxas = iofM ? `IOF ${iofM[1]}` : '';
    const parcelamento = parcM ? `${parcM[1]}/${parcM[2]}` : '';

    // Valor BRL: pegue o último número monetário que NÃO pertença ao token USD
    const allVals = [...line.matchAll(reVALany)];
    let valorBRL = null;
    if (allVals.length) {
      for (let i = allVals.length - 1; i >= 0; i--) {
        const m = allVals[i];
        const start = m.index ?? 0;
        const end = start + m[0].length;
        const around = line.slice(Math.max(0, start - 6), Math.min(line.length, end + 6));
        if (/US\$|USD/.test(around)) continue; // provavelmente USD
        valorBRL = parseValor(m[0]);
        break;
      }
    }
    if (valorBRL == null) return null;

    // Descrição: remova data, tokens de valor e palavras-chave técnicas
    let desc = line
      .replace(reDateStart, '')
      .replace(reUSD, '')
      .replace(reCot, '')
      .replace(reIOF, '')
      .replace(reParc, '')
      .replace(reVALany, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  desc = cleanDescricao(desc, banco);
  if (!desc) return null;
  // Rótulos e somatórios não são lançamentos
  const reLabelOnly = /^(total|subtotal|total dos lancamentos|resumo|nacionais em reais|internacionais|compras e saques|valor total|total da fatura|total a pagar|saldo (?:anterior|financiado)|pagamentos efetuados|pagamento minimo|minimo|encargos|juros|anuidade)\b/i;
  if (reLabelOnly.test(desc)) return null;
  if (isResumoTotal(desc)) return null;

    // Categoria/ajustes de sinal (pagamento/estorno)
    let categoriaTipo = inferCategoria(desc);
    let observacoes = '';
    const isNegative = Number(valorBRL) < 0;
    if (categoriaTipo === 'Pagamento/Crédito' || isNegative) {
      categoriaTipo = 'Pagamento/Crédito';
      if (/pagamento|pagamentos|pagto|obrigado/i.test(desc)) observacoes = 'Pagamento Fatura';
      else if (/estorno|chargeback/i.test(desc) || isNegative) observacoes = 'Estorno';
    }
    const abs = Math.abs(Number(valorBRL));
    const valorAdj = (categoriaTipo === 'Pagamento/Crédito') ? -abs : abs;

    return {
      id: `${banco}|${fmtDate(data)}|${desc}|${valorAdj}`,
      banco,
      data: fmtDate(data),
      descricao: desc,
      descricaoNormalizada: normalizeDesc(desc),
      categoriaTipo,
      divisao: inferDivisaoSugerida(desc),
      valorBRL: valorAdj,
      valorUSD: valorUSD || '',
      cotacao: cotacao || '',
      taxas: taxas || '',
      parcelamento: parcelamento || '',
      observacoes
    };
  }

  for (const raw of lines) {
    const parts = splitByDates(raw);
    for (const seg of parts) {
      const t = processSegment(seg);
      if (t) out.push(t);
    }
  }
  return out;
}

// Parser Itaú por texto integral: casa transações nacionais (2 linhas) e internacionais (3 linhas)
// com proteção contra mistura de colunas usando lookahead
function parseItauFromText(result, banco) {
  const out = [];
  const full = String(result?.text || '');
  if (!full.trim()) return out;

  // Normalizar quebras de linha: remover espaços à direita para ancoragens corretas
  const text = full.replace(/[ \t]+$/gm, '');

  // Regex unificado para capturar transações nacionais (2 linhas) e internacionais (3 linhas)
  // com proteção contra mistura de colunas usando lookahead negativo.
  // A flag 'm' (multiline) permite que ^ ancore no início de cada linha.
  // A flag 'i' (case-insensitive) ajuda com variações como "Dólar" vs "dólar".
  // A flag 'u' (unicode) garante o tratamento correto de caracteres especiais.
  const reItauTransactions = new RegExp(
    // Transações nacionais (2 linhas)
    `^(?<data>\\d{2}\\/\\d{2})\\s+` +
    `(?<estabelecimento_nacional>.+?)\\s+` +
    `(?<valor_reais_nacional>\\d{1,3}(?:\\.\\d{3})*,\\d{2})\\r?\\n` +
    `(?<categoria_nacional>[A-ZÇÃÉÊÓÚ\\s\\.]+)\\.(?<cidade_nacional>[A-Z\\s]+)` +
    `(?=(?:\\r?\\n(?!\\d{2}\\/\\d{2})))` + // Lookahead: evita quebra por nova data prematura
    `|` + // OU
    // Transações internacionais (3 linhas)
    `^(?<data_int>\\d{2}\\/\\d{2})\\s+` +
    `(?<estabelecimento_int>.+?)\\s+` +
    `(?<valor_reais_int>\\d{1,3}(?:\\.\\d{3})*,\\d{2})\\r?\\n` +
    `(?<local_int>.+?)\\s+` +
    `(?<valor_usd>\\d+,\\d{2})\\s+USD\\r?\\n` +
    `Dólar\\s+de\\s+Conversão\\s+R\\$\\s*(?<cotacao_dolar>\\d+,\\d{2})` +
    `(?=(?:\\r?\\n(?!\\d{2}\\/\\d{2})))`, // Lookahead: evita quebra por nova data prematura
    'gmiu'
  );

  function parseValorBR(str) {
    const s = String(str || '').replace(/\./g, '').replace(',', '.');
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  function isValidTransaction(desc, categoria, cidade) {
    // Filtrar cabeçalhos e ruídos comuns
    const descLower = (desc || '').toLowerCase();
    const catLower = (categoria || '').toLowerCase();
    
    // Pular cabeçalhos conhecidos
    if (/^(lançamentos|compras e saques|nacionais em reais|internacionais|resumo|total|subtotal)/i.test(descLower)) {
      return false;
    }
    
    // Pular linhas com informações de cartão mascarado
    if (/\*{2,}/.test(desc) && /\d{4}/.test(desc)) {
      return false;
    }
    
    // Pular totais e somatórios
    if (/^(total|subtotal|valor total|saldo)/i.test(descLower)) {
      return false;
    }
    
    return true;
  }

  function pushTransaction(dataStr, estabelecimento, valorBRL, extras = {}) {
    const data = parseDate(dataStr);
    if (!data) return;
    
    let desc = cleanDescricao(estabelecimento, banco);
    if (!desc) return;
    
    // Validar se é uma transação válida (não é cabeçalho ou ruído)
    if (!isValidTransaction(desc, extras.categoria, extras.local)) return;
    
    const place = (extras.local || '').toString().trim();
    
    // Classificação
    let categoriaTipo = inferCategoria(desc);
    const isNegative = Number(valorBRL) < 0;
    let observacoes = '';
    
    if (categoriaTipo === 'Pagamento/Crédito' || isNegative) {
      categoriaTipo = 'Pagamento/Crédito';
      if (/pagamento|pagamentos|pagto|obrigado/i.test(desc)) observacoes = 'Pagamento Fatura';
      else if (/estorno|chargeback/i.test(desc) || isNegative) observacoes = 'Estorno';
    }
    
    const abs = Math.abs(Number(valorBRL));
    const valorAdj = (categoriaTipo === 'Pagamento/Crédito') ? -abs : abs;
    
    out.push({
      id: `${banco}|${fmtDate(data)}|${desc}|${valorAdj}`,
      banco,
      data: fmtDate(data),
      descricao: desc,
      local: place,
      descricaoNormalizada: normalizeDesc(desc),
      categoriaTipo,
      divisao: inferDivisaoSugerida(desc),
      valorBRL: valorAdj,
      valorUSD: extras.valorUSD ?? '',
      cotacao: extras.cotacao ?? '',
      taxas: extras.taxas ?? '',
      parcelamento: extras.parcelamento ?? '',
      observacoes
    });
  }

  // Processar matches com o regex unificado
  let match;
  while ((match = reItauTransactions.exec(text)) !== null) {
    const groups = match.groups;
    
    if (groups.data && groups.estabelecimento_nacional && groups.valor_reais_nacional) {
      // Transação nacional (2 linhas)
      const dataStr = groups.data;
      const estabelecimento = groups.estabelecimento_nacional;
      const valorStr = groups.valor_reais_nacional;
      const categoria = groups.categoria_nacional || '';
      const cidade = groups.cidade_nacional || '';
      
      const valor = parseValorBR(valorStr);
      if (valor != null) {
        pushTransaction(dataStr, estabelecimento, valor, { 
          categoria, 
          local: cidade,
          tipo: 'nacional'
        });
      }
    } else if (groups.data_int && groups.estabelecimento_int && groups.valor_reais_int) {
      // Transação internacional (3 linhas)
      const dataStr = groups.data_int;
      const estabelecimento = groups.estabelecimento_int;
      const valorStr = groups.valor_reais_int;
      const local = groups.local_int || '';
      const valorUSDStr = groups.valor_usd || '';
      const cotacaoStr = groups.cotacao_dolar || '';
      
      const valor = parseValorBR(valorStr);
      const valorUSD = parseValorBR(valorUSDStr);
      
      if (valor != null) {
        pushTransaction(dataStr, estabelecimento, valor, {
          local,
          valorUSD,
          cotacao: cotacaoStr,
          tipo: 'internacional'
        });
      }
    }
  }

  return out;
}

// Função de teste para validar o parser do Itaú com casos problemáticos
function testItauParser() {
  // Casos de teste simulando problemas de duas colunas
  const testCases = [
    {
      name: "Transação nacional simples",
      text: `11/07  IFD*AMS TR DELIVERY LT    73,00
ALIMENTAÇÃO .TRES RIOS`
    },
    {
      name: "Transação internacional simples", 
      text: `15/07  GOOGLE *CHROME            29,55
650-253-0000   5,00   USD
Dólar de Conversão R$ 5,91`
    },
    {
      name: "Problema de duas colunas - nacional + nacional",
      text: `11/07  IFD*AMS TR DELIVERY LT    73,00
ALIMENTAÇÃO .TRES RIOS 20/07  SUPREME PANIFICADORA T 45,40
ALIMENTAÇÃO .TRES RIOS`
    },
    {
      name: "Problema de duas colunas - nacional + internacional", 
      text: `11/07  IFD*AMS TR DELIVERY LT    73,00
ALIMENTAÇÃO .TRES RIOS 15/07  GOOGLE *CHROME            29,55
650-253-0000   5,00   USD
Dólar de Conversão R$ 5,91`
    },
    {
      name: "Múltiplas transações válidas",
      text: `11/07  IFD*AMS TR DELIVERY LT    73,00
ALIMENTAÇÃO .TRES RIOS

20/07  SUPREME PANIFICADORA T    45,40  
ALIMENTAÇÃO .TRES RIOS

15/07  GOOGLE *CHROME            29,55
650-253-0000   5,00   USD
Dólar de Conversão R$ 5,91`
    }
  ];

  console.log('🔍 Testando parser Itaú melhorado...');
  
  for (const testCase of testCases) {
    console.log(`\n📝 Teste: ${testCase.name}`);
    console.log('Entrada:', testCase.text.replace(/\n/g, '\\n'));
    
    const result = parseItauFromText({ text: testCase.text }, 'Itaú');
    console.log(`Transações encontradas: ${result.length}`);
    
    for (const trans of result) {
      console.log(`  - ${trans.data} | ${trans.descricao} | R$ ${trans.valorBRL}`);
      if (trans.valorUSD) console.log(`    USD: ${trans.valorUSD} | Cotação: ${trans.cotacao}`);
    }
  }
  
  return testCases.length;
}

// Expor função de teste no console para debugging
window.testItauParser = testItauParser;

// Fallback tolerante por linhas: detecta blocos nacionais (2 linhas) e internacionais (3-4 linhas)
// parseItauFromLines removido: voltamos ao parser único por texto com lookaheads contra mistura de colunas
function inferCategoria(desc) {
  const s = normalizeDesc(desc);
  if (/\b(pagamento|pagamentos|pagto|credito|creditos|cr[eé]dito|cr[eé]ditos|estorno|estornos|chargeback)\b/.test(s)) return 'Pagamento/Crédito';
  if (/ifood|raia|drogasil|burger|mcdonald|padaria|supermercado|mercado|pizza|lanche|restaurante/.test(s)) return 'Alimentação';
  if (/uber|99pop|99\s*taxis|combustivel|posto|estacionamento|pedagio/.test(s)) return 'Transporte';
  if (/farmacia|drogaria|clinica|plano de saude|wellhub|gympass|academia/.test(s)) return 'Saúde';
  if (/netflix|spotify|prime|disney|hbo|assinatura|subscription|plan/.test(s)) return 'Assinaturas';
  if (/amazon|mercado livre|magalu|aliexpress|shein|store|marketplace/.test(s)) return 'Compras Online';
  if (/iof|juros|multa|anuidade|tarifa/.test(s)) return 'Serviços Financeiros';
  if (/cinema|evento|hotel|viagem|passagem/.test(s)) return 'Lazer';
  if (/curso|livro|escola|faculdade/.test(s)) return 'Educação';
  if (/energia|luz|agua|internet|manutencao|condominio|aluguel|decoracao/.test(s)) return 'Casa';
  return 'Outros';
}

function inferDivisaoSugerida(desc) {
  const key = normalizeDesc(desc);
  const rule = STATE.regras[key];
  if (rule) return rule.divisao + ' (sugerido)';
  // fallback: heurística simples, pode começar como Geral
  return 'Geral (sugerido)';
}

function aplicarAprendizado(t) {
  // se "... (sugerido)" -> extrair base
  if (t.divisao.endsWith('(sugerido)')) {
    const key = t.descricaoNormalizada;
    const r = STATE.regras[key];
    if (r) t.divisao = r.divisao + ' (sugerido)';
  }
}

function confirmarDivisao(transacao, escolha) {
  // Atualiza a UI do item atual
  transacao.divisao = escolha; // persistir escolha limpa
  const key = transacao.descricaoNormalizada;
  const rule = ensureRule(key);
  // Ajustar contadores com base na última decisão desta transação
  const decKey = transacao.id;
  const prevDecision = STATE.decisions[decKey]?.divisao;
  if (prevDecision && rule.counts[prevDecision] != null) {
    rule.counts[prevDecision] = Math.max(0, (rule.counts[prevDecision] || 0) - 1);
  }
  rule.counts[escolha] = (rule.counts[escolha] || 0) + 1;
  // Maioria decide; empate favorece a última escolha
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

  const onFiles = async (files) => {
    if (!files || files.length === 0) return;
    setStatus('Lendo PDFs...');
    const acc = [];
  for (const f of files) {
      try {
    const result = await extractTextFromPDF(f);
    const { text, pages, rows } = result;
    if (!text || !text.trim()) {
          setStatus(`Arquivo: ${f.name} — Sem texto detectável (possível PDF escaneado). Este MVP não faz OCR.`);
          continue;
        }
    const banco = detectBanco(text, f.name);
    const trs = parseTransacoesGeneric(result, banco);
        trs.forEach(aplicarAprendizado);
        acc.push(...trs);
        setStatus(`Arquivo: ${f.name} — Banco: ${banco} — Páginas: ${pages} — Lançamentos: ${trs.length}`);
      } catch (e) {
        console.error('Erro lendo', f.name, e);
        setStatus(`Erro ao ler ${f.name}: ${e?.message || e}. Dica: certifique-se de estar online (para carregar as bibliotecas) ou tente servir a pasta via um servidor local.`);
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
    setStatus(`Carregado${STATE.transacoes.length ? ': ' + STATE.transacoes.length + ' lançamentos' : ' (nenhum lançamento reconhecido – ajuste os PDFs ou aguarde melhorias de parser).'}`);
  };

  dz.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.add('dragover'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dragover'));
  dz.addEventListener('drop', (e) => {
    e.preventDefault(); dz.classList.remove('dragover');
    const files = [...(e.dataTransfer?.files || [])].filter(f => f.type === 'application/pdf' || f.name.endsWith('.pdf'));
    onFiles(files);
  });

  fileInput.addEventListener('change', (e) => onFiles([...e.target.files]));

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
