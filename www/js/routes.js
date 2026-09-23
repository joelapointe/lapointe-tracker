// js/routes.js — Routes et « Nouvelle passe »
// (extrait de l'ancien index.html)
// ── MODAL ──────────────────────────────────────────────
let routes=[];
let routeActive=null;

async function loadRoutes(){
  const{data,error}=await db.from('routes').select('*').order('created_at');
  if(error) throw error;
  routes=data||[];
  lectureReussie('routes',routes);
  restaurerRouteChoisie();
}

// Le nom de la route choisie est gardé d'une session à l'autre (lp_zone) : on retrouve la route par son nom, pour que
// l'étiquette du bas et la carte disent la même chose. Route disparue : retour à « Toutes les routes ».
function restaurerRouteChoisie(){
  if(routeActive!==null&&routes.some(r=>r.id===routeActive)) return;   // déjà choisie pendant cette session
  const r=zone?routes.find(x=>x.nom===zone):null;
  if(r){routeActive=r.id;}
  else{routeActive=null;zone='';}
}

function openRoutes(){
  renderRoutes();
  document.getElementById('routes-overlay').classList.add('open');
}
// (Le bouton « Nouvelle passe » qui remettait tout à zéro ET effaçait les problèmes est retiré à l'étape 13 :
//  une passe est maintenant un enregistrement distinct qu'on « débute » sans rien effacer — écran à l'étape 14.)
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

  // Une route désactivée (étape 19b, onglet admin « Routes ») ne se propose plus ici — comme un véhicule désactivé pour une
  // passe : elle reste dans la base (historique intact) et reste gérable dans l'onglet admin, seulement rangée de ce picker.
  const routesVisibles=routes.filter(r=>r.actif);
  if(routesVisibles.length===0){
    const empty=document.createElement('div');
    empty.style='padding:20px 16px;color:#6b7a8d;font-size:13px;';
    empty.textContent='Aucune route créée.';
    body.appendChild(empty);
    return;
  }

  routesVisibles.forEach(r=>{
    const count=stops.filter(s=>s.route_id===r.id).length;
    const nbTours=tours.filter(t=>t.route_id===r.id&&tourEnCours(t)).length;   // passes en cours sur cette route (une par tâche)
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
      '<div class="route-count">'+count+' stops'+(nbTours?' · '+nbTours+' passe'+(nbTours>1?'s':'')+' en cours':'')+'</div>';
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
  // Boîte de l'application (la fenêtre native confirm() est refusée d'office par certains navigateurs intégrés)
  const route=routes.find(r=>r.id===id);
  if(!(await confirmer('Supprimer cette route ?',route?route.nom:'','Supprimer','Annuler')))return;
  const{error}=await db.from('routes').delete().eq('id',id);
  if(error){toast('❌ Impossible : cette route a des arrêts ou un historique');return;}   // la base refuse (jamais de perte d'historique)
  routes=routes.filter(r=>r.id!==id);
  if(routeActive===id){routeActive=null;zone='Toutes les routes';}
  renderRoutes();
  renderAll();
  toast('🗑 Route supprimée');
  }
