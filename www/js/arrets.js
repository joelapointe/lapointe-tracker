// js/arrets.js — Arrêts (stops) : lecture/écriture Supabase, marqueurs, fiche
// (extrait de l'ancien index.html)
// Étape 13 : « fait » n'est plus une colonne de l'arrêt ; il vient du tour en cours (voir tours.js).
// ── SUPABASE CRUD ──────────────────────────────────────
async function loadStops(){
  setStatus('Chargement des stops…');
  try{
    // Seulement les arrêts actifs : un arrêt archivé (il a de l'historique) ne s'affiche plus, même pour l'administrateur
    const{data,error}=await db.from('stops').select('*').eq('actif',true).order('ordre');
    if(error) throw error;
 stops=data||[];
    await loadRoutes();
    await chargerTours();
    await chargerPositionsVehicules();   // camions sur place → clients « en cours » (étape 13c)
    demarrerRelecturePositions();
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
    showErr('Impossible de charger les données.<br>Vérifie que les politiques RLS sont activées dans Supabase.<br><br><small>'+esc(e.message)+'</small>');
  }
}

async function dbSave(s){
  showSync(true);
  const{data,error}=await db.from('stops').insert([s]).select().single();
  showSync(false);
  if(error){toast('❌ '+error.message);return null;}
  return data;
}

// Supprime un arrêt ; s'il a de l'historique (passe, problème) la base le refuse : il est alors ARCHIVÉ, jamais perdu.
// Renvoie 'supprime', 'archive' ou 'erreur'.
async function dbDel(id){
  showSync(true);
  const r=await db.from('stops').delete().eq('id',id);
  if(!r.error){showSync(false);return 'supprime';}
  const a=await db.from('stops').update({actif:false}).eq('id',id);
  showSync(false);
  return a.error?'erreur':'archive';
}

// ── MARQUEURS ──────────────────────────────────────────
function mkIcon(done,hasProb,onSite){
  const c=couleurEtat(done,hasProb,onSite);   // règle de couleur unique (tours.js), la même que pour les zones
  const s=done&&!hasProb?14:18;
  return L.divIcon({className:'',html:`<div style="width:${s}px;height:${s}px;background:${c};border:2px solid rgba(0,0,0,.5);transform:rotate(45deg);box-shadow:0 2px 6px rgba(0,0,0,.6)"></div>`,iconSize:[s,s],iconAnchor:[s/2,s/2]});
}

let polys=[];   // zones dessinées (à effacer avant de redessiner, sinon elles s'empilent)
function renderAll(){
  Object.values(mkrs).forEach(m=>map.removeLayer(m));
  Object.keys(mkrs).forEach(k=>delete mkrs[k]);
  polys.forEach(p=>map.removeLayer(p));
  polys=[];
  stops.forEach((s,i)=>{
    if(!s.lat) return;
  if(routeActive!==null && s.route_id!==routeActive) return;
  const m=L.marker([s.lat,s.lon],{icon:mkIcon(estFait(s),s._probleme,estEnCours(s))}).addTo(map);
    m.on('click',()=>openCard(i));
    mkrs[i]=m;
  });
  // Dessiner les zones polygonales
  stops.forEach(s=>{
    if(!s.zone_points||!Array.isArray(s.zone_points))return;
    if(routeActive!==null && s.route_id!==routeActive) return;
    const c=couleurEtat(estFait(s),s._probleme,estEnCours(s));
    polys.push(L.polygon(s.zone_points,{
      color:c,fillColor:c,fillOpacity:.15,weight:2
    }).addTo(map));
  });
	updateBar();
  _sigEnCours=signatureEnCours();   // ce qui est dessiné : on ne redessinera que si ça change
}

// Barre du bas : l'avancement de ce qui est affiché (une route, ou toutes les routes ensemble),
// calculé sur les arrêts qui font partie d'un tour en cours.
function updateBar(){
  const p=progression();
  document.getElementById('op-name').textContent=currentUser?currentUser.nom:operator||'—';
 document.getElementById('zone-val').textContent=zone||'Toutes les routes';
  document.getElementById('prog-txt').textContent=p.aucune?'Aucune passe':`${p.faits}/${p.total}`;
  document.getElementById('prog-pct').textContent=p.aucune?'—':`${p.pct}%`;
  document.getElementById('prog-fill').style.width=p.pct+'%';
}

// ── STOP CARD ──────────────────────────────────────────
function openCard(i){
  const s=stops[i];if(!s)return;
  activeIdx=i;
  majCarte();
  document.getElementById('stop-card').classList.add('open');
  map.flyTo([s.lat,s.lon],17,{duration:.7});
}

// Remplit la fiche de l'arrêt ouvert (appelée à l'ouverture, et de nouveau quand les tours changent)
function majCarte(){
  if(activeIdx===null)return;
  const s=stops[activeIdx];if(!s)return;
  document.getElementById('sc-addr').textContent=s.adresse;
  document.getElementById('sc-svc').textContent=s.service||'';
  document.getElementById('sc-cli').textContent=s.client||'';
  document.getElementById('sc-tour').textContent=texteTour(s);
  const e=etatComplete(s);
  const b=document.getElementById('btn-cmp');
  b.textContent=e.texte;
  b.className=e.classe;
  b.disabled=!e.actif;
}

function closeCard(){document.getElementById('stop-card').classList.remove('open');activeIdx=null;}

// « Complété » : seul le chauffeur de la passe peut le faire (le serveur le vérifie aussi)
async function completeStop(){
  if(activeIdx===null)return;
  const s=stops[activeIdx];if(!s)return;
  const e=etatComplete(s);
  if(!e.actif){toast(e.explication||e.texte);return;}
  showSync(true);
  let r;
  try{
    r=await db.rpc('completer_arret',{p_passe_id:e.passeId,p_stop_id:s.id,p_mode:'manuel',p_lat:lastPos?lastPos[0]:null,p_lon:lastPos?lastPos[1]:null});
  }catch(err){
    r={data:null,error:err};
  }
  showSync(false);
  if(r.error){toast('❌ '+messageErreurGeste(r.error));return;}
  await chargerTours();
  renderAll();majCarte();
  const st=r.data&&r.data.statut;
  if(st==='passe_terminee'){toast('⚠ Cette passe est déjà terminée');return;}
  closeCard();
  toast(r.data&&r.data.passe_fermee?'🎉 Passe terminée : 100 % !':(st==='deja_complete'?'✔ Déjà complété par un autre camion':'✔ Stop complété !'));
}

async function deleteStop(){
  if(activeIdx===null)return;
  const s=stops[activeIdx];if(!s)return;
  // Boîte de l'application (la fenêtre native confirm() est refusée d'office par certains navigateurs intégrés)
  if(!(await confirmer('Supprimer cet arrêt ?',s.adresse,'Supprimer','Annuler')))return;
  const r=await dbDel(s.id);
  if(r==='erreur'){toast('❌ Impossible de supprimer cet arrêt');return;}
  stops=stops.filter(x=>x.id!==s.id);   // par identifiant : la liste a pu être relue pendant la confirmation
  renderAll();closeCard();
  toast(r==='archive'?'📦 Archivé (il a un historique)':'🗑 Supprimé');
}
