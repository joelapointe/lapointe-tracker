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
  return 'Passe n° '+t.numero+' · '+t.faits+'/'+t.total+' ('+t.pourcentage+' %)';
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
