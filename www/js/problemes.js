// js/problemes.js — Signalement des problèmes
// (extrait de l'ancien index.html)
function openProbleme(){
  if(activeIdx===null)return;
  const s=stops[activeIdx];
  document.getElementById('prob-addr-lbl').textContent=s.adresse;
  document.getElementById('prob-note').value='';
  document.getElementById('prob-overlay').classList.add('open');
}

function closeProbleme(){
  document.getElementById('prob-overlay').classList.remove('open');
}

function bgClickProb(e){
  if(e.target===document.getElementById('prob-overlay'))closeProbleme();
}

async function envoyerProbleme(){
  if(activeIdx===null)return;
  const s=stops[activeIdx];
  const note=document.getElementById('prob-note').value.trim();
  if(!note){toast('⚠ Écris une note');return;}

  showSync(true);
  // Supprimer ancien problème si existant
  await db.from('problemes').delete().eq('stop_id',s.id);
  const{error}=await db.from('problemes').insert([{
    stop_id:s.id,
    utilisateur_id:currentUser.id,
    note:note,
    lu:false
  }]);
  showSync(false);

  if(error){toast('❌ '+error.message);return;}

  toast('⚠ Problème signalé !');
  closeProbleme();
  closeCard();
  await loadStops();
}
async function checkProblemes(){
  const{data}=await db.from('problemes').select('id').eq('lu',false);
  const nb=(data||[]).length;
  const btn=document.getElementById('bb-admin');
  if(!btn)return;
  const badge=btn.querySelector('.prob-badge');
  if(nb>0){
    if(!badge){
      const b=document.createElement('div');
      b.className='prob-badge';
      b.textContent=nb;
      b.style='position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;border-radius:50%;width:16px;height:16px;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;';
      btn.style.position='relative';
      btn.appendChild(b);
    } else {
      badge.textContent=nb;
    }
  } else if(badge){
    badge.remove();
  }
}
