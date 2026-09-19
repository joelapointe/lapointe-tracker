// js/placement.js — Mode placement de la zone (4 points) et navigation
// (extrait de l'ancien index.html)
// ── MODE PLACEMENT ───────────────────────────────────────
let modeplace=false;
let pointsPlacement=[];
let polygonTemp=null;
let marqueurPoints=[];

function activerPlacement(){
  modeplace=true;
  pointsPlacement=[];
  marqueurPoints=[];
  if(polygonTemp){map.removeLayer(polygonTemp);polygonTemp=null;}
  closeModal();
  document.getElementById('placement-banner').classList.add('active');
  document.getElementById('placement-count').textContent='0/4';
  map.getContainer().style.cursor='crosshair';
  map.on('click',onMapClick);
}

function annulerPlacement(){
  modeplace=false;
  pointsPlacement=[];
  marqueurPoints.forEach(m=>map.removeLayer(m));
  marqueurPoints=[];
  if(polygonTemp){map.removeLayer(polygonTemp);polygonTemp=null;}
  document.getElementById('placement-banner').classList.remove('active');
  map.getContainer().style.cursor='';
  map.off('click',onMapClick);
}

function onMapClick(e){
  if(!modeplace)return;
  const{lat,lng}=e.latlng;
  pointsPlacement.push([lat,lng]);

  // Marqueur point
  const mk=L.circleMarker([lat,lng],{
    radius:6,color:'#c8e63c',fillColor:'#c8e63c',fillOpacity:1,weight:2
  }).addTo(map);
  marqueurPoints.push(mk);

  document.getElementById('placement-count').textContent=pointsPlacement.length+'/4';

  // Dessiner polygone temporaire
  if(polygonTemp)map.removeLayer(polygonTemp);
  if(pointsPlacement.length>=3){
    polygonTemp=L.polygon(pointsPlacement,{
      color:'#c8e63c',fillColor:'#c8e63c',fillOpacity:.2,weight:2,dashArray:'6'
    }).addTo(map);
  }

  if(pointsPlacement.length===4){
    // Zone définie — calculer centre et ouvrir formulaire
    const centerLat=pointsPlacement.reduce((s,p)=>s+p[0],0)/4;
    const centerLon=pointsPlacement.reduce((s,p)=>s+p[1],0)/4;

    map.getContainer().style.cursor='';
    map.off('click',onMapClick);
    document.getElementById('placement-banner').classList.remove('active');
    modeplace=false;

    // Géocodage inverse du centre
    document.getElementById('placement-status').textContent='⏳ Recherche adresse…';
    fetch(`https://nominatim.openstreetmap.org/reverse?lat=${centerLat}&lon=${centerLon}&format=json`,
      {headers:{'Accept-Language':'fr'}})
      .then(r=>r.json())
      .then(d=>{
        const a=d.address||{};
        const parts=[
          a.house_number?`${a.house_number} ${a.road||''}`:a.road||'',
          a.city||a.town||a.village||a.suburb||''
        ].filter(Boolean);
        const adresse=parts.join(', ')||d.display_name;
        document.getElementById('f-addr').value=adresse;
        document.getElementById('placement-status').textContent='✔ '+adresse;
      })
      .catch(()=>{
        document.getElementById('placement-status').textContent='⚠ Adresse non trouvée';
      });

    // Stocker les points pour sauvegarde
    window._zonePoints=pointsPlacement;
    window._zoneLat=centerLat;
    window._zoneLon=centerLon;

    openModal();
  }
}
	function naviguerVersStop(){
  if(activeIdx===null)return;
  const s=stops[activeIdx];
  if(!s.lat)return;

  // Ouvre un choix entre Google Maps et Waze
  const adresse=encodeURIComponent(s.adresse);
  const lat=s.lat;
  const lon=s.lon;

  const gmaps=`https://www.google.com/maps/dir/?api=1&destination=${lat},${lon}&travelmode=driving`;
  const waze=`https://waze.com/ul?ll=${lat},${lon}&navigate=yes`;

  // Détecte si Waze est disponible sinon Google Maps
  const choix=confirm('Naviguer avec :\n\nOK = Google Maps\nAnnuler = Waze');
  window.open(choix?gmaps:waze,'_blank');
}
