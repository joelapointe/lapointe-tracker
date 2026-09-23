// js/admin.js — Panneau administrateur : les onglets, et l'onglet « Problèmes signalés »
// (Étape 12 : plus d'approbation de comptes — Joé crée chaque compte lui-même.)
// (Étape 13 : lit les nouvelles colonnes — cree_le, passe, auteur — et n'affiche jamais « aucun problème » quand la lecture échoue.)
// (Étape 19 : le panneau devient plusieurs onglets — Problèmes, Employés, puis Véhicules, Réglages… — chacun dans son propre fichier.)
// (extrait de l'ancien index.html)

// La liste des onglets EST UNE FONCTION (pas une constante posée au chargement) : les fichiers des autres onglets (employés,
// véhicules…) se chargent APRÈS celui-ci ; leurs fonctions n'existent donc pas encore au moment où ce fichier s'exécute.
function ongletsAdmin(){
  return [
    {id:'problemes',icone:'⚠',label:'Problèmes',titre:'Problèmes signalés',charger:loadProblemes},
    {id:'employes',icone:'👤',label:'Employés',titre:'Employés',charger:(typeof chargerEmployesAdmin==='function')?chargerEmployesAdmin:null},
    {id:'vehicules',icone:'🚚',label:'Véhicules',titre:'Véhicules',charger:(typeof chargerVehiculesAdmin==='function')?chargerVehiculesAdmin:null},
    {id:'reglages',icone:'🕒',label:'Réglages',titre:'Réglages',charger:(typeof chargerReglagesAdmin==='function')?chargerReglagesAdmin:null},
    {id:'types-service',icone:'🧰',label:'Services',titre:'Types de service',charger:(typeof chargerTypesServiceAdmin==='function')?chargerTypesServiceAdmin:null},
  ];
}
let _adminOnglet='problemes';

function openAdmin(){
  if(!currentUser||currentUser.role!=='admin'){toast('⛔ Accès admin requis');return;}
  _adminOnglet='problemes';
  document.getElementById('admin-overlay').classList.add('open');
  chargerPanneauAdmin();
}

function closeAdmin(){
  document.getElementById('admin-overlay').classList.remove('open');
}

function bgClickAdmin(e){
  if(e.target===document.getElementById('admin-overlay'))closeAdmin();
}

// Toucher un onglet : ne relit PAS l'onglet qu'on quitte (le prochain openAdmin() le fera si besoin)
function changerOngletAdmin(id){
  if(id===_adminOnglet) return;
  _adminOnglet=id;
  chargerPanneauAdmin();
}

function renderOngletsAdmin(){
  const zone=document.getElementById('admin-tabs');
  if(!zone) return;
  zone.innerHTML='';
  ongletsAdmin().forEach(o=>{
    const b=document.createElement('button');
    b.type='button';
    b.className='admin-tab'+(o.id===_adminOnglet?' active':'');
    b.textContent=o.icone+' '+o.label;
    b.onclick=()=>changerOngletAdmin(o.id);
    zone.appendChild(b);
  });
}

async function loadProblemes(){
  const body=document.getElementById('admin-body');
  // « utilisateurs!utilisateur_id » : l'AUTEUR du signalement (la table a aussi lu_par, qui pointe vers utilisateurs)
  let data=null,error=null;
  try{
    const r=await db.from('problemes')
      .select('id, note, cree_le, photo_chemin, stops(adresse,service,client), utilisateurs!utilisateur_id(nom), passes(numero,tache)')
      .eq('lu',false)
      .order('cree_le',{ascending:false});
    data=r.data;error=r.error;
  }catch(e){error=e;}

  if(error){
    body.innerHTML+='<div style="padding:16px;color:#ef4444;font-size:13px;border-top:1px solid #252d3a;">❌ Impossible de charger les problèmes. Vérifie la connexion, puis réessaie.</div>';
    return;
  }
  const probs=data||[];

  if(probs.length===0){
    body.innerHTML+='<div style="padding:16px;color:#6b7a8d;font-size:13px;border-top:1px solid #252d3a;">✔ Aucun problème signalé.</div>';
    return;
  }

  const titre=document.createElement('div');
  titre.style='padding:10px 16px 4px;font-size:10px;color:#fb923c;text-transform:uppercase;letter-spacing:.8px;font-weight:700;';
  titre.textContent='⚠ Problèmes signalés ('+probs.length+')';
  body.appendChild(titre);

  probs.forEach(p=>{
    const div=document.createElement('div');
    div.style='padding:12px 16px;border-bottom:1px solid rgba(37,45,58,.8);border-left:3px solid #fb923c;';
    const passe=p.passes?' · Passe n° '+p.passes.numero:'';
    div.innerHTML=
      '<div style="font-family:\'Barlow Condensed\',sans-serif;font-size:17px;font-weight:700;color:#f0f4f8;">'+
        esc(p.stops?p.stops.adresse:'Stop supprimé')+
      '</div>'+
      '<div style="font-size:11px;color:#6b7a8d;margin-top:2px;">'+
        esc(p.utilisateurs?p.utilisateurs.nom:'?')+' · '+esc(p.stops?p.stops.service||'':'')+esc(passe)+' · '+esc(dateHeure(p.cree_le))+
      '</div>'+
      '<div style="font-size:13px;color:#fb923c;margin-top:6px;background:rgba(251,146,60,.08);padding:8px;border-radius:6px;">'+
        '💬 '+esc(p.note)+
      '</div>';
    // La photo du problème (étape 14e) : miniature à toucher pour l'agrandir
    if(p.photo_chemin&&cheminPhotoValide(p.photo_chemin)){
      const img=document.createElement('img');
      img.className='admin-prob-photo';
      img.alt='Photo du problème';
      img.onclick=()=>voirPhoto(p.photo_chemin);
      div.appendChild(img);
      urlPhotoAsync(p.photo_chemin).then(u=>{if(u) img.src=u;});
    }
    const btLu=document.createElement('button');
    btLu.style.cssText='margin-top:8px;padding:6px 14px;background:#252d3a;border:none;border-radius:6px;color:#6b7a8d;font-size:12px;font-family:\'Barlow Condensed\',sans-serif;font-weight:700;cursor:pointer;';
    btLu.textContent='✔ Marquer comme lu';
    btLu.onclick=()=>marquerLu(p.id);
    div.appendChild(btLu);
    body.appendChild(div);
  });
}

// « Lu » : le problème disparaît de l'écran de tout le monde mais reste dans la base (avec qui l'a lu et quand).
// On vérifie qu'une ligne a VRAIMENT changé (les règles d'accès peuvent refuser sans erreur).
async function marquerLu(id){
  let r;
  try{
    r=await db.from('problemes').update({lu:true,lu_par:currentUser.id,lu_le:new Date().toISOString()}).eq('id',id).select('id');
  }catch(e){
    r={data:null,error:e};
  }
  if(r.error||!r.data||r.data.length===0){toast('❌ Impossible de marquer comme lu');return;}
  toast('✔ Problème marqué comme lu');
  await chargerProblemes();
  renderAll();majCarte();checkProblemes();
  if(_adminOnglet==='problemes') chargerPanneauAdmin();   // l'onglet des problèmes est ouvert : il se redessine ; un autre onglet n'a pas à être interrompu
}
async function chargerPanneauAdmin(){
  renderOngletsAdmin();
  const o=ongletsAdmin().find(x=>x.id===_adminOnglet)||ongletsAdmin()[0];
  document.getElementById('admin-sub').textContent=o.titre;
  const body=document.getElementById('admin-body');
  body.innerHTML='';
  if(typeof o.charger==='function') await o.charger();
}
