// js/admin-routes.js — Panneau administrateur, onglet « Routes » (étape 19b)
//
// Deux choses dans le même écran : (1) copier des clients d'une route vers une autre — sert à bâtir une route personnalisée
// (plusieurs clients pigés dans différentes routes) ET à copier un seul client vers un autre service (ex. engrais → coupe de
// gazon) ; (2) désactiver/réactiver une route, pour ranger une route personnalisée une fois la journée passée.
// Les règles d'accès (routes_admin, stops_admin) laissent déjà l'administrateur tout faire dessus : AUCUNE fonction serveur
// n'est nécessaire ici, des écritures directes suffisent (même principe que Véhicules et Types de service, étape 19).
//
// Copier = un TOUT NOUVEL arrêt (même adresse/client/position), sur la route destination. L'arrêt d'origine n'est JAMAIS
// touché : il reste sur sa route (demande de Joé, 23 sept. 2026 : le client « apparaît aux deux »). Chaque copie a son
// propre historique, sa propre place dans la liste (▲▼), et peut être désactivée séparément.
// Le SERVICE d'une copie reste celui de l'original pour une copie groupée (plusieurs clients cochés). Il n'est modifiable
// que lorsqu'UN SEUL client est coché (le cas « copier un client d'engrais dans le service coupe de gazon ») — une route
// peut déjà mélanger plusieurs services (étape 13, « tâche ») : au démarrage d'une passe, le chauffeur choisit alors lequel
// il fait ce tour-ci.
// « Dernier passage » par client (passe_arrets.complete_le, le plus récent) : demandé par Joé pour repérer vite les clients
// en retard — la liste est triée du plus ancien au plus récent (jamais servi = tout en haut).
let routesAdminSource=null;          // id de la route choisie comme SOURCE
let routesAdminListeSource=[];       // [{id, adresse, client, service, dernier}] de la route source, triée
let routesAdminDestination=null;     // id de la route choisie comme DESTINATION, ou '__nouvelle__'
let routesAdminCoches=new Set();     // ids des arrêts cochés (à copier)
let routesAdminRechercheClient='';
let routesAdminDepuisLe='';
let routesAdminServiceOverride='';

function chargerRoutesAdmin(){
  routesAdminSource=null;routesAdminListeSource=[];routesAdminDestination=null;
  routesAdminCoches=new Set();routesAdminRechercheClient='';routesAdminDepuisLe='';routesAdminServiceOverride='';
  renderRoutesAdmin();
}

function routesActivesTrieesAdmin(){return routes.filter(r=>r.actif).slice().sort((a,b)=>a.nom.localeCompare(b.nom));}

function messageErreurRoutesAdmin(error){
  if(estErreurReseau(error)) return '📴 Pas de réseau : rien n’a été changé.';
  if(String(error&&error.code)==='23505') return '❌ Ce nom de route existe déjà.';
  return '❌ '+((error&&error.message)||'Une erreur est survenue.');
}

function titreSectionAdmin(texte){
  const h=document.createElement('div');
  h.className='debut-titre';
  h.style.margin='18px 16px 8px';
  h.textContent=texte;
  return h;
}

// ── Écran complet ───────────────────────────────────────
function renderRoutesAdmin(){
  const body=document.getElementById('admin-body');
  body.innerHTML='';
  body.appendChild(titreSectionAdmin('COPIER DES CLIENTS VERS UNE AUTRE ROUTE'));
  const zoneSource=document.createElement('div');
  body.appendChild(zoneSource);
  renderSelecteurSourceAdmin(zoneSource);

  body.appendChild(titreSectionAdmin('ROUTES'));
  const zoneRoutes=document.createElement('div');
  body.appendChild(zoneRoutes);
  renderListeRoutesAdmin(zoneRoutes);
}

// ── Route source (cherchable) ───────────────────────────
function renderSelecteurSourceAdmin(container){
  container.innerHTML='';
  const f=document.createElement('div');
  f.className='f';
  f.style.padding='0 16px';
  const label=document.createElement('label');
  label.textContent='Route source';
  const recherche=document.createElement('input');
  recherche.type='text';
  recherche.placeholder='🔎 Chercher une route par nom…';
  recherche.style.marginBottom='6px';
  const select=document.createElement('select');
  function remplir(filtre){
    const valeurAvant=select.value;
    select.innerHTML='';
    const optVide=document.createElement('option');
    optVide.value='';optVide.textContent='— Choisir une route —';
    select.appendChild(optVide);
    const q=(filtre||'').trim().toLowerCase();
    routesActivesTrieesAdmin().filter(r=>!q||r.nom.toLowerCase().includes(q)).forEach(r=>{
      const o=document.createElement('option');o.value=r.id;o.textContent=r.nom;select.appendChild(o);
    });
    select.value=[...select.options].some(o=>o.value===valeurAvant)?valeurAvant:'';
  }
  remplir('');
  select.value=routesAdminSource||'';
  recherche.oninput=()=>remplir(recherche.value);
  select.onchange=()=>{
    routesAdminSource=select.value||null;
    routesAdminCoches=new Set();routesAdminDestination=null;routesAdminServiceOverride='';routesAdminRechercheClient='';routesAdminDepuisLe='';
    renderZoneSourceChoisieAdmin();
  };
  f.appendChild(label);f.appendChild(recherche);f.appendChild(select);
  container.appendChild(f);

  const zoneChoisie=document.createElement('div');
  zoneChoisie.id='ra-source-choisie';
  container.appendChild(zoneChoisie);
  renderZoneSourceChoisieAdmin();
}

function renderZoneSourceChoisieAdmin(){
  const zone=document.getElementById('ra-source-choisie');
  if(!zone) return;
  zone.innerHTML='';
  if(!routesAdminSource){
    const vide=document.createElement('div');
    vide.style.cssText='padding:16px;text-align:center;color:#6b7a8d;font-size:13px;';
    vide.textContent='Choisis une route source pour voir ses clients.';
    zone.appendChild(vide);
    return;
  }
  const attente=document.createElement('div');
  attente.style.cssText='padding:16px;text-align:center;color:#6b7a8d;';
  attente.textContent='Chargement…';
  zone.appendChild(attente);
  chargerListeClientsSourceAdmin(zone);
}

async function chargerListeClientsSourceAdmin(zone){
  let data=null,error=null;
  try{
    const r=await db.from('stops').select('id,adresse,client,service,lat,lon,passe_arrets(complete_le)').eq('route_id',routesAdminSource).eq('actif',true);
    data=r.data;error=r.error;
  }catch(e){error=e;}
  if(!document.getElementById('ra-source-choisie')) return;   // l'admin a changé d'onglet entre-temps
  if(error){
    zone.innerHTML='<div style="padding:16px;color:#ef4444;font-size:13px;">❌ Impossible de charger les clients. Vérifie la connexion, puis réessaie.</div>';
    return;
  }
  routesAdminListeSource=(data||[]).map(s=>{
    const dates=(s.passe_arrets||[]).map(p=>p.complete_le).filter(Boolean).sort();
    return {id:s.id,adresse:s.adresse,client:s.client,service:s.service,lat:s.lat,lon:s.lon,dernier:dates.length?dates[dates.length-1]:null};
  }).sort((a,b)=>{
    if(!a.dernier&&!b.dernier) return (a.adresse||'').localeCompare(b.adresse||'');
    if(!a.dernier) return -1;
    if(!b.dernier) return 1;
    return new Date(a.dernier)-new Date(b.dernier);
  });
  zone.innerHTML='';
  const filtres=document.createElement('div');
  filtres.className='f';
  filtres.style.padding='10px 16px 0';
  const rechLabel=document.createElement('label');
  rechLabel.textContent='Chercher un client (adresse ou nom)';
  const rech=document.createElement('input');
  rech.type='text';
  rech.placeholder='ex: Charette, ou un nom';
  rech.value=routesAdminRechercheClient;
  rech.oninput=()=>{routesAdminRechercheClient=rech.value;renderListeClientsFiltreeAdmin();};
  const depuisLabel=document.createElement('label');
  depuisLabel.style.marginTop='10px';
  depuisLabel.textContent='Pas servis depuis le';
  const depuis=document.createElement('input');
  depuis.type='date';
  depuis.value=routesAdminDepuisLe;
  depuis.onchange=()=>{routesAdminDepuisLe=depuis.value;renderListeClientsFiltreeAdmin();};
  filtres.appendChild(rechLabel);filtres.appendChild(rech);filtres.appendChild(depuisLabel);filtres.appendChild(depuis);
  zone.appendChild(filtres);

  const outils=document.createElement('div');
  outils.style.cssText='display:flex;gap:14px;padding:8px 16px;font-size:12px;';
  const tout=document.createElement('a');
  tout.href='javascript:void(0)';
  tout.textContent='☑ Tout cocher (visibles)';
  tout.onclick=()=>{listeClientsFiltreeAdmin().forEach(s=>routesAdminCoches.add(s.id));renderListeClientsFiltreeAdmin();};
  const aucun=document.createElement('a');
  aucun.href='javascript:void(0)';
  aucun.textContent='☐ Tout décocher';
  aucun.onclick=()=>{routesAdminCoches=new Set();renderListeClientsFiltreeAdmin();};
  outils.appendChild(tout);outils.appendChild(aucun);
  zone.appendChild(outils);

  const liste=document.createElement('div');
  liste.id='ra-liste-clients';
  zone.appendChild(liste);

  const zoneCopier=document.createElement('div');
  zoneCopier.id='ra-zone-copier';
  zone.appendChild(zoneCopier);

  renderListeClientsFiltreeAdmin();
}

function listeClientsFiltreeAdmin(){
  const q=(routesAdminRechercheClient||'').trim().toLowerCase();
  const depuis=routesAdminDepuisLe?new Date(routesAdminDepuisLe):null;
  return routesAdminListeSource.filter(s=>{
    if(q&&!((s.adresse||'').toLowerCase().includes(q)||(s.client||'').toLowerCase().includes(q))) return false;
    if(depuis&&s.dernier&&new Date(s.dernier)>=depuis) return false;
    return true;
  });
}

function renderListeClientsFiltreeAdmin(){
  const liste=document.getElementById('ra-liste-clients');
  if(!liste) return;
  liste.innerHTML='';
  const visibles=listeClientsFiltreeAdmin();
  if(!visibles.length){
    const vide=document.createElement('div');
    vide.style.cssText='padding:16px;text-align:center;color:#6b7a8d;font-size:13px;';
    vide.textContent=routesAdminListeSource.length?'Aucun client ne correspond à la recherche.':'Aucun client actif sur cette route.';
    liste.appendChild(vide);
  }else{
    visibles.forEach(s=>liste.appendChild(ligneClientCopieAdmin(s)));
  }
  renderZoneCopierAdmin();
}

function ligneClientCopieAdmin(s){
  const div=document.createElement('div');
  div.className='emp-item';
  const cb=document.createElement('input');
  cb.type='checkbox';
  cb.style.cssText='width:20px;height:20px;flex-shrink:0;';
  cb.checked=routesAdminCoches.has(s.id);
  cb.onchange=()=>{
    if(cb.checked) routesAdminCoches.add(s.id); else routesAdminCoches.delete(s.id);
    routesAdminServiceOverride='';   // le choix de service ne doit jamais survivre à un changement de sélection (éviter d'appliquer par erreur le service d'un autre client)
    renderZoneCopierAdmin();
  };
  div.appendChild(cb);
  const info=document.createElement('div');
  info.className='emp-info';
  const nom=document.createElement('div');
  nom.className='emp-nom';
  nom.textContent=s.client||s.adresse;
  const detail=document.createElement('div');
  detail.className='emp-detail';
  detail.textContent=s.adresse+' · '+(s.service||'—')+' · Dernier passage : '+(s.dernier?dateHeure(s.dernier):'Jamais');
  info.appendChild(nom);info.appendChild(detail);
  div.appendChild(info);
  return div;
}

// ── Destination + bouton « Copier » ─────────────────────
function renderZoneCopierAdmin(){
  const zone=document.getElementById('ra-zone-copier');
  if(!zone) return;
  zone.innerHTML='';
  const n=routesAdminCoches.size;
  if(!n) return;

  const f=document.createElement('div');
  f.className='f';
  f.style.padding='10px 16px 0';
  const label=document.createElement('label');
  label.textContent=n+' client'+(n>1?'s':'')+' coché'+(n>1?'s':'')+' — route destination';
  const recherche=document.createElement('input');
  recherche.type='text';
  recherche.placeholder='🔎 Chercher une route par nom…';
  recherche.style.marginBottom='6px';
  const select=document.createElement('select');
  function remplir(filtre){
    const valeurAvant=select.value;
    select.innerHTML='';
    const optVide=document.createElement('option');
    optVide.value='';optVide.textContent='— Choisir une route —';
    select.appendChild(optVide);
    const q=(filtre||'').trim().toLowerCase();
    routesActivesTrieesAdmin().filter(r=>r.id!==routesAdminSource&&(!q||r.nom.toLowerCase().includes(q))).forEach(r=>{
      const o=document.createElement('option');o.value=r.id;o.textContent=r.nom;select.appendChild(o);
    });
    const optNouvelle=document.createElement('option');
    optNouvelle.value='__nouvelle__';optNouvelle.textContent='➕ Créer une nouvelle route…';
    select.appendChild(optNouvelle);
    select.value=[...select.options].some(o=>o.value===valeurAvant)?valeurAvant:'';
  }
  remplir('');
  select.value=routesAdminDestination||'';
  recherche.oninput=()=>remplir(recherche.value);
  select.onchange=()=>{routesAdminDestination=select.value||null;renderZoneCopierAdmin();};
  f.appendChild(label);f.appendChild(recherche);f.appendChild(select);
  zone.appendChild(f);

  if(routesAdminDestination==='__nouvelle__'){
    const fNouvelle=document.createElement('div');
    fNouvelle.className='f';
    fNouvelle.style.padding='10px 16px 0';
    const l=document.createElement('label');
    l.textContent='Nom de la nouvelle route';
    const i=document.createElement('input');
    i.type='text';
    i.id='ra-nouvelle-route-nom';
    i.placeholder='ex: Route Ghislain 24 septembre';
    fNouvelle.appendChild(l);fNouvelle.appendChild(i);
    zone.appendChild(fNouvelle);
  }

  if(n===1){
    const seul=routesAdminListeSource.find(s=>routesAdminCoches.has(s.id));
    const fs=document.createElement('div');
    fs.className='f';
    fs.style.padding='10px 16px 0';
    const l=document.createElement('label');
    l.textContent='Service (optionnel — vide = garder « '+(seul&&seul.service||'—')+' »)';
    const sel=document.createElement('select');
    const optGarder=document.createElement('option');
    optGarder.value='';optGarder.textContent='— Garder le service actuel —';
    sel.appendChild(optGarder);
    (typesServiceActifs.length?typesServiceActifs:TYPES_SERVICE_DEFAUT).forEach(nomService=>{
      const o=document.createElement('option');o.value=nomService;o.textContent=nomService;sel.appendChild(o);
    });
    sel.value=routesAdminServiceOverride||'';
    sel.onchange=()=>{routesAdminServiceOverride=sel.value;};
    fs.appendChild(l);fs.appendChild(sel);
    zone.appendChild(fs);
  }else{
    const note=document.createElement('div');
    note.style.cssText='padding:6px 16px 0;font-size:12px;color:#6b7a8d;';
    note.textContent='Chaque copie garde son propre service (décoche pour n’en garder qu’un seul si tu veux le changer).';
    zone.appendChild(note);
  }

  const btCopier=document.createElement('button');
  btCopier.type='button';
  btCopier.className='lf-btn nouveau';
  btCopier.style.cssText='width:calc(100% - 32px);margin:14px 16px;';
  btCopier.textContent='📋 Copier '+n+' client'+(n>1?'s':'');
  btCopier.disabled=!routesAdminDestination;
  btCopier.onclick=copierClientsAdmin;
  zone.appendChild(btCopier);
}

async function copierClientsAdmin(){
  const coches=routesAdminListeSource.filter(s=>routesAdminCoches.has(s.id));
  if(!coches.length||!routesAdminDestination) return;
  showSync(true);
  let destinationId=routesAdminDestination;
  if(destinationId==='__nouvelle__'){
    const champNom=document.getElementById('ra-nouvelle-route-nom');
    const nom=(champNom&&champNom.value||'').trim();
    if(!nom){showSync(false);toast('⚠ Entre un nom pour la nouvelle route');return;}
    let data=null,error=null;
    try{const r=await db.from('routes').insert([{nom}]).select().single();data=r.data;error=r.error;}
    catch(e){error=e;signalerEchecReseau(e);}
    if(error){showSync(false);toast(messageErreurRoutesAdmin(error));return;}
    routes.push(data);
    destinationId=data.id;
  }
  const serviceChoisi=(coches.length===1&&routesAdminServiceOverride)?routesAdminServiceOverride:null;
  const copies=coches.map((s,i)=>({
    adresse:s.adresse,client:s.client,service:serviceChoisi||s.service,lat:s.lat,lon:s.lon,
    actif:true,route_id:destinationId,ordre:stops.length+i
  }));
  let data=null,error=null;
  try{const r=await db.from('stops').insert(copies).select();data=r.data;error=r.error;}
  catch(e){error=e;signalerEchecReseau(e);}
  showSync(false);
  if(error){toast(messageErreurRoutesAdmin(error));return;}
  stops.push(...(data||[]));
  const nomDest=(routes.find(r=>r.id===destinationId)||{}).nom||'la route';
  toast('✔ '+coches.length+' client'+(coches.length>1?'s':'')+' copié'+(coches.length>1?'s':'')+' vers '+nomDest);
  routesAdminCoches=new Set();routesAdminDestination=null;routesAdminServiceOverride='';
  renderRoutesAdmin();
}

// ── Gérer les routes (désactiver/réactiver, comme les véhicules) ──
function renderListeRoutesAdmin(container){
  container.innerHTML='';
  const liste=routes.slice().sort((a,b)=>a.nom.localeCompare(b.nom));
  if(!liste.length){
    const vide=document.createElement('div');
    vide.style.cssText='padding:16px;text-align:center;color:#6b7a8d;font-size:13px;';
    vide.textContent='Aucune route.';
    container.appendChild(vide);
    return;
  }
  liste.forEach(r=>{
    const div=document.createElement('div');
    div.className='emp-item';
    const info=document.createElement('div');
    info.className='emp-info';
    const nom=document.createElement('div');
    nom.className='emp-nom';
    nom.textContent=r.nom;
    info.appendChild(nom);
    div.appendChild(info);
    const badge=document.createElement('div');
    badge.className='emp-badge '+(r.actif?'actif':'inactif');
    badge.textContent=r.actif?'Active':'Désactivée';
    div.appendChild(badge);
    const actions=document.createElement('div');
    actions.className='emp-actions';
    const btEtat=document.createElement('button');
    btEtat.type='button';
    btEtat.className='emp-btn';
    btEtat.textContent=r.actif?'Désactiver':'Réactiver';
    btEtat.onclick=()=>changerEtatRouteAdmin(r);
    actions.appendChild(btEtat);
    div.appendChild(actions);
    container.appendChild(div);
  });
}

async function changerEtatRouteAdmin(r){
  const actif=!r.actif;
  if(!actif&&!(await confirmer('Désactiver '+r.nom+' ?','Elle ne sera plus proposée pour une nouvelle passe ni comme route source ou destination pour copier des clients. Son historique est conservé.','Désactiver','Annuler'))) return;
  showSync(true);
  let error=null;
  try{const res=await db.from('routes').update({actif}).eq('id',r.id);error=res.error;}
  catch(e){error=e;signalerEchecReseau(e);}
  showSync(false);
  if(error){toast(messageErreurRoutesAdmin(error));return;}
  toast(actif?'✔ '+r.nom+' est réactivée':'✔ '+r.nom+' est désactivée');
  await loadRoutes();   // routes[] relu : le reste de l'application (carte, sélecteurs) le voit tout de suite
  renderRoutesAdmin();
}
