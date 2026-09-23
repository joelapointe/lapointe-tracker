// js/admin-historique.js — Panneau administrateur, onglet « Historique » : les passes passées d'une route, et « Nouvelle saison »
//
// Demande de Joé (22 sept. 2026) : le numéro de passe grimpe pour toujours (route par route) ; une fois les passes d'une route
// vérifiées (travail fait, problèmes réglés, heures validées — dans les onglets Problèmes/Quarts), il veut pouvoir repartir à
// « Passe n° 1 » pour cette route, SANS PERDRE l'historique. Le vrai « numero » ne change JAMAIS (toute la logique des tours
// PARTAGÉS entre camions s'appuie dessus, dans plusieurs fichiers SQL) : « Nouvelle saison » avance seulement un DÉCALAGE
// D'AFFICHAGE par route (routes.numero_base, SQL 25) — c'est tours_en_cours() qui fait numero - numero_base pour tout le reste
// de l'application (bandeau, carte…). ICI, dans l'historique, on montre le VRAI numero (jamais renommé, jamais recyclé).
//
// La LISTE se lit directement (les règles d'accès laissent déjà l'administrateur tout lire sur « passes » et « passe_arrets »).
// « Nouvelle saison », elle, passe par la fonction serveur admin_nouvelle_saison_route (jamais une écriture directe) : elle
// REFUSE si une passe de la route est encore en cours.
let routeHistoriqueAdmin=null;   // id de la route choisie (retenu d'un passage à l'autre sur cet onglet)
let passesHistoriqueAdmin=[];    // toutes les passes (en_cours + terminee) de la route choisie

function chargerHistoriqueAdmin(){
  renderHistoriqueAdmin();
}

function renderHistoriqueAdmin(){
  const body=document.getElementById('admin-body');
  body.innerHTML='';

  const champ=document.createElement('div');
  champ.className='f';
  champ.style.cssText='padding:12px 16px 0;';
  const label=document.createElement('label');
  label.textContent='Route';
  const select=document.createElement('select');
  const optVide=document.createElement('option');
  optVide.value='';
  optVide.textContent='— Choisir une route —';
  select.appendChild(optVide);
  routes.forEach(r=>{
    const o=document.createElement('option');
    o.value=r.id;
    o.textContent=r.nom;
    select.appendChild(o);
  });
  select.value=routeHistoriqueAdmin||'';
  champ.appendChild(label);
  champ.appendChild(select);
  body.appendChild(champ);

  const resultat=document.createElement('div');
  body.appendChild(resultat);

  select.onchange=()=>{
    routeHistoriqueAdmin=select.value||null;
    if(routeHistoriqueAdmin) chargerPassesHistoriqueAdmin(resultat);
    else{ resultat.innerHTML=''; resultat.appendChild(messageVideHistorique()); }
  };

  if(routeHistoriqueAdmin) chargerPassesHistoriqueAdmin(resultat);
  else resultat.appendChild(messageVideHistorique());
}

function messageVideHistorique(){
  const vide=document.createElement('div');
  vide.style.cssText='padding:16px;text-align:center;color:#6b7a8d;font-size:13px;';
  vide.textContent='Choisis une route pour voir ses passes.';
  return vide;
}

async function chargerPassesHistoriqueAdmin(resultat){
  resultat.innerHTML='';
  const attente=document.createElement('div');
  attente.style.cssText='padding:16px;text-align:center;color:#6b7a8d;';
  attente.textContent='Chargement…';
  resultat.appendChild(attente);
  let data=null,error=null;
  try{
    const r=await db.from('passes').select('id, numero, tache, debut, fin, statut, nb_arrets_total, nb_arrets_faits').eq('route_id',routeHistoriqueAdmin).order('numero',{ascending:false});
    data=r.data;error=r.error;
  }catch(e){error=e;}
  if(error){
    resultat.innerHTML='<div style="padding:16px;color:#ef4444;font-size:13px;">❌ Impossible de charger les passes. Vérifie la connexion, puis réessaie.</div>';
    return;
  }
  passesHistoriqueAdmin=Array.isArray(data)?data:[];
  afficherPassesHistoriqueAdmin(resultat);
}

function dureeTexte(debut,fin){
  if(!debut||!fin) return '—';
  const h=(new Date(fin).getTime()-new Date(debut).getTime())/3600000;
  return (isFinite(h)?Math.max(0,h):0).toFixed(1)+' h';
}

function afficherPassesHistoriqueAdmin(resultat){
  resultat.innerHTML='';
  const enCours=passesHistoriqueAdmin.filter(p=>p.statut==='en_cours');
  const terminees=passesHistoriqueAdmin.filter(p=>p.statut==='terminee');

  if(enCours.length){
    const avert=document.createElement('div');
    avert.style.cssText='padding:8px 16px;color:#fb923c;font-size:12px;';
    avert.textContent='⚠ '+enCours.length+' passe(s) encore en cours sur cette route : impossible de commencer une nouvelle saison avant qu’elles soient terminées.';
    resultat.appendChild(avert);
  }

  if(!terminees.length){
    const vide=document.createElement('div');
    vide.style.cssText='padding:16px;text-align:center;color:#6b7a8d;font-size:13px;';
    vide.textContent='Aucune passe terminée pour cette route.';
    resultat.appendChild(vide);
  }else{
    terminees.forEach(p=>resultat.appendChild(ligneHistoriquePasse(p)));
  }

  const btNouvelle=document.createElement('button');
  btNouvelle.type='button';
  btNouvelle.className='lf-btn'+(enCours.length?'':' nouveau');
  btNouvelle.style.cssText='width:calc(100% - 32px);margin:12px 16px;';
  btNouvelle.textContent='🔄 Nouvelle saison pour cette route';
  btNouvelle.disabled=enCours.length>0;
  btNouvelle.onclick=()=>nouvelleSaisonAdmin(resultat);
  resultat.appendChild(btNouvelle);
}

function ligneHistoriquePasse(p){
  const div=document.createElement('div');
  div.className='emp-item';

  const info=document.createElement('div');
  info.className='emp-info';
  const nom=document.createElement('div');
  nom.className='emp-nom';
  nom.textContent='Passe n° '+p.numero+' · '+p.tache;
  const detail=document.createElement('div');
  detail.className='emp-detail';
  detail.textContent=dateHeure(p.debut)+' → '+(p.fin?dateHeure(p.fin):'—')+' · '+dureeTexte(p.debut,p.fin)+' · '+p.nb_arrets_faits+'/'+p.nb_arrets_total;
  info.appendChild(nom);
  info.appendChild(detail);
  div.appendChild(info);

  const actions=document.createElement('div');
  actions.className='emp-actions';
  const btDetail=document.createElement('button');
  btDetail.type='button';
  btDetail.className='emp-btn';
  btDetail.textContent='▼ Voir le détail';
  actions.appendChild(btDetail);
  div.appendChild(actions);

  let zoneDetail=null;
  btDetail.onclick=()=>{
    if(zoneDetail){zoneDetail.remove();zoneDetail=null;btDetail.textContent='▼ Voir le détail';return;}
    zoneDetail=document.createElement('div');
    zoneDetail.className='hist-detail';
    zoneDetail.textContent='Chargement…';
    div.appendChild(zoneDetail);
    btDetail.textContent='▲ Cacher le détail';
    chargerDetailPasse(p,zoneDetail);
  };

  return div;
}

async function chargerDetailPasse(p,zoneDetail){
  let data=null,error=null;
  try{
    const r=await db.from('passe_arrets').select('id, complete_le, stops(adresse,client), utilisateurs!complete_par(nom)').eq('passe_id',p.id).order('complete_le');
    data=r.data;error=r.error;
  }catch(e){error=e;}
  zoneDetail.innerHTML='';
  if(error){
    zoneDetail.style.color='#ef4444';
    zoneDetail.style.fontSize='12px';
    zoneDetail.textContent='❌ Impossible de charger le détail.';
    return;
  }
  const lignes=Array.isArray(data)?data:[];
  if(!lignes.length){
    zoneDetail.style.color='#6b7a8d';
    zoneDetail.style.fontSize='12px';
    zoneDetail.textContent='Aucun arrêt complété.';
    return;
  }
  lignes.forEach(l=>{
    const ligne=document.createElement('div');
    ligne.style.cssText='font-size:12px;color:var(--muted);padding:2px 0;';
    const nomClient=(l.stops&&(l.stops.client||l.stops.adresse))||'?';
    const parQui=(l.utilisateurs&&l.utilisateurs.nom)||'?';
    ligne.textContent='· '+nomClient+' — '+dateHeure(l.complete_le)+' (par '+parQui+')';
    zoneDetail.appendChild(ligne);
  });
}

function messageErreurHistorique(error){
  if(estErreurReseau(error)) return '📴 Pas de réseau : rien n’a été changé.';
  return '❌ '+((error&&error.message)||'Une erreur est survenue.');
}

async function nouvelleSaisonAdmin(resultat){
  const route=routes.find(r=>r.id===routeHistoriqueAdmin);
  const nomRoute=(route&&route.nom)||'cette route';
  if(!(await confirmer('Nouvelle saison pour '+nomRoute+' ?','Les prochaines passes recommenceront à « Passe n° 1 ». L’historique (toutes les passes déjà faites) reste conservé, rien n’est effacé.','Nouvelle saison','Annuler'))) return;
  showSync(true);
  let data=null,error=null;
  try{
    const r=await db.rpc('admin_nouvelle_saison_route',{p_route_id:routeHistoriqueAdmin});
    data=r.data;error=r.error;
  }catch(e){error=e;signalerEchecReseau(e);}
  showSync(false);
  if(error){toast(messageErreurHistorique(error));return;}
  if(!data||data.statut==='refuse'){toast('❌ Impossible : une passe de cette route est encore en cours.');return;}
  if(data.statut!=='ok'){toast('❌ Impossible de commencer une nouvelle saison');return;}
  toast('🔄 Nouvelle saison : la prochaine passe de '+nomRoute+' sera la n° 1');
  await loadRoutes();   // routes[].numero_base change : relu pour que le reste de l'application le voie tout de suite
  await chargerPassesHistoriqueAdmin(resultat);
}
