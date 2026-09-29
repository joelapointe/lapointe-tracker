// js/zone-terrain.js — Demande 3 de Joé (29 sept. 2026) : DESSINER LA ZONE DU TERRAIN dès la création d'un arrêt — et la corriger ensuite
//
// Avant : taper l'adresse d'un client ne posait qu'un repère (un point). La zone (les coins du terrain, colonne stops.zone_points) n'existait que par « 📍 Placer sur la carte »
// (4 touchers) ; AUCUN écran ne permettait de dessiner ou de corriger la zone d'un arrêt déjà créé.
// Décisions de Joé (29 sept. 2026) : (1) après l'adresse, la carte se place sur le terrain avec un RECTANGLE DE DÉPART de 15 m × 15 m dont les 4 coins se déplacent au doigt ;
// (2) la zone est FACULTATIVE (« Passer (sans zone) » enregistre l'arrêt comme avant) ; (3) le même outil corrige la zone d'un arrêt existant (« ✏ Modifier la zone » dans sa fiche),
// réservé à l'administrateur (règle stops_admin : écriture directe, AUCUN SQL, aucune fonction serveur).
// La zone ne sert qu'à l'affichage : le repère du client (lat, lon) ne change jamais ici.
//
// Ce fichier = l'éditeur (une barre en bas qui recouvre la barre du bas, 4 poignées, le polygone) + le « Modifier la zone » de la fiche.
// « ＋ Nouveau stop » (liste-arrets.js : addStop) l'appelle après le géocodage de l'adresse.
const ZONE_COTE_DEPART_M=15;      // le rectangle de départ : 15 m × 15 m, centré sur l'adresse (décision de Joé)
const ZONE_ZOOM_MAX=19;           // zoom d'édition : à 19, 15 m font environ 73 px (les coins ont de la place pour les doigts) ; le zoom se règle ensuite à la main
const ZONE_AIRE_MIN_M2=2;         // en dessous, les coins ont été ramenés ensemble par accident
const ZONE_M_PAR_DEGRE=111320;    // mètres par degré de latitude (la longitude : × cos(latitude))

let zoneEd=null;                  // null : aucun éditeur ouvert ; sinon {points, poly, poignees, stopId, enregistrer, sans, annule, occupe}

function zoneEditeurActif(){return !!zoneEd;}
// L'arrêt dont on corrige la zone : arrets.js (renderAll) ne dessine PAS son ancienne zone pendant ce temps (le polygone de l'éditeur la remplace)
function zoneArretEnEdition(s){return !!zoneEd&&!!zoneEd.stopId&&!!s&&s.id===zoneEd.stopId;}

// ── La géométrie ────────────────────────────────────
function zonePointValide(p){return Array.isArray(p)&&p.length===2&&typeof p[0]==='number'&&typeof p[1]==='number'&&isFinite(p[0])&&isFinite(p[1])&&Math.abs(p[0])<=90&&Math.abs(p[1])<=180;}
// Une zone de la base qu'on sait relire : au moins 3 coins [latitude, longitude]
function zoneValide(pts){return Array.isArray(pts)&&pts.length>=3&&pts.every(zonePointValide);}
// Le rectangle de départ : `cote` mètres de côté, centré sur (lat, lon). Coins dans l'ordre nord-ouest, nord-est, sud-est, sud-ouest.
function zoneRectangleDepart(lat,lon,cote){
  const demi=(cote||ZONE_COTE_DEPART_M)/2;
  const dLat=demi/ZONE_M_PAR_DEGRE;
  const dLon=demi/(ZONE_M_PAR_DEGRE*Math.cos(lat*Math.PI/180));
  return [[lat+dLat,lon-dLon],[lat+dLat,lon+dLon],[lat-dLat,lon+dLon],[lat-dLat,lon-dLon]];
}
// L'aire en m² (projection locale autour du centre : assez exacte pour un terrain)
function zoneAireM2(pts){
  const n=pts.length;
  const lat0=pts.reduce((s,p)=>s+p[0],0)/n;
  const lon0=pts.reduce((s,p)=>s+p[1],0)/n;
  const k=Math.cos(lat0*Math.PI/180);
  const xy=pts.map(p=>[(p[1]-lon0)*ZONE_M_PAR_DEGRE*k,(p[0]-lat0)*ZONE_M_PAR_DEGRE]);
  let somme=0;
  for(let i=0;i<n;i++){const a=xy[i],b=xy[(i+1)%n];somme+=a[0]*b[1]-b[0]*a[1];}
  return Math.abs(somme)/2;
}
// Deux côtés qui ne se touchent pas et se COUPENT : la zone serait un « nœud papillon » (deux coins échangés)
function zoneSeCroise(pts){
  const n=pts.length;
  const sens=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const coupe=(a,b,c,d)=>sens(a,b,c)*sens(a,b,d)<0&&sens(c,d,a)*sens(c,d,b)<0;
  for(let i=0;i<n;i++)for(let j=i+2;j<n;j++){
    if(i===0&&j===n-1) continue;   // le premier et le dernier côté se touchent (au coin de départ)
    if(coupe(pts[i],pts[(i+1)%n],pts[j],pts[(j+1)%n])) return true;
  }
  return false;
}
// Ce qui empêche d'enregistrer cette zone (un texte pour l'écran), ou null si elle est bonne
function zoneErreur(pts){
  if(!zoneValide(pts)) return 'La zone n’est pas valide.';
  if(zoneSeCroise(pts)) return 'Les côtés de la zone se croisent : déplace un coin.';
  if(zoneAireM2(pts)<ZONE_AIRE_MIN_M2) return 'La zone est trop petite.';
  return null;
}
// Environ 1 cm de précision : un texte court dans la base
function zoneArrondie(pts){return pts.map(p=>[Math.round(p[0]*1e7)/1e7,Math.round(p[1]*1e7)/1e7]);}

// ── L'éditeur ───────────────────────────────────────
// Une poignée : un gros rond (44 px de zone à toucher, pour un doigt ou un gant) avec un rond visible plus petit au centre
function iconePoigneeZone(){return L.divIcon({className:'zone-poignee',html:'<span></span>',iconSize:[44,44],iconAnchor:[22,22]});}

// La barre : la surface (ou ce qui empêche d'enregistrer) et l'état des boutons
function zoneMajBarre(){
  if(!zoneEd) return;
  const erreur=zoneErreur(zoneEd.points);
  const info=document.getElementById('zone-info');
  info.textContent=erreur?'⚠ '+erreur:'≈ '+Math.round(zoneAireM2(zoneEd.points))+' m²';
  info.className=erreur?'err':'';
  document.getElementById('zone-ok').disabled=!!erreur||zoneEd.occupe;
  document.getElementById('zone-sans').disabled=zoneEd.occupe;
  document.getElementById('zone-annuler').disabled=zoneEd.occupe;
}

// Un coin déplacé (pendant le glissement, et à la fin) : le polygone le suit
function zoneCoinBouge(i){
  if(!zoneEd||!zoneEd.poignees[i]) return;
  const ll=zoneEd.poignees[i].getLatLng();
  zoneEd.points[i]=[ll.lat,ll.lng];
  zoneEd.poly.setLatLngs(zoneEd.points);
  zoneMajBarre();
}

// Ouvre l'éditeur. o : {lat, lon (le centre du rectangle de départ), points (la zone à corriger, sinon le rectangle de départ), stopId (l'arrêt dont on corrige la zone, sinon
// null : nouvel arrêt), titre, adresse, sans (l'action du bouton « sans zone », ou null : pas de bouton), libelleSans, enregistrer(points), annule()}.
// enregistrer() et sans() renvoient une promesse : true = fini (l'éditeur se ferme) ; false = refus ou signal perdu (il reste ouvert : le dessin n'est jamais perdu).
function demarrerEditeurZone(o){
  if(!map||!o||typeof L==='undefined') return false;
  if(zoneEd) zoneRetirer();   // un seul éditeur à la fois : l'ancien est abandonné, sans rien enregistrer
  const points=zoneValide(o.points)?o.points.map(p=>[p[0],p[1]]):zoneRectangleDepart(o.lat,o.lon,ZONE_COTE_DEPART_M);
  // La fiche d'un client se range, SANS reprendre le suivi de la carte : il reprendra à la fin de l'édition (comme à la fermeture d'une fiche)
  const fiche=document.getElementById('stop-card');
  if(fiche) fiche.classList.remove('open');
  if(typeof activeIdx!=='undefined') activeIdx=null;
  const poly=L.polygon(points,{color:'#c8e63c',fillColor:'#c8e63c',fillOpacity:.2,weight:2,dashArray:'6',interactive:false}).addTo(map);
  const ed={points,poly,poignees:[],stopId:o.stopId||null,enregistrer:o.enregistrer||null,sans:o.sans||null,annule:o.annule||null,occupe:false};
  points.forEach((p,i)=>{
    const mk=L.marker(p,{draggable:true,icon:iconePoigneeZone(),zIndexOffset:2000,keyboard:false}).addTo(map);
    mk.on('drag',()=>zoneCoinBouge(i));
    mk.on('dragend',()=>zoneCoinBouge(i));
    ed.poignees.push(mk);
  });
  zoneEd=ed;
  if(ed.stopId&&typeof renderAll==='function') renderAll();   // l'ancienne zone de cet arrêt disparaît tout de suite : le polygone de l'éditeur la remplace (arrets.js : renderAll ne la redessine pas)
  document.getElementById('zone-titre').textContent=o.titre||'✏ Glisse les coins sur le terrain';
  document.getElementById('zone-adresse').textContent=o.adresse||'';
  const sans=document.getElementById('zone-sans');
  sans.style.display=o.sans?'':'none';
  sans.textContent=o.libelleSans||'Sans zone';
  document.getElementById('zone-barre').classList.add('active');
  zoneMajBarre();
  // La carte se place sur la zone : au zoom d'édition, ou plus loin si la zone est grande ; les bords restent visibles, hors de la barre du haut et de celle du bas
  try{map.flyToBounds(points,{paddingTopLeft:[40,80],paddingBottomRight:[40,170],maxZoom:ZONE_ZOOM_MAX,duration:.6});}catch(e){}
  return true;
}

// Retire l'éditeur de la carte (sans rien enregistrer) ; renvoie ce qui était ouvert
function zoneRetirer(){
  const ed=zoneEd;
  zoneEd=null;
  if(!ed) return null;
  try{map.removeLayer(ed.poly);ed.poignees.forEach(m=>map.removeLayer(m));}catch(e){}
  const barre=document.getElementById('zone-barre');
  if(barre) barre.classList.remove('active');
  return ed;
}
// Fin de l'édition (enregistrée ou annulée) : tout disparaît ; l'ancienne zone de l'arrêt, cachée pendant l'édition, est redessinée ; le suivi mis en pause par la fiche reprend
function zoneFermer(){
  const ed=zoneRetirer();
  if(ed&&ed.stopId&&typeof renderAll==='function') renderAll();
  if(typeof reprendreSuiviCarte==='function') reprendreSuiviCarte();   // (après zoneRetirer : tant que l'éditeur est ouvert, aucun suivi ne démarre)
  if(typeof majSuiviSelonPasse==='function') majSuiviSelonPasse();     // une passe a peut-être débuté pendant l'édition : son suivi, remis à plus tard, part maintenant
}

// Le travail d'un bouton (enregistrer, sans zone) : pendant ce temps les boutons sont bloqués (pas de double envoi) ; s'il échoue l'éditeur reste ouvert
async function zoneTerminer(action,points){
  const ed=zoneEd;
  if(!ed||ed.occupe||!action) return;
  ed.occupe=true;zoneMajBarre();
  let ok=false;
  try{ok=!!(await action(points));}catch(e){toast('❌ Erreur réseau');}
  if(zoneEd!==ed) return;   // l'éditeur a été fermé entre-temps
  ed.occupe=false;
  if(ok) zoneFermer(); else zoneMajBarre();
}
async function zoneEnregistrer(){
  if(!zoneEd||zoneEd.occupe) return;
  const erreur=zoneErreur(zoneEd.points);
  if(erreur){toast('⚠ '+erreur);return;}
  await zoneTerminer(zoneEd.enregistrer,zoneArrondie(zoneEd.points));
}
async function zoneSansZone(){
  if(!zoneEd||zoneEd.occupe||!zoneEd.sans) return;
  await zoneTerminer(zoneEd.sans,null);
}
function zoneAnnuler(){
  const ed=zoneEd;
  if(!ed||ed.occupe) return;
  zoneFermer();
  if(ed.annule) ed.annule();   // (nouvel arrêt : retour au formulaire, ses champs sont restés)
}

// ── La fiche d'un arrêt existant : « ✏ Modifier la zone » (l'administrateur seulement) ──
function estAdminZone(){return !!currentUser&&currentUser.role==='admin';}
// Le bouton de la fiche (index.html : #btn-zone) : son texte dit s'il y a déjà une zone (appelée par arrets.js : majCarte)
function majBoutonZoneFiche(s){
  const b=document.getElementById('btn-zone');
  if(!b) return;
  b.style.display=(estAdminZone()&&s)?'inline-block':'none';
  b.textContent=zoneValide(s&&s.zone_points)?'✏ Modifier la zone':'✏ Dessiner la zone';
}
function modifierZoneArret(){
  if(activeIdx===null||!estAdminZone()) return;
  const s=stops[activeIdx];
  if(!s) return;
  if(!s.lat||!s.lon){toast('⚠ Cet arrêt n’a pas de position sur la carte');return;}
  const avait=zoneValide(s.zone_points);
  const id=s.id;
  demarrerEditeurZone({
    stopId:id,adresse:s.adresse,lat:s.lat,lon:s.lon,points:avait?s.zone_points:null,
    titre:avait?'✏ Ajuste les coins de la zone':'✏ Glisse les coins sur le terrain',
    enregistrer:pts=>ecrireZoneArret(id,pts,'✔ Zone enregistrée'),
    libelleSans:'Retirer la zone',
    sans:avait?async()=>{
      if(!(await confirmer('Retirer la zone ?',s.adresse+' : le repère du client reste, seule la zone dessinée est effacée.','Retirer','Garder'))) return false;
      return ecrireZoneArret(id,null,'🗑 Zone retirée');
    }:null,
  });
}
// Écrit la zone (ou null : plus de zone) sur l'arrêt : écriture directe, permise à l'administrateur par la règle stops_admin. Renvoie true si elle est enregistrée.
async function ecrireZoneArret(id,pts,message){
  if(!reseau.enLigne){toast('📴 Pas de réseau : la zone ne peut pas être enregistrée maintenant.');return false;}
  showSync(true);
  try{
    const r=await db.from('stops').update({zone_points:pts}).eq('id',id).select('id');
    if(r&&r.error){
      toast(estErreurReseau(r.error)?'📴 Le signal a disparu : la zone n’a pas été enregistrée.':'❌ La zone n’a pas pu être enregistrée.');
      if(estErreurReseau(r.error)) signalerEchecReseau(r.error);
      return false;
    }
    // Un refus de la base ne donne pas toujours une erreur : aucune ligne changée = l'arrêt n'existe plus, ou l'accès est refusé
    if(!r||!Array.isArray(r.data)||!r.data.length){toast('❌ La zone n’a pas été enregistrée (arrêt introuvable ou accès refusé).');return false;}
    const s=stops.find(x=>x.id===id);
    if(s) s.zone_points=pts;
    renderAll();   // la zone est redessinée, aux couleurs de l'état de l'arrêt
    toast(message);
    return true;
  }catch(e){
    toast('📴 Le signal a disparu : la zone n’a pas été enregistrée.');
    signalerEchecReseau(e);
    return false;
  }finally{
    showSync(false);
  }
}
