// js/ordre.js — Étape 18b : l'ORDRE des clients d'une route, le « prochain client », et le parcours dans Google Maps
//
// Décisions de Joé (21 septembre 2026, après son essai sur téléphone) :
//   • « appuyer sur le nombre de clients pour voir la liste que je pourrais placer selon un ordre précis » : la liste (liste-arrets.js) suit l'ordre de la route ;
//     SEUL L'ADMINISTRATEUR le change (flèches ↑ ↓) ; les employés le voient sans pouvoir le changer.
//   • La navigation reste GOOGLE MAPS (pas de navigation maison) : un bouton ouvre les prochains clients, dans l'ordre choisi, comme étapes d'un seul trajet.
// L'ordre est la colonne « ordre » de la table « stops » (déjà là ; règle stops_admin : l'administrateur peut la modifier ; aucun SQL). Elle est GLOBALE (pas par route) :
// pour déplacer un client, on ÉCHANGE les valeurs d'ordre de deux clients de la même route (deux lignes seulement).
// Le « prochain client » = le premier arrêt PAS ENCORE FAIT de la route et du type de service de MA passe (ou de celle du camion où je suis passager), dans l'ordre.
const MAX_ETAPES_GOOGLE=10;   // Google Maps accepte 9 étapes intermédiaires + l'arrivée dans un lien
let _deplacementEnCours=false;

function valeurOrdre(s){
  const n=Number(s&&s.ordre);
  return isFinite(n)?n:0;
}
// Une liste d'arrêts triée par « ordre » (à égalité, l'ordre de départ est gardé)
function enOrdre(liste){
  return liste.map((s,i)=>({s,i})).sort((a,b)=>valeurOrdre(a.s)-valeurOrdre(b.s)||a.i-b.i).map(x=>x.s);
}
// Le tour dont je fais partie : ma passe (je conduis), sinon celle du camion où je suis passager
function monTourEnCours(){
  const m=(typeof maPasse==='function')?maPasse():null;
  if(m) return m.tour;
  const b=(typeof monBord==='function')?monBord():null;
  return b?b.tour:null;
}
// Les clients qu'il reste à faire à MON tour, dans l'ordre (seulement ceux qui ont une position sur la carte)
function clientsRestants(){
  const t=monTourEnCours();
  if(!t||!tourEnCours(t)) return [];
  return enOrdre(stops.filter(s=>s.route_id===t.route_id&&s.actif!==false&&s.service===t.tache&&s.lat&&s.lon&&!estFait(s)));
}
function prochainArret(){
  return clientsRestants()[0]||null;
}
// Toucher « ▶ prochain client » du bandeau : la fiche de ce client s'ouvre (la carte s'y rend ; « Naviguer » et « Complété » y sont)
function ouvrirProchain(e){
  if(e&&e.stopPropagation) e.stopPropagation();   // (le bandeau se réduit au toucher : pas ici)
  const p=prochainArret();
  if(!p) return;
  const i=stops.indexOf(p);
  if(i>=0) openCard(i);
}

// ── Le parcours dans Google Maps : les prochains clients, dans l'ordre, en UN lien (départ = la position du téléphone) ──
function urlParcoursGoogle(){
  const l=clientsRestants().slice(0,MAX_ETAPES_GOOGLE);
  if(!l.length) return null;
  const pt=s=>s.lat+','+s.lon;
  const arrivee=l[l.length-1];
  const etapes=l.slice(0,-1).map(pt).join('|');
  return 'https://www.google.com/maps/dir/?api=1&destination='+pt(arrivee)+(etapes?'&waypoints='+encodeURIComponent(etapes):'')+'&travelmode=driving';
}
function ouvrirParcoursGoogle(){
  const u=urlParcoursGoogle();
  if(!u){toast('Aucun client à faire pour ta passe.');return;}
  window.open(u,'_blank');
}

// ── Changer l'ordre (administrateur seulement, une route choisie) ──
function peutChangerOrdre(){
  return !!(currentUser&&currentUser.role==='admin'&&routeActive!==null);
}
// « idx » : la position de l'arrêt dans stops[] ; « delta » : -1 = plus tôt, +1 = plus tard (parmi les clients À FAIRE de la route affichée)
async function deplacerArret(e,idx,delta){
  if(e&&e.stopPropagation) e.stopPropagation();
  if(_deplacementEnCours||!peutChangerOrdre()) return;
  const s=stops[idx];
  if(!s) return;
  const groupe=enOrdre(arretsVisibles().filter(x=>!estFait(x)));
  const voisin=groupe[groupe.indexOf(s)+delta];
  if(groupe.indexOf(s)<0||!voisin) return;
  if(!reseau.enLigne){toast('📴 Pas de réseau : l’ordre ne peut pas être changé maintenant.');return;}
  _deplacementEnCours=true;
  showSync(true);
  try{
    // Deux clients de la route échangent leurs valeurs d'ordre ; si elles sont égales (rare), toute la route est d'abord renumérotée 0, 1, 2…
    const avant=new Map(stops.map(x=>[x,valeurOrdre(x)]));
    if(valeurOrdre(s)===valeurOrdre(voisin)){
      enOrdre(stops.filter(x=>x.route_id===s.route_id)).forEach((x,i)=>{x.ordre=i;});
    }
    const a=valeurOrdre(s),b=valeurOrdre(voisin);
    s.ordre=b;voisin.ordre=a;
    const changes=stops.filter(x=>valeurOrdre(x)!==avant.get(x));
    let refus=null;
    for(const x of changes){
      const r=await db.from('stops').update({ordre:valeurOrdre(x)}).eq('id',x.id);
      if(r&&r.error){refus=r.error;break;}
    }
    if(refus){
      toast(estErreurReseau(refus)?'📴 Le signal a disparu : l’ordre n’a pas été enregistré.':'❌ L’ordre n’a pas pu être enregistré.');
      if(estErreurReseau(refus)) signalerEchecReseau(refus);
      await loadStops();   // le serveur a le dernier mot : on relit l'ordre
    }
  }catch(err){
    toast('❌ L’ordre n’a pas pu être enregistré.');
    signalerEchecReseau(err);
    try{await loadStops();}catch(e2){}
  }finally{
    showSync(false);
    _deplacementEnCours=false;
    renderAll();
    if(document.getElementById('liste-overlay').classList.contains('open')) renderListe();
    if(typeof planifierMajParcours==='function') planifierMajParcours();   // le nouvel ordre crée de nouveaux couples de clients : leurs tronçons sont calculés un peu plus tard (parcours.js)
  }
}
