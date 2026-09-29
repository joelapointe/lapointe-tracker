// js/suivi-carte.js — La carte SUIT le camion (demande de Joé, 23 sept. 2026 : « la carte ne se recentre pas toute seule, il faut encore la déplacer à la main »)
//
// Décisions de Joé (29 sept. 2026) : (1) le suivi s'allume TOUT SEUL au début de la passe — pour le chauffeur ET pour les passagers à bord — et s'éteint à sa fin ;
// en dehors d'une passe, seulement avec le bouton ◎ ; (2) l'administrateur a un bouton « 📌 Suivre ce camion » dans la bulle d'un camion ; (3) la carte qui TOURNE selon
// la direction de la route : plus tard, après l'essai réel (le plugin de rotation est déjà là).
//
// Suivre = la carte garde le point suivi AU CENTRE de l'écran, sans toucher au zoom (au départ, le zoom est d'au moins 16, comme l'ancien bouton ◎).
// Qui est suivi :
//   • le chauffeur (et toute personne qui touche ◎ hors d'une passe) : SON point vert, celui du GPS de son téléphone — instantané, et il marche sans réseau. Pendant sa passe
//     il reçoit une lecture par seconde du service de position du téléphone (position.js : noterPosition → majPointVert, plus bas), et non plus seulement la lecture lente
//     (5 à 15 secondes) du suivi de la carte ;
//   • un passager : le camion où il est à bord (la position que le serveur reçoit toutes les 3 secondes) ; l'administrateur : le camion qu'il choisit dans la bulle du camion.
// Le point (donc la carte) GLISSE d'une lecture à l'autre (vehicules.js : deplacerMarqueurCamion) au lieu de sauter.
// Le suivi s'arrête : quand on déplace la carte à la main ; quand la passe finit (s'il s'était allumé tout seul) ; quand le camion suivi disparaît ; en retouchant ◎.
// Il se met en PAUSE le temps qu'une fiche de client est ouverte (la carte va vers le client) et reprend à la fermeture, au zoom d'avant la fiche — sauf si on a déplacé la carte entre-temps.
// (Un pincement pour zoomer ne coupe pas le suivi : la carte se recentre sur le point à la fin du zoom.)
const SUIVI_ZOOM_MIN=16;          // au départ du suivi, le zoom est d'au moins 16 (l'ancien bouton ◎ zoomait à 16) ; jamais changé ensuite
const SUIVI_ZOOM_EXPIRE_MS=5000;  // un zoom dont la fin n'a jamais été reçue ne suspend pas le suivi plus de 5 secondes

let suiviCarte=null;              // null : la carte ne suit rien ; sinon {type:'moi'|'camion', passeId, auto, marqueur}  (marqueur : null tant que le point suivi n'est pas dessiné)
let _suiviSuspendu=null;          // le suivi mis en pause pendant qu'une fiche de client est ouverte : {type, passeId, auto}
let _passeSuivieAuto=null;        // la passe pour laquelle le suivi s'est allumé tout seul : UNE seule fois par passe (l'éteindre à la main est respecté, jamais rallumé)
let _suiviEcouteursCarte=false;   // les écouteurs de la carte (main sur la carte, zoom) ne sont posés qu'une fois
let _zoomDepuis=0;                // heure du début d'un zoom en cours (0 : aucun)

// Le marqueur que la carte doit garder au centre, s'il est dessiné : mon point vert (carte.js), ou le camion d'une passe (vehicules.js)
function marqueurSuivi(cible){
  if(!cible) return null;
  if(cible.type==='moi') return window._uMk||null;
  return (typeof marqueursVehicules==='object'&&marqueursVehicules&&marqueursVehicules[cible.passeId])||null;
}

// La carte se recentre sur le point suivi (appelée à chaque pas de son glissement, et à la fin d'un zoom). Sans animation : le point GLISSE déjà, la carte le suit d'un seul bloc.
function _suiviRecentrer(){
  if(!suiviCarte||!suiviCarte.marqueur||!map) return;
  if(_zoomDepuis&&Date.now()-_zoomDepuis<SUIVI_ZOOM_EXPIRE_MS) return;   // pendant un zoom (pincement), on laisse la carte tranquille : elle se recentre à la fin
  map.panTo(suiviCarte.marqueur.getLatLng(),{animate:false});
}
function _suiviZoomDebut(){_zoomDepuis=Date.now();}
function _suiviZoomFini(){_zoomDepuis=0;_suiviRecentrer();}
function _suiviMainSurLaCarte(){arreterSuiviCarte();}   // « dragstart » : la personne déplace la carte elle-même (un mouvement du code ne le déclenche jamais)

function installerSuiviCarte(){
  if(_suiviEcouteursCarte||!map) return;
  _suiviEcouteursCarte=true;
  map.on('dragstart',_suiviMainSurLaCarte);
  map.on('zoomstart',_suiviZoomDebut);
  map.on('zoomend',_suiviZoomFini);
}

// Se relie au marqueur de la cible et centre la carte dessus. S'il n'est pas encore dessiné, le suivi attend (suiviMarqueurCree).
// Le zoom : celui d'avant la fiche d'un client quand le suivi REPREND (la fiche rapproche la carte à 17), sinon le zoom actuel, d'au moins 16.
function _suiviAttacher(){
  installerSuiviCarte();
  if(!suiviCarte) return;
  const m=marqueurSuivi(suiviCarte);
  suiviCarte.marqueur=m;
  if(!m) return;
  m.on('move',_suiviRecentrer);
  const zoom=(typeof suiviCarte.zoomDepart==='number')?suiviCarte.zoomDepart:Math.max(map.getZoom(),SUIVI_ZOOM_MIN);
  map.setView(m.getLatLng(),zoom,{animate:false});
}
function _suiviDetacher(){
  const m=suiviCarte&&suiviCarte.marqueur;
  if(m&&typeof m.off==='function') m.off('move',_suiviRecentrer);
  if(suiviCarte) suiviCarte.marqueur=null;
}

function demarrerSuiviCarte(cible,options){
  if(!map||!cible) return false;
  _suiviDetacher();
  suiviCarte={type:cible.type,passeId:cible.passeId||null,auto:!!(options&&options.auto),zoomDepart:(options&&typeof options.zoom==='number')?options.zoom:null,marqueur:null};
  _suiviSuspendu=null;
  _suiviAttacher();
  majBoutonSuivi();
  return true;
}
function arreterSuiviCarte(){
  _suiviDetacher();
  suiviCarte=null;
  _suiviSuspendu=null;   // (déplacer la carte pendant qu'une fiche est ouverte : le suivi ne reprendra pas à la fermeture)
  majBoutonSuivi();
}

// Le bouton ◎ (index.html) est allumé quand la carte suit quelque chose
function majBoutonSuivi(){
  const b=document.getElementById('btn-suivi');
  if(!b) return;
  const actif=!!suiviCarte;
  b.classList[actif?'add':'remove']('on');
  b.setAttribute('aria-pressed',actif?'true':'false');
}

// ── La fiche d'un client (arrets.js : openCard / closeCard) : la carte va vers le client, le suivi attend ─────
function suspendreSuiviCarte(){
  if(!suiviCarte) return;
  _suiviSuspendu={type:suiviCarte.type,passeId:suiviCarte.passeId,auto:suiviCarte.auto,zoom:map?map.getZoom():null};   // (le zoom d'AVANT la fiche : elle rapproche la carte à 17)
  _suiviDetacher();
  suiviCarte=null;
  majBoutonSuivi();
}
function reprendreSuiviCarte(){
  if(!_suiviSuspendu) return;
  const c=_suiviSuspendu;
  demarrerSuiviCarte(c,{auto:c.auto,zoom:c.zoom});   // (efface _suiviSuspendu, recentre sur le point, au zoom d'avant la fiche)
}

// ── Le bouton ◎ ──────────────────────────────────────
// Ce que suit ◎ : MON point vert (chauffeur, ou hors d'une passe) ; un passager suit le camion où il est à bord, s'il est dessiné.
// (monBord : la passe où je suis PASSAGER, jamais celle que je conduis : le chauffeur suit donc toujours son propre point.)
function cibleSuiviParDefaut(){
  const bord=(typeof monBord==='function')?monBord():null;
  if(bord&&marqueurSuivi({type:'camion',passeId:bord.passe.passe_id})) return {type:'camion',passeId:bord.passe.passe_id};
  return {type:'moi'};
}
// ◎ : allume le suivi, ou l'éteint s'il est allumé. Renvoie true si le suivi est allumé après le toucher.
function basculerSuiviCarte(){
  if(suiviCarte){arreterSuiviCarte();return false;}
  const cible=cibleSuiviParDefaut();
  if(cible.type==='moi'&&!lastPos){toast('📍 Position du téléphone pas encore trouvée');return false;}
  return demarrerSuiviCarte(cible,{auto:false});
}

// ── Tout seul, au début de MA passe (chauffeur ou passager) ; éteint à sa fin ──────
// Appelée à chaque redessin du bandeau de la passe (passe.js : majBandeauPasse). Une seule fois par passe : le suivi éteint à la main n'est jamais rallumé.
function majSuiviSelonPasse(){
  if(!map) return;
  const m=(currentUser&&typeof maPasse==='function')?maPasse():null;
  const bord=(currentUser&&!m&&typeof monBord==='function')?monBord():null;
  const passeId=m?m.passe.passe_id:(bord?bord.passe.passe_id:null);
  if(passeId){
    if(_passeSuivieAuto===passeId) return;
    _passeSuivieAuto=passeId;
    demarrerSuiviCarte(m?{type:'moi'}:{type:'camion',passeId},{auto:true});
    return;
  }
  if(!_passeSuivieAuto) return;
  _passeSuivieAuto=null;   // ma passe est finie (ou je ne suis plus à bord)
  if(suiviCarte&&suiviCarte.auto) arreterSuiviCarte();
  else if(_suiviSuspendu&&_suiviSuspendu.auto) _suiviSuspendu=null;
}

// ── Les marqueurs qui naissent et disparaissent ──────
// Un marqueur vient d'être dessiné (mon point vert : carte.js ; un camion : vehicules.js) : si le suivi l'attendait, il s'y attache maintenant
function suiviMarqueurCree(){
  if(!suiviCarte||suiviCarte.marqueur) return;
  _suiviAttacher();
}
// Un camion vient de disparaître de la carte (sa passe est finie, ou il n'est plus affiché) : le suivre n'a plus de sens
function suiviCamionRetire(passeId){
  if(suiviCarte&&suiviCarte.type==='camion'&&suiviCarte.passeId===passeId) arreterSuiviCarte();
  else if(_suiviSuspendu&&_suiviSuspendu.type==='camion'&&_suiviSuspendu.passeId===passeId) _suiviSuspendu=null;
}

// ── L'administrateur : « 📌 Suivre ce camion » (bulle du camion, vehicules.js : htmlCamion) ──
function peutSuivreCamion(){return !!currentUser&&currentUser.role==='admin';}
function suiviCamionActif(passeId){return !!suiviCarte&&suiviCarte.type==='camion'&&suiviCarte.passeId===passeId;}
function basculerSuiviCamion(passeId){
  if(!peutSuivreCamion()) return;
  if(suiviCamionActif(passeId)) arreterSuiviCarte();
  else demarrerSuiviCarte({type:'camion',passeId},{auto:false});
  // Le texte du bouton, dans la bulle ouverte, se met à jour — APRÈS le toucher (setTimeout) : remplacer le bouton PENDANT son toucher fait fermer la bulle par Leaflet,
  // qui ne reconnaît plus un toucher venu de la bulle (le bouton n'est plus dans la page) et le prend pour un toucher sur la carte.
  if(typeof majVehicules==='function') setTimeout(majVehicules,0);
}

// ── Mon point vert : il GLISSE jusqu'à chaque lecture du GPS, d'où qu'elle vienne ─────────
// Appelée par position.js (noterPosition) à CHAQUE lecture : du suivi de la carte (lent : 5 à 15 s sur Android), du service de position du téléphone pendant MA passe
// (une par seconde) ou d'une lecture fraîche du punch. Le point (donc la carte, si elle le suit) glisse pendant l'écart réel entre deux lectures, comme les camions.
// Une lecture qui ne dépasse pas la précédente (la même lecture reçue de deux sources, ou une plus vieille arrivée en retard) est ignorée : elle couperait un glissement en cours.
function majPointVert(lat,lon,precision,quandMs){
  const m=window._uMk;
  if(!m||typeof m.setLatLng!=='function') return;   // pas encore dessiné : carte.js le crée à la première lecture du suivi de la carte
  if(m._majLeMs&&quandMs<=m._majLeMs) return;
  deplacerMarqueurCamion(m,lat,lon,quandMs);
  if(window._uCk&&typeof precision==='number') window._uCk.setRadius(precision);
}
