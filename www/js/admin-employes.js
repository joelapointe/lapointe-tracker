// js/admin-employes.js — Panneau administrateur, onglet « Employés » (étape 19)
//
// Gère les comptes d'employés à travers la fonction serveur « admin-employes » (étape 10) : elle seule crée, désactive, réactive,
// supprime et réinitialise le NIP — jamais directement sur la table (le rôle et l'authentification ne se changent pas par une
// simple écriture). Un compte ADMINISTRATEUR ne se gère pas ici (la fonction le refuse) : il est seulement listé, sans bouton.
// Le NIP n'est renvoyé par le serveur qu'UNE SEULE FOIS (à la création, ou après une réinitialisation) : montré avec informer()
// (utilitaires.js), qui reste à l'écran tant que Joé n'a pas touché « J'ai noté le NIP » — jamais un simple toast qui disparaît seul.
// (« employesAdmin » et « chargerEmployesAdmin », pas « employes »/« chargerEmployes » : ces noms sont DÉJÀ pris par equipage.js,
//  pour la liste des employés actifs de l'équipage — un tout autre écran.)
let employesAdmin=[];   // la liste renvoyée par admin_lister_utilisateurs() : [{id, nom, telephone, role, actif, cree_le}]

// 10 chiffres -> « 819 555-0101 » ; sinon (ne devrait pas arriver : le serveur les valide) le texte tel quel
function formaterTel(t){
  const d=String(t||'').replace(/\D/g,'');
  return d.length===10?d.slice(0,3)+' '+d.slice(3,6)+'-'+d.slice(6):(t||'—');
}

async function chargerEmployesAdmin(){
  const body=document.getElementById('admin-body');
  let data=null,error=null;
  try{
    const r=await db.rpc('admin_lister_utilisateurs');
    data=r.data;error=r.error;
  }catch(e){error=e;}
  if(error){
    body.innerHTML='<div style="padding:16px;color:#ef4444;font-size:13px;">❌ Impossible de charger les employés. Vérifie la connexion, puis réessaie.</div>';
    return;
  }
  employesAdmin=Array.isArray(data)?data:[];
  renderEmployesAdmin();
}

function renderEmployesAdmin(){
  const body=document.getElementById('admin-body');
  body.innerHTML='';

  const zoneAjout=document.createElement('div');
  zoneAjout.style.cssText='padding:12px 16px;';
  const btAjout=document.createElement('button');
  btAjout.type='button';
  btAjout.className='lf-btn nouveau';
  btAjout.style.width='100%';
  btAjout.textContent='＋ NOUVEL EMPLOYÉ';
  btAjout.onclick=ouvrirNouvelEmploye;
  zoneAjout.appendChild(btAjout);
  body.appendChild(zoneAjout);

  if(!employesAdmin.length){
    const vide=document.createElement('div');
    vide.style.cssText='padding:16px;text-align:center;color:#6b7a8d;font-size:13px;';
    vide.textContent='Aucun compte.';
    body.appendChild(vide);
    return;
  }

  employesAdmin.forEach(u=>{
    const div=document.createElement('div');
    div.className='emp-item';

    const info=document.createElement('div');
    info.className='emp-info';
    const nom=document.createElement('div');
    nom.className='emp-nom';
    nom.textContent=u.nom;
    const detail=document.createElement('div');
    detail.className='emp-detail';
    detail.textContent=u.role==='admin'?'👑 Administrateur':formaterTel(u.telephone);
    info.appendChild(nom);
    info.appendChild(detail);
    div.appendChild(info);

    const badge=document.createElement('div');
    badge.className='emp-badge '+(u.actif?'actif':'inactif');
    badge.textContent=u.actif?'Actif':'Désactivé';
    div.appendChild(badge);

    if(u.role==='employe'){
      const actions=document.createElement('div');
      actions.className='emp-actions';

      const btEtat=document.createElement('button');
      btEtat.type='button';
      btEtat.className='emp-btn';
      btEtat.textContent=u.actif?'Désactiver':'Réactiver';
      btEtat.onclick=()=>changerEtatEmploye(u);
      actions.appendChild(btEtat);

      const btNip=document.createElement('button');
      btNip.type='button';
      btNip.className='emp-btn';
      btNip.textContent='🔑 NIP';
      btNip.onclick=()=>reinitialiserNipEmploye(u);
      actions.appendChild(btNip);

      const btSupp=document.createElement('button');
      btSupp.type='button';
      btSupp.className='emp-btn del';
      btSupp.textContent='🗑';
      btSupp.setAttribute('aria-label','Supprimer '+u.nom);
      btSupp.onclick=()=>supprimerEmploye(u);
      actions.appendChild(btSupp);

      div.appendChild(actions);
    }
    body.appendChild(div);
  });
}

// ── L'appel à la fonction serveur, et ses messages ─────
async function appelerAdminEmployes(corps){
  try{
    const r=await db.functions.invoke('admin-employes',{body:corps});
    if(r&&r.error) return {erreur:await lireErreurFonction(r.error)};
    const d=r&&r.data;
    if(!d||d.ok!==true) return {erreur:{code:(d&&d.erreur)||'reponse_illisible',message:(d&&d.message)||''}};
    return d;
  }catch(e){
    signalerEchecReseau(e);
    return {erreur:{code:estErreurReseau(e)?'reseau':'erreur',message:String((e&&e.message)||e||'')}};
  }
}
function messageErreurEmploye(e){
  if(e.code==='reseau') return '📴 Pas de réseau : rien n’a été changé.';
  if(e.code==='non_autorise') return '❌ Réservé à l’administrateur.';
  if(e.code==='fonction_absente') return '❌ La fonction « admin-employes » n’est pas installée sur Supabase.';
  if(e.code==='compte_administrateur') return '❌ Un compte administrateur ne se gère pas ici.';
  if(e.code==='employe_introuvable') return '❌ Cet employé n’existe plus (la liste va se rafraîchir).';
  if(['telephone_deja_utilise','nip_trop_facile','nom_invalide','telephone_invalide','nip_invalide','requete_invalide'].includes(e.code)) return '❌ '+(e.message||'Renseignement invalide.');
  return '❌ '+(e.message||'Une erreur est survenue.');
}
// Un « employé introuvable » : la liste a changé ailleurs (un autre appareil) — on la relit pour ne pas rester sur du faux
async function apresErreurEmploye(e){
  toast(messageErreurEmploye(e));
  if(e.code==='employe_introuvable') await chargerEmployesAdmin();
}

// ── Désactiver / réactiver ──────────────────────────────
async function changerEtatEmploye(u){
  const actif=!u.actif;
  if(!actif&&!(await confirmer('Désactiver '+u.nom+' ?','Il ne pourra plus se connecter ni voir quoi que ce soit. Son historique est conservé.','Désactiver','Annuler'))) return;
  showSync(true);
  const r=await appelerAdminEmployes({action:actif?'reactiver':'desactiver',id:u.id});
  showSync(false);
  if(r.erreur){await apresErreurEmploye(r.erreur);return;}
  toast(actif?'✔ '+u.nom+' est réactivé':'✔ '+u.nom+' est désactivé');
  await chargerEmployesAdmin();
}

// ── Réinitialiser le NIP ────────────────────────────────
async function reinitialiserNipEmploye(u){
  if(!(await confirmer('Nouveau NIP pour '+u.nom+' ?','L’ancien NIP ne fonctionnera plus.','Nouveau NIP','Annuler'))) return;
  showSync(true);
  const r=await appelerAdminEmployes({action:'reinitialiser_nip',id:u.id});
  showSync(false);
  if(r.erreur){await apresErreurEmploye(r.erreur);return;}
  await informer('Nouveau NIP de '+u.nom,r.nip,'J’ai noté le NIP');
}

// ── Supprimer (ou désactiver si de l'historique) ────────
async function supprimerEmploye(u){
  if(!(await confirmer('Supprimer '+u.nom+' ?','S’il a de l’historique (quarts, passes…), il sera désactivé à la place.','Supprimer','Annuler'))) return;
  showSync(true);
  const r=await appelerAdminEmployes({action:'supprimer',id:u.id});
  showSync(false);
  if(r.erreur){await apresErreurEmploye(r.erreur);return;}
  toast(r.resultat==='desactive'?'⚠ '+u.nom+' a de l’historique : désactivé plutôt que supprimé':'🗑 '+u.nom+' est supprimé');
  await chargerEmployesAdmin();
}

// ── « ＋ Nouvel employé » ───────────────────────────────
function ouvrirNouvelEmploye(){
  document.getElementById('ne-nom').value='';
  document.getElementById('ne-telephone').value='';
  document.getElementById('ne-nip-manuel').checked=false;
  document.getElementById('ne-nip').value='';
  document.getElementById('ne-nip-zone').style.display='none';
  document.getElementById('nouvel-employe-overlay').classList.add('open');
}
function fermerNouvelEmploye(){
  document.getElementById('nouvel-employe-overlay').classList.remove('open');
}
function bgClickNE(e){
  if(e.target===document.getElementById('nouvel-employe-overlay')) fermerNouvelEmploye();
}
function basculerNipManuel(){
  const on=document.getElementById('ne-nip-manuel').checked;
  document.getElementById('ne-nip-zone').style.display=on?'block':'none';
  if(!on) document.getElementById('ne-nip').value='';
}
async function creerEmploye(){
  const nom=document.getElementById('ne-nom').value.trim();
  const telephone=document.getElementById('ne-telephone').value.trim();
  const manuel=document.getElementById('ne-nip-manuel').checked;
  const nip=document.getElementById('ne-nip').value.trim();
  if(!nom){toast('⚠ Entre un nom');return;}
  if(!telephone){toast('⚠ Entre un numéro de téléphone');return;}
  if(manuel&&!/^[0-9]{6}$/.test(nip)){toast('⚠ Le NIP doit avoir exactement 6 chiffres');return;}
  showSync(true);
  const r=await appelerAdminEmployes(Object.assign({action:'creer',nom,telephone},manuel?{nip}:{}));
  showSync(false);
  if(r.erreur){toast(messageErreurEmploye(r.erreur));return;}
  fermerNouvelEmploye();
  await chargerEmployesAdmin();
  await informer('Compte créé : '+r.employe.nom,'NIP : '+r.nip+(r.nip_genere?' (choisi au hasard)':''),'J’ai noté le NIP');
}
