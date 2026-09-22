// js/admin-vehicules.js — Panneau administrateur, onglet « Véhicules » (étape 19)
//
// Un véhicule = une ligne de la table « equipes » (nom + actif). Les règles d'accès (equipes_admin) laissent déjà l'administrateur
// tout faire dessus : AUCUNE fonction serveur n'est nécessaire ici (contrairement aux employés) — des écritures directes suffisent.
// Un véhicule désactivé n'est plus proposé au départ d'une nouvelle passe (passe.js filtre déjà « actif=true ») mais reste lié à son
// historique (quarts, passes…) : on ne le supprime donc jamais ici, seulement « Désactiver ».
// (« vehiculesAdmin »/« chargerVehiculesAdmin », comme pour les employés : à ne pas confondre avec « nomsVehicules »/
//  « chargerVehiculesEtEquipages » de vehicules.js, qui affichent les camions sur la carte — un tout autre écran.)
let vehiculesAdmin=[];   // [{id, nom, actif}]
let _vehiculeIdEnEdition=null;   // null = « ＋ Nouveau véhicule », sinon l'id du véhicule qu'on renomme (même fenêtre pour les deux)

async function chargerVehiculesAdmin(){
  const body=document.getElementById('admin-body');
  let data=null,error=null;
  try{
    const r=await db.from('equipes').select('id, nom, actif').order('nom');
    data=r.data;error=r.error;
  }catch(e){error=e;}
  if(error){
    body.innerHTML='<div style="padding:16px;color:#ef4444;font-size:13px;">❌ Impossible de charger les véhicules. Vérifie la connexion, puis réessaie.</div>';
    return;
  }
  vehiculesAdmin=Array.isArray(data)?data:[];
  renderVehiculesAdmin();
}

function renderVehiculesAdmin(){
  const body=document.getElementById('admin-body');
  body.innerHTML='';

  const zoneAjout=document.createElement('div');
  zoneAjout.style.cssText='padding:12px 16px;';
  const btAjout=document.createElement('button');
  btAjout.type='button';
  btAjout.className='lf-btn nouveau';
  btAjout.style.width='100%';
  btAjout.textContent='＋ NOUVEAU VÉHICULE';
  btAjout.onclick=ouvrirNouveauVehicule;
  zoneAjout.appendChild(btAjout);
  body.appendChild(zoneAjout);

  if(!vehiculesAdmin.length){
    const vide=document.createElement('div');
    vide.style.cssText='padding:16px;text-align:center;color:#6b7a8d;font-size:13px;';
    vide.textContent='Aucun véhicule.';
    body.appendChild(vide);
    return;
  }

  vehiculesAdmin.forEach(v=>{
    const div=document.createElement('div');
    div.className='emp-item';

    const info=document.createElement('div');
    info.className='emp-info';
    const nom=document.createElement('div');
    nom.className='emp-nom';
    nom.textContent=v.nom;
    info.appendChild(nom);
    div.appendChild(info);

    const badge=document.createElement('div');
    badge.className='emp-badge '+(v.actif?'actif':'inactif');
    badge.textContent=v.actif?'Actif':'Désactivé';
    div.appendChild(badge);

    const actions=document.createElement('div');
    actions.className='emp-actions';

    const btRenommer=document.createElement('button');
    btRenommer.type='button';
    btRenommer.className='emp-btn';
    btRenommer.textContent='✏️ Renommer';
    btRenommer.onclick=()=>ouvrirRenommerVehicule(v);
    actions.appendChild(btRenommer);

    const btEtat=document.createElement('button');
    btEtat.type='button';
    btEtat.className='emp-btn';
    btEtat.textContent=v.actif?'Désactiver':'Réactiver';
    btEtat.onclick=()=>changerEtatVehicule(v);
    actions.appendChild(btEtat);

    div.appendChild(actions);
    body.appendChild(div);
  });
}

// Une écriture directe sur « equipes » (pas de fonction serveur) : le message d'erreur, en mots simples
function messageErreurVehicule(error){
  if(estErreurReseau(error)) return '📴 Pas de réseau : rien n’a été changé.';
  if(String(error&&error.code)==='23505') return '❌ Ce nom de véhicule existe déjà.';
  return '❌ '+((error&&error.message)||'Une erreur est survenue.');
}

// ── Désactiver / réactiver ──────────────────────────────
async function changerEtatVehicule(v){
  const actif=!v.actif;
  if(!actif&&!(await confirmer('Désactiver '+v.nom+' ?','Il ne sera plus proposé pour une nouvelle passe. Son historique est conservé.','Désactiver','Annuler'))) return;
  showSync(true);
  let error=null;
  try{
    const r=await db.from('equipes').update({actif}).eq('id',v.id);
    error=r.error;
  }catch(e){error=e;signalerEchecReseau(e);}
  showSync(false);
  if(error){toast(messageErreurVehicule(error));return;}
  toast(actif?'✔ '+v.nom+' est réactivé':'✔ '+v.nom+' est désactivé');
  await chargerVehiculesAdmin();
}

// ── « ＋ Nouveau véhicule » / « Renommer » (la même fenêtre sert aux deux) ──
function ouvrirNouveauVehicule(){
  _vehiculeIdEnEdition=null;
  document.getElementById('nv-titre').textContent='＋ Nouveau véhicule';
  document.getElementById('nv-btn-save').textContent='Créer';
  document.getElementById('nv-nom').value='';
  document.getElementById('nouveau-vehicule-overlay').classList.add('open');
}
function ouvrirRenommerVehicule(v){
  _vehiculeIdEnEdition=v.id;
  document.getElementById('nv-titre').textContent='Renommer un véhicule';
  document.getElementById('nv-btn-save').textContent='Enregistrer';
  document.getElementById('nv-nom').value=v.nom;
  document.getElementById('nouveau-vehicule-overlay').classList.add('open');
}
function fermerNouveauVehicule(){
  document.getElementById('nouveau-vehicule-overlay').classList.remove('open');
}
function bgClickNV(e){
  if(e.target===document.getElementById('nouveau-vehicule-overlay')) fermerNouveauVehicule();
}
async function sauvegarderVehicule(){
  const nom=document.getElementById('nv-nom').value.trim();
  if(!nom){toast('⚠ Entre un nom de véhicule');return;}
  const enEdition=_vehiculeIdEnEdition;
  showSync(true);
  let error=null;
  try{
    const r=enEdition
      ?await db.from('equipes').update({nom}).eq('id',enEdition)
      :await db.from('equipes').insert([{nom}]);
    error=r.error;
  }catch(e){error=e;signalerEchecReseau(e);}
  showSync(false);
  if(error){toast(messageErreurVehicule(error));return;}
  toast(enEdition?'✔ Véhicule renommé':'✔ Véhicule créé');
  fermerNouveauVehicule();
  await chargerVehiculesAdmin();
}
