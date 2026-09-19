// js/routes.js — Routes et « Nouvelle passe »
// (extrait de l'ancien index.html)
// ── MODAL ──────────────────────────────────────────────
let routes=[];
let routeActive=null;

async function loadRoutes(){
  const{data}=await db.from('routes').select('*').order('created_at');
  routes=data||[];
}

function openRoutes(){
  renderRoutes();
  document.getElementById('routes-overlay').classList.add('open');
}
async function nouvellePasse(){
  const route=routes.find(r=>r.id===routeActive);
  const nom=route?route.nom:'cette route';
  if(!confirm('Remettre tous les stops de "'+nom+'" en non-complétés ?'))return;
  const stopsRoute=stops.filter(s=>s.route_id===routeActive);
  if(!stopsRoute.length){toast('Aucun stop sur cette route');return;}
  showSync(true);
  for(const s of stopsRoute){
    await db.from('stops').update({fait:false}).eq('id',s.id);
    s.fait=false;
  }
  // Supprimer les problèmes de ces stops aussi
  for(const s of stopsRoute){
    await db.from('problemes').delete().eq('stop_id',s.id);
  }
  showSync(false);
  renderAll();
  closeRoutes();
  toast('🔄 Nouvelle passe lancée !');
}
function closeRoutes(){
  document.getElementById('routes-overlay').classList.remove('open');
}

function bgClickRoutes(e){
  if(e.target===document.getElementById('routes-overlay'))closeRoutes();
}

function renderRoutes(){
  const body=document.getElementById('routes-body');
  const isAdmin=currentUser&&currentUser.role==='admin';
  body.innerHTML='';

  // Option "Toutes les routes"
  const all=document.createElement('div');
  all.className='route-item'+(routeActive===null?' active':'');
  all.onclick=()=>{routeActive=null;zone='Toutes les routes';localStorage.setItem('lp_zone','');updateBar();renderAll();closeRoutes();};
  all.innerHTML=
    '<div class="route-dot" style="background:#c8e63c"></div>'+
    '<div class="route-nom">Toutes les routes</div>'+
    '<div class="route-count">'+stops.length+' stops</div>';
  body.appendChild(all);

  if(routes.length===0){
    const empty=document.createElement('div');
    empty.style='padding:20px 16px;color:#6b7a8d;font-size:13px;';
    empty.textContent='Aucune route créée.';
    body.appendChild(empty);
    return;
  }

  routes.forEach(r=>{
    const count=stops.filter(s=>s.route_id===r.id).length;
    const div=document.createElement('div');
    div.className='route-item'+(routeActive===r.id?' active':'');
    div.onclick=()=>{
      routeActive=r.id;
      zone=r.nom;
      localStorage.setItem('lp_zone',r.nom);
      updateBar();
      renderAll();
      closeRoutes();
    };
    div.innerHTML=
      '<div class="route-dot" style="background:'+couleurSure(r.couleur)+'"></div>'+
      '<div class="route-nom">'+esc(r.nom)+'</div>'+
      '<div class="route-count">'+count+' stops</div>';
    if(isAdmin){
      const del=document.createElement('button');
      del.className='route-del';
      del.textContent='🗑';
      del.onclick=e=>supprimerRoute(e,r.id);
      div.appendChild(del);
    }
    body.appendChild(div);
  });

  // Bouton nouvelle route visible seulement admin
  document.getElementById('btn-nouvelle-route').style.display=isAdmin?'flex':'none';
	document.getElementById('btn-nouvelle-passe').style.display=routeActive?'flex':'none';
}

function openNouvelleRoute(){
  document.getElementById('nouvelle-route-overlay').classList.add('open');
  document.getElementById('nr-nom').value='';
}

function closeNouvelleRoute(){
  document.getElementById('nouvelle-route-overlay').classList.remove('open');
}

function bgClickNR(e){
  if(e.target===document.getElementById('nouvelle-route-overlay'))closeNouvelleRoute();
}

async function sauvegarderRoute(){
  const nom=document.getElementById('nr-nom').value.trim();
  const couleur=document.getElementById('nr-couleur').value;
  if(!nom){toast('⚠ Entre un nom de route');return;}
  showSync(true);
  const{data,error}=await db.from('routes').insert([{nom,couleur}]).select().single();
  showSync(false);
  if(error){toast('❌ '+error.message);return;}
  routes.push(data);
  toast('✔ Route créée !');
  closeNouvelleRoute();
  renderRoutes();
}

async function supprimerRoute(e,id){
  e.stopPropagation();
  if(!confirm('Supprimer cette route ?'))return;
  await db.from('routes').delete().eq('id',id);
  routes=routes.filter(r=>r.id!==id);
  if(routeActive===id){routeActive=null;zone='Toutes les routes';}
  renderRoutes();
  renderAll();
  toast('🗑 Route supprimée');
  }
