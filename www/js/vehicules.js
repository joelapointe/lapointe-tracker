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

// Les camions à dessiner : une passe en cours AVEC une position (une route choisie, ou toutes les routes ensemble)
function listeCamions(){
  const res=[];
  tours.forEach(t=>{
    if(routeActive!==null&&t.route_id!==routeActive) return;
    t.passes.forEach(p=>{
      const pos=positionsVehicules.find(x=>x.passe_id===p.passe_id);
      if(!pos||!pos.lat||!pos.lon) return;
      res.push({passeId:p.passe_id,nom:nomsVehicules[p.equipe_id]||'Camion',tour:t,position:pos,equipage:equipages[p.passe_id]||[]});
    });
  });
  return res;
}

function positionPerimee(pos){
  return !(Date.now()-Date.parse(pos.maj_le)<=POSITION_PERIMEE_MIN*60000);   // trop vieille, ou date illisible
}

function iconeCamion(c,perime){
  return L.divIcon({
    className:'',
    html:'<div class="camion'+(perime?' perime':'')+'">🚜<span>'+esc(c.nom)+'</span><strong>'+Math.max(0,Math.min(100,Number(c.tour.pourcentage)||0))+' %</strong>'+(c.equipage.length?'<em>👤 '+c.equipage.length+'</em>':'')+'</div>',   // le pourcentage du camion : visible par tout le monde
    iconSize:null,           // la taille de l'étiquette est celle de son contenu (sinon Leaflet l'écrase dans une boîte de 12 px)
    popupAnchor:[0,-16]      // la bulle s'ouvre au-dessus de l'étiquette (centrée sur la position du camion, voir style.css)
  });
}

// Bulle du camion (tout texte venant de la base passe par esc())
function htmlCamion(c,perime){
  const t=c.tour;
  const chauffeur=c.equipage.filter(x=>x.role==='chauffeur').map(x=>esc(x.nom||'?'));
  const abord=c.equipage.filter(x=>x.role!=='chauffeur').map(x=>esc(x.nom||'?'));
  return '<b>🚜 '+esc(c.nom)+'</b><br>Passe n° '+esc(numeroPasse(t))+' · '+esc(t.tache)+
    '<br>'+esc(t.faits)+'/'+esc(t.total)+' ('+esc(t.pourcentage)+' %)'+
    '<br>Chauffeur : '+(chauffeur.length?chauffeur.join(', '):'—')+
    '<br>À bord : '+(abord.length?abord.join(', '):'personne d’autre')+
    '<br><small>'+(perime?'⚠ ':'')+'position '+esc(ilYa(c.position.maj_le))+'</small>';
}

// Dessine, déplace ou retire les camions. Un même camion garde le même marqueur (il se déplace, la bulle ouverte reste ouverte).
function majVehicules(){
  const camions=listeCamions();
  const vus={};
  camions.forEach(c=>{
    vus[c.passeId]=true;
    const perime=positionPerimee(c.position);
    let m=marqueursVehicules[c.passeId];
    if(m){
      m.setLatLng([c.position.lat,c.position.lon]);
      m.setIcon(iconeCamion(c,perime));
      m.setPopupContent(htmlCamion(c,perime));
    } else {
      m=L.marker([c.position.lat,c.position.lon],{icon:iconeCamion(c,perime),zIndexOffset:500}).addTo(map);
      m.bindPopup(htmlCamion(c,perime));
      marqueursVehicules[c.passeId]=m;
    }
  });
  Object.keys(marqueursVehicules).forEach(id=>{
    if(!vus[id]){ map.removeLayer(marqueursVehicules[id]); delete marqueursVehicules[id]; }   // passe terminée, ou camion d'une autre route
  });
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
