// js/hors-reseau.js — Le mode hors réseau, étape 16a : démarrer et travailler sans signal avec ce qu'on savait
//
// Les rangs de la Mauricie ont des zones mortes : l'application doit s'ouvrir et servir sans signal.
//   • À chaque lecture réussie du serveur, on GARDE une copie sur le téléphone (par employé) : arrêts, routes, tours, camions et
//     équipages, problèmes, employés, véhicules, équipage précédent.
//   • Au démarrage sans signal, l'application s'ouvre avec ces copies ; une bande « 📴 Hors réseau · données de 14 h 05 » le dit.
//   • Le signal est détecté par les échecs de lecture, puis surveillé par une petite sonde (l'indication « en ligne » du téléphone
//     ment souvent en zone morte). Au retour du signal, tout est relu depuis le serveur, qui a le dernier mot.
//   • Les gestes faits sans signal sont gardés par la file d'attente (file-attente.js, étape 16b) ; les écrans qui s'en servent : étape 16c.
const CACHE_VERSION=1;            // change quand la forme des copies change : les anciennes sont alors ignorées
let SONDE_INTERVALLE_MS=10000;    // pendant qu'on est hors réseau : on vérifie toutes les 10 secondes si le signal est revenu
let SONDE_DELAI_MS=5000;          // une sonde qui ne répond pas en 5 secondes = pas de signal
let reseau={enLigne:true,donneesDe:null,derniereLecture:null,sonde:null,sondeEnCours:false};   // donneesDe : date des données affichées quand on est hors réseau

// ── Le stockage du téléphone (IndexedDB) ───────────────
// Sans IndexedDB (ou s'il refuse), on garde en mémoire vive : l'application marche, mais rien ne survit à sa fermeture.
let _idb=null;
const _memoire={};
function _ouvrirBase(){
  return new Promise(resolve=>{
    try{
      if(typeof indexedDB==='undefined'||!indexedDB){resolve(null);return;}
      const r=indexedDB.open('lapointe-tracker',1);
      r.onupgradeneeded=()=>{r.result.createObjectStore('kv');};
      r.onsuccess=()=>resolve(r.result);
      r.onerror=()=>resolve(null);
      r.onblocked=()=>resolve(null);
    }catch(e){resolve(null);}
  });
}
async function _base(){
  if(_idb===null) _idb=(await _ouvrirBase())||false;
  return _idb||null;
}
// Le stockage garde-t-il vraiment sur le téléphone (IndexedDB), ou seulement en mémoire vive ?
async function magasinDurable(){return !!(await _base());}
async function magasinEcrire(cle,valeur){
  const b=await _base();
  if(!b){_memoire[cle]=valeur;return true;}
  return new Promise(resolve=>{
    try{
      const tx=b.transaction('kv','readwrite');
      tx.objectStore('kv').put(valeur,cle);
      tx.oncomplete=()=>resolve(true);
      tx.onerror=tx.onabort=()=>resolve(false);
    }catch(e){resolve(false);}
  });
}
async function magasinLire(cle){
  const b=await _base();
  if(!b) return Object.prototype.hasOwnProperty.call(_memoire,cle)?_memoire[cle]:undefined;
  return new Promise(resolve=>{
    try{
      const r=b.transaction('kv','readonly').objectStore('kv').get(cle);
      r.onsuccess=()=>resolve(r.result);
      r.onerror=()=>resolve(undefined);
    }catch(e){resolve(undefined);}
  });
}
// Toutes les valeurs dont la clé commence par « prefixe », dans l'ordre des clés : [{cle, valeur}] (ou null si le stockage a échoué)
async function magasinLister(prefixe){
  const b=await _base();
  if(!b) return Object.keys(_memoire).filter(k=>k.startsWith(prefixe)).sort().map(k=>({cle:k,valeur:_memoire[k]}));
  return new Promise(resolve=>{
    try{
      const sortie=[];
      const cur=b.transaction('kv','readonly').objectStore('kv').openCursor(IDBKeyRange.bound(prefixe,prefixe+String.fromCharCode(65535)));
      cur.onsuccess=()=>{
        const c=cur.result;
        if(!c){resolve(sortie);return;}
        sortie.push({cle:String(c.key),valeur:c.value});
        c.continue();
      };
      cur.onerror=()=>resolve(null);
    }catch(e){resolve(null);}
  });
}
// Retire UNE clé (exactement celle-là)
async function magasinRetirer(cle){
  const b=await _base();
  if(!b){delete _memoire[cle];return true;}
  return new Promise(resolve=>{
    try{
      const tx=b.transaction('kv','readwrite');
      tx.objectStore('kv').delete(cle);
      tx.oncomplete=()=>resolve(true);
      tx.onerror=tx.onabort=()=>resolve(false);
    }catch(e){resolve(false);}
  });
}
// Efface toutes les clés qui commencent par « prefixe »
async function magasinEffacer(prefixe){
  const b=await _base();
  if(!b){Object.keys(_memoire).forEach(k=>{if(k.startsWith(prefixe)) delete _memoire[k];});return true;}
  return new Promise(resolve=>{
    try{
      const tx=b.transaction('kv','readwrite');
      const st=tx.objectStore('kv');
      const cur=st.openCursor();
      cur.onsuccess=()=>{
        const c=cur.result;
        if(!c) return;
        if(String(c.key).startsWith(prefixe)) c.delete();
        c.continue();
      };
      tx.oncomplete=()=>resolve(true);
      tx.onerror=tx.onabort=()=>resolve(false);
    }catch(e){resolve(false);}
  });
}

// ── Les copies des lectures du serveur ─────────────────
// Une copie par employé (« cache:<numéro>:<nom> ») : sur un téléphone partagé, chacun retrouve SES données (ex. « je suis chauffeur »).
const _ecritures=new Set();   // les écritures en cours (les essais les attendent)
function cleCache(nom){return 'cache:'+(currentUser?currentUser.id:'?')+':'+nom;}
function cacheEcrire(nom,data){
  if(!currentUser) return Promise.resolve(false);
  const p=magasinEcrire(cleCache(nom),{v:CACHE_VERSION,le:new Date().toISOString(),data}).catch(()=>false);
  _ecritures.add(p);
  p.then(()=>_ecritures.delete(p),()=>_ecritures.delete(p));
  return p;
}
async function attendreEcritures(){await Promise.all(Array.from(_ecritures));}
// Renvoie {data, le} ou null (rien, ou copie illisible / d'une autre version)
async function cacheLire(nom){
  if(!currentUser) return null;
  try{
    const c=await magasinLire(cleCache(nom));
    if(!c||c.v!==CACHE_VERSION||typeof c.le!=='string'||!('data' in c)) return null;
    return {data:c.data,le:c.le};
  }catch(e){return null;}
}
async function effacerCache(){
  try{await attendreEcritures();await magasinEffacer('cache:');}catch(e){}
}

// Une lecture du serveur a réussi : on en garde la copie et on sait que le signal est là
function lectureReussie(nom,data){
  cacheEcrire(nom,data);
  serveurAtteint();
}

// ── Le signal ──────────────────────────────────────────
// Un échec de RÉSEAU (pas un refus du serveur : « accès refusé » n'est pas une zone morte)
function estErreurReseau(e){
  if(!e) return false;
  const m=String((e&&(e.message||e.error_description||e.error))||e);
  if(e.name==='AuthRetryableFetchError') return true;
  if(e.status===0) return true;
  return /failed to fetch|networkerror|network request failed|network error|load failed|fetch failed|err_internet|err_network|timed out|timeout|aborted|econn/i.test(m);
}
function signalerEchecReseau(e){
  if(estErreurReseau(e)) marquerHorsReseau();
}
function serveurAtteint(){
  reseau.derniereLecture=new Date().toISOString();
  if(!reseau.enLigne) marquerEnLigne(true);
}

function heureCourte(iso){
  const d=new Date(iso);
  if(isNaN(d.getTime())) return '';
  try{return d.toLocaleTimeString('fr-CA',{hour:'2-digit',minute:'2-digit'});}
  catch(e){return d.toISOString().slice(11,16);}
}
function texteBandeauReseau(){
  return '📴 Hors réseau'+(reseau.donneesDe?' · données de '+heureCourte(reseau.donneesDe):'');
}
// La bande du haut dit deux choses : « hors réseau » (16a) et les gestes qui attendent (16b, file-attente.js). Elle s'ouvre sur la liste des gestes.
function majBandeauReseau(){
  const b=document.getElementById('bandeau-reseau');
  if(!b) return;
  const lignes=[];
  if(currentUser){
    if(!reseau.enLigne) lignes.push(texteBandeauReseau());
    if(typeof texteBandeauFile==='function') lignes.push(...texteBandeauFile());
  }
  if(!lignes.length){
    b.textContent='';
    b.classList.remove('show','actif');
  }else{
    b.textContent=lignes.join(' · ');
    b.classList.add('show');
    const cliquable=typeof fileAGestes==='function'&&fileAGestes();
    b.classList.toggle('actif',!!cliquable);
    b.onclick=cliquable?()=>ouvrirListeGestes():null;
  }
}

function marquerHorsReseau(){
  if(reseau.enLigne){
    reseau.enLigne=false;
    if(!reseau.donneesDe) reseau.donneesDe=reseau.derniereLecture||new Date().toISOString();   // l'heure de la dernière lecture réussie
  }
  majBandeauReseau();
  demarrerSonde();
}
// Une seule sonde à la fois
function demarrerSonde(){
  if(reseau.sonde) return;
  reseau.sonde=setInterval(sonderReseau,SONDE_INTERVALLE_MS);
}
function arreterSonde(){
  if(reseau.sonde){clearInterval(reseau.sonde);reseau.sonde=null;}
}
// Le serveur répond-il ? N'importe quelle réponse (même un refus) prouve que le signal est là.
async function serveurJoignable(){
  let temps=null;
  try{
    const c=(typeof AbortController!=='undefined')?new AbortController():null;
    if(c) temps=setTimeout(()=>c.abort(),SONDE_DELAI_MS);
    const r=await fetch(SUPA_URL+'/auth/v1/health',{headers:{apikey:SUPA_KEY},cache:'no-store',signal:c?c.signal:undefined});
    return !!(r&&typeof r.status==='number'&&r.status>0);
  }catch(e){
    return false;
  }finally{
    if(temps) clearTimeout(temps);
  }
}
async function sonderReseau(){
  if(reseau.sondeEnCours||reseau.enLigne) return;
  reseau.sondeEnCours=true;
  try{
    if(await serveurJoignable()) await marquerEnLigne(true);
  }finally{
    reseau.sondeEnCours=false;
  }
}
// UN SEUL rechargement de retour à la fois : sur un réseau PARTIEL (une lecture réussit, une autre échoue), « je suis en ligne » ne doit pas
// relancer un rechargement complet qui échoue, qui relance… (boucle qui martèlerait le serveur). La sonde reprend alors son rythme de 10 secondes.
let _retourEnCours=false;
async function marquerEnLigne(retour){
  const etaitHors=!reseau.enLigne;
  reseau.enLigne=true;
  reseau.donneesDe=null;
  arreterSonde();
  majBandeauReseau();
  if(etaitHors&&retour&&currentUser&&!_retourEnCours){
    _retourEnCours=true;
    try{await apresRetourReseau();}finally{_retourEnCours=false;}
    if(!reseau.enLigne) demarrerSonde();   // (le rechargement a de nouveau constaté l'absence de signal)
  }
}
// Le signal est de retour : d'abord les gestes faits sans réseau (file-attente.js, dans l'ordre), puis on relit tout depuis le serveur, qui a le dernier mot.
async function apresRetourReseau(){
  if(typeof rejouerFile==='function'){
    try{await rejouerFile();}catch(e){}
    if(!reseau.enLigne) return;   // le signal a de nouveau disparu pendant l'envoi : la sonde reprend, on ne relit pas
  }
  try{await loadStops();}catch(e){}
}

// ── Démarrer sans signal : rouvrir les copies ──────────
// Renvoie true si on a de quoi afficher (au moins les arrêts et les routes)
async function restaurerDepuisCache(){
  await attendreEcritures();   // les copies écrites à l'instant doivent être lisibles
  // Les gestes gardés sur ce téléphone (étape 16c) : relus AVANT de poser les copies, pour que l'écran montre leur résultat dès l'ouverture
  if(typeof assurerChargee==='function'){try{await enSerie(assurerChargee);}catch(e){}}
  const lire={};
  for(const nom of ['stops','routes','tours','vehicules','problemes','employes','quart']) lire[nom]=await cacheLire(nom);
  if(!lire.stops||!lire.routes||!Array.isArray(lire.stops.data)||!Array.isArray(lire.routes.data)) return false;
  stops=lire.stops.data;
  routes=lire.routes.data;
  restaurerRouteChoisie();
  if(lire.tours&&Array.isArray(lire.tours.data)) installerTours(lire.tours.data,Date.parse(lire.tours.le));
  else installerTours([],Date.now());
  if(lire.vehicules&&lire.vehicules.data){
    nomsVehicules=lire.vehicules.data.noms||{};
    installerEquipages(lire.vehicules.data.equipages||{});
  }
  if(typeof _passeVue!=='undefined') _passeVue=null;   // les tours changent parce qu'on relit une COPIE, pas parce que ma passe s'est fermée : jamais de faux « Passe terminée »
  installerProblemes((lire.problemes&&Array.isArray(lire.problemes.data))?lire.problemes.data:[]);
  employes=(lire.employes&&Array.isArray(lire.employes.data))?lire.employes.data:[];
  if(typeof restaurerReglagesQuart==='function') await restaurerReglagesQuart();   // rappel, pause : la dernière valeur connue (elle ne compte pas dans « données de … »)
  if(lire.quart&&typeof installerQuart==='function') installerQuart(lire.quart.data||null);   // suis-je en service ? (la copie « null » = pas en service)
  positionsVehicules=[];   // les positions ne se gardent pas : un point de plus de 3 minutes ne veut plus rien dire
  // Les données affichées valent ce que vaut la plus VIEILLE des copies (honnêteté)
  const dates=Object.values(lire).filter(Boolean).map(c=>Date.parse(c.le)).filter(t=>t>0);
  reseau.enLigne=true;   // (marquerHorsReseau la fera passer à « hors réseau »)
  reseau.donneesDe=dates.length?new Date(Math.min(...dates)).toISOString():new Date().toISOString();
  marquerHorsReseau();
  return true;
}
