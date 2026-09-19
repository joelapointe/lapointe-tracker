// js/admin.js — Panneau administrateur : problèmes signalés
// (Étape 12 : plus d'approbation de comptes — Joé crée chaque compte lui-même.)
// (extrait de l'ancien index.html)
	function openAdmin(){
  if(!currentUser||currentUser.role!=='admin'){toast('⛔ Accès admin requis');return;}
 document.getElementById('admin-overlay').classList.add('open');
  document.getElementById('admin-sub').textContent='Problèmes signalés';
  chargerPanneauAdmin();
}

function closeAdmin(){
  document.getElementById('admin-overlay').classList.remove('open');
}

function bgClickAdmin(e){
  if(e.target===document.getElementById('admin-overlay'))closeAdmin();
}

async function loadProblemes(){
  const{data}=await db.from('problemes')
    .select('*, stops(adresse,service,client), utilisateurs(nom)')
    .eq('lu',false)
    .order('created_at',{ascending:false});

  const body=document.getElementById('admin-body');
  const probs=data||[];

  if(probs.length===0){
    body.innerHTML+='<div style="padding:16px;color:#6b7a8d;font-size:13px;border-top:1px solid #252d3a;">✔ Aucun problème signalé.</div>';
    return;
  }

  const titre=document.createElement('div');
  titre.style='padding:10px 16px 4px;font-size:10px;color:#fb923c;text-transform:uppercase;letter-spacing:.8px;font-weight:700;';
  titre.textContent='⚠ Problèmes signalés';
  body.appendChild(titre);

  probs.forEach(p=>{
    const div=document.createElement('div');
    div.style='padding:12px 16px;border-bottom:1px solid rgba(37,45,58,.8);border-left:3px solid #fb923c;';
    div.innerHTML=
      '<div style="font-family:\'Barlow Condensed\',sans-serif;font-size:17px;font-weight:700;color:#f0f4f8;">'+
        esc(p.stops?p.stops.adresse:'Stop supprimé')+
      '</div>'+
      '<div style="font-size:11px;color:#6b7a8d;margin-top:2px;">'+
        esc(p.utilisateurs?p.utilisateurs.nom:'?')+' · '+esc(p.stops?p.stops.service||'':'')+
      '</div>'+
      '<div style="font-size:13px;color:#fb923c;margin-top:6px;background:rgba(251,146,60,.08);padding:8px;border-radius:6px;">'+
        '💬 '+esc(p.note)+
      '</div>';
    const btLu=document.createElement('button');
    btLu.style.cssText='margin-top:8px;padding:6px 14px;background:#252d3a;border:none;border-radius:6px;color:#6b7a8d;font-size:12px;font-family:\'Barlow Condensed\',sans-serif;font-weight:700;cursor:pointer;';
    btLu.textContent='✔ Marquer comme lu';
    btLu.onclick=()=>marquerLu(p.id);
    div.appendChild(btLu);
    body.appendChild(div);
  });
}

async function marquerLu(id){
  await db.from('problemes').update({lu:true}).eq('id',id);
  toast('✔ Problème marqué comme lu');
  openAdmin();
  checkProblemes();
}
async function chargerPanneauAdmin(){
  const body=document.getElementById('admin-body');
  body.innerHTML='';
  await loadProblemes();
}
