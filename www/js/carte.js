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
    // La rotation (étape 18b, plugin vendor/leaflet-rotate) : NORD VERROUILLÉ par défaut ; la boussole (sous les boutons ronds) active la rotation à deux doigts,
    // un deuxième toucher remet le nord en haut et reverrouille. Sans le plugin (fichier absent), ces options sont ignorées : la carte marche, sans pivoter.
    map = L.map('map',{center:[46.55,-72.75],zoom:14,zoomControl:false,rotate:true,bearing:0,touchRotate:true,dragRotate:true,shiftKeyRotate:false,rotateControl:{position:'topright',behavior:'toggle',enabled:false}});
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

  // Le suivi GPS démarre APRÈS la connexion (loadStops : demarrerSuiviGps) et non au chargement de la page : la permission de localisation est demandée UNE
  // SEULE FOIS, à la première ouverture après la connexion (étape 17, morceau 3 ; position.js). La lecture est celle du plugin du téléphone, sinon du navigateur.
  let _gpsDemarre=false;
  window.demarrerSuiviGps=async function(){
    if(_gpsDemarre) return;
    _gpsDemarre=true;
    try{await demanderPermissionPosition();}catch(e){}
    demarrerSuiviPosition(pos=>{
      const{latitude:lat,longitude:lon,accuracy}=pos.coords;   // (lastPos et lastPosInfo : déjà posés par position.js)
      dotEl.className='on';
      lblEl.textContent=`±${Math.round(accuracy)}m`;
      // Le point vert est DESSINÉ ici, à la première lecture ; ensuite il GLISSE jusqu'à chaque lecture — de n'importe quelle source, y compris le service de position du
      // téléphone pendant ma passe, une par seconde — par majPointVert (suivi-carte.js), appelée par noterPosition (position.js). Le cercle de précision le suit.
      // Pendant MA passe il prend l'aspect de mon camion (vehicules.js : majMonCamion) : une seule marque sur ma carte.
      if(!window._uMk){
        window._uMk=L.marker([lat,lon],{icon:iconePointVert(),zIndexOffset:1000}).addTo(map);
        window._uMk._posActuelle=[lat,lon];
        window._uMk._majLeMs=lastPosInfo?lastPosInfo.le:Date.now();
        window._uCk=L.circle([lat,lon],{radius:accuracy,color:'#4ade80',fillColor:'#4ade80',fillOpacity:.08,weight:1}).addTo(map);
        window._uMk.on('move',e=>window._uCk.setLatLng(e.latlng));
        map.setView([lat,lon],15);
        if(typeof majVehicules==='function') majVehicules();   // je conduis déjà une passe : le point devient tout de suite mon camion
        if(typeof suiviMarqueurCree==='function') suiviMarqueurCree();   // la carte attendait peut-être ce point pour le suivre
      }
      geocodeReverse(lat,lon,addrEl);
    },()=>{dotEl.className='err';lblEl.textContent='Erreur';});
  };

  // ◎ : allume le suivi de la carte (elle garde mon point au centre), ou l'éteint s'il est allumé (suivi-carte.js). Avant : un recentrage unique.
  window.centerUser=function(){basculerSuiviCarte();};

  // Temps réel
  // Les arrêts qui changent : on relit tout. Les passes et les arrêts complétés qui changent (sur n'importe quel téléphone) :
  // on relit seulement les tours (une seule fois même si plusieurs changements arrivent d'un coup). Chacun ne reçoit
  // que ce que les règles d'accès lui permettent de voir.
  db.channel('stops-changes')
    .on('postgres_changes',{event:'*',schema:'public',table:'stops'},()=>planifierRechargementArrets())   // (regroupées : l'ordre des clients change deux lignes à la fois)
    .on('postgres_changes',{event:'*',schema:'public',table:'passes'},()=>planifierRechargementTours())
    .on('postgres_changes',{event:'*',schema:'public',table:'passe_arrets'},()=>planifierRechargementTours())
    .on('postgres_changes',{event:'*',schema:'public',table:'positions'},()=>planifierRechargementPositions())
    .on('postgres_changes',{event:'*',schema:'public',table:'problemes'},()=>planifierRechargementProblemes())
    .on('postgres_changes',{event:'*',schema:'public',table:'equipage_periodes'},()=>{planifierRechargementEquipages();planifierRechargementTours();})   // les tours disent aussi « je suis à bord » (un passager retiré le voit tout de suite)
    .subscribe();

  // Session : reprise de celle déjà ouverte sur ce téléphone (Supabase Auth), sinon écran de connexion
  restaurerSession();
}

// Le point vert de ma position (le rond vert à bord blanc). Sert au départ et quand ma passe finit (vehicules.js : retablirPointVert).
function iconePointVert(){
  return L.divIcon({className:'',html:`<div style="width:14px;height:14px;border-radius:50%;background:#4ade80;border:3px solid #fff;box-shadow:0 0 8px #4ade80"></div>`,iconSize:[14,14],iconAnchor:[7,7]});
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
