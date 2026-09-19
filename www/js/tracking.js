// js/tracking.js — Positions des tracteurs, proximité, suivi GPS
// (extrait de l'ancien index.html)
// ── HELPERS ────────────────────────────────────────────
// ── TRACTEURS EN TEMPS RÉEL ──────────────────────────────
let tracteurs={};
let posInterval=null;

async function envoyerPosition(lat,lon){
  if(!currentUser)return;
  await db.from('positions').upsert({
    utilisateur_id:currentUser.id,
    nom:currentUser.nom,
    lat,lon,
    updated_at:new Date().toISOString()
  },{onConflict:'utilisateur_id'});
}

async function chargerPositions(){
  if(!currentUser)return;
  const{data}=await db.from('positions').select('*');
  if(!data)return;

  // Supprimer tracteurs déconnectés (pas de mise à jour depuis 2 min)
  const maintenant=Date.now();
  Object.keys(tracteurs).forEach(uid=>{
    const existe=data.find(p=>p.utilisateur_id===uid);
    if(!existe){
      map.removeLayer(tracteurs[uid]);
      delete tracteurs[uid];
    }
  });

  data.forEach(p=>{
    // Ne pas afficher son propre tracteur
    if(p.utilisateur_id===currentUser.id)return;

    // Vérifier si position récente (moins de 2 minutes)
    const age=(maintenant-new Date(p.updated_at).getTime())/1000/60;
    if(age>2){
      if(tracteurs[p.utilisateur_id]){
        map.removeLayer(tracteurs[p.utilisateur_id]);
        delete tracteurs[p.utilisateur_id];
      }
      return;
    }

    const icon=L.divIcon({
      className:'',
      html:`<div style="
        background:#1a1f26;
        border:2px solid #c8e63c;
        border-radius:8px;
        padding:3px 6px;
        font-size:18px;
        line-height:1;
        box-shadow:0 2px 8px rgba(0,0,0,.5);
        white-space:nowrap;
        display:flex;
        align-items:center;
        gap:4px;
      ">🚜<span style="font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;color:#c8e63c;">${esc(p.nom)}</span></div>`,
      iconAnchor:[20,20],
    });

    if(tracteurs[p.utilisateur_id]){
      tracteurs[p.utilisateur_id].setLatLng([p.lat,p.lon]);
      tracteurs[p.utilisateur_id].setIcon(icon);
    } else {
      tracteurs[p.utilisateur_id]=L.marker([p.lat,p.lon],{icon,zIndexOffset:500})
        .addTo(map)
        .bindPopup(`🚜 ${esc(p.nom)}`);
    }
  });
}

// Détection « client en cours » par le GPS : l'ancienne version complétait l'arrêt toute seule en écrivant dans
// stops.fait (colonne retirée à l'étape 13). Elle sera remplacée à l'étape 13c (zone d'une autre couleur pendant que
// le camion est sur place, sans compléter l'arrêt). Jamais appelée tant que ANCIEN_SUIVI_ACTIF est faux.
function verifierProximite(lat,lon){}
	function demarrerTracking(){
  if(posInterval)clearInterval(posInterval);
  // Envoyer position toutes les 10 secondes
  posInterval=setInterval(()=>{
    if(lastPos) envoyerPosition(lastPos[0],lastPos[1]);
    chargerPositions();
  },10000);
  // Premier envoi immédiat
  if(lastPos) envoyerPosition(lastPos[0],lastPos[1]);
  chargerPositions();
}

async function arreterTracking(){
  if(posInterval){
    clearInterval(posInterval);
    posInterval=null;
  }
  if(!ANCIEN_SUIVI_ACTIF) return;   // ancien suivi désactivé (étape 12) : rien à effacer dans la base
  // Supprimer sa position de la BD.
  // (Avant, la requête n'était jamais envoyée : il manquait le « await ».)
  // On n'attend pas plus de 2,5 s : sans réseau, la déconnexion doit quand même fonctionner.
  if(currentUser){
    try{
      await Promise.race([
        db.from('positions').delete().eq('utilisateur_id',currentUser.id),
        new Promise(res=>setTimeout(res,2500))
      ]);
    }catch(e){}
  }
}
