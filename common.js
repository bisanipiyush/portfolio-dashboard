// ═══════════════════════════════════════
// SHARED BY EVERY PAGE
// ═══════════════════════════════════════
// Google sign-in, reading the Sheets, the FIFO engine and the tax-date rules.
// Tax logic lives HERE only, so the holdings view and the capital-gains
// report can never disagree. Pages add their own state with Object.assign(S, …).

// ═══════════════════════════════════════
// LIVE DATA CONFIG (Google Sheets)
// ═══════════════════════════════════════
// None of these is a secret: the client ID is public by design, and the sheets
// are only readable by Google accounts they're shared with — access is enforced
// by Google against the signed-in user's own token, not by this page.
const GOOGLE_CLIENT_ID = '532108610568-c5dtbg58dquj001pi5v5mhcl8ct03nrh.apps.googleusercontent.com';
const SHEET_ID         = '1JxhOdY8Z5FWxTJwzl9VaBhfDgvvIAMjsiho32vqJt2U';   // "Portfolio Transactions - Live"
const LEDGER_ID        = '1yB20GnSvT1ybStapUr83BXuRf6UU7Z0qrjCgS1h6XUM';   // "Portfolio Ledger"
const SHEETS_SCOPE     = 'https://www.googleapis.com/auth/spreadsheets.readonly';

const S = {
  errors:      [],
  portfolios:  [],   // portfolio tab names, discovered from the data
  isinAliases: {},   // old ISIN → current ISIN, from the "ISIN Aliases" tab
};

// ═══════════════════════════════════════
// UTILS
// ═══════════════════════════════════════
const pad2 = n => String(n).padStart(2,'0');
const fmtDate = d => !d||isNaN(d) ? '—' : `${pad2(d.getDate())}-${pad2(d.getMonth()+1)}-${d.getFullYear()}`;   // dd-mm-yyyy
const fmtN  = (n,d=2) => n==null||isNaN(n) ? '—' : n.toLocaleString('en-IN',{minimumFractionDigits:d,maximumFractionDigits:d});
const fmtL  = n => {
  if(n==null||isNaN(n)) return '—';
  const sign = n<0 ? '-' : '';
  const abs  = Math.abs(n);
  if(abs>=10000000) return sign+'₹'+(abs/10000000).toFixed(2)+'Cr';
  if(abs>=100000)   return sign+'₹'+(abs/100000).toFixed(2)+'L';
  return sign+'₹'+fmtN(abs,0);
};
const fmtR = (n,d=2) => n==null||isNaN(n) ? '—' : (n<0?'-':'')+'₹'+fmtN(Math.abs(n),d);   // exact rupees
const r2   = n => n==null ? null : Math.round(n*100)/100;
const esc  = s => String(s??'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

const daysSince   = d => d&&!isNaN(d) ? Math.floor((Date.now()-d.getTime())/86400000) : 0;
const daysBetween = (a,b) => Math.round((b.getTime()-a.getTime())/86400000);
const dayKey      = d => d.getFullYear()*10000 + (d.getMonth()+1)*100 + d.getDate();

// Serial number (Sheets/xlsx), Date, or text → Date
function toDate(raw) {
  if(raw instanceof Date)   return raw;
  if(typeof raw==='number') return new Date(Math.round((raw-25569)*86400*1000));
  const m = String(raw||'').trim().match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);   // dd-mm-yyyy
  if(m) return new Date(+m[3], +m[2]-1, +m[1]);
  return new Date(raw||0);
}

// ═══════════════════════════════════════
// TAX RULES
// ═══════════════════════════════════════
// Long term = held MORE than 12 months, counted by calendar date (agreed
// 2026-09-28): a sale on the 12-month anniversary itself is still short term.
// A 29-Feb purchase's anniversary is taken as 28-Feb.
function isLongTerm(buy, sell) {
  if(!buy || !sell || isNaN(buy) || isNaN(sell)) return false;
  const y = buy.getFullYear()+1, m = buy.getMonth();
  const d = Math.min(buy.getDate(), new Date(y, m+1, 0).getDate());
  return dayKey(sell) > y*10000 + (m+1)*100 + d;
}
const isSTCG = d => !isLongTerm(d, new Date());
// Indian financial year (Apr–Mar) a date falls in, e.g. "FY 2026-27"
const finYear = d => { const y = d.getMonth()>=3 ? d.getFullYear() : d.getFullYear()-1; return `FY ${y}-${String(y+1).slice(2)}`; };
// Taxpayer = portfolio tab name minus its last word (the broker):
// "X HDFC" + "X AO" → "X", "X HUF HDFC" → "X HUF". Names stay out of the code.
const taxpayerOf = p => String(p).trim().split(/\s+/).slice(0,-1).join(' ') || p;
// Shares bought before this date may need the 31-Jan-2018 FMV (grandfathering)
const GRANDFATHER_DATE = new Date(2018, 1, 1);
const BUY_TYPES = ['Buy','Bonus','Rights','IPO'];
// Same-day order: every acquisition before a sell, so a same-day buy is
// available to match. Stable sort keeps the sheet's order otherwise.
const txOrder = (a,b) => (a.date-b.date) || ((a.type==='Sell')-(b.type==='Sell'));

// ═══════════════════════════════════════
// SHARED UI BITS
// ═══════════════════════════════════════
// Portfolio colours, assigned in the Live sheet's tab order
const PORT_PALETTE = ['#c8992a','#4a9eff','#3dba6f','#a78bfa','#e05050','#2dd4bf','#f59e0b','#ec4899'];
const portColor = p => { const i = S.portfolios.indexOf(p); return i<0 ? '#667a95' : PORT_PALETTE[i % PORT_PALETTE.length]; };
const portLabel = p => `<span style="display:inline-flex;align-items:center;gap:4px"><span class="port-dot" style="background:${portColor(p)}"></span><span style="font-size:10px;font-weight:600;color:${portColor(p)}">${esc(p)}</span></span>`;
const gainSpan  = n => n==null ? '<span class="muted">—</span>' : `<span class="${n>=0?'pl-pos':'pl-neg'}">${n>=0?'+':''}${fmtR(n)}</span>`;
const opt       = (v,cur,lbl) => `<option value="${esc(v)}"${v===cur?' selected':''}>${esc(lbl??v)}</option>`;
// Phone view: one card per row instead of a wide table row
const lcCell    = (k,v) => `<div><div class="k">${k}</div><div class="v">${v}</div></div>`;
function setStatus(msg) { const el=document.getElementById('load-status'); if(el) el.textContent=msg; }

function exportXlsx(fileName, sheets) {
  const wb = XLSX.utils.book_new();
  for(const [name, rows] of sheets) {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{}], { dateNF:'dd-mm-yyyy', cellDates:true });
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, fileName);
}

// ═══════════════════════════════════════
// FIFO ENGINE
// ═══════════════════════════════════════
// Old ISIN → current ISIN, for corporate actions that re-issue the ISIN
// (e.g. a face-value split). Kept in the Live sheet's "ISIN Aliases" tab
// (A = Old ISIN, B = New ISIN, C = note) so a new one needs no code change.
// Trades under either ISIN share one FIFO queue, and lots carry the current
// ISIN so screener prices still match.
function parseIsinAliases(wb) {
  const ws = wb.Sheets['ISIN Aliases'];
  if(!ws) return;
  const rows = XLSX.utils.sheet_to_json(ws, {header:1, defval:null});
  for(let i=1; i<rows.length; i++) {
    const [from, to] = (rows[i]||[]).map(v => String(v??'').trim());
    if(from && to) S.isinAliases[from] = to;
  }
}

// One capital-gains row per sell ↔ buy-lot match. Sale value per share is the
// sell row's tradeRate (net of every charge except STT); cost is the lot's.
function gainRow(tx, isin, lot, qty) {
  const base = { portfolio:tx.portfolio, taxpayer:taxpayerOf(tx.portfolio), isin, name:tx.name,
                 sellDate:tx.date, fy:finYear(tx.date), qty, saleRate:tx.tradeRate, saleValue:qty*tx.tradeRate };
  if(!lot) return { ...base, buyDate:null, buyRate:null, cost:null, gain:null, days:null, term:'—', flags:['Buy missing'] };
  const term  = isLongTerm(lot.buyDate, tx.date) ? 'LTCG' : 'STCG';
  const flags = [];
  if(dayKey(lot.buyDate)===dayKey(tx.date))          flags.push('Intraday');
  if(term==='LTCG' && lot.buyDate < GRANDFATHER_DATE) flags.push('Pre-2018');
  const cost = qty*lot.tradeRate;
  return { ...base, buyDate:lot.buyDate, buyType:lot.type, buyRate:lot.tradeRate, cost,
           gain:base.saleValue-cost, days:daysBetween(lot.buyDate, tx.date), term, flags };
}

// transactions must be sorted with txOrder. Returns the lots still held,
// FIFO problems, and every sale matched to the lots it consumed.
function runFIFO(transactions) {
  const errors = [];
  const realised = [];
  const queues = {}; // key: "portfolio|isin"

  for(const tx of transactions) {
    const isin = S.isinAliases[tx.isin] || tx.isin;
    const k = `${tx.portfolio}|${isin}`;

    if(tx.type === 'Split') {
      // Row quantity is the total holding AFTER the split. Tax treatment:
      // original buy dates and total cost carry over, so each open lot is
      // rescaled (more shares, proportionally lower rate).
      const q = queues[k] || [];
      const held = q.reduce((s,l) => s + l.remaining, 0);
      if(!held) {
        errors.push({ portfolio:tx.portfolio, isin, name:tx.name, date:tx.date,
          msg:`Split on ${fmtDate(tx.date)} — no open lots to split` });
        continue;
      }
      const ratio = tx.qty / held;
      for(const lot of q) { lot.remaining *= ratio; lot.qty *= ratio; lot.tradeRate /= ratio; }
    } else if(BUY_TYPES.includes(tx.type)) {
      // Bonus = a new lot at ₹0 cost; Rights/IPO = a new lot at the price paid.
      // All are acquired on the allotment date.
      if(!queues[k]) queues[k] = [];
      queues[k].push({
        isin:        isin,
        name:        tx.name,
        portfolio:   tx.portfolio,
        type:        tx.type,
        buyDate:     tx.date,
        qty:         tx.qty,
        remaining:   tx.qty,
        tradeRate:   tx.tradeRate,
        bucket:      tx.bucket,
        status:      tx.status,
        cmp:         tx.cmp,
        dma50:       tx.dma50,
        dma200:      tx.dma200,
      });
    } else if(tx.type === 'Sell') {
      const q = queues[k] || [];
      let toSell = tx.qty;
      for(const lot of q) {
        if(toSell <= 1e-9) break;
        const take = Math.min(lot.remaining, toSell);
        if(take > 1e-9) realised.push(gainRow(tx, isin, lot, take));
        lot.remaining -= take;
        toSell        -= take;
      }
      if(queues[k]) queues[k] = queues[k].filter(l => l.remaining > 1e-9);
      if(toSell > 1e-9) {
        errors.push({ portfolio:tx.portfolio, isin, name:tx.name, date:tx.date,
          msg:`Sell ${tx.qty} on ${fmtDate(tx.date)} — ${toSell} units unmatched` });
        realised.push(gainRow(tx, isin, null, toSell));
      }
    }
  }

  const openLots = [];
  for(const q of Object.values(queues))
    for(const lot of q)
      if(lot.remaining > 1e-9) openLots.push({ ...lot, qty: lot.remaining });

  return { openLots, errors, realised };
}

// ═══════════════════════════════════════
// PORTFOLIO LEDGER (the permanent record)
// ═══════════════════════════════════════
// One tab per portfolio, full charge breakup per row. Agreed rules
// (agreed 2026-09-25 / 2026-09-28) — every charge is allowable except STT:
//   Buy cost   = Amount + Brokerage + GST + Other Charges   (stamp duty is in Other)
//   Sale value = Amount − Brokerage − GST − Other Charges
// Rows without an Amount (e.g. Rights) fall back to the Trade Rate column;
// Bonus = ₹0 cost; Split = qty is the total holding after the split.
const LEDGER_HEADERS = {
  type:'Type', name:'Asset Name', isin:'ISIN', date:'Date', qty:'Qty', rate:'Rate',
  amount:'Amount', brokerage:'Brokerage', gst:'GST', stt:'STT', other:'Other Charges',
  net:'Net Amount', tradeRate:'Trade Rate',
};

function parseLedger(wb) {
  const txs = [], errors = [];
  const num = v => typeof v==='number' ? v : null;
  for(const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {header:1, defval:null, raw:true});
    if(!rows||!rows.length) continue;
    const H = (rows[0]||[]).map(h => String(h??'').trim());
    if(!(H.includes('Type') && H.includes('Qty') && H.includes('Amount'))) continue;
    const c = {};
    for(const [k,label] of Object.entries(LEDGER_HEADERS)) c[k] = H.indexOf(label);
    for(let i=1; i<rows.length; i++) {
      const r = rows[i]; if(!r) continue;
      const type = String(r[c.type]||'').trim();
      const name = String(r[c.name]||'').trim();
      const qty  = r[c.qty];
      if(!type||!name||typeof qty!=='number'||qty<=0) continue;
      const tx = {
        portfolio:sheetName, type, name, isin:String(r[c.isin]||'').trim(), date:toDate(r[c.date]), qty,
        rate:num(r[c.rate]), amount:num(r[c.amount]), brokerage:num(r[c.brokerage]), gst:num(r[c.gst]),
        stt:num(r[c.stt]), other:num(r[c.other]), net:num(r[c.net]), sheetRate:num(r[c.tradeRate]),
      };
      const err = msg => errors.push({ portfolio:sheetName, isin:tx.isin, name, date:tx.date, msg:`row ${i+1}: ${msg}` });
      if(isNaN(tx.date)) { err('unreadable date'); continue; }
      if(!BUY_TYPES.includes(type) && type!=='Sell' && type!=='Split') { err(`unknown type "${type}"`); continue; }
      const charges = (tx.brokerage||0) + (tx.gst||0) + (tx.other||0);   // everything except STT
      if(type==='Bonus')       tx.tradeRate = 0;
      else if(type==='Split')  tx.tradeRate = null;
      else if(tx.amount!=null) tx.tradeRate = (type==='Sell' ? tx.amount - charges : tx.amount + charges) / qty;
      else                     tx.tradeRate = tx.sheetRate;
      if(type!=='Split' && tx.tradeRate==null) { err(`${type} has neither Amount nor Trade Rate`); continue; }
      // Tie-out: our per-share figure must agree with the stored Trade Rate
      if(tx.amount!=null && tx.sheetRate!=null && type!=='Bonus' && Math.abs(tx.tradeRate - tx.sheetRate) > 0.001)
        err(`Trade Rate ${fmtN(tx.sheetRate,4)} ≠ ${fmtN(tx.tradeRate,4)} from Amount and charges`);
      txs.push(tx);
    }
  }
  txs.sort(txOrder);
  return { txs, errors };
}

function ledgerErrorBox() {
  if(!S.ledgerErrors?.length) return '';
  return `<div class="error-inner" style="margin-bottom:14px">
    <h4>⚠ ${S.ledgerErrors.length} Portfolio Ledger row problem${S.ledgerErrors.length>1?'s':''}</h4>
    ${S.ledgerErrors.map(e=>`<div class="error-item"><span class="ep">${esc(e.portfolio)}</span> · <span class="es">${esc(e.name)}</span> · ${esc(e.msg)}</div>`).join('')}
  </div>`;
}

// Ledger portfolios, in the Live sheet's tab order
const ledgerPortfolios = () => [...new Set(S.ledgerTxs.map(t=>t.portfolio))]
  .sort((a,b)=>{ const ia=S.portfolios.indexOf(a), ib=S.portfolios.indexOf(b); return (ia<0?99:ia)-(ib<0?99:ib); });

// ═══════════════════════════════════════
// GOOGLE SIGN-IN + SHEETS
// ═══════════════════════════════════════
// Google Sheets returns the screener-derived columns (CMP/DMA/PE…) as text,
// e.g. "1575.00" — convert plain numeric strings so the parsers' number
// checks behave exactly as they do for an .xlsx file.
const NUMERIC_STR = /^-?[\d,]*\.?\d+$/;
const coerceCell = v => (typeof v==='string' && NUMERIC_STR.test(v.trim())) ? parseFloat(v.replace(/,/g,'')) : v;

// Build an XLSX-shaped workbook from a Sheets values:batchGet response, so
// every parser runs unchanged regardless of the data source.
function valuesToWorkbook(valueRanges) {
  const wb = { SheetNames: [], Sheets: {} };
  for(const vr of valueRanges) {
    const name = vr.range.split('!')[0].replace(/^'|'$/g,'').replace(/''/g,"'");
    const rows = (vr.values||[]).map(r => r.map(coerceCell));
    wb.SheetNames.push(name);
    wb.Sheets[name] = XLSX.utils.aoa_to_sheet(rows);
  }
  return wb;
}

// Kept in sessionStorage so moving between the dashboard pages in the same
// browser tab doesn't ask for sign-in again (Piyush, 16-10-2026). It is the
// read-only Sheets token, gone when the tab closes, and expires within an hour.
const TOKEN_KEY = 'pcc.gtoken';
let gToken = (() => { try { return JSON.parse(sessionStorage.getItem(TOKEN_KEY)) || null; } catch { return null; } })();
const saveToken = t => { gToken = t; try { t ? sessionStorage.setItem(TOKEN_KEY, JSON.stringify(t)) : sessionStorage.removeItem(TOKEN_KEY); } catch {} };
const hasValidToken = () => !!(gToken && Date.now() < gToken.expiresAt - 60000);

function getToken() {
  if(hasValidToken()) return Promise.resolve(gToken.access_token);
  return new Promise((resolve, reject) => {
    if(!window.google?.accounts?.oauth2) return reject(new Error('Google Sign-In failed to load — check your connection and retry.'));
    const client = google.accounts.oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SHEETS_SCOPE,
      callback: resp => {
        if(resp.error) return reject(new Error('Sign-in cancelled or refused ('+resp.error+').'));
        saveToken({ access_token: resp.access_token, expiresAt: Date.now() + resp.expires_in*1000 });
        resolve(gToken.access_token);
      },
      error_callback: err => reject(new Error('Sign-in window closed ('+(err.type||'unknown')+').')),
    });
    client.requestAccessToken({ prompt: gToken ? '' : 'select_account' });
  });
}

// Tabs of one spreadsheet as an XLSX-shaped workbook; wb.AllTabs lists every
// tab name. `onlyTabs` limits which tabs' values are fetched.
async function fetchWorkbook(sheetId, token, label, onlyTabs) {
  const auth = { headers: { Authorization: 'Bearer '+token } };
  const api  = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}`;
  const check = res => {
    if(res.status===401) { saveToken(null); throw new Error('Session expired — sign in again.'); }
    if(res.status===403 || res.status===404) throw new Error(`This Google account cannot read the ${label}. Sign in with the account it is shared with.`);
    if(!res.ok) throw new Error(`Google Sheets error ${res.status} (${label})`);
    return res.json();
  };
  // Tab names come from the Sheet itself (none are hard-coded in this page).
  const meta = await fetch(`${api}?fields=sheets.properties.title`, auth).then(check);
  const all  = meta.sheets.map(s => s.properties.title);
  const tabs = all.filter(t => t !== 'Processed Emails' && (!onlyTabs || onlyTabs.includes(t)));
  let wb = { SheetNames: [], Sheets: {} };
  if(tabs.length) {
    const qs = tabs.map(t => 'ranges='+encodeURIComponent(`'${t.replace(/'/g,"''")}'`)).join('&')
             + '&valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER';
    const data = await fetch(`${api}/values:batchGet?${qs}`, auth).then(check);
    wb = valuesToWorkbook(data.valueRanges||[]);
  }
  wb.AllTabs = all;
  return wb;
}

// Current price per ISIN, same sources as the holdings page: a portfolio tab's
// "Current Price" column first, else SCREENER_ALL STKS.
function parseCurrentPrices(wb) {
  const prices = {};
  const take = (tab, isinCol, priceCol, override) => {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[tab], {header:1, defval:null, raw:true});
    const H = (rows[0]||[]).map(h => String(h??'').trim());
    const ci = H.indexOf(isinCol), cp = H.indexOf(priceCol);
    if(ci<0 || cp<0) return;
    for(let i=1; i<rows.length; i++) {
      const r = rows[i]||[], isin = String(r[ci]??'').trim(), p = r[cp];
      if(isin && typeof p==='number' && p>0 && (override || prices[isin]==null)) prices[isin] = p;
    }
  };
  if(wb.Sheets['SCREENER_ALL STKS']) take('SCREENER_ALL STKS', 'ISIN Code', 'Current Price', false);
  for(const t of wb.SheetNames) if(t!=='SCREENER_ALL STKS') take(t, 'ISIN No.', 'Current Price', true);
  return prices;
}

// For the Ledger pages: the Ledger itself, plus only what they need from the
// Live sheet (ISIN aliases, and tab order for portfolio colours). withPrices
// also reads current prices, for unrealised gains on the lots still held.
async function loadLedgerData(withPrices) {
  setStatus('Signing in…');
  const token = await getToken();
  setStatus('Fetching ledger…');
  const live   = await fetchWorkbook(SHEET_ID,  token, 'portfolio sheet', withPrices ? null : ['ISIN Aliases']);
  const ledger = await fetchWorkbook(LEDGER_ID, token, 'Portfolio Ledger');
  S.isinAliases = {};
  parseIsinAliases(live);
  const { txs, errors } = parseLedger(ledger);
  S.portfolios   = live.AllTabs.filter(t => ledger.SheetNames.includes(t));
  S.ledgerTxs    = txs;
  S.ledgerErrors = errors;
  const fifo     = runFIFO(txs);
  S.realised     = fifo.realised;   // unmatched sells come back as "Buy missing" rows
  S.openLots     = fifo.openLots;
  S.currentPrices = withPrices ? parseCurrentPrices(live) : {};
}

// Sign-in screen → page, for the Ledger pages. render() draws #content.
function initLedgerPage(render, withPrices) {
  const run = () => loadLedgerData(withPrices).then(() => {
    document.getElementById('loading').classList.add('hidden');
    document.getElementById('app').classList.remove('hidden');
    document.getElementById('data-badge').innerHTML = `<span>${S.ledgerTxs.length}</span> ledger rows`;
    render();
    // On a phone the tab row scrolls sideways — bring this page's tab into view
    document.querySelector('.nav-tab.active')?.scrollIntoView({ inline:'center', block:'nearest' });
  });
  document.getElementById('btn-google').addEventListener('click', () => run().catch(e => setStatus('Error: '+e.message)));
  document.getElementById('btn-reload').addEventListener('click', () => run().catch(e => alert(e.message)));
  if(hasValidToken()) run().catch(e => setStatus('Error: '+e.message));   // signed in on another page
}
