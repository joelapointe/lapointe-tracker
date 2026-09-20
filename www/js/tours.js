// js/tours.js — Tours en cours : l'état « fait » d'un arrêt vient de la passe en cours (étape 13), plus de la colonne stops.fait
//
// Un TOUR = une route + une tâche (le type de service des arrêts) + un numéro de passe.
// Deux camions qui font la même tâche sur la même route partagent le même tour (mêmes arrêts faits, même pourcentage).
// Un camion qui fait une autre tâche a son propre tour. Le serveur (fonction tours_en_cours) donne la même réponse à tous les employés.
let tours=[];            // [{route_id, tache, numero, total, faits, pourcentage, arrets_faits:[id…], passes:[{passe_id, je_suis_chauffeur, je_suis_a_bord…}]}]
let _faitsParTour={};    // « route|tâche » -> Set des identifiants d'arrêts faits dans le tour en cours
let _tRechargeTours=null;
let _toursLusLe=0;       // heure (de ce téléphone) de la dernière lecture réussie : sert à faire avancer le délai d'annulation

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
    signalerEchecReseau(e);
    return false;
  }
  installerTours(lus,Date.now());
  lectureReussie('tours',lus);
  return true;
}
// Met les tours en place (lecture du serveur, ou copie gardée sur le téléphone : luLe = l'heure de cette lecture).
// Étape 16c : les gestes faits sans réseau et pas encore envoyés (file-attente.js) sont posés PAR-DESSUS la copie du serveur : tout l'écran
// (arrêts faits, pourcentage, ma passe…) montre donc le résultat du geste, et aucune relecture ne peut le défaire tant que le geste attend.
let _toursServeur=[];    // la copie du serveur, telle quelle (jamais modifiée : c'est elle qu'on garde en copie locale)
let _toursServeurConnus=false;
function installerTours(lus,luLe){
  _toursServeur=lus;
  _toursServeurConnus=true;
  _toursLusLe=luLe>0?luLe:Date.now();
  poserTours(superposerTours(lus,_toursLusLe));
}
// Un geste vient d'être gardé (ou retiré) : on refait la superposition à partir de la copie du serveur
function reappliquerGestes(){
  if(_toursServeurConnus) poserTours(superposerTours(_toursServeur,_toursLusLe));   // (sinon les tours n'ont pas encore été lus : rien à superposer)
  if(typeof poserProblemes==='function') poserProblemes();   // les problèmes signalés sans réseau (problemes.js)
}
function poserTours(t){
  tours=t;
  _faitsParTour={};
  tours.forEach(x=>{_faitsParTour[cleTour(x.route_id,x.tache)]=new Set(x.arrets_faits||[]);});
  if(typeof poserEquipages==='function') poserEquipages();   // l'équipage à bord suit les passes affichées (vehicules.js)
}
// Le numéro d'une passe débutée sans réseau est PROVISOIRE (le serveur le donne au retour du signal)
function numeroPasse(t){return String(t.numero)+(t.numero_a_confirmer?' (à confirmer)':'');}

// ── Les gestes en attente, posés par-dessus la copie du serveur (étape 16c) ──
// Règles : (1) on ne touche JAMAIS à la copie du serveur (on travaille sur une copie de la copie) ; (2) chaque geste est REPÉTABLE sans doublon :
// si le serveur a déjà fait le geste (sa réponse s'est perdue), il ne compte pas deux fois ; (3) on imite ce que ferait le serveur.
function recalculerTour(t){
  t.arrets_faits=t.arrets_faits||[];
  t.faits=t.arrets_faits.length;
  t.pourcentage=t.total>0?Math.round(100*t.faits/t.total):0;
}
function tourDeLaPasse(lus,passeId){
  return lus.find(t=>tourEnCours(t)&&(t.passes||[]).some(p=>p.passe_id===passeId))||null;
}
// Un tour est terminé (100 % atteint) : on garde ce qu'il faut pour le rouvrir si un arrêt est annulé
function fermerTourLocalement(t,passeId){
  const p=(t.passes||[]).find(x=>x.passe_id===passeId);
  t._passesFermees=t.passes;
  t.en_cours=false;
  t.passes=[];
  t.mes_passes_annulables=(p&&p.je_suis_chauffeur)?[passeId]:[];
}
function appliquerGesteAuxTours(lus,g,luLe){
  const a=g.args||{};
  if(g.type==='completer_arret'){
    const t=tourDeLaPasse(lus,a.passeId);
    if(!t) return;   // passe introuvable ou déjà terminée : le serveur tranchera au retour du signal
    if(!t.arrets_faits.includes(a.stopId)){
      t.arrets_faits.push(a.stopId);
      // L'âge de l'arrêt, comme le donne le serveur (en secondes, depuis la lecture) : le délai de 10 minutes se compte depuis l'heure du GESTE
      t.faits_il_y_a=t.faits_il_y_a||{};
      t.faits_il_y_a[a.stopId]=(luLe-Date.parse(g.moment))/1000;
    }
    recalculerTour(t);
    if(t.total>0&&t.faits>=t.total) fermerTourLocalement(t,a.passeId);   // 100 % : le serveur ferme la passe, on fait de même
  }else if(g.type==='annuler_arret'){
    let t=tourDeLaPasse(lus,a.passeId);
    if(!t){
      // Une passe fermée à 100 % (par le serveur ou par nous) : « Annuler » la rouvre, tant que c'est MA passe
      t=lus.find(x=>!tourEnCours(x)&&(x.mes_passes_annulables||[]).includes(a.passeId))||null;
      if(!t||!t.arrets_faits.includes(a.stopId)) return;
      const avant=t._passesFermees||[{passe_id:a.passeId,equipe_id:null,je_suis_chauffeur:true,je_suis_a_bord:true}];
      t.en_cours=true;
      t.passes=avant;
      t.mes_passes_annulables=[];
      delete t._passesFermees;
    }
    t.arrets_faits=t.arrets_faits.filter(x=>x!==a.stopId);
    if(t.faits_il_y_a) delete t.faits_il_y_a[a.stopId];
    recalculerTour(t);
  }else if(g.type==='terminer_passe'){
    const t=tourDeLaPasse(lus,a.passeId);
    if(!t) return;   // déjà terminée : rien à faire
    t.passes=t.passes.filter(p=>p.passe_id!==a.passeId);
    if(!t.passes.length) t.en_cours=false;   // plus aucun camion : le tour reste affiché, terminé (étape 14c) ; les autres camions le continuent
  }else if(g.type==='debuter_passe'){
    debuterLocalement(lus,a);
  }
}
// « Débuter la passe » : ma passe apparaît, dans le tour déjà en cours (la personne le rejoint) ou dans un nouveau tour.
// Comme le serveur : ma passe précédente et celle du véhicule sont terminées ; un tour TERMINÉ ne se rejoint pas (il est remplacé).
function debuterLocalement(lus,a){
  if(lus.some(t=>(t.passes||[]).some(p=>p.passe_id===a.passeId))) return;   // le serveur l'a déjà (sa réponse s'est perdue) : pas deux fois
  lus.forEach(t=>{
    if(!tourEnCours(t)) return;
    const restent=t.passes.filter(p=>!(p.je_suis_chauffeur||p.equipe_id===a.equipeId));
    if(restent.length!==t.passes.length){t.passes=restent;if(!restent.length) t.en_cours=false;}
  });
  const passe={passe_id:a.passeId,equipe_id:a.equipeId,chauffeur_id:currentUser?currentUser.id:null,je_suis_chauffeur:true,je_suis_a_bord:true};
  const rejoint=lus.find(x=>tourEnCours(x)&&x.route_id===a.routeId&&x.tache===a.tache);
  if(rejoint){rejoint.passes.push(passe);return;}
  const ancien=lus.find(x=>x.route_id===a.routeId&&x.tache===a.tache)||null;   // le dernier tour de cette route et de cette tâche (terminé)
  const total=stops.filter(s=>s.route_id===a.routeId&&s.actif!==false&&s.service===a.tache).length;
  const neuf={route_id:a.routeId,tache:a.tache,numero:(ancien&&Number(ancien.numero)>0?Number(ancien.numero):0)+1,numero_a_confirmer:true,en_cours:true,
    total,faits:0,pourcentage:0,arrets_faits:[],faits_il_y_a:{},mes_passes_annulables:[],passes:[passe]};
  if(ancien) lus.splice(lus.indexOf(ancien),1,neuf); else lus.push(neuf);
}
// Renvoie la copie du serveur si rien n'attend, sinon une COPIE où les gestes en attente sont appliqués, dans l'ordre où ils ont été faits
function superposerTours(lus,luLe){
  const attente=(typeof gestesEnAttente==='function')?gestesEnAttente():[];
  if(!attente.length) return lus;
  const copie=JSON.parse(JSON.stringify(lus));
  copie.forEach(t=>{t.arrets_faits=t.arrets_faits||[];t.passes=t.passes||[];});
  attente.forEach(g=>{try{appliquerGesteAuxTours(copie,g,luLe);}catch(e){}});
  return copie;
}
// Un geste sur cet arrêt attend d'être envoyé ? (pour le petit ⏳ de la fiche et de la liste)
function arretEnAttente(s){
  return typeof gestesEnAttente==='function'&&gestesEnAttente().some(g=>(g.type==='completer_arret'||g.type==='annuler_arret')&&g.args&&g.args.stopId===s.id);
}

// Étape 14c (décision de Joé) : quand une passe est terminée, son tour RESTE affiché (arrêts faits en vert, avancement)
// jusqu'à ce qu'une nouvelle passe débute sur la même route et la même tâche. Un tour terminé n'a plus aucun camion (passes vide).
function tourEnCours(t){return !!t&&t.en_cours!==false;}

// Le tour d'un arrêt (même route, même type de service : en cours, sinon le dernier tour terminé), sinon null
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
  return {total:vus.length,faits,pct:vus.length?Math.round(100*faits/vus.length):0,aucune:vus.length===0,enCours:vus.some(s=>tourEnCours(tourDe(s)))};
}

// « Annuler » un arrêt complété par erreur : 10 minutes (règle du serveur), pour le chauffeur du tour. L'âge de chaque arrêt vient du SERVEUR
// (faits_il_y_a, en secondes) : l'horloge du téléphone n'entre pas en jeu, sauf pour le temps écoulé depuis la lecture.
const DELAI_ANNULER_S=600;
function peutAnnuler(s){
  if(!estFait(s)) return null;
  const t=tourDe(s);
  if(!t||!t.faits_il_y_a) return null;
  const age=t.faits_il_y_a[s.id];
  if(age==null) return null;
  const reste=DELAI_ANNULER_S-Number(age)-(Date.now()-_toursLusLe)/1000;
  if(!(reste>0)) return null;
  // Tour en cours : ma passe (je suis chauffeur). Tour terminé : une de MES passes terminées à 100 % (le serveur ne les donne qu'à leur chauffeur).
  const passeId=tourEnCours(t)?((t.passes.find(x=>x.je_suis_chauffeur)||{}).passe_id||null):((t.mes_passes_annulables||[])[0]||null);
  return passeId?{passeId,reste,tour:t}:null;
}

// Ce que le bouton « Complété » de la fiche doit montrer et permettre
function etatComplete(s){
  if(estFait(s)){
    const a=peutAnnuler(s);
    if(a) return {texte:'↩ Annuler ('+Math.max(1,Math.ceil(a.reste/60))+' min)',classe:'scb annulable',actif:true,action:'annuler',passeId:a.passeId,termine:!tourEnCours(a.tour)};
    return {texte:'✔ Déjà complété',classe:'scb done2',actif:false};
  }
  const t=tourDe(s);
  if(!t) return {texte:'Aucune passe',classe:'scb done2',actif:false,explication:'Aucune passe en cours pour ce type de service : il faut d’abord débuter une passe.'};
  if(!tourEnCours(t)) return {texte:'Passe terminée',classe:'scb done2',actif:false,explication:'Cette passe est terminée : il faut débuter une nouvelle passe.'};
  const p=t.passes.find(x=>x.je_suis_chauffeur);
  if(!p) return {texte:'Chauffeur seulement',classe:'scb done2',actif:false,explication:'Seul le chauffeur de la passe peut compléter un arrêt.'};
  return {texte:'✔ Complété',classe:'scb done',actif:true,passeId:p.passe_id};
}

// Phrase courte sous l'adresse, dans la fiche
function texteTour(s){
  const t=tourDe(s);
  if(!t) return 'Aucune passe en cours pour ce type de service';
  const attente=arretEnAttente(s)?' · ⏳ en attente d’envoi':'';   // un geste sur cet arrêt attend le retour du signal (étape 16c)
  if(!tourEnCours(t)) return 'Passe n° '+numeroPasse(t)+' terminée · '+t.faits+'/'+t.total+' ('+t.pourcentage+' %)'+attente;
  return 'Passe n° '+numeroPasse(t)+' · '+t.faits+'/'+t.total+' ('+t.pourcentage+' %)'+(estEnCours(s)?' · 🚜 camion sur place':'')+attente;
}

// ── CLIENT « EN COURS » (étape 13c) ────────────────────
// Un client est « en cours » quand un camion de SON tour (même route, même tâche) est sur place, arrêt pas encore fait.
// Les positions viennent de la table positions : une ligne par camion en passe, écrite par le téléphone du chauffeur seulement,
// lisible par tous les employés. Arriver chez un client NE le complète PAS (le chauffeur touche « Complété »).
let positionsVehicules=[];   // [{passe_id, lat, lon, precision_m, maj_le}]
let _tRechargePositions=null;
let _minuterieEnCours=null;
let _sigEnCours='';          // ce qui est dessiné en ce moment (pour ne redessiner que si quelque chose change)
let _tickRelecture=0;

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
    serveurAtteint();
    return true;
  }catch(e){
    signalerEchecReseau(e);
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
  if(!tourEnCours(t)) return false;   // pas de tour, ou tour terminé : aucun camion n'y travaille
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
  _tickRelecture++;
  if(_tickRelecture%4===0) await chargerVehiculesEtEquipages();   // relecture de secours des équipages : une fois par minute
  if(signatureEnCours()!==_sigEnCours){ renderAll(); majCarte(); }
  else majVehicules();   // les camions bougent même quand aucun client ne change d'état
  if(activeIdx!==null) majCarte();   // le délai d'annulation d'un arrêt fait avance : le bouton « Annuler » disparaît de lui-même après 10 minutes
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
    passe_terminee:'Cette passe a été terminée : impossible d’annuler un arrêt.',
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
