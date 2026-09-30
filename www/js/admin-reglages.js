// js/admin-reglages.js — Panneau administrateur, onglet « Réglages » (étape 19)
//
// La table « reglages » (cle, valeur, description) existe depuis l'étape 7 : Joé la changeait jusqu'ici par une commande SQL
// qu'on lui donnait. Les règles d'accès (étape 8) laissent déjà l'administrateur modifier n'importe quelle « valeur » (jamais
// « cle » ni « description », qui ne sont pas accordées en écriture) : AUCUN SQL n'est nécessaire ici, juste l'écran.
// L'écran est GÉNÉRIQUE (il affiche TOUTE la table, quels que soient les réglages qui existent) plutôt que de nommer chacun en
// dur : un futur réglage ajouté par SQL apparaît ici tout seul, sans changer ce fichier.
let reglagesAdmin=[];   // [{cle, valeur, description}]

// Les durées des réglages sont des HEURES, sauf celles dont la clé finit par « _s » : des SECONDES (demande 6 : presence_complete_auto_s, le « Complété » automatique). Celui-là permet 0 (= jamais) et
// va jusqu'à 3600 ; les durées en heures restent plus grandes que 0.
function reglageEnSecondes(cle){return /_s$/.test(String(cle));}
function uniteReglage(cle){return reglageEnSecondes(cle)?'secondes':'heures';}
function messageValeurReglage(cle){
  return reglageEnSecondes(cle)?'⚠ Entre un nombre de secondes valide (0 = jamais, 3600 au plus)':'⚠ Entre un nombre d’heures valide (plus grand que 0)';
}
function valeurReglageValide(cle,v){
  if(!Number.isFinite(v)) return false;
  return reglageEnSecondes(cle)?(v>=0&&v<=3600):v>0;
}

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
    unite.textContent=uniteReglage(r.cle);
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
  const brut=String(input.value).trim();
  const v=brut===''?NaN:Number(brut);   // (un champ vide n'est jamais « 0 » : pour le complété automatique, 0 veut dire « jamais »)
  if(!valeurReglageValide(r.cle,v)){toast(messageValeurReglage(r.cle));return;}
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
