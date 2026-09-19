// js/admin.js — Panneau administrateur : problèmes et comptes en attente
// (extrait de l'ancien index.html)
	function openAdmin(){
  if(!currentUser||currentUser.role!=='admin'){toast('⛔ Accès admin requis');return;}
 document.getElementById('admin-overlay').classList.add('open');
  document.getElementById('admin-sub').textContent='Problèmes & comptes en attente';
  loadPendingUsers();
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
async function loadPendingUsers(){
  const body=document.getElementById('admin-body');
  body.innerHTML='';
  await loadProblemes();
  
  // Séparateur comptes en attente
  const sep=document.createElement('div');
  sep.style='padding:10px 16px 4px;font-size:10px;color:#6b7a8d;text-transform:uppercase;letter-spacing:.8px;font-weight:700;border-top:1px solid #252d3a;margin-top:8px;';
  sep.textContent='👤 Comptes en attente';
  body.appendChild(sep);

  const{data,error}=await db.from('utilisateurs')
    .select('*')
    .eq('approuve',false)
    .eq('role','employe')
    .order('created_at');

  if(error||!data||data.length===0){
    const empty=document.createElement('div');
    empty.style='padding:16px;text-align:center;color:#6b7a8d;font-size:13px;';
    empty.textContent='✔ Aucun compte en attente.';
    body.appendChild(empty);
    return;
  }
  document.getElementById('admin-sub').textContent=data.length+' compte'+(data.length>1?'s':'')+' en attente';

  body.innerHTML='';
  data.forEach(u=>{
    const div=document.createElement('div');
    div.className='user-item';
    div.id='user-'+u.id;
    div.innerHTML=
      '<div class="user-info">'+
        '<div class="user-nom">'+esc(u.nom)+'</div>'+
        '<div class="user-tel">📞 '+esc(u.telephone)+'</div>'+
      '</div>';
    const btRefus=document.createElement('button');
    btRefus.className='user-refuse';
    btRefus.textContent='Refuser';
    btRefus.onclick=()=>refuseUser(u.id);
    const btOk=document.createElement('button');
    btOk.className='user-approve';
    btOk.textContent='Approuver';
    btOk.onclick=()=>approveUser(u.id);
    div.appendChild(btRefus);
    div.appendChild(btOk);
    body.appendChild(div);
  });
}

async function approveUser(id){
  const{error}=await db.from('utilisateurs').update({approuve:true}).eq('id',id);
  if(error){toast('❌ Erreur: '+error.message);return;}
  document.getElementById('user-'+id).remove();
  toast('✔ Compte approuvé !');
  const body=document.getElementById('admin-body');
  if(!body.querySelector('.user-item')){
    body.innerHTML='<div style="padding:32px;text-align:center;color:#6b7a8d;font-size:14px;">✔ Aucun compte en attente.</div>';
    document.getElementById('admin-sub').textContent='Aucun compte en attente';
  }
}

async function refuseUser(id){
  if(!confirm('Supprimer ce compte ?'))return;
  await db.from('utilisateurs').delete().eq('id',id);
  document.getElementById('user-'+id).remove();
  toast('🗑 Compte supprimé');
  const body=document.getElementById('admin-body');
  if(!body.querySelector('.user-item')){
    body.innerHTML='<div style="padding:32px;text-align:center;color:#6b7a8d;font-size:14px;">✔ Aucun compte en attente.</div>';
  }
}
