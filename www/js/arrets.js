// js/arrets.js — Arrêts (stops) : lecture/écriture Supabase, marqueurs, fiche
// (extrait de l'ancien index.html, aucun changement de code)
// ── SUPABASE CRUD ──────────────────────────────────────
async function loadStops(){
  setStatus('Chargement des stops…');
  try{
    const{data,error}=await db.from('stops').select('*').order('ordre');
    if(error) throw error;
 stops=data||[];
    await loadRoutes();
    // Charger les problèmes pour chaque stop
    const{data:probs}=await db.from('problemes').select('*').eq('lu',false);
    const probMap={};
    (probs||[]).forEach(p=>{probMap[p.stop_id]=p;});
    stops=stops.map(s=>({...s,_probleme:probMap[s.id]||null}));
    renderAll();
    hideLoading();
    updateBar();
	  checkProblemes();
    
  }catch(e){
    showErr('Impossible de charger les données.<br>Vérifie que les politiques RLS sont activées dans Supabase.<br><br><small>'+e.message+'</small>');
  }
}

async function dbSave(s){
  showSync(true);
  const{data,error}=await db.from('stops').insert([s]).select().single();
  showSync(false);
  if(error){toast('❌ '+error.message);return null;}
  return data;
}

async function dbDone(id){
  showSync(true);
  await db.from('stops').update({fait:true}).eq('id',id);
  showSync(false);
}

async function dbDel(id){
  showSync(true);
  await db.from('stops').delete().eq('id',id);
  showSync(false);
}

// ── MARQUEURS ──────────────────────────────────────────
function mkIcon(done,hasProb,onSite){
  const c=hasProb?'#fb923c':(done?'#4ade80':(onSite?'#60a5fa':'#c8e63c'));
  const s=done&&!hasProb?14:18;
  return L.divIcon({className:'',html:`<div style="width:${s}px;height:${s}px;background:${c};border:2px solid rgba(0,0,0,.5);transform:rotate(45deg);box-shadow:0 2px 6px rgba(0,0,0,.6)"></div>`,iconSize:[s,s],iconAnchor:[s/2,s/2]});
}

function renderAll(){
  Object.values(mkrs).forEach(m=>map.removeLayer(m));
  Object.keys(mkrs).forEach(k=>delete mkrs[k]);
  stops.forEach((s,i)=>{
    if(!s.lat) return;
  if(routeActive!==null && s.route_id!==routeActive) return;
  const m=L.marker([s.lat,s.lon],{icon:mkIcon(s.fait,s._probleme,s._onSite)}).addTo(map);
    m.on('click',()=>openCard(i));
    mkrs[i]=m;
  });
  // Dessiner les zones polygonales
  stops.forEach(s=>{
    if(!s.zone_points||!Array.isArray(s.zone_points))return;
    const c=s._probleme?'#fb923c':(s.fait?'#4ade80':'#c8e63c');
    L.polygon(s.zone_points,{
      color:c,fillColor:c,fillOpacity:.15,weight:2
    }).addTo(map);
  });
	updateBar();
}

function updateBar(){
  const tot=stops.length,done=stops.filter(s=>s.fait).length,pct=tot?Math.round(done/tot*100):0;
  document.getElementById('op-name').textContent=currentUser?currentUser.nom:operator||'—';
 document.getElementById('zone-val').textContent=zone||'Toutes les routes';
  document.getElementById('prog-txt').textContent=`${done}/${tot}`;
  document.getElementById('prog-pct').textContent=`${pct}%`;
  document.getElementById('prog-fill').style.width=pct+'%';
}

// ── STOP CARD ──────────────────────────────────────────
function openCard(i){
  const s=stops[i];if(!s)return;
  activeIdx=i;
  document.getElementById('sc-addr').textContent=s.adresse;
  document.getElementById('sc-svc').textContent=s.service||'';
  document.getElementById('sc-cli').textContent=s.client||'';
  const b=document.getElementById('btn-cmp');
  b.textContent=s.fait?'✔ Déjà complété':'✔ Complété';
  b.className=s.fait?'scb done2':'scb done';
  document.getElementById('stop-card').classList.add('open');
  map.flyTo([s.lat,s.lon],17,{duration:.7});
}

function closeCard(){document.getElementById('stop-card').classList.remove('open');activeIdx=null;}

async function completeStop(){
  if(activeIdx===null)return;
  const s=stops[activeIdx];if(s.fait)return;
  await dbDone(s.id);s.fait=true;renderAll();closeCard();toast('✔ Stop complété !');
}

async function deleteStop(){
  if(activeIdx===null)return;
  const s=stops[activeIdx];
  if(!confirm(`Supprimer "${s.adresse}" ?`))return;
  await dbDel(s.id);stops.splice(activeIdx,1);renderAll();closeCard();toast('🗑 Supprimé');
}
