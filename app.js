// ══════════════════════════════════════════════════════
//  PICKING / REABASTECIMENTO — ARMAZEMFACIL
//  app.js — lógica completa + sincronização em tempo real
// ══════════════════════════════════════════════════════

const CONF_PASSWORD = '4321';

let confUnlocked  = false;
let checklistDone = false;
let tipoOperacao  = null;   // 'durante' | 'apos'
let tipoPendente  = null;   // guarda qual foi clicado enquanto modal está aberto

// ══════════════════════════════════════════════════════
//  RASTREAMENTO DE LOCALIZACAO
// ══════════════════════════════════════════════════════
const LOC_SPEED_IDLE   = 0.4;   // m/s abaixo disso = parado (~1.4 km/h)
const LOC_IDLE_CONFIRM = 20;    // segundos parado para confirmar idle

let loc = {
  watchId:       null,
  taskId:        null,
  positions:     [],
  idleSegments:  [],
  idleStartTs:   null,
  lastPos:       null,
  totalDistM:    0,
  supported:     ('geolocation' in navigator),
  denied:        false,
};

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
            Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function startLocationTracking(taskId) {
  if (!loc.supported || loc.denied) return;
  loc.taskId = taskId; loc.positions = []; loc.idleSegments = [];
  loc.idleStartTs = null; loc.lastPos = null; loc.totalDistM = 0;
  loc.watchId = navigator.geolocation.watchPosition(
    pos => onLocationUpdate(pos),
    err => { if (err.code === 1) { loc.denied = true; toast('GPS negado — rastreamento desativado', true); } },
    { enableHighAccuracy: true, maximumAge: 3000, timeout: 10000 }
  );
}

function onLocationUpdate(pos) {
  const { latitude: lat, longitude: lng, speed } = pos.coords;
  const ts  = pos.timestamp;
  const spd = (speed !== null && speed >= 0) ? speed : null;
  if (loc.lastPos) {
    const dist    = haversineM(loc.lastPos.lat, loc.lastPos.lng, lat, lng);
    const dtSec   = (ts - loc.lastPos.ts) / 1000;
    const estSpd  = dtSec > 0 ? dist / dtSec : 0;
    const effSpd  = spd !== null ? spd : estSpd;
    if (dist < 500) loc.totalDistM += dist;
    if (effSpd < LOC_SPEED_IDLE) {
      if (!loc.idleStartTs) loc.idleStartTs = ts;
    } else {
      if (loc.idleStartTs) {
        const idleSec = (ts - loc.idleStartTs) / 1000;
        if (idleSec >= LOC_IDLE_CONFIRM) loc.idleSegments.push({ start: loc.idleStartTs, end: ts, sec: Math.round(idleSec) });
        loc.idleStartTs = null;
      }
    }
  }
  loc.positions.push({ lat, lng, speed: spd, ts });
  loc.lastPos = { lat, lng, ts };
}

function stopLocationTracking() {
  if (loc.watchId !== null) { navigator.geolocation.clearWatch(loc.watchId); loc.watchId = null; }
  if (loc.idleStartTs) {
    const now = Date.now(); const idleSec = (now - loc.idleStartTs) / 1000;
    if (idleSec >= LOC_IDLE_CONFIRM) loc.idleSegments.push({ start: loc.idleStartTs, end: now, sec: Math.round(idleSec) });
    loc.idleStartTs = null;
  }
  const totalIdleSec = loc.idleSegments.reduce((s, seg) => s + seg.sec, 0);
  const first = loc.positions[0] || null;
  const last  = loc.positions[loc.positions.length - 1] || null;
  return {
    distanciaM:      Math.round(loc.totalDistM),
    totalIdleSec,
    segmentosParado: loc.idleSegments.length,
    posInicial:      first ? { lat: first.lat, lng: first.lng } : null,
    posFinal:        last  ? { lat: last.lat,  lng: last.lng  } : null,
    mapsLink:        last  ? 'https://www.google.com/maps?q=' + last.lat + ',' + last.lng : null,
    totalLeituras:   loc.positions.length,
  };
}

function fmtLocSummary(locData) {
  if (!locData || !locData.totalLeituras) return '';
  const idleMin  = Math.round(locData.totalIdleSec / 60);
  const distTxt  = locData.distanciaM >= 1000
    ? (locData.distanciaM / 1000).toFixed(2) + ' km'
    : locData.distanciaM + ' m';
  let html = '<div class="loc-summary">' +
    '<span class="loc-chip">📍 ' + distTxt + '</span>' +
    '<span class="loc-chip idle">⏸ ' + idleMin + 'min parado</span>';
  if (locData.mapsLink) {
    html += '<a class="loc-chip link" href="' + locData.mapsLink + '" target="_blank">🗺 Ver no mapa</a>';
  }
  html += '</div>';
  return html;
}

const PRODUCTS = [
  { codigo: 347, descricao: "SUKITA PET 1L CAIXA C/12" },
  { codigo: 371, descricao: "MALZBIER BRAHMA LONG NECK 355ML SIX-PACK BAND" },
  { codigo: 503, descricao: "SUKITA PET 2L CAIXA C/6" }
];

let S = {
  tarefas:    [],
  operadores: [],
  conferentes:[],
  selProd:    null,
  nextId:     1
};

const FB_KEY = 'pk_firebase_config';
let fbApp = null, fbDb = null, fbUnsub = null;

// ── Firebase helpers ─────────────────────────────────
function loadFbConfig() {
  try { return JSON.parse(localStorage.getItem(FB_KEY) || 'null'); } catch(e) { return null; }
}

function populateFbForm() {
  const cfg = loadFbConfig();
  if (!cfg) return;
  const map = { apiKey:'fb-apiKey', authDomain:'fb-authDomain', projectId:'fb-projectId',
    storageBucket:'fb-storageBucket', messagingSenderId:'fb-messagingSenderId',
    appId:'fb-appId', measurementId:'fb-measurementId' };
  Object.entries(map).forEach(([k,id]) => {
    const el = document.getElementById(id);
    if (el && cfg[k]) el.value = cfg[k];
  });
}

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
    showFbResult('Preencha ao menos: API Key, Project ID e App ID', 'err'); return;
  }
  if (!cfg.apiKey.startsWith('AIza')) {
    showFbResult('API Key inválida — deve começar com "AIza..."', 'err'); return;
  }
  localStorage.setItem(FB_KEY, JSON.stringify(cfg));
  toast('Config Firebase salva!');
  initFirebase(cfg);
}

function clearFbConfig() {
  if (!confirm('Remover configuração do Firebase?')) return;
  if (fbUnsub) { fbUnsub(); fbUnsub = null; }
  localStorage.removeItem(FB_KEY);
  fbApp = null; fbDb = null;
  setFbIndicator('off');
  updateSettingsToggle(false);
  updateMenuFbStatus(false);
  document.getElementById('fb-test-result').innerHTML = '';
  toast('Config removida', true);
}

function initFirebase(cfg) {
  try {
    if (fbUnsub) { fbUnsub(); fbUnsub = null; }
    if (firebase.apps.length) { firebase.apps.forEach(a => a.delete()); }
    fbApp = firebase.initializeApp(cfg);
    fbDb  = firebase.firestore();
    fbDb.enablePersistence({ synchronizeTabs: true }).catch(() => {});
    setFbIndicator('connecting');
    updateSettingsToggle(false);
    startRealtimeSync();
  } catch(e) {
    setFbIndicator('error');
    showFbResult('Erro ao inicializar: ' + e.message, 'err');
  }
}

function startRealtimeSync() {
  if (!fbDb) return;
  fbUnsub = fbDb.collection('tarefas')
    .orderBy('criadoEm', 'asc')
    .onSnapshot(
      snap => {
        S.tarefas = snap.docs.map(d => ({ _docId: d.id, ...d.data() }));
        const maxId = S.tarefas.reduce((m,t) => Math.max(m, t.id||0), 0);
        if (maxId >= S.nextId) S.nextId = maxId + 1;
        save(); renderAll();
        setFbIndicator('online');
        updateSettingsToggle(true);
        updateMenuFbStatus(true);
      },
      err => {
        setFbIndicator('error');
        toast('Erro Firebase: ' + err.message, true);
      }
    );
}

async function testFbConnection() {
  saveFbConfig();
  if (!fbDb) return;
  showFbResult('Testando conexão com o Firestore...', 'load');
  try {
    const snap = await fbDb.collection('tarefas').limit(1).get();
    showFbResult('Conexão OK — Firestore acessível (' + snap.size + ' doc encontrado)', 'ok');
    setFbIndicator('online');
    updateSettingsToggle(true);
    updateMenuFbStatus(true);
  } catch(e) {
    if (e.code === 'permission-denied') {
      showFbResult('Conectado, mas sem permissão. Va em Firestore - Regras e publique: allow read, write: if true;', 'err');
    } else {
      showFbResult(e.message, 'err');
    }
    setFbIndicator('error');
  }
}

// ── Firestore escrita ─────────────────────────────────
async function fbSaveTask(task) {
  if (!fbDb) return;
  try {
    const { _docId, ...data } = task;
    if (_docId) {
      await fbDb.collection('tarefas').doc(_docId).set(data);
    } else {
      const ref = await fbDb.collection('tarefas').add(data);
      task._docId = ref.id;
    }
  } catch(e) { toast('Erro ao salvar no Firebase: ' + e.message, true); }
}

async function fbDeleteTask(task) {
  if (!fbDb || !task._docId) return;
  try { await fbDb.collection('tarefas').doc(task._docId).delete(); } catch(e) {}
}

async function fbPushToReport(task) {
  if (!fbDb) return;
  try {
    await fbDb.collection('registros').add({
      id: task.id, codigo: task.codigo, descricao: task.descricao,
      quantidade: task.quantidade, conferente: task.conferente,
      operador: task.operador, criadoEm: task.criadoEm,
      iniciadoEm: task.iniciadoEm, finalizadoEm: task.finalizadoEm,
      duracaoMin: task.duracaoMin, enviadoEm: new Date().toISOString(),
      tipoOperacao:    task.tipoOperacao    ?? null,
      locDistanciaM:   task.locData?.distanciaM   ?? null,
      locIdleSec:      task.locData?.totalIdleSec ?? null,
      locParadas:      task.locData?.segmentosParado ?? null,
      locMapsLink:     task.locData?.mapsLink     ?? null,
    });
  } catch(e) {}
}

// ── Visuals Firebase ──────────────────────────────────
function setFbIndicator(state) {
  const el = document.getElementById('fb-indicator');
  if (!el) return;
  const MAP = {
    off:        { cls:'fb-off',        txt:'OFFLINE'    },
    connecting: { cls:'fb-connecting', txt:'CONECTANDO' },
    online:     { cls:'fb-online',     txt:'ONLINE'     },
    error:      { cls:'fb-error',      txt:'ERRO'       },
  };
  const s = MAP[state] || MAP.off;
  el.className   = 'fb-indicator ' + s.cls;
  el.textContent = s.txt;
}

function showFbResult(msg, type) {
  const el = document.getElementById('fb-test-result');
  if (!el) return;
  const cls = { ok:'fb-msg-ok', err:'fb-msg-err', load:'fb-msg-load' }[type] || 'fb-msg-load';
  el.innerHTML = '<div class="fb-msg ' + cls + '">' + msg + '</div>';
}

function updateSettingsToggle(connected) {
  const btn = document.getElementById('settings-toggle-btn');
  if (!btn) return;
  if (connected) {
    btn.classList.add('connected');
    btn.querySelector('span:first-child').textContent = 'FIREBASE — CONECTADO';
  } else {
    btn.classList.remove('connected');
    btn.querySelector('span:first-child').textContent = 'CONFIGURACAO FIREBASE';
  }
}

function updateMenuFbStatus(connected) {
  const el = document.getElementById('menu-fb-status');
  if (!el) return;
  el.textContent = connected
    ? 'Firebase conectado — dados em tempo real'
    : 'Configure o Firebase nas configuracoes do Conferente';
  el.style.color = connected ? 'var(--green)' : '';
}

// ══════════════════════════════════════════════════════
//  PERSIST LOCAL
// ══════════════════════════════════════════════════════
// ── Versão dos nomes — aumente se mudar operadores/conferentes no código
const NAMES_VERSION = 3;

function load() {
  try {
    const d = localStorage.getItem('pk2_s');
    if (!d) return;
    const saved = JSON.parse(d);
    if (saved.tarefas) S.tarefas = saved.tarefas;
    if (saved.nextId)  S.nextId  = saved.nextId;

    // Se a versão dos nomes mudou, ignora os nomes salvos e usa só os do código
    if ((saved.namesVersion || 0) < NAMES_VERSION) {
      // Descarta nomes antigos — usa apenas os hardcoded acima
      return;
    }

    // Mesma versão: mantém extras adicionados pelo usuário via +ADD
    if (saved.operadores)  saved.operadores.forEach(n  => { if (!S.operadores.includes(n))  S.operadores.push(n);  });
    if (saved.conferentes) saved.conferentes.forEach(n => { if (!S.conferentes.includes(n)) S.conferentes.push(n); });
  } catch(e) {}
}
function save() { localStorage.setItem('pk2_s', JSON.stringify({...S, namesVersion: NAMES_VERSION})); }

// ══════════════════════════════════════════════════════
//  RELOGIO
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
//  NAVEGACAO — PANES
// ══════════════════════════════════════════════════════
const ALL_PANES = ['menu','conf','emp','relatorio','reports'];

function goPane(name) {
  ALL_PANES.forEach(p => {
    document.getElementById('pane-' + p).classList.toggle('active', p === name);
  });
  if (name === 'relatorio') renderRelatorioDia();
  if (name === 'reports') {
    // Preenche data padrão com hoje
    const di = document.getElementById('csv-date');
    if (di && !di.value) {
      const t = new Date();
      di.value = t.toISOString().slice(0,10);
    }
  }
}

function goMenu() {
  goPane('menu');
  updateMenuCounts();
}

function requestConfTab() {
  if (confUnlocked) { goPane('conf'); return; }
  document.getElementById('modal-senha').style.display = 'flex';
  document.getElementById('inp-senha').value = '';
  document.getElementById('senha-erro').style.display = 'none';
  setTimeout(() => document.getElementById('inp-senha').focus(), 100);
}

function requestEmpTab() {
  if (!checklistDone) {
    resetChecklist();
    document.getElementById('modal-checklist').style.display = 'flex';
    return;
  }
  goPane('emp');
}

function toggleSec(id) {
  document.getElementById('sec-' + id + '-head')?.classList.toggle('open');
  document.getElementById('sec-' + id + '-body')?.classList.toggle('open');
}

function toggleSettings() {
  document.getElementById('settings-body').classList.toggle('open');
  const arrow = document.getElementById('settings-toggle-status');
  if (arrow) arrow.textContent =
    document.getElementById('settings-body').classList.contains('open') ? 'v' : '>';
}

// ══════════════════════════════════════════════════════
//  MENU — contadores dinamicos
// ══════════════════════════════════════════════════════
function updateMenuCounts() {
  const pending  = S.tarefas.filter(t => t.status === 'pending').length;
  const progress = S.tarefas.filter(t => t.status === 'in_progress').length;
  const done     = S.tarefas.filter(t => t.status === 'done').length;
  const allOpen  = pending + progress;

  const set = (id, txt) => { const el = document.getElementById(id); if(el) el.textContent = txt; };
  set('mc-pend', pending + ' pend.');
  set('mc-prog',  progress + ' and.');
  set('mc-done',  done + ' conc.');

  const badge = document.getElementById('menu-badge');
  if (badge) {
    badge.style.display = allOpen ? 'inline-flex' : 'none';
    badge.textContent   = allOpen;
  }

  // Estado do lock do conferente no menu
  const confLock = document.getElementById('conf-lock-state');
  if (confLock) {
    if (confUnlocked) {
      confLock.textContent = 'Acesso liberado';
      confLock.classList.add('unlocked');
    } else {
      confLock.textContent = 'Senha necessaria';
      confLock.classList.remove('unlocked');
    }
  }

  // Estado do lock do empilhador no menu
  const empLock = document.getElementById('emp-lock-state');
  if (empLock) {
    if (checklistDone) {
      empLock.textContent = 'Checklist OK';
      empLock.classList.add('unlocked');
    } else {
      empLock.textContent = 'Checklist necessario';
      empLock.classList.remove('unlocked');
    }
  }
}

// ══════════════════════════════════════════════════════
//  MODAL SENHA — CONFERENTE
// ══════════════════════════════════════════════════════
function confirmarSenha() {
  const inp  = document.getElementById('inp-senha');
  const erro = document.getElementById('senha-erro');
  if (inp.value === CONF_PASSWORD) {
    confUnlocked = true;
    document.getElementById('modal-senha').style.display = 'none';
    goPane('conf');
    updateMenuCounts();
    toast('Acesso liberado — Bem-vindo, Conferente!');
  } else {
    erro.style.display = 'block';
    inp.classList.add('shake');
    inp.value = '';
    setTimeout(() => inp.classList.remove('shake'), 450);
    inp.focus();
  }
}

function fecharModalSenha() {
  document.getElementById('modal-senha').style.display = 'none';
}

function togglePwdView() {
  const inp = document.getElementById('inp-senha');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    fecharModalSenha();
    fecharModalChecklist();
    fecharModalPOP();
  }
});

// ══════════════════════════════════════════════════════
//  MODAL CHECKLIST — EMPILHADOR
// ══════════════════════════════════════════════════════
const TOTAL_CHECKS = 5;

function resetChecklist() {
  document.querySelectorAll('.chk-box').forEach(b => { b.checked = false; });
  atualizarProgressoChecklist();
}

function avaliarChecklist() { atualizarProgressoChecklist(); }

function atualizarProgressoChecklist() {
  const boxes   = document.querySelectorAll('.chk-box');
  const checked = [...boxes].filter(b => b.checked).length;
  const pct     = Math.round((checked / TOTAL_CHECKS) * 100);
  document.getElementById('chk-fill').style.width  = pct + '%';
  document.getElementById('chk-label').textContent = checked + ' / ' + TOTAL_CHECKS + ' itens confirmados';
  const btn = document.getElementById('btn-chk-ok');
  btn.disabled    = checked < TOTAL_CHECKS;
  btn.style.opacity = checked === TOTAL_CHECKS ? '1' : '.5';
}

function confirmarChecklist() {
  const checked = [...document.querySelectorAll('.chk-box')].filter(b => b.checked).length;
  if (checked < TOTAL_CHECKS) { toast('Marque todos os itens antes de continuar', true); return; }
  checklistDone = true;
  document.getElementById('modal-checklist').style.display = 'none';
  goPane('emp');
  updateMenuCounts();
  toast('Checklist concluido — Bom turno, operador!');
}

function fecharModalChecklist() {
  document.getElementById('modal-checklist').style.display = 'none';
}

// ══════════════════════════════════════════════════════
//  TIPO DE OPERAÇÃO — DURANTE / APÓS CARREGAMENTO
// ══════════════════════════════════════════════════════
function selecionarTipo(tipo) {
  const op = document.getElementById('sel-op')?.value;
  if (!op) { toast('Selecione seu nome antes de escolher o tipo de operação', true); return; }

  tipoPendente = tipo;

  const isDurante = tipo === 'durante';
  document.getElementById('modal-tipo-icon').textContent  = isDurante ? '🚛' : '📦';
  document.getElementById('modal-tipo-title').textContent = isDurante
    ? 'DURANTE O CARREGAMENTO'
    : 'APÓS O CARREGAMENTO';
  document.getElementById('modal-tipo-desc').innerHTML = isDurante
    ? 'As tarefas realizadas serão registradas como <strong>reabastecimento durante o processo de carregamento</strong>.'
    : 'As tarefas realizadas serão registradas como <strong>ressuprimento da área de picking após o carregamento</strong>.';
  document.getElementById('modal-tipo-operador').innerHTML =
    'Operador: <strong>' + op + '</strong>';

  document.getElementById('modal-tipo').style.display = 'flex';
}

function confirmarTipo() {
  tipoOperacao = tipoPendente;
  tipoPendente = null;
  document.getElementById('modal-tipo').style.display = 'none';
  atualizarExibicaoTipo();
  const label = tipoOperacao === 'durante' ? 'DURANTE O CARREGAMENTO' : 'APÓS O CARREGAMENTO';
  toast('Tipo definido: ' + label);
}

function cancelarTipo() {
  tipoPendente = null;
  document.getElementById('modal-tipo').style.display = 'none';
}

function atualizarExibicaoTipo() {
  const btnD  = document.getElementById('btn-tipo-durante');
  const btnA  = document.getElementById('btn-tipo-apos');
  const texto = document.getElementById('op-tipo-texto');
  const status= document.getElementById('op-tipo-status');

  if (!btnD || !btnA) return;

  btnD.classList.toggle('ativo',   tipoOperacao === 'durante');
  btnD.classList.toggle('inativo', tipoOperacao === 'apos');
  btnA.classList.toggle('ativo',   tipoOperacao === 'apos');
  btnA.classList.toggle('inativo', tipoOperacao === 'durante');

  if (tipoOperacao === 'durante') {
    texto.innerHTML = '🚛 <strong>DURANTE O CARREGAMENTO</strong> — tipo ativo';
    status.className = 'op-tipo-status tipo-durante';
  } else if (tipoOperacao === 'apos') {
    texto.innerHTML = '📦 <strong>APÓS O CARREGAMENTO</strong> — tipo ativo';
    status.className = 'op-tipo-status tipo-apos';
  } else {
    texto.innerHTML = '⚠ Nenhum tipo selecionado — escolha antes de iniciar uma tarefa';
    status.className = 'op-tipo-status';
  }
}

// ══════════════════════════════════════════════════════
//  MODAL POP + RACI
// ══════════════════════════════════════════════════════
function abrirModalPOP() { document.getElementById('modal-pop').style.display = 'flex'; }
function fecharModalPOP() { document.getElementById('modal-pop').style.display = 'none'; }
function fecharPOP(e) { if (e.target === document.getElementById('modal-pop')) fecharModalPOP(); }

// ══════════════════════════════════════════════════════
//  SELECTS
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
  el.innerHTML = '<option value="">' + ph + '</option>';
  arr.forEach(n => {
    const o = document.createElement('option');
    o.value = n; o.textContent = n;
    if (n === cur) o.selected = true;
    el.appendChild(o);
  });
}

function addConf() {
  const n = v('inp-new-conf').trim().toUpperCase();
  if (!n || S.conferentes.includes(n)) return;
  S.conferentes.push(n);
  document.getElementById('inp-new-conf').value = '';
  save(); fillAll(); toast('Conferente adicionado: ' + n);
}
function addOp() {
  const n = v('inp-new-op').trim().toUpperCase();
  if (!n || S.operadores.includes(n)) return;
  S.operadores.push(n);
  document.getElementById('inp-new-op').value = '';
  save(); fillAll(); renderEmp(); toast('Operador adicionado: ' + n);
}

// ══════════════════════════════════════════════════════
//  PRODUTOS
// ══════════════════════════════════════════════════════
function filterProds() {
  const q  = v('inp-search').toLowerCase().trim();
  const el = document.getElementById('prod-list');
  if (!q) {
    el.innerHTML = '<div class="empty"><div class="ico">🔍</div>Digite o código ou nome do produto</div>'; return;
  }
  const list = PRODUCTS.filter(p => String(p.codigo).includes(q) || p.descricao.toLowerCase().includes(q));
  if (!list.length) {
    el.innerHTML = '<div class="empty"><div class="ico">🔍</div>Nenhum produto encontrado</div>'; return;
  }
  el.innerHTML = list.map(p =>
    '<div class="prod-item ' + (S.selProd?.codigo === p.codigo ? 'sel' : '') + '" onclick="selProd(' + p.codigo + ')">' +
    '<span class="prod-code">' + p.codigo + '</span>' +
    '<span class="prod-desc">' + p.descricao + '</span></div>'
  ).join('');
}
function selProd(codigo) {
  S.selProd = PRODUCTS.find(p => p.codigo === codigo);
  filterProds();
}

// ══════════════════════════════════════════════════════
//  TAREFAS — CRUD
// ══════════════════════════════════════════════════════
async function criarTarefa() {
  const conf = v('sel-conf'), op = v('sel-op-assign'), qty = parseInt(v('inp-qty'));
  if (!S.selProd) { toast('Selecione um produto', true); return; }
  if (!conf)      { toast('Selecione o conferente', true); return; }
  if (!op)        { toast('Selecione o operador', true); return; }
  if (!qty||qty<1){ toast('Informe a quantidade', true); return; }

  const t = {
    id: S.nextId++, codigo: S.selProd.codigo, descricao: S.selProd.descricao,
    quantidade: qty, conferente: conf, operador: op, status: 'pending',
    criadoEm: new Date().toISOString(), iniciadoEm: null, finalizadoEm: null, duracaoMin: null
  };
  if (fbDb) { await fbSaveTask(t); } else { S.tarefas.push(t); save(); renderAll(); }
  S.selProd = null;
  document.getElementById('inp-search').value = '';
  document.getElementById('inp-qty').value = 1;
  filterProds();
  toast('Tarefa #' + t.id + ' criada para ' + op);
}

async function iniciar(id) {
  const t = S.tarefas.find(t => t.id === id);
  if (!t) return;
  if (!tipoOperacao) {
    toast('Selecione o tipo de operação antes de iniciar (Durante ou Após o Carregamento)', true);
    // Scroll suave até o card de identificação
    document.querySelector('.op-tipo-btns')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }
  t.status = 'in_progress';
  t.iniciadoEm = new Date().toISOString();
  t.locData = null;
  t.tipoOperacao = tipoOperacao === 'durante' ? 'Durante o Carregamento' : 'Após o Carregamento';
  startLocationTracking(id);
  if (fbDb) { await fbSaveTask(t); } else { save(); renderAll(); }
  toast('Tarefa #' + id + ' INICIADA — ' + t.tipoOperacao);
}

async function finalizar(id) {
  const t = S.tarefas.find(t => t.id === id);
  if (!t) return;
  t.status = 'done';
  t.finalizadoEm = new Date().toISOString();
  t.duracaoMin = Math.round((new Date(t.finalizadoEm) - new Date(t.iniciadoEm)) / 6000) / 10;
  // Salva dados de localização se disponíveis
  if (loc.taskId === id) {
    t.locData = stopLocationTracking();
  }
  if (fbDb) { await fbSaveTask(t); await fbPushToReport(t); } else { save(); renderAll(); }
  toast('Tarefa #' + id + ' CONCLUIDA em ' + fmtMin(t.duracaoMin));
}

async function excluir(id) {
  if (!confirm('Excluir tarefa #' + id + '?')) return;
  const t = S.tarefas.find(t => t.id === id);
  if (!t) return;
  if (fbDb) { await fbDeleteTask(t); } else { S.tarefas = S.tarefas.filter(x => x.id !== id); save(); renderAll(); }
}

function clearLocal() {
  if (!confirm('Limpar todas as tarefas locais?\nOs dados ja enviados ao Firebase permanecem intactos.')) return;
  S.tarefas = []; S.nextId = 1;
  save(); renderAll();
  document.getElementById('report-area').innerHTML = '';
  toast('Dados locais limpos');
}

// ══════════════════════════════════════════════════════
//  RELATÓRIO DA ABA CONFERENTE (Firebase)
// ══════════════════════════════════════════════════════
async function pullReport() {
  const area = document.getElementById('report-area');
  if (!fbDb) { area.innerHTML = '<div class="empty"><div class="ico">🔥</div>Configure o Firebase primeiro</div>'; return; }
  area.innerHTML = '<div class="fb-msg fb-msg-load">Buscando registros no Firebase...</div>';
  try {
    const snap = await fbDb.collection('registros').orderBy('finalizadoEm','desc').limit(100).get();
    if (snap.empty) { area.innerHTML = '<div class="empty"><div class="ico">📭</div>Nenhum registro encontrado</div>'; return; }
    const records = snap.docs.map(d => d.data());
    const hoje    = new Date().toLocaleDateString('pt-BR');
    const todayR  = records.filter(r => r.finalizadoEm && new Date(r.finalizadoEm).toLocaleDateString('pt-BR') === hoje);
    const show    = todayR.length ? todayR : records.slice(0,30);
    const totalPal = show.reduce((s,r) => s + (r.quantidade||0), 0);
    const comDur   = show.filter(r => r.duracaoMin);
    const avgMin   = comDur.length ? comDur.reduce((s,r) => s + r.duracaoMin/r.quantidade, 0) / comDur.length : null;

    area.innerHTML =
      '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px">' +
      statBox(show.length, 'Tarefas', 'var(--amber)') +
      statBox(totalPal, 'Paletes', 'var(--green)') +
      (avgMin !== null ? statBox(fmtMin(avgMin), 'Media/Palete', 'var(--blue)') : '') +
      '</div>' +
      '<div style="overflow-x:auto">' +
      '<table class="rpt-table"><thead><tr><th>#</th><th>Produto</th><th>Paletes</th><th>Conferente</th><th>Operador</th><th>Inicio</th><th>Fim</th><th>Duracao</th></tr></thead><tbody>' +
      show.map(r =>
        '<tr><td style="font-family:monospace;color:var(--amber)">' + r.id + '</td>' +
        '<td><span style="color:var(--amber)">' + r.codigo + '</span> ' + r.descricao + '</td>' +
        '<td style="text-align:center;font-weight:700">' + r.quantidade + '</td>' +
        '<td>' + (r.conferente||'—') + '</td>' +
        '<td style="color:var(--blue);font-weight:600">' + (r.operador||'—') + '</td>' +
        '<td style="font-family:monospace;font-size:11px">' + fmtTime(r.iniciadoEm) + '</td>' +
        '<td style="font-family:monospace;font-size:11px">' + fmtTime(r.finalizadoEm) + '</td>' +
        '<td style="color:var(--green);font-weight:700">' + fmtMin(r.duracaoMin) + '</td></tr>'
      ).join('') +
      '</tbody></table></div>';
  } catch(e) {
    area.innerHTML = '<div class="fb-msg fb-msg-err">' + e.message + '</div>';
  }
}

function statBox(val, lbl, color) {
  return '<div style="background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:12px 18px;text-align:center">' +
    '<div style="font-family:\'Barlow Condensed\',sans-serif;font-weight:900;font-size:28px;color:' + color + '">' + val + '</div>' +
    '<div style="font-size:10px;color:var(--text-dim);letter-spacing:1px;text-transform:uppercase">' + lbl + '</div></div>';
}

// ══════════════════════════════════════════════════════
//  DOWNLOAD CSV POR DATA
// ══════════════════════════════════════════════════════
async function downloadCSV() {
  const dateInput = document.getElementById('csv-date');
  const date = dateInput.value;
  if (!date) { toast('Selecione uma data', true); return; }

  const status  = document.getElementById('csv-status');
  const preview = document.getElementById('csv-preview');
  preview.innerHTML = '';

  if (!fbDb) {
    status.innerHTML = '<div class="fb-msg fb-msg-err">Firebase nao conectado. Configure na area do Conferente.</div>';
    return;
  }

  status.innerHTML = '<div class="fb-msg fb-msg-load">Buscando registros no Firebase...</div>';

  try {
    const snap = await fbDb.collection('registros').get();
    const all  = snap.docs.map(d => d.data());

    const [ano, mes, dia] = date.split('-');
    const dataFmt = dia + '/' + mes + '/' + ano;

    const filtered = all.filter(r => {
      if (!r.finalizadoEm) return false;
      return new Date(r.finalizadoEm).toLocaleDateString('pt-BR') === dataFmt;
    }).sort((a,b) => (a.finalizadoEm||'').localeCompare(b.finalizadoEm||''));

    if (!filtered.length) {
      status.innerHTML = '<div class="fb-msg fb-msg-err">Nenhum registro encontrado para ' + dataFmt + '. Verifique se ha tarefas finalizadas nesse dia.</div>';
      return;
    }

    // Formata duração para texto legível: "4min 32s" ou "45s"
    function fmtDurCSV(min) {
      if (min === null || min === undefined || min === '') return '';
      const totalSec = Math.round(min * 60);
      const m = Math.floor(totalSec / 60);
      const s = totalSec % 60;
      if (m > 0 && s > 0) return m + 'min ' + s + 's';
      if (m > 0)          return m + 'min';
      return totalSec + 's';
    }

    function fmtDateCSV(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      const pad = n => String(n).padStart(2,'0');
      return pad(d.getDate()) + '/' + pad(d.getMonth()+1) + '/' + d.getFullYear()
        + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds());
    }

    // Separador ponto-e-vírgula para Excel BR abrir colunas corretamente
    const SEP = ';';

    const headers = [
      'CODIGO DO PRODUTO',
      'DESCRICAO DO PRODUTO',
      'QUANTIDADE DE PALETES',
      'CONFERENTE',
      'OPERADOR',
      'CRIADO EM',
      'INICIADO EM',
      'FINALIZADO EM',
      'DURACAO DA OPERACAO',
      'DURANTE / APÓS O CARREGAMENTO'
    ];

    const rows = filtered.map(r => [
      r.codigo        ?? '',
      r.descricao     ?? '',
      r.quantidade    ?? '',
      r.conferente    ?? '',
      r.operador      ?? '',
      fmtDateCSV(r.criadoEm),
      fmtDateCSV(r.iniciadoEm),
      fmtDateCSV(r.finalizadoEm),
      fmtDurCSV(r.duracaoMin),
      r.tipoOperacao  ?? ''
    ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(SEP));

    const csvContent = [headers.map(h => '"'+h+'"').join(SEP), ...rows].join('\r\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'relatorio_picking_' + date + '.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    status.innerHTML = '<div class="fb-msg fb-msg-ok">' + filtered.length + ' registros baixados — arquivo: relatorio_picking_' + date + '.csv</div>';

    const prev = filtered.slice(0,10);
    const totalPal = filtered.reduce((s,r) => s + (r.quantidade||0), 0);

    preview.innerHTML =
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0 10px">' +
      statBox(filtered.length, 'Tarefas', 'var(--amber)') +
      statBox(totalPal, 'Paletes', 'var(--green)') +
      '</div>' +
      '<div style="font-size:11px;color:var(--text-dim);margin-bottom:8px">Preview — ' +
        (filtered.length > 10 ? 'primeiros 10 de ' + filtered.length + ' registros' : filtered.length + ' registros') +
        ' do dia <strong style="color:var(--text)">' + dataFmt + '</strong></div>' +
      '<div style="overflow-x:auto"><table class="rpt-table"><thead><tr>' +
      '<th>#</th><th>Produto</th><th>Paletes</th><th>Conferente</th><th>Operador</th><th>Inicio</th><th>Fim</th><th>Duracao</th>' +
      '</tr></thead><tbody>' +
      prev.map(r =>
        '<tr><td style="font-family:monospace;color:var(--amber)">' + r.id + '</td>' +
        '<td><span style="color:var(--amber)">' + r.codigo + '</span> ' + r.descricao + '</td>' +
        '<td style="text-align:center;font-weight:700">' + r.quantidade + '</td>' +
        '<td>' + (r.conferente||'—') + '</td>' +
        '<td style="color:var(--blue);font-weight:600">' + (r.operador||'—') + '</td>' +
        '<td style="font-family:monospace;font-size:11px">' + fmtTime(r.iniciadoEm) + '</td>' +
        '<td style="font-family:monospace;font-size:11px">' + fmtTime(r.finalizadoEm) + '</td>' +
        '<td style="color:var(--green);font-weight:700">' + fmtMin(r.duracaoMin) + '</td></tr>'
      ).join('') +
      '</tbody></table></div>' +
      (filtered.length > 10 ? '<div style="font-size:11px;color:var(--text-muted);margin-top:6px;text-align:center">+ ' + (filtered.length - 10) + ' registros adicionais no arquivo CSV</div>' : '');

  } catch(e) {
    status.innerHTML = '<div class="fb-msg fb-msg-err">Erro ao buscar dados: ' + e.message + '</div>';
  }
}

// ══════════════════════════════════════════════════════
//  RELATORIO DO DIA — pane
// ══════════════════════════════════════════════════════
function renderRelatorioDia() {
  const hoje = new Date().toLocaleDateString('pt-BR');

  const pending  = S.tarefas.filter(t => t.status === 'pending');
  const progress = S.tarefas.filter(t => t.status === 'in_progress');
  const done     = S.tarefas.filter(t =>
    t.status === 'done' && t.finalizadoEm &&
    new Date(t.finalizadoEm).toLocaleDateString('pt-BR') === hoje
  );

  const setNum = (id, n) => { const el = document.getElementById(id); if(el) el.textContent = n; };
  setNum('rel-num-pend', pending.length);
  setNum('rel-num-prog', progress.length);
  setNum('rel-num-done', done.length);

  const setCount = (id, n) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = n;
    el.className = 'sec-cnt' + (n === 0 ? ' zero' : '');
  };
  setCount('cnt-rel-pend', pending.length);
  setCount('cnt-rel-prog', progress.length);
  setCount('cnt-rel-done', done.length);

  const emptyMsg = (ico, txt) => '<div class="empty"><div class="ico">' + ico + '</div>' + txt + '</div>';

  document.getElementById('rel-pend').innerHTML = pending.length
    ? pending.map(t => taskCardReadonly(t)).join('')
    : emptyMsg('✅', 'Nenhuma tarefa pendente');

  document.getElementById('rel-prog').innerHTML = progress.length
    ? progress.map(t => taskCardReadonly(t)).join('')
    : emptyMsg('⏳', 'Nenhuma tarefa em andamento');

  document.getElementById('rel-done').innerHTML = done.length
    ? done.slice().reverse().map(t => taskCardReadonly(t)).join('')
    : emptyMsg('📦', 'Nenhuma tarefa concluida hoje');
}

// Card de leitura (sem botoes de acao) para o relatorio
function taskCardReadonly(t) {
  const statusBadge =
    t.status === 'pending'     ? '<span class="bdg bdg-amber">PENDENTE</span>' :
    t.status === 'in_progress' ? '<span class="bdg bdg-blue">EM ANDAMENTO</span>' :
                                 '<span class="bdg bdg-green">CONCLUIDA</span>';
  return '<div class="tc ' + t.status + '">' +
    '<div class="tc-top">' +
      '<div><div class="tc-code">' + t.codigo + '</div><div class="tc-desc">' + t.descricao + '</div></div>' +
      '<div><div class="tc-qty-val">' + t.quantidade + '</div><div class="tc-qty-lbl">PALETES</div></div>' +
    '</div>' +
    '<div class="tc-meta">' +
      '<span>TAREFA <strong>#' + t.id + '</strong></span>' +
      '<span>CONFERENTE <strong>' + t.conferente + '</strong></span>' +
      '<span>OPERADOR <strong style="color:var(--blue)">' + t.operador + '</strong></span>' +
      (t.tipoOperacao ? '<span>TIPO <strong style="color:var(--amber)">' + t.tipoOperacao + '</strong></span>' : '') +
      (t.iniciadoEm   ? '<span>INICIO <strong>' + fmtTime(t.iniciadoEm) + '</strong></span>' : '') +
      (t.finalizadoEm ? '<span>FIM <strong>' + fmtTime(t.finalizadoEm) + '</strong></span>' : '') +
      (t.status==='done' ? '<span>TOTAL <strong style="color:var(--green)">' + fmtMin(t.duracaoMin) + '</strong></span>' : '') +
    '</div>' +
    '<div class="btn-row">' + statusBadge + '</div>' +
    '</div>';
}

// ══════════════════════════════════════════════════════
//  RENDER GERAL
// ══════════════════════════════════════════════════════
function v(id) { return document.getElementById(id)?.value || ''; }

function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('pt-BR', {hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
}
function fmtMin(m) {
  if (m === null || m === undefined) return '—';
  const h = Math.floor(m/60), min = Math.floor(m%60), s = Math.round((m%1)*60);
  if (h > 0)   return h + 'h ' + min + 'min';
  if (min > 0) return min + 'min ' + s + 's';
  return Math.round(m*60) + 's';
}

function taskCard(t, ctx) {
  const pp = t.duracaoMin !== null ? fmtMin(t.duracaoMin/t.quantidade) : null;
  const actions = ctx === 'emp'
    ? (t.status === 'pending'
        ? '<button class="btn btn-start" onclick="iniciar(' + t.id + ')">INICIAR</button>'
        : t.status === 'in_progress'
        ? '<button class="btn btn-finish" onclick="finalizar(' + t.id + ')">FINALIZAR</button>'
        : '<span class="bdg bdg-green">CONCLUIDA</span>')
    : (t.status === 'pending'
        ? '<span class="bdg bdg-amber">AGUARDANDO OPERADOR</span>' +
          '<button class="btn btn-red btn-sm" onclick="excluir(' + t.id + ')">EXCLUIR</button>'
        : t.status === 'in_progress'
        ? '<span class="bdg bdg-blue">EM ANDAMENTO</span>'
        : '<span class="bdg bdg-green">CONCLUIDA</span>');

  return '<div class="tc ' + t.status + '">' +
    '<div class="tc-top">' +
      '<div><div class="tc-code">' + t.codigo + '</div><div class="tc-desc">' + t.descricao + '</div></div>' +
      '<div><div class="tc-qty-val">' + t.quantidade + '</div><div class="tc-qty-lbl">PALETES</div></div>' +
    '</div>' +
    '<div class="tc-meta">' +
      '<span>TAREFA <strong>#' + t.id + '</strong></span>' +
      '<span>CONFERENTE <strong>' + t.conferente + '</strong></span>' +
      '<span>OPERADOR <strong style="color:var(--blue)">' + t.operador + '</strong></span>' +
      (t.tipoOperacao ? '<span>TIPO <strong style="color:var(--amber)">' + t.tipoOperacao + '</strong></span>' : '') +
      (t.iniciadoEm   ? '<span>INICIO <strong>' + fmtTime(t.iniciadoEm) + '</strong></span>' : '') +
      (t.finalizadoEm ? '<span>FIM <strong>' + fmtTime(t.finalizadoEm) + '</strong></span>' : '') +
      (t.status==='done' ? '<span>TOTAL <strong style="color:var(--green)">' + fmtMin(t.duracaoMin) + '</strong></span>' : '') +
      (pp && t.status==='done' ? '<span>/ PALETE <strong style="color:var(--green)">' + pp + '</strong></span>' : '') +
    '</div>' +
    (t.status === 'done' && t.locData ? fmtLocSummary(t.locData) : '') +
    (t.status === 'in_progress' && loc.taskId === t.id ? '<div class="loc-tracking-live">📡 GPS ativo — rastreando movimento</div>' : '') +
    '<div class="btn-row">' + actions + '</div></div>';
}

function renderAll() { renderConf(); renderEmp(); updateMenuCounts(); }

function renderConf() {
  const open = S.tarefas.filter(t => t.status !== 'done');
  const done = S.tarefas.filter(t => t.status === 'done').slice().reverse().slice(0,10);
  const setCount = (id,n) => { const el=document.getElementById(id); if(!el)return; el.textContent=n; el.className='sec-cnt'+(n===0?' zero':''); };
  setCount('cnt-conf-open', open.length);
  setCount('cnt-conf-done', done.length);
  document.getElementById('conf-open').innerHTML = open.length
    ? open.map(t => taskCard(t,'conf')).join('')
    : '<div class="empty"><div class="ico">✅</div>Nenhuma tarefa aberta</div>';
  document.getElementById('conf-done').innerHTML = done.length
    ? done.map(t => taskCard(t,'conf')).join('')
    : '<div class="empty"><div class="ico">📦</div>Nenhuma tarefa concluida ainda hoje</div>';
}

function renderEmp() {
  const op       = v('sel-op');
  const pending  = S.tarefas.filter(t => t.operador===op && t.status==='pending');
  const progress = S.tarefas.filter(t => t.operador===op && t.status==='in_progress');
  const done     = S.tarefas.filter(t => t.operador===op && t.status==='done').slice().reverse().slice(0,10);
  const setCount = (id,n,noOp) => { const el=document.getElementById(id); if(!el)return; el.textContent=noOp?0:n; el.className='sec-cnt'+((!op||n===0)?' zero':''); };
  setCount('cnt-emp-pending',  pending.length,  !op);
  setCount('cnt-emp-progress', progress.length, !op);
  setCount('cnt-emp-done',     done.length,     !op);
  const noOp = '<div class="empty"><div class="ico">👷</div>Selecione seu nome para ver as tarefas</div>';
  document.getElementById('emp-pending').innerHTML  = !op ? noOp : pending.length  ? pending.map(t=>taskCard(t,'emp')).join('')  : '<div class="empty"><div class="ico">✅</div>Nenhuma tarefa pendente</div>';
  document.getElementById('emp-progress').innerHTML = !op ? ''   : progress.length ? progress.map(t=>taskCard(t,'emp')).join('') : '<div class="empty"><div class="ico">⏳</div>Nenhuma em andamento</div>';
  document.getElementById('emp-done').innerHTML     = !op ? ''   : done.length     ? done.map(t=>taskCard(t,'emp')).join('')     : '<div class="empty"><div class="ico">📦</div>Nenhuma concluida ainda</div>';
}

// ══════════════════════════════════════════════════════
//  TOAST
// ══════════════════════════════════════════════════════
function toast(msg, warn=false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.style.background = warn ? '#d97706' : 'var(--green)';
  el.style.color = '#0d0f12';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 3500);
}

// ══════════════════════════════════════════════════════
//  INICIALIZACAO
// ══════════════════════════════════════════════════════
load();
fillAll();
filterProds();
renderAll();
populateFbForm();

const _cfg = loadFbConfig();
if (_cfg && _cfg.apiKey && _cfg.projectId) {
  setFbIndicator('connecting');
  initFirebase(_cfg);
}

// Inicia no menu principal
goPane('menu');
