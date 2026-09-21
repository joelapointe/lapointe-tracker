// js/position.js — Étape 17, morceau 3 : la position du téléphone (GPS), pour le punch
//
// Décisions de Joé (21 septembre 2026) :
//   • « JE COMMENCE » et « JE TERMINE » enregistrent la position ET sa précision (± mètres). Jamais bloquant : sans position, le quart s'enregistre quand même.
//   • Attente : 6 secondes au plus. On prend d'abord la lecture continue du GPS si elle a moins de 20 s (instantané) ; sinon une lecture FRAÎCHE (précision élevée) ;
//     sinon la dernière lecture si elle a moins de 2 minutes ; sinon « sans position ».
//   • La permission de localisation est demandée UNE SEULE FOIS, à la première ouverture après la connexion (jamais en plein punch).
//   • La confirmation du punch dit la vérité : « 📍 Position enregistrée (±12 m) » ou « 📍 Sans position : … ».
// Sur le téléphone (APK Capacitor) on utilise le plugin officiel @capacitor/geolocation ; dans un navigateur, navigator.geolocation. Le suivi EN ARRIÈRE-PLAN
// (le chauffeur suivi sur la carte, application fermée) est l'étape 18 : il n'est pas ici.
const POSITION_FRAICHE_S=20;         // une lecture du suivi continu de moins de 20 s : utilisée tout de suite
let POSITION_ATTENTE_MS=6000;        // une lecture fraîche : 6 secondes au plus (le punch n'attend jamais plus)
const POSITION_RECENTE_S=120;        // à défaut, la dernière lecture si elle a moins de 2 minutes
let lastPosInfo=null;                // {lat, lon, precision (m ou null), le (heure de la lecture, en ms)} : la dernière lecture connue ; lastPos (config.js) en garde les coordonnées
let _permissionPosition='inconnue';  // 'accordee' | 'refusee' | 'a_demander' | 'gps_desactive' | 'inconnue'
let _permissionDemandee=false;
let _suiviDemarre=false;
let _lecturePosition=null;           // une seule lecture fraîche à la fois : deux touchers rapprochés partagent la même

// Le plugin de position du téléphone, s'il existe (sinon null : on utilisera le navigateur)
function pluginPosition(){
  try{
    const C=(typeof Capacitor!=='undefined')?Capacitor:null;
    if(C&&C.Plugins&&C.Plugins.Geolocation&&(typeof C.isPluginAvailable!=='function'||C.isPluginAvailable('Geolocation'))) return C.Plugins.Geolocation;
  }catch(e){}
  return null;
}
function gpsPresent(){
  return !!pluginPosition()||(typeof navigator!=='undefined'&&!!navigator.geolocation);
}

// Une lecture est reçue (du suivi continu ou d'une lecture fraîche) : on la garde, avec sa précision et son heure
function noterPosition(lat,lon,precision,quand){
  if(typeof lat!=='number'||typeof lon!=='number'||isNaN(lat)||isNaN(lon)) return;
  // (l'heure de la lecture vient de l'appareil ; si elle est absurde, c'est maintenant)
  const t=(typeof quand==='number'&&quand>0&&Math.abs(Date.now()-quand)<10*60000)?quand:Date.now();
  lastPos=[lat,lon];
  lastPosInfo={lat,lon,precision:(typeof precision==='number'&&precision>=0)?precision:null,le:t};
}
// La dernière lecture connue, si elle a moins de maxS secondes
function positionConnue(maxS){
  if(!lastPosInfo) return null;
  const age=(Date.now()-lastPosInfo.le)/1000;
  if(age>maxS) return null;
  return {lat:lastPosInfo.lat,lon:lastPosInfo.lon,precision:lastPosInfo.precision,ageS:Math.max(0,Math.round(age))};
}

function lireUnePosition(options){
  const p=pluginPosition();
  if(p) return p.getCurrentPosition(options);
  if(typeof navigator!=='undefined'&&navigator.geolocation) return new Promise((ok,ko)=>navigator.geolocation.getCurrentPosition(ok,ko,options));
  return Promise.reject(new Error('gps_absent'));
}
// Une lecture fraîche, 6 secondes au plus. Renvoie la position, ou null (refus, GPS éteint, trop long…). Si elle arrive après la limite, elle est quand même gardée (noterPosition).
function lireAvecLimite(){
  if(_lecturePosition) return _lecturePosition;
  const p=(async()=>{
    let t=null;
    try{
      const limite=new Promise(res=>{t=setTimeout(()=>res(null),POSITION_ATTENTE_MS);});
      const lecture=lireUnePosition({enableHighAccuracy:true,timeout:Math.max(1000,POSITION_ATTENTE_MS-1000),maximumAge:POSITION_FRAICHE_S*1000}).then(pos=>{
        const c=pos&&pos.coords;
        if(!c||typeof c.latitude!=='number'||typeof c.longitude!=='number') return null;
        noterPosition(c.latitude,c.longitude,c.accuracy,pos.timestamp);
        return lastPosInfo?{lat:lastPosInfo.lat,lon:lastPosInfo.lon,precision:lastPosInfo.precision,ageS:0}:null;
      },()=>null);
      return await Promise.race([lecture,limite]);
    }catch(e){
      return null;
    }finally{
      clearTimeout(t);
    }
  })();
  _lecturePosition=p;
  p.then(()=>{if(_lecturePosition===p) _lecturePosition=null;});
  return p;
}
// LA fonction du punch. Ne lève jamais d'erreur et n'attend jamais plus que POSITION_ATTENTE_MS.
// Renvoie {lat, lon, precision (m ou null), ageS, source: 'continue' | 'fraiche' | 'recente'}, ou null (« sans position »).
async function obtenirPosition(){
  try{
    const recente=positionConnue(POSITION_FRAICHE_S);
    if(recente) return {...recente,source:'continue'};
    if(gpsPresent()){
      const lue=await lireAvecLimite();
      if(lue) return {...lue,source:'fraiche'};
    }
    const vieille=positionConnue(POSITION_RECENTE_S);
    return vieille?{...vieille,source:'recente'}:null;
  }catch(e){
    return null;
  }
}

// Le suivi continu de la position (celui de la carte). Renvoie false s'il n'y a aucun GPS. Démarre une seule fois.
// auSucces(pos) reçoit la lecture (pos.coords.latitude / longitude / accuracy) ; alErreur(erreur) reçoit un échec.
function demarrerSuiviPosition(auSucces,alErreur){
  if(_suiviDemarre) return true;
  const options={enableHighAccuracy:true,maximumAge:5000,timeout:15000};
  const chaque=(pos,err)=>{
    if(err||!pos||!pos.coords){if(alErreur) alErreur(err||new Error('position_vide'));return;}
    noterPosition(pos.coords.latitude,pos.coords.longitude,pos.coords.accuracy,pos.timestamp);
    if(auSucces) auSucces(pos);
  };
  const p=pluginPosition();
  if(p){
    _suiviDemarre=true;
    Promise.resolve().then(()=>p.watchPosition(options,chaque)).catch(e=>{_suiviDemarre=false;if(alErreur) alErreur(e);});
    return true;
  }
  if(typeof navigator!=='undefined'&&navigator.geolocation){
    _suiviDemarre=true;
    navigator.geolocation.watchPosition(pos=>chaque(pos),err=>chaque(null,err||new Error('gps')),options);
    return true;
  }
  return false;
}

// ── La permission de localisation ──────────────────────
// 'accordee' (précise OU approximative : sous Android 12 la personne peut choisir « approximative »), 'refusee', 'a_demander', 'gps_desactive' (le GPS du
// téléphone est éteint : le plugin le signale par une erreur), 'inconnue'.
async function etatPermissionPosition(){
  const p=pluginPosition();
  if(p){
    try{
      const e=await p.checkPermissions();
      if(e&&(e.location==='granted'||e.coarseLocation==='granted')) return 'accordee';
      const attendre=s=>s==='prompt'||s==='prompt-with-rationale';
      return e&&(attendre(e.location)||attendre(e.coarseLocation))?'a_demander':'refusee';
    }catch(err){
      return /service|enabled|disabled|désactiv/i.test(String((err&&err.message)||err))?'gps_desactive':'inconnue';
    }
  }
  try{
    if(typeof navigator!=='undefined'&&navigator.permissions&&typeof navigator.permissions.query==='function'){
      const r=await navigator.permissions.query({name:'geolocation'});
      return r.state==='granted'?'accordee':(r.state==='denied'?'refusee':'a_demander');
    }
  }catch(err){}
  return 'inconnue';
}
// À la première ouverture après la connexion : UNE seule demande (jamais en plein punch). Sur le téléphone, la boîte du système s'ouvre ;
// dans un navigateur, c'est le navigateur qui la montre à la première lecture. Renvoie l'état de la permission.
async function demanderPermissionPosition(){
  if(_permissionDemandee) return _permissionPosition;
  _permissionDemandee=true;
  let e=await etatPermissionPosition();
  if(e==='a_demander'){
    const p=pluginPosition();
    if(p){
      try{await p.requestPermissions();}catch(err){}
      e=await etatPermissionPosition();
    }
  }
  _permissionPosition=e;
  return e;
}

// Ce que dit la confirmation du punch (« 📍 … »). N'utilise JAMAIS « ⚠ » : un quart sans position n'est pas une erreur.
function textePosition(pos){
  if(pos){
    const prec=pos.precision!=null?' (±'+Math.round(pos.precision)+' m)':'';
    return '📍 '+(pos.source==='recente'?'Dernière position connue':'Position enregistrée')+prec;
  }
  if(_permissionPosition==='refusee') return '📍 Sans position : la localisation est refusée pour cette application';
  if(_permissionPosition==='gps_desactive') return '📍 Sans position : le GPS du téléphone est désactivé';
  return '📍 Sans position : le GPS n’a pas répondu';
}
