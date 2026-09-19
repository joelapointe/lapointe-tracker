// js/liste-arrets.js — Liste des arrêts et ajout d'un arrêt
// (extrait de l'ancien index.html)
function openListe(){
  renderListe();
  document.getElementById('liste-overlay').classList.add('open');
}
function closeListe(){
  document.getElementById('liste-overlay').classList.remove('open');
}
function bgClickListe(e){
  if(e.target===document.getElementById('liste-overlay'))closeListe();
}
function renderListe(){
  const todo=stops.filter(s=>!s.fait);
  const done=stops.filter(s=>s.fait);
  const tot=stops.length;
  const nb=todo.length;
  document.getElementById('liste-sub').textContent=
    tot===0?'Aucun stop pour cette route':
    nb===0?'✔ Tous les stops sont complétés !':
    nb+' restant'+(nb>1?'s':'')+' · '+done.length+' complété'+(done.length>1?'s':'');
  const body=document.getElementById('liste-body');
  body.innerHTML='';
  if(tot===0){
    body.innerHTML='<div style="padding:32px;text-align:center;color:#6b7a8d;font-size:14px;">Aucun stop.<br>Clique ＋ pour commencer.</div>';
    return;
  }
  const sorted=[...todo,...done];
  sorted.forEach((s,i)=>{
    const div=document.createElement('div');
    div.className='ci'+(s.fait?' ci-done':'');
    const idx=stops.indexOf(s);
    div.onclick=()=>{closeListe();openCard(idx);};
    div.innerHTML=
      '<div class="ci-num">'+(i+1)+'</div>'+
      '<div class="ci-diamond '+(s.fait?'done':'todo')+'"></div>'+
      '<div class="ci-info">'+
        '<div class="ci-addr '+(s.fait?'done':'')+'">'+esc(s.adresse)+'</div>'+
        '<div class="ci-svc">'+esc(s.service||'')+(s.client?' · '+esc(s.client):'')+'</div>'+
      '</div>'+
      '<div class="ci-badge '+(s.fait?'done':'todo')+'">'+(s.fait?'✔ FAIT':'À FAIRE')+'</div>';
    body.appendChild(div);
  });
}
function openModal(){
  document.getElementById('overlay').classList.add('open');
  document.getElementById('geo-st').textContent='';
  document.getElementById('geo-st').className='';
  document.getElementById('f-op').value=operator;
  document.getElementById('f-zone').value=zone;
  document.getElementById('f-addr').value='';
  document.getElementById('f-client').value='';
}
function closeModal(){document.getElementById('overlay').classList.remove('open');}
function bgClick(e){if(e.target===document.getElementById('overlay'))closeModal();}

async function addStop(){
  const addr=document.getElementById('f-addr').value.trim();
  const client=document.getElementById('f-client').value.trim();
  const service=document.getElementById('f-svc').value;
  const op=document.getElementById('f-op').value.trim();
  const z=document.getElementById('f-zone').value.trim();
  if(!addr){toast('⚠ Entrez une adresse');return;}
  if(op){operator=op;localStorage.setItem('lp_op',op);}
  if(z){zone=z;localStorage.setItem('lp_zone',z);}
  const st=document.getElementById('geo-st');
  st.className='';st.textContent='⏳ Géocodage…';
  try{
    const r=await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr)}&format=json&limit=1`,{headers:{'Accept-Language':'fr'}});
    const d=await r.json();
    if(!d.length){st.className='err';st.textContent='❌ Adresse introuvable';return;}
  const lat=window._zoneLat||parseFloat(d[0].lat);
const lon=window._zoneLon||parseFloat(d[0].lon);
const ns={adresse:addr,client:client||null,service,lat,lon,fait:false,ordre:stops.length,route_id:routeActive||null,zone_points:window._zonePoints||null};
window._zonePoints=null;window._zoneLat=null;window._zoneLon=null;
    st.className='ok';st.textContent='✔ Sauvegarde…';
    const saved=await dbSave(ns);
    if(!saved)return;
    stops.push(saved);renderAll();
    map.flyTo([saved.lat,saved.lon],17,{duration:.8});
    toast('📍 Stop ajouté !');
    setTimeout(closeModal,500);
  }catch(e){st.className='err';st.textContent='❌ Erreur réseau';}
}
