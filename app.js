'use strict';

// Persistência simples
const LS_KEYS = {
  sort: 'cg_sort_v1',
  filters: 'cg_filters_v1',
  rules: 'cg_rules_v1',
  data: 'cg_data_v1'
};

const STATE = {
  transacoes: [], // todas as transacoes carregadas
  sort: JSON.parse(localStorage.getItem(LS_KEYS.sort) || 'null') || { key: 'data', dir: 'asc' },
  filters: JSON.parse(localStorage.getItem(LS_KEYS.filters) || 'null') || { banco: '', texto: '', dataInicio: '', dataFim: '', divisao: '' },
  regras: JSON.parse(localStorage.getItem(LS_KEYS.rules) || 'null') || {}, // descricaoNormalizada -> { divisao: 'Geral'|'Exclusiva', score: number }
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

// Parsers por banco (heurística inicial simples)
function parseTransacoesGeneric(text, banco) {
  // Heurística 1: linhas únicas com data + descrição + valor
  // Use linhas reconstruídas quando houver; fallback para separar por \n
  const lines = (Array.isArray(text?.rows) ? text.rows : String(text || '').split(/\n+/))
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
  const reCabecalho = /(resumo|lan[çc]amentos|nacionais em reais|vencimento|fechamento|limite|cart[aã]o|n[ou]mero|cliente|fatura)/i;

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
  transacao.divisao = escolha; // persistir escolha limpa
  const key = transacao.descricaoNormalizada;
  STATE.regras[key] = { divisao: escolha, score: 1 };
  savePrefs();
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

  let idx = 1;
  for (const t of despesas) {
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
    tr.appendChild(mk(p.categoriaTipo));
    tr.appendChild(mk(p.valorBRL != null && p.valorBRL !== '' ? p.valorBRL.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '', 'right'));
    tr.appendChild(mk(p.observacoes || ''));
    pagBody.appendChild(tr);
  }
  const legend = document.getElementById('legend-pag-count');
  if (legend) legend.textContent = pagamentos.length ? `${pagamentos.length} registros` : 'Nenhum registro';

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
  const rows = [['Data','Banco/Cartão','Descrição','Categoria','Divisão','Valor R$','Valor USD','Cotação','Taxas','Parcelamento','Observações']];
  const all = applyFiltersSort();
  const despesas = all.filter(t => t.categoriaTipo !== 'Pagamento/Crédito');
  const pagamentos = all.filter(t => t.categoriaTipo === 'Pagamento/Crédito');
  for (const t of despesas.concat(pagamentos)) {
    rows.push([
      t.data,
      t.banco,
      t.descricao,
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
  document.getElementById('btn-limpar').addEventListener('click', () => {
    if (!confirm('Limpar dados, filtros e regras salvas?')) return;
    STATE.transacoes = [];
    STATE.regras = {};
    STATE.filters = { banco: '', texto: '', dataInicio: '', dataFim: '', divisao: '' };
    localStorage.removeItem(LS_KEYS.data);
    localStorage.removeItem(LS_KEYS.rules);
    localStorage.removeItem(LS_KEYS.filters);
    setStatus('Dados limpos.');
    updateBancoFiltroOptions();
    recalcSummary();
    renderTable();
  });

  // ordenar colunas
  document.querySelectorAll('#tabela thead th.sortable').forEach(th => {
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
  recalcSummary();
  renderTable();
}

window.addEventListener('DOMContentLoaded', initUI);
