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
  { "codigo": 279, "descricao": "BRAHMA CHOPP LONG NECK 355ML SIX-PACK CAIXA C/4" },
  { "codigo": 347, "descricao": "SUKITA PET 1L CAIXA C/12" },
  { "codigo": 503, "descricao": "SUKITA PET 2L CAIXA C/6" },
  { "codigo": 504, "descricao": "PEPSI COLA PET 2L CAIXA C/6" },
  { "codigo": 620, "descricao": "CARACU LONG NECK 355ML SIX-PACK BANDEJA C/4" },
  { "codigo": 772, "descricao": "PEPSI COLA MIX BAG IN BOX 18L" },
  { "codigo": 838, "descricao": "CHOPP BRAHMA CLARO BARRIL KEG 50L" },
  { "codigo": 982, "descricao": "SKOL 600ML" },
  { "codigo": 988, "descricao": "BRAHMA CHOPP 600ML" },
  { "codigo": 1114, "descricao": "GUARANA CHP ANTARCTICA PET 3,3 L SH C/04" },
  { "codigo": 1116, "descricao": "PEPSI COLA PET 3,3 L SH C/04" },
  { "codigo": 1166, "descricao": "SUKITA UVA PET 2L CAIXA C/6" },
  { "codigo": 1388, "descricao": "SKOL GFA VD 1L 2,99" },
  { "codigo": 1695, "descricao": "BRAHMA CHOPP GFA VD 1L COM TTC" },
  { "codigo": 1699, "descricao": "STELLA ARTOIS LT 269ML CX C/8 FRIDGE PACK" },
  { "codigo": 1743, "descricao": "ANTARCTICA PILSEN GFA VD 1L COM TTC" },
  { "codigo": 1745, "descricao": "SKOL LT 269ML SH C15 NPAL" },
  { "codigo": 1898, "descricao": "BRAHMA CHOPP LT 269ML SH C15 NPAL" },
  { "codigo": 2006, "descricao": "ANTARCTICA SUBZERO 600ML" },
  { "codigo": 2008, "descricao": "ANTARCTICA SUBZERO LATA 350ML SH C/12 NPAL" },
  { "codigo": 2243, "descricao": "GUARANA CHP ANTARCTICA MIX BAG IN BOX 18L" },
  { "codigo": 2248, "descricao": "SODA LIMONADA ANTARCTICA MIX BAG IN BOX 18L" },
  { "codigo": 2250, "descricao": "GUARANA CHP ANTARCTICA DIET MIX BAG IN BOX 18L" },
  { "codigo": 2319, "descricao": "GUARANA CHP ANTARCTICA PET 1L CAIXA C/12" },
  { "codigo": 2320, "descricao": "SODA LIMONADA ANTARCTICA PET 1L CAIXA C/12" },
  { "codigo": 2349, "descricao": "GUARANA CHP ANTARCTICA PET 2L CAIXA C/6" },
  { "codigo": 2350, "descricao": "SODA LIMONADA ANTARCTICA PET 2L CAIXA C/6" },
  { "codigo": 2353, "descricao": "GUARANA CHP ANTARCTICA DIET PET 2L CAIXA C/6" },
  { "codigo": 2538, "descricao": "ANTARCTICA PILSEN 600ML" },
  { "codigo": 2546, "descricao": "ORIGINAL 600ML" },
  { "codigo": 2548, "descricao": "BUDWEISER 600ML" },
  { "codigo": 2585, "descricao": "GUARANA CHP ANTARCTICA GFA VD 1L" },
  { "codigo": 3733, "descricao": "BOHEMIA NOVA EMBALAGEM 600ML" },
  { "codigo": 3735, "descricao": "BOHEMIA NOVA EMBALAGEM LONG NECK 355ML SIX-PACK SHRINK C/4" },
  { "codigo": 4141, "descricao": "PATAGONIA AMB LAG NACIONAL LT SLEEK 350ML C 8 CX CARTAO" },
  { "codigo": 4143, "descricao": "PATAGONIA BOH PILS NACIONAL LT SLEEK 350ML C 8 CX CARTAO" },
  { "codigo": 4198, "descricao": "PATAGONIA IPA LT SLEEK 350ML C 8 CX CARTAO" },
  { "codigo": 4262, "descricao": "MICHELOB ULTRA N LT SLEEK 350ML C 8 CX CARTAO" },
  { "codigo": 4293, "descricao": "PEPSI BLACK PET 200ML SH C/12" },
  { "codigo": 4367, "descricao": "INDAIA AGUA MINERAL S/GAS GFA PET 1,5L FD C/6" },
  { "codigo": 4409, "descricao": "PEPSI TWIST PET 2L SHRINK C/6" },
  { "codigo": 6181, "descricao": "AGUA MIN DIAS DAVILA S/GAS PET 500ML CAIXA C/12" },
  { "codigo": 6183, "descricao": "AGUA MIN DIAS DAVILA C/GAS PET 500ML CAIXA C/12" },
  { "codigo": 6185, "descricao": "AGUA MIN DIAS DAVILA S/GAS PET 1,5L CAIXA C/6" },
  { "codigo": 7325, "descricao": "PEPSI COLA PET 1L CAIXA C/12" },
  { "codigo": 7431, "descricao": "SUKITA MIX BAG IN BOX 18L" },
  { "codigo": 7945, "descricao": "PEPSI COLA PET 2,5L CAIXA C/6" },
  { "codigo": 7947, "descricao": "GUARANA CHP ANTARCTICA PET 2,5L CAIXA C/6" },
  { "codigo": 7977, "descricao": "GATORADE UVA PET 500ML SIXPACK" },
  { "codigo": 7979, "descricao": "GATORADE FRUTAS CITRICAS PET 500ML SIXPACK" },
  { "codigo": 7980, "descricao": "GATORADE TANGERINA PET 500ML SIXPACK" },
  { "codigo": 7981, "descricao": "GATORADE LARANJA PET 500ML SIXPACK" },
  { "codigo": 7982, "descricao": "GATORADE LIMAO PET 500ML SIXPACK" },
  { "codigo": 7983, "descricao": "GATORADE MORANGO-MARACUJA PET 500ML SIXPACK" },
  { "codigo": 7985, "descricao": "GATORADE MARACUJA PET 500ML SIXPACK" },
  { "codigo": 8336, "descricao": "ORIGINAL ONE WAY 600ML CX 12" },
  { "codigo": 8791, "descricao": "H2OH LIMAO C/GAS PET 500ML CAIXA C/12" },
  { "codigo": 8793, "descricao": "H2OH LIMAO C/GAS PET 1,5L CAIXA C/6" },
  { "codigo": 8919, "descricao": "GUARANA CHP ANTARCTICA PET 600ML CX12 NPAL" },
  { "codigo": 9067, "descricao": "ANTARCTICA PILSEN LATA 350ML SH C/12 NPAL" },
  { "codigo": 9068, "descricao": "SKOL LATA 350ML SH C/12 NPAL" },
  { "codigo": 34608, "descricao": "SKOL LATA 350ML SH C/12 NPAL MULTIPACK" },
  { "codigo": 9069, "descricao": "BRAHMA CHOPP LATA 350ML SH C/12 NPAL" },
  { "codigo": 33820, "descricao": "BRAHMA CHOPP LT 350ML SH C/12 NP MULTIPK" },
  { "codigo": 9072, "descricao": "BOHEMIA NOVA EMBALAGEM LATA 350ML SH C/12 NPAL" },
  { "codigo": 9083, "descricao": "SKOL LT 473ML SH C/12 NPAL" },
  { "codigo": 9084, "descricao": "GUARANA CHP ANTARCTICA LATA 350ML SH C/12 NPAL" },
  { "codigo": 9085, "descricao": "GUARANA CHP ANTARCTICA DIET LATA 350ML SH C/12 NPAL" },
  { "codigo": 9087, "descricao": "SODA LIMONADA ANTARCTICA LATA 350ML SH C/12 NPAL" },
  { "codigo": 9089, "descricao": "SUKITA LATA 350ML SH C/12 NPAL" },
  { "codigo": 9091, "descricao": "TONICA ANTARCTICA LATA 350ML SH C/12 NPAL" },
  { "codigo": 9092, "descricao": "TONICA ANTARCTICA DIET LATA 350ML SH C/12 NPAL" },
  { "codigo": 9096, "descricao": "PEPSI COLA LATA 350ML SH C/12 NPAL" },
  { "codigo": 9274, "descricao": "PEPSI ZERO LATA 350ML SH C/12 NPAL" },
  { "codigo": 9276, "descricao": "PEPSI ZERO PET 2L CAIXA C/6" },
  { "codigo": 9320, "descricao": "BRAHMA CHOPP LT 473ML SH C/12 NPAL" },
  { "codigo": 9442, "descricao": "PEPSI TWIST MIX BAG IN BOX 18L" },
  { "codigo": 9795, "descricao": "GUARANA ANTARCTICA ZERO PET 1L CAIXA C/12" },
  { "codigo": 10175, "descricao": "ANTARCTICA SUBZERO LT 473ML SH C/12 NPAL" },
  { "codigo": 10537, "descricao": "BOHEMIA GFA VD 990ML" },
  { "codigo": 11518, "descricao": "SKOL ONE WAY 300ML CXPAP12" },
  { "codigo": 11593, "descricao": "PEPSI COLA GFA VD 1L" },
  { "codigo": 12948, "descricao": "BRAHMA CHOPP ZERO LATA 350ML SH C/12 NPAL" },
  { "codigo": 12951, "descricao": "BRAHMA CHOPP ZERO LN 355ML SIXPACK CX CART C/04" },
  { "codigo": 13061, "descricao": "H2OH LIMONETO PET 500ML SHRINK C/12 NPAL" },
  { "codigo": 13065, "descricao": "H2OH LIMONETO PET 1,5 SHRINK C/06 NPAL" },
  { "codigo": 13194, "descricao": "BRAHMA CHOPP ONE WAY 300ML CX C/23" },
  { "codigo": 13196, "descricao": "SKOL ONE WAY 300ML CX C/23" },
  { "codigo": 13201, "descricao": "BRAHMA CHOPP GFA VD 300ML CX C/23" },
  { "codigo": 13205, "descricao": "SKOL GFA VD 300ML CX C/23" },
  { "codigo": 13307, "descricao": "BUDWEISER GFA VD 990ML CX C/12" },
  { "codigo": 13486, "descricao": "FUSION PET 1L SH C/06" },
  { "codigo": 13566, "descricao": "SKOL BEATS SENSES LT 269ML CX C/8 FRIDGE PACK" },
  { "codigo": 13839, "descricao": "BUDWEISER LT 269ML CX C/8 FRIDGE PACK" },
  { "codigo": 14099, "descricao": "BUDWEISER ONE WAY 600ML CX C/12 NPAL" },
  { "codigo": 14103, "descricao": "WALS SESSION ONE WAY 600ML CX C/12 ARTE" },
  { "codigo": 14111, "descricao": "WALS BOHEMIA PILSEN ONE WAY 600ML CX C/12 ARTE" },
  { "codigo": 14135, "descricao": "BUDWEISER LATA 473ML SIX-PACK SH C/2 NPAL" },
  { "codigo": 14283, "descricao": "WALS DUBBEL ONE WAY 375ML CX C/12 ARTE" },
  { "codigo": 14293, "descricao": "WALS TRIPPEL ONE WAY 375ML CX C/12 ARTE" },
  { "codigo": 14340, "descricao": "ORIGINAL ONE WAY 300ML CXPAP12" },
  { "codigo": 14550, "descricao": "COLORADO APPIA ONE WAY 600ML CX C-12 ARTE" },
  { "codigo": 15190, "descricao": "PEPSI ZERO MIX BAG IN BOX 18L" },
  { "codigo": 16503, "descricao": "BOHEMIA GFA VD 300ML CX C/23" },
  { "codigo": 17266, "descricao": "BOHEMIA LT 473ML CX CARTAO C/12" },
  { "codigo": 17268, "descricao": "PATAGONIA BOH PILS NACIONAL LN 355ML CX C/12" },
  { "codigo": 17276, "descricao": "PATAGONIA AMB LAG NACIONAL LN 355ML CX C/12" },
  { "codigo": 17278, "descricao": "PATAGONIA WEISSE NACIONAL LN 355ML CX C/12" },
  { "codigo": 17757, "descricao": "BECKS N LONG NECK 330ML SIX-PACK SHRINK C/4" },
  { "codigo": 17808, "descricao": "BUDWEISER OW 330ML CX C/24" },
  { "codigo": 17810, "descricao": "BUDWEISER ONE WAY 550ML CX C/12" },
  { "codigo": 18142, "descricao": "GOOSE ISLAND MIDWAY NAC LN 355ML CX C/12" },
  { "codigo": 18152, "descricao": "GUARANA CHP ANTARCTICA PET 200ML SH C/12" },
  { "codigo": 18266, "descricao": "PEPSI COLA PET 200ML SH C/12" },
  { "codigo": 18267, "descricao": "SODA LIMONADA ANTARCTICA PET 200ML SH C/12" },
  { "codigo": 18268, "descricao": "SUKITA PET 200ML SH C/12" },
  { "codigo": 18673, "descricao": "SKOL PURO MALTE GFA VD 300ML CX C/23" },
  { "codigo": 18676, "descricao": "SKOL PURO MALTE LT 473ML SH C/12 NPAL" },
  { "codigo": 18677, "descricao": "SKOL PURO MALTE 600ML" },
  { "codigo": 18678, "descricao": "SKOL PURO MALTE GFA VD 1L" },
  { "codigo": 18680, "descricao": "SKOL PURO MALTE LATA 350ML SH C/12 NPAL" },
  { "codigo": 18780, "descricao": "CORONITA EXTRA N OW 210ML CX C/4 SIX PACK" },
  { "codigo": 18807, "descricao": "STELLA ARTOIS LONG NECK 330ML SIX-PACK SHRINK C/4" },
  { "codigo": 18833, "descricao": "SKOL PURO MALTE LONG NECK 275ML SIX PACK CX04 PULL OFF" },
  { "codigo": 18836, "descricao": "CORONA EXTRA N LONG NECK 330ML CX C/24 NPAL" },
  { "codigo": 19164, "descricao": "GUARANA CHP ANTARCTICA PET 1L PACK C/2 MULTPACK" },
  { "codigo": 19166, "descricao": "COLORADO LAGER ONE WAY 600ML CX C-12 ARTE" },
  { "codigo": 19225, "descricao": "RED BULL BR LATA 250ML CX C 24 NPAL" },
  { "codigo": 19227, "descricao": "RED BULL BR LATA 355ML FOUR PACK" },
  { "codigo": 19228, "descricao": "RED BULL BR LATA 250ML FOUR PACK NPAL" },
  { "codigo": 19229, "descricao": "RED BULL BR LATA 250ML SIX PACK NPAL" },
  { "codigo": 19231, "descricao": "RED BULL SUGAR FREE BR LATA 250ML FOUR PACK NPAL" },
  { "codigo": 19321, "descricao": "GUARANA ANTARCTICA ZERO PET 200ML SH C/12" },
  { "codigo": 19644, "descricao": "SKOL PURO MALTE LT SLEEK 350ML SH C 12" },
  { "codigo": 19668, "descricao": "ORIGINAL LATA 350ML SH C/12 NPAL" },
  { "codigo": 19729, "descricao": "STELLA ARTOIS LT SLEEK 350ML C 8 CX CARTAO" },
  { "codigo": 19849, "descricao": "BOHEMIA_ LT SLEEK 350ML SH C 12" },
  { "codigo": 20072, "descricao": "BECKS N LT SLEEK 350ML C 8 CX CARTAO" },
  { "codigo": 20217, "descricao": "ORIGINAL GFA VD 300ML CX C/23" },
  { "codigo": 20329, "descricao": "BRAHMA DUPLO MALTE 600ML" },
  { "codigo": 20498, "descricao": "BRAHMA DUPLO MALTE LT SLEEK 350ML SH C 12" },
  { "codigo": 20530, "descricao": "STELLA ARTOIS 600 ML" },
  { "codigo": 20533, "descricao": "BRAHMA DUPLO MALTE GFA VD 1L" },
  { "codigo": 20535, "descricao": "STELLA ARTOIS ONE WAY 600ML CX C/12 NPAL" },
  { "codigo": 20537, "descricao": "BECKS N ONE WAY 600ML CX C/12 NPAL" },
  { "codigo": 20544, "descricao": "BRAHMA DUPLO MALTE LONG NECK 330ML SIX-PACK SHRINK C/4" },
  { "codigo": 20549, "descricao": "BRAHMA DUPLO MALTE GFA VD 300ML CX C/23" },
  { "codigo": 20651, "descricao": "CORONA EXTRA N LT SLEEK 350ML C 8 CX CARTAO" },
  { "codigo": 20853, "descricao": "COLORADO LAGER LT SLEEK 350ML C 8 CX CARTAO" },
  { "codigo": 21020, "descricao": "BUDWEISER LT SLEEK 350ML CX CART C 12" },
  { "codigo": 21113, "descricao": "STELLA ARTOIS SEM GLUTEN LONG NECK 330ML SIX-PACK SHRINK C/4" },
  { "codigo": 21119, "descricao": "SKOL BEATS GT LT 269ML CX CARTAO C/8 NPAL" },
  { "codigo": 21426, "descricao": "TEACHERS HIGHLAND CREAM GARRAFA VIDRO 1 L" },
  { "codigo": 21441, "descricao": "SUKITA LIMAO PET 2L CAIXA C/6" },
  { "codigo": 21526, "descricao": "JOHNNIE WALKER RED LABEL GARRAFA VIDRO 1 L" },
  { "codigo": 21527, "descricao": "TANQUERAY GIN LONDON DRY GARRAFA VIDRO 750ML" },
  { "codigo": 21529, "descricao": "ABSOLUT ORIGINAL GARRAFA VIDRO 1 L" },
  { "codigo": 21530, "descricao": "SMIRNOFF ORIGINAL GARRAFA VIDRO 998ML" },
  { "codigo": 21632, "descricao": "SPATEN N LN 355ML SIXPACK SH C/4" },
  { "codigo": 210, "descricao": "DIET PEPSI COLA LATA 350ML CAIXA C/24 EXPORTACAO" },
  { "codigo": 21666, "descricao": "RED BULL TROPICAL BR LATA 250ML FOUR PACK NPAL" },
  { "codigo": 21668, "descricao": "SPATEN N ONE WAY 600ML CX C/12 NP ARTE" },
  { "codigo": 21778, "descricao": "JOHNNIE WALKER RED LABEL GARRAFA VIDRO 750ML" },
  { "codigo": 21781, "descricao": "SMIRNOFF ICE GARRAFA VD 275ML CX C24" },
  { "codigo": 21789, "descricao": "ORLOFF GARRAFA VIDRO 1 L" },
  { "codigo": 21791, "descricao": "PIRASSUNUNGA 51 GARRAFA VIDRO 965ML" },
  { "codigo": 21792, "descricao": "WHITE HORSE GARRAFA VIDRO 1 L" },
  { "codigo": 21955, "descricao": "CHIVAS REGAL 12 ANOS GARRAFA VIDRO 1 L" },
  { "codigo": 21968, "descricao": "TRIDENT HORTELA ENVELOPE 8G CX C/21" },
  { "codigo": 21970, "descricao": "TRIDENT MENTA ENVELOPE 8G CX C/21" },
  { "codigo": 21973, "descricao": "TRIDENT MELANCIA ENVELOPE 8G CX C/21" },
  { "codigo": 21974, "descricao": "TRIDENT TUTTI-FRUTTI ENVELOPE 8G CX C/21" },
  { "codigo": 22003, "descricao": "HALLS CEREJA ENVELOPE 28G CX C/21" },
  { "codigo": 22005, "descricao": "HALLS MENTA ENVELOPE 28G CX C/21" },
  { "codigo": 22007, "descricao": "HALLS EXTRA FORTE ENVELOPE 28G CX C/21" },
  { "codigo": 22009, "descricao": "CHICLETE ADAMS HORTELA CAIXINHA 2,8G CX C/100" },
  { "codigo": 22027, "descricao": "COLORADO APPIA LT SLEEK 350ML C8 CX CARTAO NPAL" },
  { "codigo": 22049, "descricao": "SELETA GARRAFA VD 600ML" },
  { "codigo": 22106, "descricao": "MINI OREO PCT 35G CX C/10" },
  { "codigo": 22177, "descricao": "BUDWEISER ZERO LT SLEEK 350ML C 8 CX CARTAO" },
  { "codigo": 22180, "descricao": "BUDWEISER ZERO LONG NECK 330ML SIX-PACK SHRINK C/4" },
  { "codigo": 22200, "descricao": "TONICA ANTARCTICA PET 1 L SH C/06" },
  { "codigo": 22202, "descricao": "TONICA ANTARCTICA ZERO PET 1L SH C/06" },
  { "codigo": 22326, "descricao": "BRAHMA DUPLO MALTE LT 473ML SH C/12 NPAL" },
  { "codigo": 22330, "descricao": "MENDORATO PCT 27G CX C/60" },
  { "codigo": 22562, "descricao": "DOMECQ COQ. COMPOSTO GARRAFA VIDRO 1 L" },
  { "codigo": 23028, "descricao": "BUCHANANS WHISKY DELUXE 12 ANOS GARRAFA VIDRO 1 L" },
  { "codigo": 29926, "descricao": "JOHNNIE WALKER BLACK LABEL WHISKY ICONS GARRAFA VIDRO 1 L" },
  { "codigo": 23058, "descricao": "PIRACANJUBA DESNATADO CX 1L CX C/12" },
  { "codigo": 23184, "descricao": "PITU AGUARDENTE LT 350ML CX C/12" },
  { "codigo": 23186, "descricao": "SPATEN N 600ML" },
  { "codigo": 23193, "descricao": "BEATS MOSCOW MULE LT 269ML CX CARTAO C/8 NPAL" },
  { "codigo": 23194, "descricao": "BEATS MOJITO LT 269ML CX CARTAO C/8 NPAL" },
  { "codigo": 23246, "descricao": "PIRACANJUBA LEITE CONDENSADO TETRAPAK 395G CX C/27" },
  { "codigo": 23256, "descricao": "PIRACANJUBA CREME DE LEITE TETRAPAK 200G CX C/27" },
  { "codigo": 23269, "descricao": "SKOL BEATS GT LONG NECK 269ML SIX-PACK SH C/4" },
  { "codigo": 23271, "descricao": "SKOL BEATS SENSES LONG NECK 269ML SIX-PACK SH C/4" },
  { "codigo": 23440, "descricao": "SALINAS TRAD. CACHACA GARRAFA VIDRO 1 L" },
  { "codigo": 23443, "descricao": "PITU AGUARDENTE GARRAFA VIDRO 965ML" },
  { "codigo": 23449, "descricao": "MIKES HARD LEMONADE N LT 269ML SH C12 NP" },
  { "codigo": 23450, "descricao": "MIKES HARD LEMONADE PITAIA N LT 269ML SH C12 NP" },
  { "codigo": 23451, "descricao": "MIKES HARD LEMONADE TANGERINA N LT 269ML SH C12 NP" },
  { "codigo": 23546, "descricao": "INDAIA AGUA MINERAL C/GAS GFA PET 500ML PACK C/12" },
  { "codigo": 23552, "descricao": "INDAIA AGUA MINERAL S/GAS GFA PET 500ML PACK C/12" },
  { "codigo": 23594, "descricao": "PIRAKIDS BEBIDA LACTEA CHOCOLATE TETRA PAK 200 ML CX C/27" },
  { "codigo": 23608, "descricao": "PIRACANJUBA LEITE EM PO INTEGRAL SACO AL. 200G FD C/50" },
  { "codigo": 24168, "descricao": "MICHELOB ULTRA N LONG NECK 330ML SIX-PACK SHRINK C/4" },
  { "codigo": 24256, "descricao": "PETROPOLIS AGUA MIN SEM GAS PET 1,5 SHRINK C/6" },
  { "codigo": 24306, "descricao": "RED BULL MELANCIA LATA 250ML FOUR PACK NPAL" },
  { "codigo": 24408, "descricao": "QUINTA DO MORGADO VINHO TINTO SECO GFA VD 750 ML" },
  { "codigo": 24409, "descricao": "QUINTA DO MORGADO VINHO TINTO SUAVE GFA VD 750 ML" },
  { "codigo": 24410, "descricao": "QUINTA DO MORGADO VINHO BRANCO SUAVE GFA VD 750 ML" },
  { "codigo": 24479, "descricao": "BOHEMIA LONG NECK 330ML SIX-PACK SHRINK C/4" },
  { "codigo": 25151, "descricao": "OLD PARR WHISKY GFA VDR 1L" },
  { "codigo": 25160, "descricao": "BLACK & WHITE WHISKY GFA VDR 1L" },
  { "codigo": 25178, "descricao": "51 ICE LIMAO GARRAFA VD 275ML CX C24" },
  { "codigo": 25194, "descricao": "CACHACA 51 LT 350ML CX C/12" },
  { "codigo": 25220, "descricao": "CACHACA 51 PIRASS OURO DESCARTAVEL GFA DE VDRO 965ML" },
  { "codigo": 25546, "descricao": "GARRAFEIRA PL. AL. LAT. AB. PRETA BEES 1 UN P/ 23 GFA 300ML" },
  { "codigo": 25700, "descricao": "FUSION PET 2L SHRINK C/6" },
  { "codigo": 25837, "descricao": "SPATEN N LT 473ML CX CARTAO C/12" },
  { "codigo": 26037, "descricao": "MONTILLA CARTA CRISTAL GFA VDR 1L" },
  { "codigo": 26462, "descricao": "ORIGINAL LT 473ML CX CARTAO C/12" },
  { "codigo": 26607, "descricao": "RED BULL PITAYA LATA 250ML FOUR PACK NPAL" },
  { "codigo": 26991, "descricao": "WHITE HORSE GFA VIDRO 700ML" },
  { "codigo": 26994, "descricao": "SMIRNOFF ORIGINAL GFA VDR 600ML" },
  { "codigo": 27001, "descricao": "GORDONS GIN DRY GFA VD 750 ML" },
  { "codigo": 27177, "descricao": "HALLS MENTOL ENVELOPE 28G CX C/21" },
  { "codigo": 27179, "descricao": "HALLS MORANGO ENVELOPE 28G CX C/21" },
  { "codigo": 27522, "descricao": "CACHACA 51 PIRASSUNUNGA GFA VD 965ML RET CX/12" },
  { "codigo": 27559, "descricao": "CACHACA 51 PIRASSUNUNGA OURO GFA VD 965ML RET CX/12" },
  { "codigo": 27686, "descricao": "MIKES HARD LEMONADE N LONG NECK 275ML SIX PACK SH C/4" },
  { "codigo": 27866, "descricao": "CORONA CERO SUNBREW N LONG NECK 330 ML SP BASKET CX C4" },
  { "codigo": 28137, "descricao": "SKOL BEATS CAIPIRINHA LT 269ML CX CARTAO C/8 NPAL" },
  { "codigo": 28202, "descricao": "BUBBALOO TUTTI FRUTTI DISPLAY 300G" },
  { "codigo": 28203, "descricao": "BUBBALOO MORANGO DISPLAY 300G" },
  { "codigo": 28204, "descricao": "BUBBALOO UVA DISPLAY 300G" },
  { "codigo": 28700, "descricao": "OREO ORIGINAL BISCOITO RECHEADO PACOTE 36G CX8" },
  { "codigo": 29197, "descricao": "TANG REFRESCO EM PO LIMAO PCT 18G DP C/18" },
  { "codigo": 29199, "descricao": "TANG REFRESCO EM PO LARANJA PCT 18G DP C/18" },
  { "codigo": 29201, "descricao": "TANG REFRESCO EM PO ABACAXI PCT 18G DP C/18" },
  { "codigo": 29207, "descricao": "TANG REFRESCO EM PO MORANGO PCT 18G DP C/18" },
  { "codigo": 29209, "descricao": "TANG REFRESCO EM PO MARACUJA PCT 18G DP C/18" },
  { "codigo": 29215, "descricao": "TANG REFRESCO EM PO UVA PCT 18G DP C/18" },
  { "codigo": 29253, "descricao": "ORIGINAL GFA VD 1L" },
  { "codigo": 29323, "descricao": "INDAIA BEB MISTA CITRUS LARANJA GFA PET 330ML FD C/12" },
  { "codigo": 29326, "descricao": "INDAIA BEB MISTA CITRUS LARANJA GFA PET 1,5L FD C/6" },
  { "codigo": 29485, "descricao": "SKOL BEATS CAIPIRINHA LONG NECK 269ML SIX-PACK SH C/4" },
  { "codigo": 29504, "descricao": "OLD PARR WHISKY 12 ANOS GFA VD 750 ML" },
  { "codigo": 29505, "descricao": "CIROC VODKA GFA VD 750 ML" },
  { "codigo": 29508, "descricao": "JOHNNIE WALKER WHISKY GOLD LABEL RESERVE GFA VD 750 ML" },
  { "codigo": 29518, "descricao": "JOHNNIE WALKER WHISKY BLONDE GFA VD 750 ML" },
  { "codigo": 29580, "descricao": "STELLA ARTOIS PURE GOLD LONG NECK 330ML SP SH C/4" },
  { "codigo": 29845, "descricao": "PEPSI BLACK PET 1 L SH C/12" },
  { "codigo": 30045, "descricao": "RED BULL BR LATA 473ML CX C 12" },
  { "codigo": 30852, "descricao": "BUBBALOO BALA TUTTI FRUTI DISPLAY 15G CX/12" },
  { "codigo": 30854, "descricao": "BUBBALOO BALA MIX DISPLAY 15G CX/12" },
  { "codigo": 30856, "descricao": "BUBBALOO BALA MORANGO DISPLAY 15G CX/12" },
  { "codigo": 31064, "descricao": "BUDWEISER LT 269ML SH C 15" },
  { "codigo": 31272, "descricao": "FUSION LT 473ML SH C/12 NPAL" },
  { "codigo": 32067, "descricao": "GATORADE BERRY BLUE PET 500ML SIXPACK" },
  { "codigo": 32122, "descricao": "SMIRNOFF VODKA N21 GFA PET 1,75L" },
  { "codigo": 32126, "descricao": "AMINDUS GRELHADITOS AMEND. TOR. S/ PELE PCT 24G FD C/60" },
  { "codigo": 32128, "descricao": "PACOQUITA QUADRADA PCT PL 18G DSP C/24" },
  { "codigo": 32131, "descricao": "PACOQUITA ROLHA EMBALADA PCT 15G PT/50" },
  { "codigo": 32155, "descricao": "PACOQUITA ZERO QUADRADA PCT PL 18G DSP C/24" },
  { "codigo": 32349, "descricao": "BEATS TROPICAL LT 269ML CX CARTAO C/8 NPAL" },
  { "codigo": 32361, "descricao": "BEATS TROPICAL LONG NECK 269ML SIX-PACK SH C/4" },
  { "codigo": 32425, "descricao": "FUSION MELANCIA LT 473ML SH C/12 NPAL" },
  { "codigo": 32427, "descricao": "FUSION TROPICAL LT 473ML SH C/12 NPAL" },
  { "codigo": 32500, "descricao": "STELLA ARTOIS PURE GOLD LT SLEEK 350ML C 8 CX CARTAO" },
  { "codigo": 32526, "descricao": "PETROPOLIS AGUA MIN SEM GAS GARRAFA PET 500MLCX C12" },
  { "codigo": 32528, "descricao": "PETROPOLIS AGUA MIN COM GAS GARRAFA PET 500MLCX C12" },
  { "codigo": 32644, "descricao": "BUBBALOO UVA DISPLAY 5G CX/60" },
  { "codigo": 32646, "descricao": "BUBBALOO TUTTI FRUTTI DISPLAY 5G CX/60" },
  { "codigo": 32648, "descricao": "BUBBALOO MORANGO DISPLAY 5G CX/60" },
  { "codigo": 33109, "descricao": "51 OURO AGUARDENTE COMPOSTA LT 350ML CX C/12" },
  { "codigo": 33734, "descricao": "BEATS RED MIX LT 269ML SH C/8" },
  { "codigo": 33738, "descricao": "BEATS RED MIX LONG NECK 269ML SIX-PACK SH C/2" },
  { "codigo": 22859, "descricao": "PIRAQUE LEITE MALTADO PCT 160G CX C/40" },
  { "codigo": 22860, "descricao": "PIRAQUE AGUA GERGELIM PCT 240G CX C/40" },
  { "codigo": 22871, "descricao": "PIRAQUE ROLAD. GOIABA PCT 75G CX C/40" },
  { "codigo": 22873, "descricao": "PIRAQUE SALG. PRESUNTINHO PCT 100G CX C/20" },
  { "codigo": 22876, "descricao": "PIRAQUE SALG. QUEIJINHO PCT 100G CX C/20" },
  { "codigo": 24184, "descricao": "PIRAQUE MALTADO COBERTO PCT 80G CX C/40" },
  { "codigo": 30132, "descricao": "VITARELLA BISC MARIA TRADICIONAL PCT 350G CX 24" },
  { "codigo": 30134, "descricao": "VITARELLA BISC MAIZENA TRADICIONAL PCT 350G CX 24" },
  { "codigo": 30136, "descricao": "VITARELLA CREAM CRACKER TRADICIONAL PCT 350G CX 24" },
  { "codigo": 30148, "descricao": "TRELOSO BISCOITO RECHEADO CHOCOLATE PCT 120G CX/36" },
  { "codigo": 30151, "descricao": "TRELOSO RECHEADO BAUNILHA CHOCORESCO PCT 120G CX/36" },
  { "codigo": 30152, "descricao": "TRELOSO BISCOITO RECHEADO MORANGO PCT 120G CX/36" },
  { "codigo": 30218, "descricao": "ESCURETO RICHESTER RECHEADO PCT PLAST 125G CX/36" },
  { "codigo": 30220, "descricao": "PIRAQUE NEWAFER CHOCOLATE PCT PLAST 100G CX/20" },
  { "codigo": 30440, "descricao": "ISABELA BISCOITO SABOR LEITE PCT 350G CX 24" },
  { "codigo": 32036, "descricao": "PIRAQUE MAIZENA PCT PLAST 175G C48" },
  { "codigo": 32754, "descricao": "PIRAQUE BISC DOCE C/ LEITE MALT BLACK PCT PLAST 132G C50" },
  { "codigo": 34677, "descricao": "PIRAQUE BISC LEITE MALT BLACK COB CHOC PCT 80G CX C/40" },
  { "codigo": 34681, "descricao": "PIRAQUE RECH PRETTY PCT 76G CX40" },
  { "codigo": 34683, "descricao": "PIRAQUE RECH LIMAO PCT 76G CX40" },
  { "codigo": 34685, "descricao": "PIRAQUE RECH CHOCOLATE PCT 76G CX40" },
  { "codigo": 34687, "descricao": "PIRAQUE RECH MORANGO PCT 76G CX40" },
  { "codigo": 34296, "descricao": "TRIDENT CANELA ENVELOPE 8G CX C/21" },
  { "codigo": 34298, "descricao": "TRIDENT MORANGO ENVELOPE 8G CX C/21" },
  { "codigo": 29733, "descricao": "HALLS MELANCIA ENVELOPE 28G CX C/21" },
  { "codigo": 34693, "descricao": "TRELOSO CHOCORESCO RECH CHOC PCT 120G CX/36" },
  { "codigo": 21658, "descricao": "SPATEN N LT SLEEK 350ML CX CART C 12" },
  { "codigo": 10530, "descricao": "ANTARCTICA SUBZERO GFA VD 1L" },
  { "codigo": 32175, "descricao": "CROKISSIMO AMEND CROC LEV SALGADO PCT 24G FD/36" },
  { "codigo": 22514, "descricao": "BALLANTINES FINEST GARRAFA VIDRO 750ML" },
  { "codigo": 828, "descricao": "CHOPP BRAHMA CLARO BARRIL KEG 30L" },
  { "codigo": 34410, "descricao": "HALLS UVA VERDE ENVELOPE 28G CX C/21" },
  { "codigo": 34263, "descricao": "CORONA CERO SUNBREW N LT SLEEK 350ML C 8 CX CARTAO" },
  { "codigo": 9071, "descricao": "CARACU LATA 350ML SH C/12 NPAL" },
  { "codigo": 9081, "descricao": "MALZBIER BRAHMA LATA 350ML SH C/12 NPAL" },
  { "codigo": 9093, "descricao": "PEPSI TWIST LATA 350ML SH C/12 NPAL" },
  { "codigo": 21787, "descricao": "DREHER GARRAFA VIDRO 900ML" },
  { "codigo": 24304, "descricao": "TODDYNHO 200ML TETRA PAK 200 ML CX C/27" },
  { "codigo": 31582, "descricao": "YPE LAVA LOUCAS LIQUIDO CLEAR FRASCO PLASTICO 500 ML C24" },
  { "codigo": 31589, "descricao": "YPE LAVA LOUCAS LIQUIDO MACA FRASCO PLASTICO 500 ML C24" },
  { "codigo": 31667, "descricao": "YPE LAVA LOUCAS LIQUIDO NEUTRO FRASCO PLASTICO 500 ML C24" },
  { "codigo": 31669, "descricao": "YPE LAVA LOUCAS LIQUIDO COCO FRASCO PLASTICO 500 ML C24" },
  { "codigo": 33042, "descricao": "YPE LAVA LOUCAS LIQUIDO LIMAO FRASCO PLASTICO 500 ML C24" },
  { "codigo": 33046, "descricao": "YPE TIXAN LAVA ROUPAS PO MACIEZ SACHE PLASTICO 800G CX20" },
  { "codigo": 33048, "descricao": "YPE TIXAN LAVA ROUPAS PRIMAV SACHE PLASTICO 800G CX20" },
  { "codigo": 33061, "descricao": "YPE TIXAN LAVA ROUPAS PO MACIEZ SACHE 400G CX C/24" },
  { "codigo": 33066, "descricao": "YPE TIXAN LAVA ROUPAS PRIMAV SACHE 400G CX C/24" },
  { "codigo": 34420, "descricao": "RED BULL SUMMER MARACUJA E MELAO LATA 250ML FOUR PACK NPAL" },
  { "codigo": 34429, "descricao": "RED BULL AMORA LATA 250ML FOUR PACK NPAL" },
  { "codigo": 34475, "descricao": "ELEVE AGUA MIN S GAS GFA PET 510ML FD C/12" },
  { "codigo": 34479, "descricao": "ELEVE AGUA MIN S GAS PET 1,5 SHRINK C/6" },
  { "codigo": 34770, "descricao": "RED BULL SUGAR FREE POMELO LATA 250ML FOUR PACK NPAL" },
  { "codigo": 35003, "descricao": "TRIDENT XFRESH 5S PRETO CEREJA ENVELOPE 8G CX C/21" },
  { "codigo": 371, "descricao": "MALZBIER BRAHMA LONG NECK 355ML SIX-PACK BANDEJA C/4" },
  { "codigo": 1164, "descricao": "SUKITA UVA LATA 350ML SH C/12 NPAL" },
  { "codigo": 8411, "descricao": "GUARANA CHP ANTARCTICA PET 1,5 SHRINK C/6" },
  { "codigo": 18752, "descricao": "PATAGONIA WEISSE NACIONAL ONE WAY 740ML CX6" },
  { "codigo": 18772, "descricao": "PATAGONIA AMB LAG NACIONAL ONE WAY 740ML CX6" },
  { "codigo": 20164, "descricao": "SKOL LT 473ML SH C/12 NPAL MULTPACK 12" },
  { "codigo": 22382, "descricao": "PASSPORT SELECTION GARRAFA VIDRO 1 L" },
  { "codigo": 22508, "descricao": "PERGOLA SEL. VINHO TINTO SUAVE GARRAFA VIDRO 750ML" },
  { "codigo": 25429, "descricao": "MATUTA CACHACA CRISTAL GARRAFA VIDRO 1 L" },
  { "codigo": 25430, "descricao": "MATUTA CACHACA UMBURANA GARRAFA VIDRO 1 L" },
  { "codigo": 27560, "descricao": "CASILLERO DEL DIABLO VINH RESERVA MALBEC GFA VD 750 ML" },
  { "codigo": 27562, "descricao": "CASILLERO DEL DIABLO VINH RESERVA MERLOT GFA VD 750 ML" },
  { "codigo": 27566, "descricao": "RESERVADO VINHO SWEET RED GFA VD 750 ML" },
  { "codigo": 27613, "descricao": "CASILLERO DEL DIABLO VNH RSV CABER SAUVG GFA VD 750 ML" },
  { "codigo": 27624, "descricao": "RESERVADO VINHO MALBEC GFA VD 750 ML" },
  { "codigo": 32538, "descricao": "PERGOLA SEL. VINHO TINTO SUAVE GARRAFA VIDRO 1 L" },
  { "codigo": 34027, "descricao": "GUARANA CHP ANTARCTICA LATA 350ML SH C/12 NPAL MULTIPACK" },
  { "codigo": 35331, "descricao": "BUDWEISER GFA VD 1L" },
  { "codigo": 34529, "descricao": "YPE TIXAN LAVA ROUPAS LIQ MACIEZ FRASCO PLAST 1L CX12" },
  { "codigo": 31713, "descricao": "YPE AMACIANTE CONC PINK FRASCO PLAST 500ML CX/12" },
  { "codigo": 31789, "descricao": "YPE AMACIANTE TRADICIONAL ACONCHEGO FRASCO PLASTICO 2 L C6" },
  { "codigo": 34890, "descricao": "YPE ASSOLAN ESPONJA LA ACO CX PAPEL CART 1,6KG LEVE 20 PAG 18" },
  { "codigo": 31805, "descricao": "YPE TIXAN LAVA ROUPAS LIQ PRIMAVERA FRASCO PLAST 1 L C12" },
  { "codigo": 34527, "descricao": "YPE AMACIANTE TRADICIONAL ACONCHEGO FRASCO PLASTICO 500 ML C24" },
  { "codigo": 31708, "descricao": "YPE AMACIANTE CONC BLUE FRASCO PLAST 500ML CX/12" },
  { "codigo": 34320, "descricao": "GUARANA ANTARCTICA ZERO LATA 350ML SH C/12 NPAL MULTIPACK" },
  { "codigo": 34432, "descricao": "RED BULL TROPICAL BR LATA 473ML CX C 12" },
  { "codigo": 24411, "descricao": "QUINTA DO MORGADO VINHO BRANCO SECO GFA VD 750 ML" },
  { "codigo": 25329, "descricao": "SALTON ESPUMANTE BRUT GFA VD 750 ML" },
  { "codigo": 25335, "descricao": "SALTON ESPUMANTE BRUT ROSE GFA VD 750 ML" },
  { "codigo": 25347, "descricao": "SALTON ESPUMANTE CLASSIC MOSCATEL GFA VD 750 ML" },
  { "codigo": 22543, "descricao": "ROCKS STRAMBERRY GARRAFA VIDRO 1 L" },
  { "codigo": 29891, "descricao": "ROCKS DRY GIN GARRAFA VIDRO 1 L" },
  { "codigo": 32969, "descricao": "RED BULL SUMMER MORANGO E PESSEGO LATA 250ML FOUR PACK NPAL" },
  { "codigo": 25434, "descricao": "MATUTA CACHACA MEL E LIMAO GARRAFA VIDRO 1 L" },
  { "codigo": 35617, "descricao": "BEATS GREEN MIX LT 269ML SH C/8" },
  { "codigo": 35136, "descricao": "YPE SABAO BARRA MULTIATIVO PCT PLAST 800G" },
  { "codigo": 35134, "descricao": "YPE SABAO BARRA NEUTRO PCT PLAST 800G" },
  { "codigo": 36034, "descricao": "BUDWEISER LT 473ML SH C12 NP MULTIPACK" },
  { "codigo": 34325, "descricao": "ELEVE AGUA MIN C GAS GFA PET 510ML FD C/12" },
  { "codigo": 35620, "descricao": "BEATS GREEN MIX LONG NECK 269ML SIX-PACK SH C/4" },
  { "codigo": 35108, "descricao": "CERVEGELA PLASTICA SPATEN 1 UN P/ GFA 600ML CX3" },
  { "codigo": 35417, "descricao": "JOHNNIE WALKER GOLD RES ICONS ED LIM GFA VD 750 ML" },
  { "codigo": 21788, "descricao": "BALLANTINES FINEST GARRAFA VIDRO 1 L" },
  { "codigo": 22563, "descricao": "CHIVAS REGAL 12 ANOS GARRAFA VIDRO 750ML" },
  { "codigo": 24161, "descricao": "S. JOAO BARRA CONHAQUE ALC. GARRAFA VIDRO 900ML" },
  { "codigo": 35061, "descricao": "YPE AMACIANTE CONC BLUE GARDEN FRASCO PLAST 500 ML" },
  { "codigo": 30878, "descricao": "YPE AMACIANTE TRADICIONAL ACONCHEGO FRASCO PLASTICO 2L" },
  { "codigo": 31674, "descricao": "YPE AMACIANTE INTENSO FRASCO PLASTICO 2 L C6" },
  { "codigo": 31678, "descricao": "YPE AMACIANTE CONC BLUE FRASCO PLAST 1 L C12" },
  { "codigo": 33854, "descricao": "YPE TIXAN LAVA ROUPAS LIQ PRIMAVERA FRASCO PLAST 1L" },
  { "codigo": 35012, "descricao": "MENDORATO PCT 45G DISPLAY C10" },
  { "codigo": 34920, "descricao": "DIAS DAVILA AGUA MINERAL S GAS GFA PET 1,5L FD C/6" },
  { "codigo": 34923, "descricao": "DIAS DAVILA AGUA MINERAL C GAS GFA PET 500ML PACK C/12" },
  { "codigo": 34918, "descricao": "DIAS DAVILA AGUA MINERAL S GAS GFA PET 500ML PACK C/12" },
  { "codigo": 35980, "descricao": "CASAL GARCIA VINHO ROSE GFA VD 750 ML" },
  { "codigo": 35992, "descricao": "CASAL GARCIA VINHO BR VERDE GFA VD 750 ML" },
  { "codigo": 13203, "descricao": "ANTARCTICA PILSEN GFA VD 300ML CX C/23" },
  { "codigo": 33818, "descricao": "ORIGINAL LATA 350ML SHRINK C/12 MULTPACK" },
  { "codigo": 9427, "descricao": "ANTARCTICA PILSEN LT 473ML SH C/12 NPAL" },
  { "codigo": 37454, "descricao": "DOCES VIEIRA BRIGADEIRO PCT PLAST 23G CX C/6" },
  { "codigo": 37576, "descricao": "DOCES VIEIRA PE DE MOCA PCT PLAST 23G POTE C/" },
  { "codigo": 37579, "descricao": "DOCES VIEIRA BEIJO DE LEITE PCT PLAST 23G POT" },
  { "codigo": 37580, "descricao": "DOCES VIEIRA CHURRITOS PCT PLAST 23G POTE C/4" },
  { "codigo": 37581, "descricao": "DOCES VIEIRA COCADA BAIANA PCT PLAST 23G POTE" },
  { "codigo": 37582, "descricao": "DOCES VIEIRA COCADA BRANCA PCT PLAST 23G POTE" },
  { "codigo": 37583, "descricao": "DOCES VIEIRA BEIJO DE MOCA PCT PLAST 23G POTE" },
  { "codigo": 23671, "descricao": "CERVEGELA PLASTICA BRAHMA 1 UN P/ GFA 1L CX C/3" },
  { "codigo": 23672, "descricao": "CERVEGELA PLASTICA BRAHMA 1 UN P/ GFA 600ML CX C/3" },
  { "codigo": 29416, "descricao": "CERVEGELA BUDWEISER 1 UN P/ GF 600ML CX3" },
  { "codigo": 29418, "descricao": "CERVEGELA BUDWEISER LITRAO 1 UN P/ GF 1L PCK3" },
  { "codigo": 24604, "descricao": "MINALBA AGUA PREMIUM C/GAS GFA VDR 300ML CX/12" },
  { "codigo": 24609, "descricao": "MINALBA AGUA PREMIUM S/GAS GFA VDR 300ML CX/12" },
  { "codigo": 37933, "descricao": "DOCES VIEIRA BRIGADEIRO PCT PLAST 23G POTE C/40" },
  { "codigo": 34454, "descricao": "H2OH LIMONETO LT SLEEK 350ML SH C 12" },
  { "codigo": 1708, "descricao": "GUARANA ANTARCTICA ZERO PET 2,5L CAIXA C/6" },
  { "codigo": 20150, "descricao": "BRAHMA CHOPP LT 473ML SH C/12 NPAL MULTPACK 12" },
  { "codigo": 25303, "descricao": "GARRAFEIRA PL. PRETO BEES 1 UN P/24 GFA 600ML" },
  { "codigo": 24486, "descricao": "GALLO AZEITE OLIVA EX. VIR. GFA VDR 500ML" },
  { "codigo": 24488, "descricao": "GALLO AZEITE OLIVA EX. VIR. GFA VDR 250ML" },
  { "codigo": 33857, "descricao": "STELLA ARTOIS PURE GOLD 600ML" },
  { "codigo": 37450, "descricao": "BUDWEISER LT SLEEK 350ML SH C 12 MULTIPACK" },
  { "codigo": 31795, "descricao": "BRUTAL FRUIT LONG NECK 275ML SIX PACK SH C 2" }
];

let S = {
  tarefas:    [],
  operadores: ['MARIVALDO ARTHUR', 'RONILDO', 'PAULO PEREIRA'],
  conferentes:['GILSON ROSA DA SILVA', 'MATHEUS'],
  selProd:    null,
  nextId:     1
};

const FB_KEY = 'pk_firebase_config';
let fbApp = null, fbDb = null, fbUnsub = null;

// ── Firebase helpers ─────────────────────────────────
const FB_DEFAULT_CONFIG = {
  apiKey:            'AIzaSyA_ykhJGRkIDbPuDNYooMIVvB2DeVzp2VE',
  authDomain:        'armazemfacil-b2292.firebaseapp.com',
  projectId:         'armazemfacil-b2292',
  storageBucket:     'armazemfacil-b2292.firebasestorage.app',
  messagingSenderId: '688234941301',
  appId:             '1:688234941301:web:153e2ad3f634379fe3213c',
  measurementId:     'G-6HFDEKWVDB',
};

function loadFbConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(FB_KEY) || 'null');
    return saved || FB_DEFAULT_CONFIG;
  } catch(e) { return FB_DEFAULT_CONFIG; }
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
const NAMES_VERSION = 4;

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
    // (os nomes fixos já estão em S desde a inicialização)
    if (saved.operadores)  saved.operadores.forEach(n  => { if (!S.operadores.includes(n))  S.operadores.push(n);  });
    if (saved.conferentes) saved.conferentes.forEach(n => { if (!S.conferentes.includes(n)) S.conferentes.push(n); });

    // Restaura estado da sessão do empilhador
    if (saved.tipoOperacao)  tipoOperacao  = saved.tipoOperacao;
    if (saved.checklistDone) checklistDone = saved.checklistDone;
    if (saved.selOp)         window._savedSelOp = saved.selOp;
  } catch(e) {}
}
function save() {
  localStorage.setItem('pk2_s', JSON.stringify({
    ...S,
    namesVersion:  NAMES_VERSION,
    tipoOperacao:  tipoOperacao,
    checklistDone: checklistDone,
    selOp:         document.getElementById('sel-op')?.value || '',
  }));
}

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
const ALL_PANES = ['menu','conf','emp','reports','despejo','repack','armazem','quebras','validades','dashboard','controle','blitz','csv'];

function goPane(name) {
  ALL_PANES.forEach(p => {
    document.getElementById('pane-' + p).classList.toggle('active', p === name);
  });

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
  save();
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
  save();
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
  const deInput  = document.getElementById('relatorio-data-de')  || document.getElementById('csv-date');
  const ateInput = document.getElementById('relatorio-data-ate') || document.getElementById('csv-date');
  const de  = deInput  ? deInput.value  : '';
  const ate = ateInput ? ateInput.value : '';
  if (!de && !ate) { toast('Selecione um intervalo de datas', true); return; }

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

    const filtered = all.filter(r => {
      if (!r.finalizadoEm) return false;
      const dIso = r.finalizadoEm.split('T')[0]; // YYYY-MM-DD
      if (de  && dIso < de)  return false;
      if (ate && dIso > ate) return false;
      return true;
    }).sort((a,b) => (a.finalizadoEm||'').localeCompare(b.finalizadoEm||''));

    const labelPeriodo = de === ate ? de : (de + ' a ' + ate);

    if (!filtered.length) {
      status.innerHTML = '<div class="fb-msg fb-msg-err">Nenhum registro encontrado para ' + labelPeriodo + '. Verifique se há tarefas finalizadas nesse período.</div>';
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

    // Converte tipoOperacao para o label curto usado no relatório
    function fmtTipo(tipo) {
      if (!tipo) return '';
      const t = tipo.toUpperCase();
      if (t.includes('DURANTE') || t.includes('REABASTECIMENTO')) return 'RESSUPRIMENTO';
      if (t.includes('APÓS') || t.includes('APOS') || t.includes('RESSUPRIMENTO')) return 'ABASTECIMENTO';
      return tipo.toUpperCase();
    }

    function fmtHora(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
    }

    function fmtDataCurta(iso) {
      if (!iso) return '';
      const d = new Date(iso);
      return String(d.getDate()).padStart(2,'0') + '/' +
             String(d.getMonth()+1).padStart(2,'0') + '/' + d.getFullYear();
    }

    const headers = [
      'DATA',
      'HORA/INICIAL',
      'HORA/FINAL',
      'OPERAÇÃO',
      'OPERADOR',
      'RESSUPRIMENTO',
      'COD.PRODUTO',
      'PALLETS ABASTECIDOS'
    ];

    const rows = filtered.map(r => [
      fmtDataCurta(r.finalizadoEm),
      fmtHora(r.iniciadoEm),
      fmtHora(r.finalizadoEm),
      r.conferente    ?? '',
      r.operador      ?? '',
      fmtTipo(r.tipoOperacao),
      r.codigo        ?? '',
      r.quantidade    ?? ''
    ].map(v => '"' + String(v).replace(/"/g, '""') + '"').join(SEP));

    const csvContent = [headers.map(h => '"'+h+'"').join(SEP), ...rows].join('\r\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', 'relatorio_picking_' + (de||'inicio') + '_a_' + (ate||'fim') + '.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    status.innerHTML = '<div class="fb-msg fb-msg-ok">' + filtered.length + ' registros baixados — período: ' + labelPeriodo + '</div>';

    const prev = filtered.slice(0,10);
    const totalPal = filtered.reduce((s,r) => s + (r.quantidade||0), 0);

    preview.innerHTML =
      '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:12px 0 10px">' +
      statBox(filtered.length, 'Tarefas', 'var(--amber)') +
      statBox(totalPal, 'Paletes', 'var(--green)') +
      '</div>' +
      '<div style="font-size:11px;color:var(--text-dim);margin-bottom:8px">Preview — ' +
        (filtered.length > 10 ? 'primeiros 10 de ' + filtered.length + ' registros' : filtered.length + ' registros') +
        ' · período <strong style="color:var(--text)">' + labelPeriodo + '</strong></div>' +
      '<div style="overflow-x:auto"><table class="rpt-table"><thead><tr>' +
      '<th>DATA</th><th>H.INICIAL</th><th>H.FINAL</th><th>OPERAÇÃO</th><th>OPERADOR</th><th>RESSUPRIMENTO</th><th>COD.PRODUTO</th><th>PALLETS</th>' +
      '</tr></thead><tbody>' +
      prev.map(r =>
        '<tr>' +
        '<td style="font-family:monospace;font-size:11px">' + fmtDataCurta(r.finalizadoEm) + '</td>' +
        '<td style="font-family:monospace;font-size:11px">' + fmtHora(r.iniciadoEm) + '</td>' +
        '<td style="font-family:monospace;font-size:11px">' + fmtHora(r.finalizadoEm) + '</td>' +
        '<td>' + (r.conferente||'—') + '</td>' +
        '<td style="color:var(--blue);font-weight:600">' + (r.operador||'—') + '</td>' +
        '<td style="color:var(--amber);font-size:11px">' + fmtTipo(r.tipoOperacao) + '</td>' +
        '<td style="font-family:monospace;color:var(--amber)">' + (r.codigo||'—') + '</td>' +
        '<td style="text-align:center;font-weight:700">' + (r.quantidade||'—') + '</td>' +
        '</tr>'
      ).join('') +
      '</tbody></table></div>' +
      (filtered.length > 10 ? '<div style="font-size:11px;color:var(--text-muted);margin-top:6px;text-align:center">+ ' + (filtered.length - 10) + ' registros adicionais no arquivo CSV</div>' : '');

  } catch(e) {
    status.innerHTML = '<div class="fb-msg fb-msg-err">Erro ao buscar dados: ' + e.message + '</div>';
  }
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
  // Match parcial: "MARIVALDO" captura "MARIVALDO SILVA" e vice-versa
  const matchOp  = (nome) => !op ? false : nome === op || nome.toUpperCase().includes(op.toUpperCase()) || op.toUpperCase().includes(nome.toUpperCase());
  const pending  = S.tarefas.filter(t => matchOp(t.operador) && t.status==='pending');
  const progress = S.tarefas.filter(t => matchOp(t.operador) && t.status==='in_progress');
  const done     = S.tarefas.filter(t => matchOp(t.operador) && t.status==='done').slice().reverse().slice(0,10);
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

// Restaura operador e tipo de operação da sessão anterior
if (window._savedSelOp) {
  const selOp = document.getElementById('sel-op');
  if (selOp) selOp.value = window._savedSelOp;
  delete window._savedSelOp;
}
atualizarExibicaoTipo();

// Persiste o operador selecionado sempre que ele mudar
document.getElementById('sel-op')?.addEventListener('change', () => save());

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
