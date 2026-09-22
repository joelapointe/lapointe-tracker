// js/liste-arrets.js — Liste des arrêts et ajout d'un arrêt
// (extrait de l'ancien index.html)
function openListe(){
  renderListe();
  document.getElementById('liste-overlay').classList.add('open');
  // le PROCHAIN client de ma passe est amené à l'écran (ordre.js) : une longue liste s'ouvre sur ce qui compte
  const corps=document.getElementById('liste-body');
  const p=corps&&corps.querySelector?corps.querySelector('.ci-prochain'):null;
  if(p&&p.scrollIntoView) p.scrollIntoView({block:'nearest'});
}
function closeListe(){
  document.getElementById('liste-overlay').classList.remove('open');
}
function bgClickListe(e){
  if(e.target===document.getElementById('liste-overlay'))closeListe();
}
function renderListe(){
  // Ce qui est affiché : une route, ou toutes les routes ensemble ; « fait » vient du tour en cours (tours.js)
  const vus=arretsVisibles();
  const todo=vus.filter(s=>!estFait(s));
  const done=vus.filter(s=>estFait(s));
  const tot=vus.length;
  const nb=todo.length;
  document.getElementById('liste-sub').textContent=
    tot===0?'Aucun stop pour cette route':
    nb===0?'✔ Tous les stops sont complétés !':
    nb+' restant'+(nb>1?'s':'')+' · '+done.length+' complété'+(done.length>1?'s':'')+(progression().aucune?' · aucune passe en cours':(progression().enCours?'':' · passe terminée'));
  const body=document.getElementById('liste-body');
  body.innerHTML='';
  const parcoursVide=document.getElementById('liste-parcours');
  if(parcoursVide) parcoursVide.innerHTML='';
  if(typeof majBoutonTraceAdmin==='function') majBoutonTraceAdmin();   // « 🛣 Mettre à jour le tracé » (administrateur seulement, parcours.js)
  if(tot===0){
    body.innerHTML='<div style="padding:32px;text-align:center;color:#6b7a8d;font-size:14px;">Aucun stop.<br>Clique ＋ pour commencer.</div>';
    return;
  }
  // L'ordre des clients (ordre.js, étape 18b) : les clients à faire d'abord, puis les faits, chaque groupe dans l'ORDRE de la route ; le PROCHAIN client de ma passe est
  // marqué ; l'administrateur (une route choisie) déplace les clients à faire avec ▲ ▼ (deux lignes de la base changent, ordre.js : deplacerArret)
  const enOrdreOuTel=(typeof enOrdre==='function')?enOrdre:(l=>l);
  const aFaire=enOrdreOuTel(todo);
  const prochain=(typeof prochainArret==='function')?prochainArret():null;
  const ordonnable=(typeof peutChangerOrdre==='function')&&peutChangerOrdre();
  const sorted=[...aFaire,...enOrdreOuTel(done)];
  sorted.forEach((s,i)=>{
    const div=document.createElement('div');
    const fait=estFait(s);
    const estProchain=!fait&&s===prochain;
    div.className='ci'+(fait?' ci-done':'')+(estProchain?' ci-prochain':'');
    const idx=stops.indexOf(s);
    div.onclick=()=>{closeListe();openCard(idx);};
    const route=routeActive===null?routes.find(r=>r.id===s.route_id):null;   // « toutes les routes » : on nomme la route de chaque arrêt
    const fleches=(ordonnable&&!fait)
      ?'<div class="ci-mv-groupe">'+
        '<button type="button" class="ci-mv" aria-label="Plus tôt dans l’ordre"'+(i===0?' disabled':'')+' onclick="deplacerArret(event,'+idx+',-1)">▲</button>'+
        '<button type="button" class="ci-mv" aria-label="Plus tard dans l’ordre"'+(i===aFaire.length-1?' disabled':'')+' onclick="deplacerArret(event,'+idx+',1)">▼</button></div>'
      :'';
    div.innerHTML=
      '<div class="ci-num">'+(i+1)+'</div>'+
      '<div class="ci-diamond '+(fait?'done':'todo')+'"></div>'+
      '<div class="ci-info">'+
        '<div class="ci-addr '+(fait?'done':'')+'">'+esc(s.adresse)+'</div>'+
        '<div class="ci-svc">'+(route?esc(route.nom)+' · ':'')+esc(s.service||'')+(s.client?' · '+esc(s.client):'')+'</div>'+
      '</div>'+
      '<div class="ci-badge '+(fait?'done':(estProchain?'prochain':'todo'))+'">'+(fait?'✔ FAIT':(estProchain?'▶ PROCHAIN':'À FAIRE'))+(arretEnAttente(s)?' ⏳':'')+'</div>'+   // ⏳ : un geste sur cet arrêt attend le retour du signal (étape 16c)
      fleches;
    body.appendChild(div);
  });
  // « 🧭 Parcours dans Google Maps » : les prochains clients de MA passe, dans l'ordre, en un seul trajet (ordre.js)
  const zoneParcours=document.getElementById('liste-parcours');
  if(zoneParcours){
    const n=(typeof clientsRestants==='function')?Math.min(clientsRestants().length,MAX_ETAPES_GOOGLE):0;
    zoneParcours.innerHTML=n?'<button type="button" class="lf-btn parcours" onclick="ouvrirParcoursGoogle()">🧭 Parcours dans Google Maps · '+n+' client'+(n>1?'s':'')+'</button>':'';
  }
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
const ns={adresse:addr,client:client||null,service,lat,lon,ordre:stops.length,route_id:routeActive||null,zone_points:window._zonePoints||null};
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
