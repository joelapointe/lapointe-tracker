// js/carte.js — Initialisation de la carte, GPS, temps réel, adresse inverse
// (extrait de l'ancien index.html)
function initApp(){
  try{
    db = supabase.createClient(SUPA_URL, SUPA_KEY);
  } catch(e){
    showErr('Erreur Supabase: '+esc(e.message)); return;
  }

  // Carte
  try{
    map = L.map('map',{center:[46.55,-72.75],zoom:14,zoomControl:false});
  } catch(e){
    showErr('Erreur carte: '+esc(e.message)); return;
  }

  const layers={
    sat: L.layerGroup([
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:20}),
      L.tileLayer('https://services.arcgisonline.com/arcgis/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{maxZoom:20,opacity:.9}),
    ]),
    map: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:20}),
  };
  let curL='sat';
  layers.sat.addTo(map);

  window.setLayer=function(t){
    if(t===curL) return;
    ['sat','map'].forEach(k=>{try{map.removeLayer(layers[k]);}catch(e){}});
    layers[t].addTo(map);
    curL=t;
    document.getElementById('btn-sat').classList.toggle('on',t==='sat');
    document.getElementById('btn-map').classList.toggle('on',t==='map');
  };

  // GPS
  const dotEl=document.getElementById('gps-dot');
  const lblEl=document.getElementById('gps-lbl');
  const addrEl=document.getElementById('addr-txt');

  if(navigator.geolocation){
    navigator.geolocation.watchPosition(pos=>{
      const{latitude:lat,longitude:lon,accuracy}=pos.coords;
      lastPos=[lat,lon];
      dotEl.className='on';
      lblEl.textContent=`±${Math.round(accuracy)}m`;
      const icon=L.divIcon({className:'',html:`<div style="width:14px;height:14px;border-radius:50%;background:#4ade80;border:3px solid #fff;box-shadow:0 0 8px #4ade80"></div>`,iconSize:[14,14],iconAnchor:[7,7]});
      if(!window._uMk){
        window._uMk=L.marker([lat,lon],{icon,zIndexOffset:1000}).addTo(map);
        window._uCk=L.circle([lat,lon],{radius:accuracy,color:'#4ade80',fillColor:'#4ade80',fillOpacity:.08,weight:1}).addTo(map);
        map.setView([lat,lon],15);
      } else {
        window._uMk.setLatLng([lat,lon]);
        window._uCk.setLatLng([lat,lon]).setRadius(accuracy);
      }
      geocodeReverse(lat,lon,addrEl);
		if(ANCIEN_SUIVI_ACTIF){
		  if(currentUser) envoyerPosition(lat,lon);
		  verifierProximite(lat,lon);
		}
    },()=>{dotEl.className='err';lblEl.textContent='Erreur';},{enableHighAccuracy:true,maximumAge:5000,timeout:15000});
  }

  window.centerUser=function(){if(lastPos) map.flyTo(lastPos,16,{duration:.8});};

  // Temps réel
  // Les arrêts qui changent : on relit tout. Les passes et les arrêts complétés qui changent (sur n'importe quel téléphone) :
  // on relit seulement les tours (une seule fois même si plusieurs changements arrivent d'un coup). Chacun ne reçoit
  // que ce que les règles d'accès lui permettent de voir.
  db.channel('stops-changes')
    .on('postgres_changes',{event:'*',schema:'public',table:'stops'},()=>loadStops())
    .on('postgres_changes',{event:'*',schema:'public',table:'passes'},()=>planifierRechargementTours())
    .on('postgres_changes',{event:'*',schema:'public',table:'passe_arrets'},()=>planifierRechargementTours())
    .on('postgres_changes',{event:'*',schema:'public',table:'positions'},()=>planifierRechargementPositions())
    .subscribe();

  // Session : reprise de celle déjà ouverte sur ce téléphone (Supabase Auth), sinon écran de connexion
  restaurerSession();
}

// ── GEOCODE ────────────────────────────────────────────
let _lgeo=null,_gT=null;
function geocodeReverse(lat,lon,el){
  if(_lgeo&&Math.abs(lat-_lgeo[0])<0.0001&&Math.abs(lon-_lgeo[1])<0.0001) return;
  clearTimeout(_gT);
  _gT=setTimeout(async()=>{
    try{
      const r=await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json`,{headers:{'Accept-Language':'fr'}});
      const d=await r.json();
      const a=d.address||{};
      const p=[a.house_number?`${a.house_number} ${a.road||''}`:a.road||'',a.city||a.town||a.village||a.suburb||''].filter(Boolean);
      el.textContent=p.join(', ')||d.display_name;
      _lgeo=[lat,lon];
    }catch(e){}
  },1500);
}
