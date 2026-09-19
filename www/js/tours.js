// js/tours.js — Tours en cours : l'état « fait » d'un arrêt vient de la passe en cours (étape 13), plus de la colonne stops.fait
//
// Un TOUR = une route + une tâche (le type de service des arrêts) + un numéro de passe.
// Deux camions qui font la même tâche sur la même route partagent le même tour (mêmes arrêts faits, même pourcentage).
// Un camion qui fait une autre tâche a son propre tour. Le serveur (fonction tours_en_cours) donne la même réponse à tous les employés.
let tours=[];            // [{route_id, tache, numero, total, faits, pourcentage, arrets_faits:[id…], passes:[{passe_id, je_suis_chauffeur, je_suis_a_bord…}]}]
let _faitsParTour={};    // « route|tâche » -> Set des identifiants d'arrêts faits dans le tour en cours
let _tRechargeTours=null;

function cleTour(routeId,tache){return String(routeId)+'|'+String(tache);}

// Lit les tours en cours. En cas d'échec (pas de réseau…), on GARDE ce qu'on savait : mieux vaut un écran un peu ancien
// qu'un écran vide pendant une tempête. Renvoie true si la lecture a réussi.
async function chargerTours(){
  let lus;
  try{
    const{data,error}=await db.rpc('tours_en_cours');
    if(error) throw error;
    lus=Array.isArray(data)?data:[];
  }catch(e){
    return false;
  }
  tours=lus;
  _faitsParTour={};
  tours.forEach(t=>{_faitsParTour[cleTour(t.route_id,t.tache)]=new Set(t.arrets_faits||[]);});
  return true;
}

// Le tour en cours d'un arrêt (même route, même type de service), sinon null
function tourDe(s){
  return tours.find(t=>t.route_id===s.route_id&&t.tache===s.service)||null;
}
function estFait(s){
  const f=_faitsParTour[cleTour(s.route_id,s.service)];
  return !!(f&&f.has(s.id));
}

// Les arrêts affichés : une route choisie, ou toutes les routes ensemble
function arretsVisibles(){
  return routeActive===null?stops:stops.filter(s=>s.route_id===routeActive);
}

// Avancement de ce qui est affiché : seulement les arrêts qui font partie d'un tour en cours
function progression(){
  const vus=arretsVisibles().filter(s=>tourDe(s));
  const faits=vus.filter(estFait).length;
  return {total:vus.length,faits,pct:vus.length?Math.round(100*faits/vus.length):0,aucune:vus.length===0};
}

// Ce que le bouton « Complété » de la fiche doit montrer et permettre
function etatComplete(s){
  if(estFait(s)) return {texte:'✔ Déjà complété',classe:'scb done2',actif:false};
  const t=tourDe(s);
  if(!t) return {texte:'Aucune passe',classe:'scb done2',actif:false,explication:'Aucune passe en cours pour ce type de service : il faut d’abord débuter une passe.'};
  const p=t.passes.find(x=>x.je_suis_chauffeur);
  if(!p) return {texte:'Chauffeur seulement',classe:'scb done2',actif:false,explication:'Seul le chauffeur de la passe peut compléter un arrêt.'};
  return {texte:'✔ Complété',classe:'scb done',actif:true,passeId:p.passe_id};
}

// Phrase courte sous l'adresse, dans la fiche
function texteTour(s){
  const t=tourDe(s);
  if(!t) return 'Aucune passe en cours pour ce type de service';
  return 'Passe n° '+t.numero+' · '+t.faits+'/'+t.total+' ('+t.pourcentage+' %)'+(estEnCours(s)?' · 🚜 camion sur place':'');
}

// ── CLIENT « EN COURS » (étape 13c) ────────────────────
// Un client est « en cours » quand un camion de SON tour (même route, même tâche) est sur place, arrêt pas encore fait.
// Les positions viennent de la table positions : une ligne par camion en passe, écrite par le téléphone du chauffeur seulement,
// lisible par tous les employés. Arriver chez un client NE le complète PAS (le chauffeur touche « Complété »).
let positionsVehicules=[];   // [{passe_id, lat, lon, precision_m, maj_le}]
let _tRechargePositions=null;
let _minuterieEnCours=null;
let _sigEnCours='';          // ce qui est dessiné en ce moment (pour ne redessiner que si quelque chose change)

// Distance en mètres entre deux points GPS
function distanceMetres(lat1,lon1,lat2,lon2){
  const R=6371000;
  const dLat=(lat2-lat1)*Math.PI/180;
  const dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)*Math.sin(dLat/2)+
    Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*
    Math.sin(dLon/2)*Math.sin(dLon/2);
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

// Lit les positions des camions. En cas d'échec, on garde les dernières connues (elles expirent d'elles-mêmes après 3 minutes).
async function chargerPositionsVehicules(){
  try{
    const{data,error}=await db.from('positions').select('passe_id, lat, lon, precision_m, maj_le');
    if(error) throw error;
    positionsVehicules=Array.isArray(data)?data:[];
    return true;
  }catch(e){
    return false;
  }
}

// Une position compte si elle est récente et assez précise (précision inconnue : acceptée)
function positionCompte(p,maintenant){
  const age=maintenant-Date.parse(p.maj_le);
  if(!(age<=POSITION_PERIMEE_MIN*60000)) return false;                  // trop vieille, ou date illisible
  if(p.precision_m!=null&&p.precision_m>PRECISION_MAX_M) return false;   // GPS trop imprécis
  return true;
}

function estEnCours(s){
  if(!s.lat||!s.lon) return false;
  if(estFait(s)) return false;
  const t=tourDe(s);
  if(!t) return false;
  const passes=t.passes.map(p=>p.passe_id);
  const maintenant=Date.now();
  return positionsVehicules.some(p=>passes.includes(p.passe_id)&&positionCompte(p,maintenant)
    &&distanceMetres(p.lat,p.lon,s.lat,s.lon)<=RAYON_EN_COURS_M);
}

// UNE seule règle de couleur pour les marqueurs ET les zones : problème (orange) > en cours (bleu) > fait (vert) > à faire (jaune)
function couleurEtat(fait,probleme,enCours){
  return probleme?'#fb923c':(enCours?'#60a5fa':(fait?'#4ade80':'#c8e63c'));
}

// Identifie l'ensemble des clients « en cours » (pour ne redessiner la carte que si cet ensemble change)
function signatureEnCours(){
  return stops.filter(estEnCours).map(s=>s.id).sort().join(',');
}
// Relit les positions ; ne redessine que si un client entre ou sort de l'état « en cours »
async function rafraichirEnCours(){
  if(!currentUser) return;
  await chargerPositionsVehicules();
  if(signatureEnCours()!==_sigEnCours){ renderAll(); majCarte(); }
}
// Changements de positions reçus en temps réel : on relit une seule fois même si plusieurs arrivent d'un coup
function planifierRechargementPositions(){
  clearTimeout(_tRechargePositions);
  _tRechargePositions=setTimeout(rafraichirEnCours,500);
}
// Relecture de secours (temps réel manqué) ; fait aussi expirer les positions périmées
function demarrerRelecturePositions(){
  if(_minuterieEnCours) return;
  _minuterieEnCours=setInterval(rafraichirEnCours,RELECTURE_POSITIONS_S*1000);
}

// Messages en français pour les refus du serveur
function messageErreurGeste(e){
  const m=String((e&&e.message)||'');
  const connus={
    non_autorise:'Seul le chauffeur de la passe peut faire ça.',
    passe_introuvable:'Cette passe n’existe plus.',
    arret_hors_route:'Cet arrêt n’est pas sur la route de la passe.',
    arret_hors_tache:'Cet arrêt n’a pas le même type de service que la passe.',
    delai_depasse:'Trop tard pour annuler (plus de 10 minutes).',
    impossible_de_rouvrir:'Impossible : une nouvelle passe est déjà commencée.'
  };
  for(const k in connus){ if(m.includes(k)) return connus[k]; }
  return 'Pas de réseau ou erreur. Réessaie.';
}

// Quand une passe ou un arrêt complété change (sur n'importe quel téléphone), on relit les tours une seule fois
// même si plusieurs changements arrivent d'un coup.
function planifierRechargementTours(){
  clearTimeout(_tRechargeTours);
  _tRechargeTours=setTimeout(async()=>{
    if(!currentUser) return;
    if(await chargerTours()){ renderAll(); majCarte(); }
  },300);
}
