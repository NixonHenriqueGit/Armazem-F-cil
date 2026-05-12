// ══════════════════════════════════════════════════════
//  PICKING / REABASTECIMENTO — ARMAZEMFACIL
//  app.js — lógica completa + sincronização em tempo real
// ══════════════════════════════════════════════════════

// ── PRODUTOS ─────────────────────────────────────────
const PRODUCTS = [
  { codigo: 347, descricao: "SUKITA PET 1L CAIXA C/12" },
  { codigo: 371, descricao: "MALZBIER BRAHMA LONG NECK 355ML SIX-PACK BAND" },
  { codigo: 503, descricao: "SUKITA PET 2L CAIXA C/6" }
];

// ── STATE LOCAL ───────────────────────────────────────
let S = {
  tarefas:    [],          // fonte de verdade vem do Firestore quando online
  operadores: ["CARLOS", "JORGE", "MARCOS", "FABIO"],
  conferentes:["ANA", "ROBERTO", "PATRICIA"],
  selProd:    null,
  nextId:     1
};

// ── FIREBASE ──────────────────────────────────────────
const FB_KEY = 'pk_firebase_config';
let fbApp      = null;
let fbDb       = null;
let fbUnsub    = null;   // cancela o listener onSnapshot quando necessário

/** Lê config salvo no localStorage */
function loadFbConfig() {
  try { return JSON.parse(localStorage.getItem(FB_KEY) || 'null'); }
  catch(e) { return null; }
}

/** Preenche o formulário com o config salvo */
function populateFbForm() {
  const cfg = loadFbConfig();
  if (!cfg) return;
  const map = {
    apiKey:'fb-apiKey', authDomain:'fb-authDomain', projectId:'fb-projectId',
    storageBucket:'fb-storageBucket', messagingSenderId:'fb-messagingSenderId',
    appId:'fb-appId', measurementId:'fb-measurementId'
  };
  Object.entries(map).forEach(([k, id]) => {
    const el = document.getElementById(id);
    if (el && cfg[k]) el.value = cfg[k];
  });
}

/** Salva config no localStorage e inicializa Firebase */
function saveFbConfig() {
  const cfg = {
    apiKey:            document.getElementById('fb-apiKey')?.value.trim(),
    authDomain:        document.getElementById('fb-authDomain')?.value.trim(),
    projectId:         document.getElementById('fb-projectId')?.value.trim(),
    storageBucket:     document.getElementById('fb-storageBucket')?.value.trim(),
    messagingSenderId: document.getElementById('fb-messagingSenderId')?.value.trim(),
    appId:             document.getElementById('fb-appId')?.value.trim(),
    measurementId:     document.getElementById('fb-measurementId')?.value.trim(),
  };

  if (!cfg.apiKey || !cfg.projectId || !cfg.appId) {
    showFbResult('❌ Preencha ao menos: API Key, Project ID e App ID', 'err');
    return;
  }
  if (!cfg.apiKey.startsWith('AIza')) {
    showFbResult('❌ API Key inválida — deve começar com "AIza..."', 'err');
    return;
  }

  localStorage.setItem(FB_KEY, JSON.stringify(cfg));
  toast('✅ Config Firebase salva!');
  initFirebase(cfg);
}

/** Remove config salvo */
function clearFbConfig() {
  if (!confirm('Remover configuração do Firebase?')) return;
  if (fbUnsub) { fbUnsub(); fbUnsub = null; }
  localStorage.removeItem(FB_KEY);
  fbApp = null; fbDb = null;
  setFbIndicator('off');
  updateSettingsToggle(false);
  document.getElementById('fb-test-result').innerHTML = '';
  toast('Config removida', true);
}

/** Inicializa o Firebase e arranca a sincronização em tempo real */
function initFirebase(cfg) {
  try {
    // Cancela listener anterior se existir
    if (fbUnsub) { fbUnsub(); fbUnsub = null; }

    if (firebase.apps.length) {
      firebase.apps.forEach(a => a.delete());
    }
    fbApp = firebase.initializeApp(cfg);
    fbDb  = firebase.firestore();

    // Habilita persistência offline (opcional mas útil em mobile)
    fbDb.enablePersistence({ synchronizeTabs: true }).catch(() => {});

    setFbIndicator('connecting');
    updateSettingsToggle(false);
    startRealtimeSync();
  } catch(e) {
    setFbIndicator('error');
    showFbResult('❌ Erro ao inicializar: ' + e.message, 'err');
  }
}

/**
 * Liga o listener onSnapshot na coleção "tarefas".
 * Qualquer mudança feita em QUALQUER dispositivo reflete aqui automaticamente.
 */
function startRealtimeSync() {
  if (!fbDb) return;

  fbUnsub = fbDb.collection('tarefas')
    .orderBy('criadoEm', 'asc')
    .onSnapshot(
      snap => {
        // Substitui a lista local pela versão do Firestore
        S.tarefas = snap.docs.map(d => ({ _docId: d.id, ...d.data() }));

        // Ajusta o nextId para evitar colisões ao criar tarefas offline
        const maxId = S.tarefas.reduce((m, t) => Math.max(m, t.id || 0), 0);
        if (maxId >= S.nextId) S.nextId = maxId + 1;

        save();          // mantém cópia local como fallback offline
        renderAll();

        setFbIndicator('online');
        updateSettingsToggle(true);
      },
      err => {
        setFbIndicator('error');
        if (err.code === 'permission-denied') {
          toast('⚠ Firebase: sem permissão. Corrija as Regras do Firestore.', true);
        } else {
          toast('⚠ Erro Firebase: ' + err.message, true);
        }
      }
    );
}

/** Testa a conexão tentando acessar o Firestore */
async function testFbConnection() {
  saveFbConfig();
  if (!fbDb) return;
  showFbResult('⏳ Testando conexão com o Firestore...', 'load');
  try {
    const snap = await fbDb.collection('tarefas').limit(1).get();
    showFbResult(`✅ Conexão OK — Firestore acessível (${snap.size} doc encontrado)`, 'ok');
    setFbIndicator('online');
    updateSettingsToggle(true);
  } catch(e) {
    if (e.code === 'permission-denied') {
      showFbResult('⚠ Conectado, mas sem permissão. Vá em Firestore → Regras e publique: allow read, write: if true;', 'err');
    } else {
      showFbResult('❌ ' + e.message, 'err');
    }
    setFbIndicator('error');
  }
}

// ══════════════════════════════════════════════════════
//  FIRESTORE — escrita de tarefas (sincronizadas)
// ══════════════════════════════════════════════════════

/** Salva/atualiza uma tarefa no Firestore */
async function fbSaveTask(task) {
  if (!fbDb) return;   // sem Firebase, já foi salvo localmente em save()
  try {
    const { _docId, ...data } = task;
    if (_docId) {
      // Atualiza documento existente
      await fbDb.collection('tarefas').doc(_docId).set(data);
    } else {
      // Cria novo documento e guarda o ID gerado
      const ref = await fbDb.collection('tarefas').add(data);
      task._docId = ref.id;
    }
  } catch(e) {
    toast('⚠ Erro ao salvar no Firebase: ' + e.message, true);
  }
}

/** Remove uma tarefa do Firestore */
async function fbDeleteTask(task) {
  if (!fbDb || !task._docId) return;
  try {
    await fbDb.collection('tarefas').doc(task._docId).delete();
  } catch(e) {
    toast('⚠ Erro ao excluir no Firebase: ' + e.message, true);
  }
}

/** Também grava na coleção "registros" quando finaliza (para o relatório histórico) */
async function fbPushToReport(task) {
  if (!fbDb) return;
  try {
    await fbDb.collection('registros').add({
      id:           task.id,
      codigo:       task.codigo,
      descricao:    task.descricao,
      quantidade:   task.quantidade,
      conferente:   task.conferente,
      operador:     task.operador,
      criadoEm:     task.criadoEm,
      iniciadoEm:   task.iniciadoEm,
      finalizadoEm: task.finalizadoEm,
      duracaoMin:   task.duracaoMin,
      enviadoEm:    new Date().toISOString()
    });
  } catch(e) {
    // silencioso — não crítico
  }
}

// ══════════════════════════════════════════════════════
//  RELATÓRIO — busca da coleção "registros"
// ══════════════════════════════════════════════════════
async function pullReport() {
  const area = document.getElementById('report-area');
  if (!fbDb) {
    area.innerHTML = '<div class="empty"><div class="ico">🔥</div>Configure o Firebase primeiro</div>';
    return;
  }
  area.innerHTML = '<div class="fb-msg fb-msg-load">⏳ Buscando registros no Firebase...</div>';
  try {
    const snap = await fbDb.collection('registros').orderBy('finalizadoEm','desc').limit(100).get();
    if (snap.empty) {
      area.innerHTML = '<div class="empty"><div class="ico">📭</div>Nenhum registro encontrado no Firebase</div>';
      return;
    }
    const records  = snap.docs.map(d => d.data());
    const hoje     = new Date().toLocaleDateString('pt-BR');
    const todayR   = records.filter(r => r.finalizadoEm &&
      new Date(r.finalizadoEm).toLocaleDateString('pt-BR') === hoje);
    const show     = todayR.length ? todayR : records.slice(0, 30);
    const totalPal = show.reduce((s,r) => s + (r.quantidade||0), 0);
    const comDur   = show.filter(r => r.duracaoMin);
    const avgMin   = comDur.length
      ? comDur.reduce((s,r) => s + r.duracaoMin/r.quantidade, 0) / comDur.length
      : null;

    area.innerHTML = `
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px 18px;text-align:center">
          <div style="font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:28px;color:var(--amber)">${show.length}</div>
          <div style="font-size:10px;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase">Tarefas${todayR.length?'<br>hoje':''}</div>
        </div>
        <div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px 18px;text-align:center">
          <div style="font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:28px;color:var(--green)">${totalPal}</div>
          <div style="font-size:10px;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase">Total<br>Paletes</div>
        </div>
        ${avgMin!==null?`<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px 18px;text-align:center">
          <div style="font-family:'Barlow Condensed',sans-serif;font-weight:900;font-size:28px;color:var(--blue)">${fmtMin(avgMin)}</div>
          <div style="font-size:10px;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase">Média<br>/ Palete</div>
        </div>`:''}
      </div>
      <div style="font-size:11px;color:var(--text-dim);margin-bottom:8px">
        ${todayR.length
          ? `Hoje (${hoje}) — ${todayR.length} tarefas · Total no Firebase: ${records.length} registros`
          : `Últimos ${show.length} registros · Total: ${records.length}`}
      </div>
      <div style="overflow-x:auto">
      <table class="rpt-table">
        <thead><tr>
          <th>#</th><th>Produto</th><th>Paletes</th>
          <th>Conferente</th><th>Operador</th>
          <th>Início</th><th>Fim</th><th>Duração</th><th>Min/Pal</th>
        </tr></thead>
        <tbody>${show.map(r=>`<tr>
          <td style="font-family:'Share Tech Mono',monospace;color:var(--amber)">${r.id}</td>
          <td><span style="color:var(--amber);font-family:'Share Tech Mono',monospace">${r.codigo}</span> ${r.descricao}</td>
          <td style="text-align:center;font-weight:700">${r.quantidade}</td>
          <td>${r.conferente||'—'}</td>
          <td style="color:var(--blue);font-weight:600">${r.operador||'—'}</td>
          <td style="font-family:'Share Tech Mono',monospace;font-size:11px">${fmtTime(r.iniciadoEm)}</td>
          <td style="font-family:'Share Tech Mono',monospace;font-size:11px">${fmtTime(r.finalizadoEm)}</td>
          <td style="color:var(--green);font-weight:700">${fmtMin(r.duracaoMin)}</td>
          <td style="color:var(--amber)">${r.duracaoMin&&r.quantidade?fmtMin(r.duracaoMin/r.quantidade):'—'}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;
  } catch(e) {
    area.innerHTML = `<div class="fb-msg fb-msg-err">❌ ${e.message}</div>`;
  }
}

// ── Helpers visuais Firebase ──────────────────────────
function setFbIndicator(state) {
  const el = document.getElementById('fb-indicator');
  if (!el) return;
  const MAP = {
    off:        { cls:'fb-off',        txt:'🔴 OFFLINE'    },
    connecting: { cls:'fb-connecting', txt:'⏳ CONECTANDO' },
    online:     { cls:'fb-online',     txt:'🟢 ONLINE'     },
    error:      { cls:'fb-error',      txt:'🔴 ERRO'       },
  };
  const s = MAP[state] || MAP.off;
  el.className   = 'fb-indicator ' + s.cls;
  el.textContent = s.txt;
}

function showFbResult(msg, type) {
  const el = document.getElementById('fb-test-result');
  if (!el) return;
  const cls = { ok:'fb-msg-ok', err:'fb-msg-err', load:'fb-msg-load' }[type] || 'fb-msg-load';
  el.innerHTML = `<div class="fb-msg ${cls}">${msg}</div>`;
}

function updateSettingsToggle(connected) {
  const btn = document.getElementById('settings-toggle-btn');
  if (!btn) return;
  if (connected) {
    btn.classList.add('connected');
    btn.querySelector('span:first-child').textContent = '🔥 FIREBASE — CONECTADO';
  } else {
    btn.classList.remove('connected');
    btn.querySelector('span:first-child').textContent = '🔥 CONFIGURAÇÃO FIREBASE';
  }
}

// ══════════════════════════════════════════════════════
//  PERSIST LOCAL (fallback offline)
// ══════════════════════════════════════════════════════
function load() {
  try {
    const d = localStorage.getItem('pk2_s');
    if (d) S = {...S, ...JSON.parse(d)};
  } catch(e) {}
}
function save() { localStorage.setItem('pk2_s', JSON.stringify(S)); }

// ══════════════════════════════════════════════════════
//  RELÓGIO
// ══════════════════════════════════════════════════════
(function initClock() {
  const tick = () => {
    const el = document.getElementById('clock');
    if (el) el.textContent = new Date().toLocaleTimeString('pt-BR', {hour12:false});
  };
  tick();
  setInterval(tick, 1000);
})();

// ══════════════════════════════════════════════════════
//  TABS E NAVEGAÇÃO
// ══════════════════════════════════════════════════════
function goTab(t) {
  ['conf','emp'].forEach(x => {
    document.getElementById('pane-'+x).classList.toggle('active', x===t);
    document.getElementById('btn-tab-'+x).classList.toggle('active', x===t);
  });
  if (t==='emp') renderEmp();
}

function toggleSec(id) {
  document.getElementById('sec-'+id+'-head')?.classList.toggle('open');
  document.getElementById('sec-'+id+'-body')?.classList.toggle('open');
}

function toggleSettings() {
  document.getElementById('settings-body').classList.toggle('open');
  const arrow = document.getElementById('settings-toggle-status');
  if (arrow) arrow.textContent =
    document.getElementById('settings-body').classList.contains('open') ? '▴' : '▾';
}

// ══════════════════════════════════════════════════════
//  SELECTS — operadores e conferentes
// ══════════════════════════════════════════════════════
function fillAll() {
  fillSel('sel-conf',      S.conferentes);
  fillSel('sel-op',        S.operadores);
  fillSel('sel-op-assign', S.operadores);
}
function fillSel(id, arr) {
  const el = document.getElementById(id);
  if (!el) return;
  const cur = el.value;
  const ph  = el.options[0].text;
  el.innerHTML = `<option value="">${ph}</option>`;
  arr.forEach(n => {
    const o = document.createElement('option');
    o.value=n; o.textContent=n;
    if(n===cur) o.selected=true;
    el.appendChild(o);
  });
}

function addConf() {
  const n = v('inp-new-conf').trim().toUpperCase();
  if(!n||S.conferentes.includes(n)) return;
  S.conferentes.push(n);
  document.getElementById('inp-new-conf').value='';
  save(); fillAll(); toast('Conferente adicionado: '+n);
}
function addOp() {
  const n = v('inp-new-op').trim().toUpperCase();
  if(!n||S.operadores.includes(n)) return;
  S.operadores.push(n);
  document.getElementById('inp-new-op').value='';
  save(); fillAll(); renderEmp(); toast('Operador adicionado: '+n);
}

// ══════════════════════════════════════════════════════
//  PRODUTOS
// ══════════════════════════════════════════════════════
function filterProds() {
  const q  = v('inp-search').toLowerCase().trim();
  const el = document.getElementById('prod-list');
  if(!q) {
    el.innerHTML='<div class="empty"><div class="ico">🔍</div>Digite o código ou nome do produto</div>';
    return;
  }
  const list = PRODUCTS.filter(p=>String(p.codigo).includes(q)||p.descricao.toLowerCase().includes(q));
  if(!list.length){
    el.innerHTML='<div class="empty"><div class="ico">🔍</div>Nenhum produto encontrado</div>';
    return;
  }
  el.innerHTML = list.map(p=>`
    <div class="prod-item ${S.selProd?.codigo===p.codigo?'sel':''}" onclick="selProd(${p.codigo})">
      <span class="prod-code">${p.codigo}</span>
      <span class="prod-desc">${p.descricao}</span>
    </div>`).join('');
}
function selProd(codigo) {
  S.selProd = PRODUCTS.find(p=>p.codigo===codigo);
  filterProds();
}

// ══════════════════════════════════════════════════════
//  TAREFAS — CRUD (com sincronização Firestore)
// ══════════════════════════════════════════════════════
async function criarTarefa() {
  const conf = v('sel-conf');
  const op   = v('sel-op-assign');
  const qty  = parseInt(v('inp-qty'));
  if(!S.selProd){ toast('⚠ Selecione um produto',true); return; }
  if(!conf)     { toast('⚠ Selecione o conferente',true); return; }
  if(!op)       { toast('⚠ Selecione o operador',true); return; }
  if(!qty||qty<1){ toast('⚠ Informe a quantidade',true); return; }

  const t = {
    id:           S.nextId++,
    codigo:       S.selProd.codigo,
    descricao:    S.selProd.descricao,
    quantidade:   qty,
    conferente:   conf,
    operador:     op,
    status:       'pending',
    criadoEm:     new Date().toISOString(),
    iniciadoEm:   null,
    finalizadoEm: null,
    duracaoMin:   null
  };

  if (fbDb) {
    // Com Firebase: salva no Firestore — o onSnapshot atualiza a tela automaticamente
    await fbSaveTask(t);
  } else {
    // Sem Firebase: salva só localmente
    S.tarefas.push(t);
    save(); renderAll();
  }

  S.selProd=null;
  document.getElementById('inp-search').value='';
  document.getElementById('inp-qty').value=1;
  filterProds();
  toast(`✅ Tarefa #${t.id} criada → ${op}`);
}

async function iniciar(id) {
  const t = S.tarefas.find(t=>t.id===id);
  if(!t) return;
  t.status='in_progress';
  t.iniciadoEm=new Date().toISOString();

  if (fbDb) {
    await fbSaveTask(t);   // onSnapshot reflete em todos os dispositivos
  } else {
    save(); renderAll();
  }
  toast(`▶ Tarefa #${id} INICIADA às ${fmtTime(t.iniciadoEm)}`);
}

async function finalizar(id) {
  const t = S.tarefas.find(t=>t.id===id);
  if(!t) return;
  t.status='done';
  t.finalizadoEm=new Date().toISOString();
  t.duracaoMin=Math.round((new Date(t.finalizadoEm)-new Date(t.iniciadoEm))/6000)/10;

  if (fbDb) {
    await fbSaveTask(t);          // atualiza a tarefa na coleção "tarefas"
    await fbPushToReport(t);      // cópia histórica em "registros"
  } else {
    save(); renderAll();
  }
  toast(`🏁 Tarefa #${id} CONCLUÍDA em ${fmtMin(t.duracaoMin)}`);
}

async function excluir(id) {
  if(!confirm(`Excluir tarefa #${id}?`)) return;
  const t = S.tarefas.find(t=>t.id===id);
  if(!t) return;

  if (fbDb) {
    await fbDeleteTask(t);   // onSnapshot remove dos outros dispositivos também
  } else {
    S.tarefas=S.tarefas.filter(t=>t.id!==id);
    save(); renderAll();
  }
}

function clearLocal() {
  if(!confirm('Limpar todas as tarefas locais?\n\nOs dados já enviados ao Firebase permanecem intactos.')) return;
  S.tarefas=[]; S.nextId=1;
  save(); renderAll();
  document.getElementById('report-area').innerHTML='';
  toast('Dados locais limpos');
}

// ══════════════════════════════════════════════════════
//  RENDER
// ══════════════════════════════════════════════════════
function v(id){ return document.getElementById(id)?.value||''; }

function fmtTime(iso) {
  if(!iso) return '—';
  return new Date(iso).toLocaleTimeString('pt-BR',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
function fmtMin(m) {
  if(m===null||m===undefined) return '—';
  const h=Math.floor(m/60), min=Math.floor(m%60), s=Math.round((m%1)*60);
  if(h>0) return `${h}h ${min}min`;
  if(min>0) return `${min}min ${s}s`;
  return `${Math.round(m*60)}s`;
}

function taskCard(t, ctx) {
  const pp = t.duracaoMin!==null ? fmtMin(t.duracaoMin/t.quantidade) : null;
  const actions = ctx==='emp'
    ? (t.status==='pending'
        ? `<button class="btn btn-start" onclick="iniciar(${t.id})">▶ INICIAR</button>`
        : t.status==='in_progress'
        ? `<button class="btn btn-finish" onclick="finalizar(${t.id})">✔ FINALIZAR</button>`
        : `<span class="bdg bdg-green">✔ CONCLUÍDA</span>`)
    : (t.status==='pending'
        ? `<span class="bdg bdg-amber">⏳ AGUARDANDO OPERADOR</span>
           <button class="btn btn-red btn-sm" onclick="excluir(${t.id})">✕ EXCLUIR</button>`
        : t.status==='in_progress'
        ? `<span class="bdg bdg-blue">🚜 EM ANDAMENTO</span>`
        : `<span class="bdg bdg-green">✔ CONCLUÍDA</span>`);

  return `<div class="tc ${t.status}">
    <div class="tc-top">
      <div>
        <div class="tc-code">${t.codigo}</div>
        <div class="tc-desc">${t.descricao}</div>
      </div>
      <div>
        <div class="tc-qty-val">${t.quantidade}</div>
        <div class="tc-qty-lbl">PALETES</div>
      </div>
    </div>
    <div class="tc-meta">
      <span>TAREFA <strong>#${t.id}</strong></span>
      <span>CONFERENTE <strong>${t.conferente}</strong></span>
      <span>OPERADOR <strong style="color:var(--blue)">${t.operador}</strong></span>
      ${t.iniciadoEm?`<span>⏱ INÍCIO <strong>${fmtTime(t.iniciadoEm)}</strong></span>`:''}
      ${t.finalizadoEm?`<span>🏁 FIM <strong>${fmtTime(t.finalizadoEm)}</strong></span>`:''}
      ${t.status==='done'?`<span>TOTAL <strong style="color:var(--green)">${fmtMin(t.duracaoMin)}</strong></span>`:''}
      ${pp&&t.status==='done'?`<span>/ PALETE <strong style="color:var(--green)">${pp}</strong></span>`:''}
    </div>
    <div class="btn-row">${actions}</div>
  </div>`;
}

function renderAll() { renderConf(); renderEmp(); }

function renderConf() {
  const open = S.tarefas.filter(t=>t.status!=='done');
  const done = S.tarefas.filter(t=>t.status==='done').slice().reverse().slice(0,10);
  const setCount = (id,n)=>{const el=document.getElementById(id);if(!el)return;el.textContent=n;el.className='sec-cnt'+(n===0?' zero':'');};
  setCount('cnt-conf-open',open.length);
  setCount('cnt-conf-done',done.length);
  document.getElementById('conf-open').innerHTML = open.length
    ? open.map(t=>taskCard(t,'conf')).join('')
    : '<div class="empty"><div class="ico">✅</div>Nenhuma tarefa aberta no momento</div>';
  document.getElementById('conf-done').innerHTML = done.length
    ? done.map(t=>taskCard(t,'conf')).join('')
    : '<div class="empty"><div class="ico">📦</div>Nenhuma tarefa concluída ainda hoje</div>';
}

function renderEmp() {
  const op       = v('sel-op');
  const pending  = S.tarefas.filter(t=>t.operador===op&&t.status==='pending');
  const progress = S.tarefas.filter(t=>t.operador===op&&t.status==='in_progress');
  const done     = S.tarefas.filter(t=>t.operador===op&&t.status==='done').slice().reverse().slice(0,10);
  const setCount = (id,n,noOp)=>{const el=document.getElementById(id);if(!el)return;el.textContent=noOp?0:n;el.className='sec-cnt'+((!op||n===0)?' zero':'');};
  setCount('cnt-emp-pending', pending.length,  !op);
  setCount('cnt-emp-progress',progress.length, !op);
  setCount('cnt-emp-done',    done.length,     !op);
  const noOp='<div class="empty"><div class="ico">👷</div>Selecione seu nome para ver as tarefas</div>';
  document.getElementById('emp-pending').innerHTML  = !op?noOp:pending.length?pending.map(t=>taskCard(t,'emp')).join(''):'<div class="empty"><div class="ico">✅</div>Nenhuma tarefa pendente para você</div>';
  document.getElementById('emp-progress').innerHTML = !op?'':progress.length?progress.map(t=>taskCard(t,'emp')).join(''):'<div class="empty"><div class="ico">⏳</div>Nenhuma em andamento</div>';
  document.getElementById('emp-done').innerHTML     = !op?'':done.length?done.map(t=>taskCard(t,'emp')).join(''):'<div class="empty"><div class="ico">📦</div>Nenhuma concluída ainda</div>';
  const allOpen = S.tarefas.filter(t=>t.status!=='done').length;
  const badge   = document.getElementById('badge');
  badge.style.display = allOpen?'inline-flex':'none';
  badge.textContent   = allOpen;
}

// ══════════════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════════════
function toast(msg, warn=false) {
  const el = document.getElementById('toast');
  el.textContent=msg;
  el.style.background=warn?'#d97706':'var(--green)';
  el.style.color='#0d0f12';
  el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),3500);
}

// ══════════════════════════════════════════════════════
//  INICIALIZAÇÃO
// ══════════════════════════════════════════════════════
load();
fillAll();
filterProds();
renderAll();
populateFbForm();

// Se já tem config salvo, conecta automaticamente e inicia sincronização
const _cfg = loadFbConfig();
if (_cfg && _cfg.apiKey && _cfg.projectId) {
  setFbIndicator('connecting');
  initFirebase(_cfg);
}
