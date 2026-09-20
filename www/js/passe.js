// js/passe.js — Débuter une passe (étape 14a)
//
// Le chauffeur choisit sa ROUTE, sa TÂCHE (le type de service des arrêts) et son VÉHICULE, puis démarre. Le serveur (fonction
// debuter_passe) fait le reste : il archive la passe précédente du chauffeur et du véhicule, et il fait REJOINDRE le tour déjà en
// cours quand un autre camion fait la même route et la même tâche. L'équipage se confirmera à l'étape 15 (pour l'instant le
// chauffeur est seul à bord). Le suivi GPS continu vient à l'étape 18 : ici, la position du téléphone n'est envoyée qu'au départ.
//
// Ce que la personne voit dans le bandeau du haut :
//   • sans passe en cours : un gros bouton « ▶ Débuter la passe » (chauffeurs ET administrateur : Joé conduit aussi)
//   • chauffeur d'une passe : un résumé de SA passe (le grand pourcentage et « Terminer » arrivent à l'étape 14b)
const CLE_VEHICULE='lp_vehicule';        // dernier véhicule utilisé sur CE téléphone (« mémorisé pour la fois suivante »)
const CLE_ROUTE_DEBUT='lp_route_debut';  // dernière route débutée sur CE téléphone
let _debut=null;          // écran ouvert : {routeId, tache, equipeId, equipes:[{id,nom}], envoi}
let _ouvertureDebut=false;
let _essaiDebut=null;     // {cle, passeId} : le MÊME identifiant sert tant que le démarrage n'a pas réussi (un renvoi ne crée jamais deux passes)

function lireMemo(k){try{return localStorage.getItem(k);}catch(e){return null;}}
function ecrireMemo(k,v){try{localStorage.setItem(k,v);}catch(e){}}

// Identifiant unique de la passe, fabriqué par le téléphone (le serveur s'en sert pour ne jamais créer deux passes si le geste est renvoyé)
function nouvelId(){
  if(typeof crypto!=='undefined'&&crypto&&typeof crypto.randomUUID==='function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return (c==='x'?r:(r&3|8)).toString(16);});
}

// ── Où en est la personne connectée ────────────────────
// Sa passe (elle en est le chauffeur), sinon null
function maPasse(){
  for(const t of tours){
    const p=t.passes.find(x=>x.je_suis_chauffeur);
    if(p) return {tour:t,passe:p};
  }
  return null;
}
// La passe d'un camion où elle est PASSAGÈRE (à bord sans en être le chauffeur), sinon null
function monBord(){
  for(const t of tours){
    const p=t.passes.find(x=>x.je_suis_a_bord&&!x.je_suis_chauffeur);
    if(p) return {tour:t,passe:p};
  }
  return null;
}
function nomRoute(id){const r=routes.find(x=>x.id===id);return r?r.nom:'';}
function nomVehiculeDe(equipeId){return nomsVehicules[equipeId]||'';}
function nomChauffeurDe(passeId){
  const c=(equipages[passeId]||[]).find(x=>x.role==='chauffeur');
  return c&&c.nom?c.nom:'';
}
// Le camion (et son chauffeur) qui est déjà en passe avec ce véhicule, sinon null
function occupantDe(equipeId){
  for(const t of tours){
    const p=t.passes.find(x=>x.equipe_id===equipeId);
    if(p) return {tour:t,passe:p,chauffeur:nomChauffeurDe(p.passe_id)};
  }
  return null;
}
// Le tour déjà en cours pour cette route ET cette tâche : celui qu'un camion qui démarre REJOINT
function tourARejoindre(routeId,tache){
  return tours.find(t=>t.route_id===routeId&&t.tache===tache)||null;
}

// ── Les choix possibles ────────────────────────────────
function routesDebut(){return routes.filter(r=>r.actif!==false);}
// Les types de service des arrêts actifs de la route (= les tâches possibles), en ordre alphabétique
function tachesDe(routeId){
  const vus=new Set();
  stops.forEach(s=>{if(s.route_id===routeId&&s.actif!==false&&s.service) vus.add(s.service);});
  return Array.from(vus).sort((a,b)=>a.localeCompare(b,'fr'));
}
function tacheParDefaut(routeId){
  const t=tachesDe(routeId);
  return t.length===1?t[0]:null;    // une seule tâche : choisie d'office ; plusieurs : la personne choisit
}
// La route proposée : celle affichée sur la carte, sinon la dernière débutée, sinon la seule qui existe
function routeParDefaut(){
  const l=routesDebut();
  if(routeActive!==null&&l.some(r=>r.id===routeActive)) return routeActive;
  const m=lireMemo(CLE_ROUTE_DEBUT);
  if(m&&l.some(r=>r.id===m)) return m;
  return l.length===1?l[0].id:null;
}

// Ce qui manque avant de pouvoir démarrer
function etatDebut(){
  const d=_debut;
  if(!d) return {pret:false,manque:[],sansArret:false};
  const manque=[];
  let sansArret=false;
  if(!d.routeId) manque.push('route');
  else{
    const t=tachesDe(d.routeId);
    if(!t.length) sansArret=true;
    else if(!d.tache||!t.includes(d.tache)) manque.push('tâche');
  }
  if(!d.equipeId||!d.equipes.some(x=>x.id===d.equipeId)) manque.push('véhicule');
  return {pret:manque.length===0&&!sansArret,manque,sansArret};
}

// ── L'écran « Débuter la passe » ───────────────────────
// Lit les véhicules actifs (à jour) et ouvre l'écran. Sans réseau on n'ouvre rien : démarrer une passe demande le serveur (le mode hors réseau vient à l'étape 16).
async function ouvrirDebut(){
  if(!currentUser||_ouvertureDebut||_debut) return;
  _ouvertureDebut=true;
  try{
    showSync(true);
    await chargerTours();                    // pour savoir qui est déjà en passe (en cas d'échec on garde ce qu'on savait)
    await chargerVehiculesEtEquipages();
    if(maPasse()){showSync(false);toast('Tu as déjà une passe en cours : termine-la d’abord.');return;}
    let equipes;
    try{
      const{data,error}=await db.from('equipes').select('id, nom').eq('actif',true).order('nom');
      if(error) throw error;
      equipes=(data||[]).slice().sort((a,b)=>String(a.nom).localeCompare(String(b.nom),'fr',{numeric:true}));
    }catch(e){
      showSync(false);
      toast('❌ Pas de réseau. Réessaie.');
      return;
    }
    showSync(false);
    const routeId=routeParDefaut();
    const dernier=lireMemo(CLE_VEHICULE);
    _debut={
      routeId,
      tache:routeId?tacheParDefaut(routeId):null,
      equipeId:(dernier&&equipes.some(x=>x.id===dernier))?dernier:null,
      equipes,
      envoi:false
    };
    renderDebut();
    document.getElementById('debut-overlay').classList.add('open');
  }finally{
    _ouvertureDebut=false;
  }
}
function fermerDebut(){
  document.getElementById('debut-overlay').classList.remove('open');
  _debut=null;
}
function bgClickDebut(e){
  if(e.target===document.getElementById('debut-overlay')) fermerDebut();
}

function choisirRouteDebut(id){
  const d=_debut; if(!d||d.envoi) return;
  d.routeId=id;
  d.tache=tacheParDefaut(id);
  renderDebut();
}
function choisirTacheDebut(t){
  const d=_debut; if(!d||d.envoi) return;
  d.tache=t;
  renderDebut();
}
function choisirVehiculeDebut(id){
  const d=_debut; if(!d||d.envoi) return;
  d.equipeId=id;
  renderDebut();
}

function titreDebut(texte){
  const t=document.createElement('div');
  t.className='debut-titre';
  t.textContent=texte;
  return t;
}
function infoDebut(html,classe){
  const i=document.createElement('div');
  i.className='debut-info'+(classe?' '+classe:'');
  i.innerHTML=html;
  return i;
}
function boutonChoix(html,choisi,pris,auToucher){
  const b=document.createElement('button');
  b.type='button';
  b.className='debut-choix'+(choisi?' choisi':'')+(pris?' pris':'');
  b.innerHTML=html;
  b.onclick=auToucher;
  return b;
}

function renderDebut(){
  const d=_debut; if(!d) return;
  const corps=document.getElementById('debut-body');
  corps.innerHTML='';

  // ROUTE
  corps.appendChild(titreDebut('Route'));
  const routesOk=routesDebut();
  if(!routesOk.length){
    corps.appendChild(infoDebut('Aucune route active.','debut-alerte'));
  }else{
    const g=document.createElement('div');
    g.className='debut-grille';
    routesOk.forEach(r=>{
      const nb=stops.filter(s=>s.route_id===r.id).length;
      g.appendChild(boutonChoix(esc(r.nom)+'<small>'+nb+' arrêt'+(nb>1?'s':'')+'</small>',d.routeId===r.id,false,()=>choisirRouteDebut(r.id)));
    });
    corps.appendChild(g);
  }

  // TÂCHE (le type de service des arrêts de la route)
  if(d.routeId){
    const taches=tachesDe(d.routeId);
    corps.appendChild(titreDebut('Tâche'));
    if(!taches.length){
      corps.appendChild(infoDebut('Cette route n’a aucun arrêt actif : impossible de débuter une passe.','debut-alerte'));
    }else if(taches.length===1){
      corps.appendChild(infoDebut('<b>'+esc(taches[0])+'</b> (la seule de cette route)'));
    }else{
      const g=document.createElement('div');
      g.className='debut-grille';
      taches.forEach(t=>{
        const nb=stops.filter(s=>s.route_id===d.routeId&&s.service===t).length;
        g.appendChild(boutonChoix(esc(t)+'<small>'+nb+' arrêt'+(nb>1?'s':'')+'</small>',d.tache===t,false,()=>choisirTacheDebut(t)));
      });
      corps.appendChild(g);
    }
    // Un autre camion fait déjà cette route et cette tâche : on le dit AVANT de démarrer (le serveur fait rejoindre le tour tout seul)
    const rejoint=d.tache?tourARejoindre(d.routeId,d.tache):null;
    if(rejoint){
      const camions=rejoint.passes.map(p=>{
        const v=nomVehiculeDe(p.equipe_id)||'Camion',c=nomChauffeurDe(p.passe_id);
        return esc(v)+(c?' ('+esc(c)+')':'');
      });
      corps.appendChild(infoDebut('🤝 Cette passe est déjà commencée : n° '+esc(rejoint.numero)+', '+esc(rejoint.faits)+'/'+esc(rejoint.total)+' ('+esc(rejoint.pourcentage)+' %)'+
        (camions.length?' — '+camions.join(', '):'')+'.<br>Tu la rejoins : les arrêts déjà faits restent faits.','debut-rejoint'));
    }
  }

  // VÉHICULE
  corps.appendChild(titreDebut('Véhicule'));
  if(!d.equipes.length){
    corps.appendChild(infoDebut('Aucun véhicule actif. Communique avec Joé.','debut-alerte'));
  }else{
    const g=document.createElement('div');
    g.className='debut-grille';
    d.equipes.forEach(v=>{
      const occ=occupantDe(v.id);
      const sous=occ?'<small>🚜 '+esc(occ.chauffeur||'déjà en passe')+' · en passe</small>':'';
      g.appendChild(boutonChoix(esc(v.nom)+sous,d.equipeId===v.id,!!occ,()=>choisirVehiculeDebut(v.id)));
    });
    corps.appendChild(g);
  }

  const e=etatDebut();
  if(e.manque.length) corps.appendChild(infoDebut('Choisis encore : '+e.manque.join(', ')+'.','debut-aide'));
  const bouton=document.getElementById('btn-demarrer');
  bouton.disabled=!e.pret||d.envoi;
  bouton.textContent=d.envoi?'DÉMARRAGE…':'▶ DÉMARRER';
}

// Messages en français pour les refus du serveur
function messageErreurDebut(e){
  const m=String((e&&e.message)||'');
  const connus={
    route_inactive:'Cette route n’est plus active.',
    equipe_inactive:'Ce véhicule n’est plus actif.',
    tache_requise:'Choisis la tâche de la passe.',
    tache_sans_arret:'Cette route n’a aucun arrêt pour cette tâche.',
    passe_deja_en_cours:'Une passe est déjà commencée avec ce véhicule ou ce chauffeur. Réessaie.',
    non_autorise:'Cette passe appartient à un autre chauffeur.'
  };
  for(const k in connus){ if(m.includes(k)) return connus[k]; }
  return 'Pas de réseau ou erreur. Réessaie.';
}

// « Démarrer » : demande une confirmation quand cela affecte quelqu'un d'autre, puis appelle la fonction du serveur
async function demarrerPasse(){
  const d=_debut;
  if(!d||d.envoi) return;
  const e=etatDebut();
  if(!e.pret){toast('⚠ Choisis d’abord : '+(e.manque.join(', ')||'une route avec des arrêts'));return;}
  if(maPasse()){toast('Tu as déjà une passe en cours : termine-la d’abord.');return;}
  d.envoi=true;   // pris tout de suite : un double toucher ne peut pas lancer deux démarrages
  renderDebut();

  const annuler=()=>{ if(_debut===d){d.envoi=false;renderDebut();} };

  // Passager d'un autre camion : débuter sa propre passe le fait quitter ce camion
  const bord=monBord();
  if(bord){
    const nom=nomVehiculeDe(bord.passe.equipe_id)||'ce camion';
    if(!(await confirmer('Quitter « '+nom+' » ?','Tu es à bord de ce camion. Si tu débutes ta propre passe, tu le quittes.','Oui, débuter','Annuler'))){annuler();return;}
  }
  // Véhicule déjà en passe avec quelqu'un d'autre : démarrer TERMINE sa passe (le serveur l'archive). On le dit, en nommant la personne.
  const occ=occupantDe(d.equipeId);
  if(occ){
    const v=nomVehiculeDe(d.equipeId)||'Ce véhicule';
    const qui=occ.chauffeur||'l’autre chauffeur';
    if(!(await confirmer('Remplacer la passe de '+qui+' ?','« '+v+' » est déjà en passe ('+(nomRoute(occ.tour.route_id)||'route')+', '+occ.tour.pourcentage+' %). Si tu continues, cette passe est terminée.','Oui, remplacer','Annuler'))){annuler();return;}
  }
  if(_debut!==d) return;   // l'écran a été fermé pendant la confirmation

  // Le même identifiant sert tant que ça n'a pas réussi : si la réponse se perd, un nouvel essai ne crée pas une 2e passe
  const cle=d.routeId+'|'+d.tache+'|'+d.equipeId;
  if(!_essaiDebut||_essaiDebut.cle!==cle) _essaiDebut={cle,passeId:nouvelId()};
  const passeId=_essaiDebut.passeId;

  showSync(true);
  let r;
  try{
    r=await db.rpc('debuter_passe',{p_id:passeId,p_route_id:d.routeId,p_equipe_id:d.equipeId,p_lat:lastPos?lastPos[0]:null,p_lon:lastPos?lastPos[1]:null,p_tache:d.tache});
  }catch(err){
    r={data:null,error:err};
  }
  showSync(false);

  // Réponse perdue ? Le serveur a peut-être quand même créé la passe : on la cherche avant de dire que ça a échoué
  if(r.error){
    await chargerTours();
    const p=tours.map(t=>t.passes.find(x=>x.passe_id===passeId)).find(Boolean);
    if(p) r={data:{statut:'debutee'},error:null};
  }
  if(r.error){
    toast('❌ '+messageErreurDebut(r.error));
    annuler();
    return;
  }

  _essaiDebut=null;
  ecrireMemo(CLE_VEHICULE,d.equipeId);
  ecrireMemo(CLE_ROUTE_DEBUT,d.routeId);
  fermerDebut();
  // La carte montre la route de la passe
  routeActive=d.routeId;
  zone=nomRoute(d.routeId)||zone;
  ecrireMemo('lp_zone',zone);
  await chargerTours();
  await chargerVehiculesEtEquipages();
  await chargerPositionsVehicules();
  renderAll();majCarte();
  const num=r.data&&r.data.numero!=null?r.data.numero:((maPasse()||{tour:{}}).tour.numero);
  toast(r.data&&r.data.tour_rejoint?'🤝 Tu as rejoint la passe n° '+num:'▶ Passe n° '+num+' débutée');
}

// ── Le bandeau du haut ────────────────────────────────
// Appelé à chaque redessin de la carte (donc à chaque changement des tours, sur n'importe quel téléphone)
function majBandeauPasse(){
  const b=document.getElementById('passe-bandeau');
  if(!b) return;
  if(!currentUser){
    b.innerHTML='';
    b.classList.remove('show');
    return;
  }
  b.classList.add('show');
  const m=maPasse();
  if(!m){
    b.innerHTML='<button id="btn-debuter" type="button" class="passe-debuter" onclick="ouvrirDebut()">▶ Débuter la passe</button>';
    return;
  }
  const t=m.tour;
  b.innerHTML='<div class="passe-encours"><div class="passe-pct">'+esc(t.pourcentage)+' %</div><div class="passe-infos"><b>🚜 '+esc(nomVehiculeDe(m.passe.equipe_id)||'Camion')+'</b>'+
    '<br>Passe n° '+esc(t.numero)+' · '+esc(nomRoute(t.route_id))+'<br>'+esc(t.tache)+' · '+esc(t.faits)+'/'+esc(t.total)+'</div></div>';
}
