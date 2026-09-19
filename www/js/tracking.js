// js/tracking.js — Positions des tracteurs, proximité, suivi GPS
// (extrait de l'ancien index.html, aucun changement de code)
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
      ">🚜<span style="font-family:'Barlow Condensed',sans-serif;font-size:11px;font-weight:700;color:#c8e63c;">${p.nom}</span></div>`,
      iconAnchor:[20,20],
    });

    if(tracteurs[p.utilisateur_id]){
      tracteurs[p.utilisateur_id].setLatLng([p.lat,p.lon]);
      tracteurs[p.utilisateur_id].setIcon(icon);
    } else {
      tracteurs[p.utilisateur_id]=L.marker([p.lat,p.lon],{icon,zIndexOffset:500})
        .addTo(map)
        .bindPopup(`🚜 ${p.nom}`);
    }
  });
}

let onSiteTimers={};

function verifierProximite(lat,lon){
  if(!currentUser||currentUser.role==='admin')return;
  const RAYON=30; // mètres
  const TEMPS=30*1000; // 30 secondes

  stops.forEach((s,i)=>{
    if(!s.lat||s.fait)return;
    const dist=getDistance(lat,lon,s.lat,s.lon);

    if(dist<=RAYON){
      // L'employé est sur place
      if(!s._onSite){
        s._onSite=true;
        renderAll();
        toast('📍 Sur place : '+s.adresse);
      }
      // Démarrer timer si pas déjà démarré
      if(!onSiteTimers[s.id]){
        onSiteTimers[s.id]=setTimeout(async()=>{
          // Vérifier encore que l'employé est toujours là
          if(s._onSite&&!s.fait){
            await dbDone(s.id);
            s.fait=true;
            s._onSite=false;
            delete onSiteTimers[s.id];
            renderAll();
            toast('✔ Auto-complété : '+s.adresse);
          }
        },TEMPS);
      }
    } else {
      // L'employé est parti
      if(s._onSite){
        s._onSite=false;
        renderAll();
      }
      if(onSiteTimers[s.id]){
        clearTimeout(onSiteTimers[s.id]);
        delete onSiteTimers[s.id];
      }
    }
  });
}
	function getDistance(lat1,lon1,lat2,lon2){
  const R=6371000;
  const dLat=(lat2-lat1)*Math.PI/180;
  const dLon=(lon2-lon1)*Math.PI/180;
  const a=Math.sin(dLat/2)*Math.sin(dLat/2)+
    Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*
    Math.sin(dLon/2)*Math.sin(dLon/2);
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}
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

function arreterTracking(){
  if(posInterval){
    clearInterval(posInterval);
    posInterval=null;
  }
  // Supprimer sa position de la BD
  if(currentUser){
    db.from('positions').delete().eq('utilisateur_id',currentUser.id);
  }
}
