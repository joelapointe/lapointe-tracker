// js/vehicules.js — Les camions sur la carte, avec leur équipage (étape 13f)
//
// Un camion = une passe en cours = UN SEUL point sur la carte : la position envoyée par le téléphone du chauffeur.
// Tout le monde voit l'équipage complet de chaque camion (qui est à bord) : les employés savent déjà qui travaille avec qui,
// et les règles d'accès leur permettent de lire les noms (jamais les téléphones) et les équipages en cours.
// Toucher un camion ouvre une bulle : le camion, sa passe, son avancement, son chauffeur et les personnes à bord.
let nomsVehicules={};        // equipe_id -> nom du véhicule
let equipages={};            // passe_id -> [{utilisateur_id, role, nom}] (chauffeur d'abord)
let marqueursVehicules={};   // passe_id -> marqueur Leaflet
let _tRechargeEquipages=null;

// Lit les noms des véhicules et les équipages à bord. En cas d'échec (pas de réseau…), on GARDE ce qu'on savait.
async function chargerVehiculesEtEquipages(){
  try{
    // « utilisateurs!utilisateur_id » : la PERSONNE à bord (la table a aussi ajoute_par et retire_par, qui pointent vers utilisateurs)
    const[v,e]=await Promise.all([
      db.from('equipes').select('id, nom'),
      db.from('equipage_periodes').select('passe_id, role, utilisateur_id, utilisateurs!utilisateur_id(nom)').is('fin',null)
    ]);
    if(v.error||e.error) throw (v.error||e.error);
    const noms={};
    (v.data||[]).forEach(x=>{noms[x.id]=x.nom;});
    const eq={};
    (e.data||[]).forEach(x=>{
      (eq[x.passe_id]=eq[x.passe_id]||[]).push({utilisateur_id:x.utilisateur_id,role:x.role,nom:(x.utilisateurs&&x.utilisateurs.nom)||''});
    });
    Object.values(eq).forEach(l=>l.sort((a,b)=>(a.role==='chauffeur'?0:1)-(b.role==='chauffeur'?0:1)||a.nom.localeCompare(b.nom,'fr')));
    nomsVehicules=noms;
    installerEquipages(eq);
    lectureReussie('vehicules',{noms,equipages:eq});   // (la copie gardée reste celle du serveur : jamais le résultat superposé)
  }catch(err){
    signalerEchecReseau(err);
    return false;
  }
  return true;
}

// ── L'équipage à bord : les gestes sans réseau posés par-dessus la copie du serveur (étape 16c) ──
// Même principe que pour les tours (tours.js) : `equipages` est TOUJOURS la copie du serveur avec les gestes en attente par-dessus.
let _equipagesServeur={};   // la copie du serveur, telle quelle (jamais modifiée)
let _equipagesConnus=false;
function installerEquipages(eq){
  _equipagesServeur=eq;
  _equipagesConnus=true;
  poserEquipages();
}
function poserEquipages(){
  if(!_equipagesConnus) return;   // pas encore lu : rien à superposer
  equipages=superposerEquipages(_equipagesServeur);
}
function idsPassesEnCours(liste){
  const s=new Set();
  (liste||[]).forEach(t=>{if(tourEnCours(t)) (t.passes||[]).forEach(p=>s.add(p.passe_id));});
  return s;
}
function trierEquipage(l){
  l.sort((a,b)=>(a.role==='chauffeur'?0:1)-(b.role==='chauffeur'?0:1)||String(a.nom).localeCompare(String(b.nom),'fr'));
}
// Une personne monte à bord (sans doublon) ; elle quitte tout autre camion (le serveur fait le transfert)
function assurerABord(eq,passeId,userId,role,nom){
  const l=(eq[passeId]=eq[passeId]||[]);
  if(!l.some(x=>x.utilisateur_id===userId)) l.push({utilisateur_id:userId,role,nom:nom||''});
  trierEquipage(l);
}
function retirerDesEquipages(eq,userId,sauf){
  Object.keys(eq).forEach(pid=>{
    if(pid===sauf) return;
    eq[pid]=eq[pid].filter(x=>x.utilisateur_id!==userId);
    if(!eq[pid].length) delete eq[pid];
  });
}
function appliquerGesteAuxEquipages(eq,g){
  const a=g.args||{};
  if(g.type==='debuter_passe'){
    if(currentUser){
      retirerDesEquipages(eq,currentUser.id,a.passeId);   // débuter ma propre passe me fait quitter l'autre camion
      assurerABord(eq,a.passeId,currentUser.id,'chauffeur',currentUser.nom);
    }
    (a.equipage||[]).forEach(m=>{
      retirerDesEquipages(eq,m.utilisateur_id,a.passeId);
      assurerABord(eq,a.passeId,m.utilisateur_id,'passager',m.nom);
    });
  }else if(g.type==='equipage_ajouter'){
    if(!idsPassesEnCours(tours).has(a.passeId)) return;   // la passe n'est plus en cours : le serveur refusera, on n'affiche rien
    retirerDesEquipages(eq,a.userId,a.passeId);            // la personne quitte l'autre camion (transfert)
    assurerABord(eq,a.passeId,a.userId,'passager',a.nom);
  }else if(g.type==='equipage_retirer'){
    if(!eq[a.passeId]) return;
    eq[a.passeId]=eq[a.passeId].filter(x=>x.utilisateur_id!==a.userId||x.role==='chauffeur');   // le chauffeur ne se retire pas
  }else if(g.type==='quart_terminer'){
    if(currentUser) retirerDesEquipages(eq,currentUser.id,null);   // « Je termine » (étape 17) : je quitte mon camion (le serveur ferme ma place à bord)
  }
}
// Renvoie la copie du serveur si rien n'attend, sinon une COPIE avec les gestes en attente appliqués (dans l'ordre où ils ont été faits)
function superposerEquipages(eq){
  const attente=(typeof gestesEnAttente==='function')?gestesEnAttente():[];
  if(!attente.length) return eq;
  const copie=JSON.parse(JSON.stringify(eq));
  attente.forEach(g=>{try{appliquerGesteAuxEquipages(copie,g);}catch(e){}});
  // Une passe fermée à l'écran (terminée, ou 100 % atteint) n'a plus personne à bord ; une passe débutée puis terminée sans réseau non plus
  const affichees=idsPassesEnCours(tours);
  const fermees=new Set(Array.from(idsPassesEnCours(_toursServeur)).filter(id=>!affichees.has(id)));
  attente.forEach(g=>{if(g.type==='debuter_passe'&&g.args&&!affichees.has(g.args.passeId)) fermees.add(g.args.passeId);});
  fermees.forEach(id=>{delete copie[id];});
  return copie;
}

// Les camions à dessiner : une passe en cours AVEC une position (une route choisie, ou toutes les routes ensemble).
// MA passe (celle que je conduis) est toujours dans la liste, à MA position : celle du GPS de ce téléphone, sans les quelques secondes de retard de celle que le serveur reçoit.
// Elle est dessinée par majMonCamion (plus bas) : mon point vert prend l'aspect du camion, quelle que soit la route affichée, sans ajouter de deuxième marqueur. Tant que le point
// vert n'existe pas (pas encore de position du téléphone), majVehicules la dessine comme les autres, d'après le serveur.
function maPositionDeCamion(){
  if(typeof lastPosInfo==='undefined'||!lastPosInfo) return null;
  return {lat:lastPosInfo.lat,lon:lastPosInfo.lon,precision_m:lastPosInfo.precision,maj_le:new Date(lastPosInfo.le).toISOString()};
}
function listeCamions(){
  const res=[];
  tours.forEach(t=>{
    t.passes.forEach(p=>{
      const moi=!!p.je_suis_chauffeur;
      if(!moi&&routeActive!==null&&t.route_id!==routeActive) return;
      const pos=(moi&&maPositionDeCamion())||positionsVehicules.find(x=>x.passe_id===p.passe_id);
      if(!pos||!pos.lat||!pos.lon) return;
      res.push({passeId:p.passe_id,nom:nomsVehicules[p.equipe_id]||'Camion',tour:t,position:pos,equipage:equipages[p.passe_id]||[],moi});
    });
  });
  return res;
}

function positionPerimee(pos){
  return !(Date.now()-Date.parse(pos.maj_le)<=POSITION_PERIMEE_MIN*60000);   // trop vieille, ou date illisible
}

// Le point glisse d'une lecture à l'autre au lieu de sauter d'un coup (retour de Joé après un essai réel, 23 sept. 2026 :
// « il se téléporte au 10 secondes, à 90 km/h ça n'a aucun sens »). La durée du glissement suit l'écart RÉEL entre les deux
// heures de lecture (maj_le) — pas une constante fixe — pour rester juste même si l'envoi (10 s d'habitude) a été retardé ;
// plafonnée pour ne jamais ramper après un long silence (zone morte, camion arrêté puis reparti loin).
const GLISSEMENT_PAS_MS=150;
const GLISSEMENT_DUREE_MAX_MS=15000;
// (Sert aussi au point VERT de la carte — suivi-carte.js : majPointVert —, d'où l'heure de lecture : du texte venant du serveur (maj_le) ou un nombre de millisecondes (lecture du GPS).)
function deplacerMarqueurCamion(m,lat,lon,majLe){
  if(m._animCamion){clearInterval(m._animCamion);m._animCamion=null;}
  const majLeMs=(typeof majLe==='number')?majLe:Date.parse(majLe);
  const duree=(m._posActuelle&&m._majLeMs&&majLeMs)?Math.min(GLISSEMENT_DUREE_MAX_MS,Math.max(0,majLeMs-m._majLeMs)):0;
  if(majLeMs) m._majLeMs=majLeMs;
  if(!m._posActuelle||!duree){
    m.setLatLng([lat,lon]);
    m._posActuelle=[lat,lon];
    return;
  }
  const depart=m._posActuelle,arrivee=[lat,lon],t0=Date.now();
  m._animCamion=setInterval(()=>{
    const p=Math.min(1,(Date.now()-t0)/duree);
    const pos=[depart[0]+(arrivee[0]-depart[0])*p,depart[1]+(arrivee[1]-depart[1])*p];
    m.setLatLng(pos);
    m._posActuelle=pos;
    if(p>=1){clearInterval(m._animCamion);m._animCamion=null;}
  },GLISSEMENT_PAS_MS);
}

// L'icône de la TÂCHE du camion (icones-taches.js : celle que l'administrateur a choisie, sinon celle que le nom laisse deviner) ; sans la banque d'icônes, l'ancien petit tracteur
function htmlIconeTache(tache,classe){
  return (typeof svgIcone==='function'&&typeof iconeDeTache==='function')?svgIcone(iconeDeTache(tache),classe):'🚜';
}
// L'étiquette du camion sur la carte : l'icône de sa tâche, son nom, son avancement (visible par tout le monde), les personnes à bord
function htmlEtiquetteCamion(c,perime){
  return '<div class="camion'+(perime?' perime':'')+'">'+htmlIconeTache(c.tour.tache,'camion-ico')+'<span>'+esc(c.nom)+'</span><strong>'+Math.max(0,Math.min(100,Number(c.tour.pourcentage)||0))+' %</strong>'+(c.equipage.length?'<em>👤 '+c.equipage.length+'</em>':'')+'</div>';
}
function iconeCamion(c,perime){
  return L.divIcon({
    className:'',
    html:htmlEtiquetteCamion(c,perime),
    iconSize:null,           // la taille de l'étiquette est celle de son contenu (sinon Leaflet l'écrase dans une boîte de 12 px)
    popupAnchor:[0,-16]      // la bulle s'ouvre au-dessus de l'étiquette (centrée sur la position du camion, voir style.css)
  });
}

// Bulle du camion (tout texte venant de la base passe par esc())
function htmlCamion(c,perime){
  const t=c.tour;
  const chauffeur=c.equipage.filter(x=>x.role==='chauffeur').map(x=>esc(x.nom||'?'));
  const abord=c.equipage.filter(x=>x.role!=='chauffeur').map(x=>esc(x.nom||'?'));
  return '<b>'+htmlIconeTache(t.tache,'bulle-ico')+' '+esc(c.nom)+'</b><br>Passe n° '+esc(numeroPasse(t))+' · '+esc(t.tache)+
    '<br>'+esc(t.faits)+'/'+esc(t.total)+' ('+esc(t.pourcentage)+' %)'+
    '<br>Chauffeur : '+(chauffeur.length?chauffeur.join(', '):'—')+
    '<br>À bord : '+(abord.length?abord.join(', '):'personne d’autre')+
    '<br><small>'+(perime?'⚠ ':'')+'position '+esc(ilYa(c.position.maj_le))+'</small>'+
    // L'administrateur peut faire suivre ce camion par la carte (suivi-carte.js) ; un même toucher l'arrête. (L'identifiant de la passe passe par data-passe : du TEXTE, jamais du code.)
    // Jamais sur MON camion : la carte me suit déjà quand je le demande (◎), et mon camion n'est pas un marqueur de camion comme les autres.
    ((!c.moi&&typeof peutSuivreCamion==='function'&&peutSuivreCamion())
      ?'<br><button type="button" class="camion-suivre" data-passe="'+esc(c.passeId)+'" onclick="basculerSuiviCamion(this.dataset.passe)">'+(suiviCamionActif(c.passeId)?'⏹ Ne plus suivre ce camion':'📌 Suivre ce camion')+'</button>'
      :'');
}

// MON camion : pendant MA passe, le point vert de la carte (window._uMk, dessiné par carte.js) prend l'aspect du camion — l'icône de la tâche, le nom, l'avancement, l'équipage.
// Une seule marque sur ma carte (décision de Joé : « un seul ») : ni un point vert et un camion presque superposés, ni un camion qui traîne quelques secondes derrière moi.
// Il reste à ma position exacte : c'est le même marqueur, qui glisse à chaque lecture du GPS (suivi-carte.js : majPointVert) et que la carte suit. Renvoie true s'il est dessiné.
function pointVertDeLaCarte(){return (typeof window!=='undefined'&&window._uMk)||null;}
function majMonCamion(c,perime){
  const m=pointVertDeLaCarte();
  if(!m||typeof m.setIcon!=='function') return false;   // pas encore de position du téléphone : carte.js dessine le point à la première lecture, puis rappelle majVehicules
  const etiquette=htmlEtiquetteCamion(c,perime);
  if(m._etiquetteHtml!==etiquette){
    m._etiquetteHtml=etiquette;
    m.setIcon(L.divIcon({className:'',html:etiquette,iconSize:null,popupAnchor:[0,-16]}));
  }
  const bulle=htmlCamion(c,perime);
  if(m._bulleHtml!==bulle){
    if(m._bulleHtml==null) m.bindPopup(bulle); else m.setPopupContent(bulle);
    m._bulleHtml=bulle;
  }
  return true;
}
// Je ne conduis pas (ou plus) : le point vert redevient un simple point, sans bulle
function retablirPointVert(){
  const m=pointVertDeLaCarte();
  if(!m||m._etiquetteHtml==null) return;
  m._etiquetteHtml=null;
  m.setIcon(iconePointVert());
  if(m._bulleHtml!=null){
    m._bulleHtml=null;
    if(typeof m.unbindPopup==='function') m.unbindPopup();
  }
}

// Dessine, déplace ou retire les camions. Un même camion garde le même marqueur (il se déplace, la bulle ouverte reste ouverte).
function majVehicules(){
  const camions=listeCamions();
  const vus={};
  let moiSurLaCarte=false;
  camions.forEach(c=>{
    const perime=positionPerimee(c.position);
    if(c.moi){
      if(majMonCamion(c,perime)){moiSurLaCarte=true;return;}   // MON camion : mon point vert lui-même, pas un marqueur de plus
      // Pas encore de point vert (le téléphone n'a pas encore de position) : mon camion est dessiné comme les autres, d'après le serveur, et suit la route affichée
      if(routeActive!==null&&c.tour.route_id!==routeActive) return;
    }
    vus[c.passeId]=true;
    let m=marqueursVehicules[c.passeId];
    if(m){
      deplacerMarqueurCamion(m,c.position.lat,c.position.lon,c.position.maj_le);
      m.setIcon(iconeCamion(c,perime));
      const bulle=htmlCamion(c,perime);
      if(m._bulleHtml!==bulle){m._bulleHtml=bulle;m.setPopupContent(bulle);}   // une bulle ouverte n'est redessinée que si son texte change : un toucher sur son bouton (« Suivre ce camion ») n'est pas perdu
    } else {
      m=L.marker([c.position.lat,c.position.lon],{icon:iconeCamion(c,perime),zIndexOffset:500}).addTo(map);
      m._posActuelle=[c.position.lat,c.position.lon];
      m._majLeMs=Date.parse(c.position.maj_le)||null;
      m._bulleHtml=htmlCamion(c,perime);
      m.bindPopup(m._bulleHtml);
      marqueursVehicules[c.passeId]=m;
      if(typeof suiviMarqueurCree==='function') suiviMarqueurCree();   // la carte attendait peut-être ce camion pour le suivre (suivi-carte.js)
    }
  });
  Object.keys(marqueursVehicules).forEach(id=>{
    if(!vus[id]){
      if(marqueursVehicules[id]._animCamion) clearInterval(marqueursVehicules[id]._animCamion);
      if(typeof suiviCamionRetire==='function') suiviCamionRetire(id);   // suivre un camion qui disparaît n'a plus de sens (suivi-carte.js)
      map.removeLayer(marqueursVehicules[id]); delete marqueursVehicules[id];   // passe terminée, ou camion d'une autre route
    }
  });
  if(!moiSurLaCarte) retablirPointVert();   // je ne conduis pas (ou plus) : le point vert redevient un simple point
}

// Un équipage qui change (quelqu'un monte à bord, descend, est transféré) sur n'importe quel téléphone :
// on relit une seule fois même si plusieurs changements arrivent d'un coup
function planifierRechargementEquipages(){
  clearTimeout(_tRechargeEquipages);
  _tRechargeEquipages=setTimeout(async()=>{
    if(!currentUser) return;
    if(await chargerVehiculesEtEquipages()){
      majVehicules();
      majBandeauPasse();       // « 👤 Équipage · N à bord » et le panneau ouvert se mettent à jour (étape 15c)
    }
  },300);
}
