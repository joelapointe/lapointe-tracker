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
// Le tour déjà en cours pour cette route ET cette tâche : celui qu'un camion qui démarre REJOINT.
// (Un tour TERMINÉ, resté affiché en vert, ne se rejoint pas : débuter ouvre un nouveau tour et remet tout à zéro.)
function tourARejoindre(routeId,tache){
  return tours.find(t=>tourEnCours(t)&&t.route_id===routeId&&t.tache===tache)||null;
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
// Le POURCENTAGE EN GROS (décision de Joé) : le chauffeur le voit en permanence, avec le bouton « Terminer » tant que ce n'est pas 100 %.
// Un passager voit la même carte, sans « Terminer ». Tout le monde voit aussi le pourcentage de chaque camion sur la carte (vehicules.js).
let _envoiTerminer=false;   // « Terminer » en cours (le bouton se grise : pas de double geste)

function pourcentageDe(t){return Math.max(0,Math.min(100,Number(t.pourcentage)||0));}

// La carte de l'avancement d'une passe. role : 'chauffeur' (ma passe) ou 'bord' (je suis passager de ce camion)
function htmlCartePasse(t,passe,role){
  const pct=pourcentageDe(t);
  const nom=nomVehiculeDe(passe.equipe_id)||'Camion';
  return '<div class="passe-encours"><div class="passe-pct">'+pct+' %</div><div class="passe-infos"><b>'+(role==='bord'?'👤 À bord · ':'🚜 ')+esc(nom)+'</b>'+
    '<br>Passe n° '+esc(t.numero)+' · '+esc(nomRoute(t.route_id))+'<br>'+esc(t.tache)+' · '+esc(t.faits)+'/'+esc(t.total)+
    '<div class="passe-barre"><i style="width:'+pct+'%"></i></div></div></div>';
}

// Appelé à chaque redessin de la carte (donc à chaque changement des tours, sur n'importe quel téléphone)
function majBandeauPasse(){
  const b=document.getElementById('passe-bandeau');
  if(!b) return;
  if(!currentUser){
    b.innerHTML='';
    b.classList.remove('show');
    _passeVue=null;
    return;
  }
  b.classList.add('show');
  const m=maPasse();
  suivreMaPasse(m);
  if(m){
    // « Terminer » n'existe que pour une passe pas encore complétée : à 100 % le serveur la ferme lui-même
    b.innerHTML=htmlCartePasse(m.tour,m.passe,'chauffeur')+(pourcentageDe(m.tour)<100
      ?'<button id="btn-terminer" type="button" class="passe-terminer" onclick="terminerPasse()"'+(_envoiTerminer?' disabled':'')+'>■ Terminer la passe</button>':'');
    return;
  }
  const bord=monBord();
  b.innerHTML=(bord?htmlCartePasse(bord.tour,bord.passe,'bord'):'')+
    '<button id="btn-debuter" type="button" class="passe-debuter'+(bord?' secondaire':'')+'" onclick="ouvrirDebut()">▶ Débuter '+(bord?'ma propre ':'la ')+'passe</button>';
}

// ── Terminer la passe ─────────────────────────────────
// Seulement ma passe (ce camion) : le tour continue pour les autres camions. Terminer la passe NE ferme PAS le quart de travail (étape 17).
function messageErreurTerminer(e){
  const m=String((e&&e.message)||'');
  if(m.includes('non_autorise')) return 'Seul le chauffeur de la passe peut la terminer.';
  if(m.includes('passe_introuvable')) return 'Cette passe n’existe plus.';
  return 'Pas de réseau ou erreur. Réessaie.';
}

async function terminerPasse(){
  if(_envoiTerminer) return;
  const m=maPasse();
  if(!m){toast('Tu n’as pas de passe en cours.');return;}
  const t=m.tour,passeId=m.passe.passe_id;
  if(pourcentageDe(t)>=100){toast('Cette passe est complétée à 100 %.');return;}
  _envoiTerminer=true;   // pris tout de suite : un double toucher ne peut pas lancer deux gestes
  majBandeauPasse();
  const restant=Math.max(0,(Number(t.total)||0)-(Number(t.faits)||0));
  const autres=t.passes.filter(p=>p.passe_id!==passeId).map(p=>nomVehiculeDe(p.equipe_id)||'un autre camion');
  const texte='Passe n° '+t.numero+' : '+t.faits+'/'+t.total+' ('+pourcentageDe(t)+' %). '+
    (restant>1?restant+' arrêts ne seront pas faits.':'1 arrêt ne sera pas fait.')+
    (autres.length?' Le tour continue pour '+autres.join(', ')+'.':'');
  if(!(await confirmer('Terminer la passe ?',texte,'Oui, terminer','Continuer'))){
    _envoiTerminer=false;
    majBandeauPasse();
    return;
  }

  showSync(true);
  let r;
  try{
    r=await db.rpc('terminer_passe',{p_passe_id:passeId});
  }catch(err){
    r={data:null,error:err};
  }
  showSync(false);

  // Réponse perdue ? Si la passe n'existe plus parmi les passes en cours, elle est bel et bien terminée
  if(r.error){
    const lu=await chargerTours();
    if(lu&&!tours.some(x=>x.passes.some(p=>p.passe_id===passeId))) r={data:{statut:'terminee'},error:null};
  }
  _envoiTerminer=false;
  if(r.error){
    majBandeauPasse();
    toast('❌ '+messageErreurTerminer(r.error));
    return;
  }

  _passeVue=null;   // je viens de la terminer moi-même : la boîte de confirmation et le message suffisent (pas de résumé)
  await chargerTours();
  await chargerPositionsVehicules();
  await chargerVehiculesEtEquipages();
  renderAll();majCarte();
  const d=r.data||{};
  if(d.statut==='deja_terminee'){toast('Cette passe était déjà terminée.');return;}
  const faits=d.faits!=null?d.faits:t.faits,total=d.total!=null?d.total:t.total,pct=d.pourcentage!=null?d.pourcentage:pourcentageDe(t);
  toast('■ Passe n° '+t.numero+' terminée : '+faits+'/'+total+' ('+pct+' %)');
}
