// js/admin-reglages.js — Panneau administrateur, onglet « Réglages » (étape 19)
//
// La table « reglages » (cle, valeur, description) existe depuis l'étape 7 : Joé la changeait jusqu'ici par une commande SQL
// qu'on lui donnait. Les règles d'accès (étape 8) laissent déjà l'administrateur modifier n'importe quelle « valeur » (jamais
// « cle » ni « description », qui ne sont pas accordées en écriture) : AUCUN SQL n'est nécessaire ici, juste l'écran.
// L'écran est GÉNÉRIQUE (il affiche TOUTE la table, quels que soient les réglages qui existent) plutôt que de nommer chacun en
// dur : un futur réglage ajouté par SQL apparaît ici tout seul, sans changer ce fichier.
let reglagesAdmin=[];   // [{cle, valeur, description}]

async function chargerReglagesAdmin(){
  const body=document.getElementById('admin-body');
  let data=null,error=null;
  try{
    const r=await db.from('reglages').select('cle, valeur, description').order('cle');
    data=r.data;error=r.error;
  }catch(e){error=e;}
  if(error){
    body.innerHTML='<div style="padding:16px;color:#ef4444;font-size:13px;">❌ Impossible de charger les réglages. Vérifie la connexion, puis réessaie.</div>';
    return;
  }
  reglagesAdmin=Array.isArray(data)?data:[];
  renderReglagesAdmin();
}

function renderReglagesAdmin(){
  const body=document.getElementById('admin-body');
  body.innerHTML='';

  if(!reglagesAdmin.length){
    const vide=document.createElement('div');
    vide.style.cssText='padding:16px;text-align:center;color:#6b7a8d;font-size:13px;';
    vide.textContent='Aucun réglage.';
    body.appendChild(vide);
    return;
  }

  reglagesAdmin.forEach(r=>{
    const div=document.createElement('div');
    div.className='regl-item';

    const desc=document.createElement('div');
    desc.className='regl-desc';
    desc.textContent=r.description||r.cle;
    div.appendChild(desc);

    const ligne=document.createElement('div');
    ligne.className='regl-ligne';

    const input=document.createElement('input');
    input.type='number';
    input.inputMode='decimal';
    input.min='0';
    input.step='any';
    input.className='regl-valeur';
    input.value=String(Number(r.valeur));
    ligne.appendChild(input);

    const unite=document.createElement('span');
    unite.className='regl-unite';
    unite.textContent='heures';
    ligne.appendChild(unite);

    const btn=document.createElement('button');
    btn.type='button';
    btn.className='regl-btn';
    btn.textContent='Enregistrer';
    btn.onclick=()=>enregistrerReglage(r,input);
    ligne.appendChild(btn);

    div.appendChild(ligne);
    body.appendChild(div);
  });
}

function messageErreurReglage(error){
  if(estErreurReseau(error)) return '📴 Pas de réseau : rien n’a été changé.';
  return '❌ '+((error&&error.message)||'Une erreur est survenue.');
}

async function enregistrerReglage(r,input){
  const v=Number(input.value);
  if(!Number.isFinite(v)||v<=0){toast('⚠ Entre un nombre d’heures valide (plus grand que 0)');return;}
  showSync(true);
  let error=null;
  try{
    const res=await db.from('reglages').update({valeur:v}).eq('cle',r.cle);
    error=res.error;
  }catch(e){error=e;signalerEchecReseau(e);}
  showSync(false);
  if(error){toast(messageErreurReglage(error));return;}
  toast('✔ Réglage enregistré');
  await chargerReglagesAdmin();
}
