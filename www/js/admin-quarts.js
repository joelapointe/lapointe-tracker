// js/admin-quarts.js — Panneau administrateur, onglet « Quarts » (étape 19, morceau 5)
//
// Deux listes : les quarts « à valider » (ouverts automatiquement par l'application, fermés automatiquement après un délai,
// ou dont la fin est contestée par l'employé) et les transferts d'équipage récents (au cas où l'un d'eux serait une erreur).
// La LISTE se lit directement (les règles d'accès de l'étape 8 laissent déjà l'administrateur tout lire) mais toute ÉCRITURE
// passe par une fonction serveur — JAMAIS une écriture directe sur equipage_periodes/equipage_journal/quarts depuis
// l'application (principe déjà en place depuis l'étape 9a : voir test-app-equipage-depart.mjs/test-app-equipage-pendant.mjs) :
// admin_corriger_quart (étape 19, SQL 24) pour changer l'heure d'un quart, admin_annuler_transfert (étape 9a) pour un transfert
// erroné (deux lignes de equipage_periodes à faire correspondre). L'export de paie (bouton séparé) refuse de fonctionner tant
// qu'un quart est à valider : c'est pour ça que cet onglet existe.
let quartsAValiderAdmin=[];   // [{id, utilisateur_id, debut, fin, raison_a_valider, note, utilisateurs:{nom}}]
let transfertsAdmin=[];       // une ligne par transfert (l'ENTRÉE dans le nouveau véhicule) : [{id, transfert_id, debut, utilisateurs:{nom}, passes:{equipes:{nom}}}]
let _quartIdEnCorrection=null;

async function chargerQuartsAdmin(){
  const body=document.getElementById('admin-body');
  let quarts=null,transferts=null,error=null;
  try{
    const[q,t]=await Promise.all([
      db.from('quarts').select('id, utilisateur_id, debut, fin, raison_a_valider, note, utilisateurs!utilisateur_id(nom)').eq('a_valider',true).order('debut'),
      db.from('equipage_periodes').select('id, transfert_id, utilisateur_id, debut, utilisateurs!utilisateur_id(nom), passes(equipes(nom))').not('transfert_id','is',null).order('debut',{ascending:false}).limit(20),
    ]);
    if(q.error) throw q.error;
    if(t.error) throw t.error;
    quarts=q.data;transferts=t.data;
  }catch(e){error=e;}
  if(error){
    body.innerHTML='<div style="padding:16px;color:#ef4444;font-size:13px;">❌ Impossible de charger les quarts. Vérifie la connexion, puis réessaie.</div>';
    return;
  }
  quartsAValiderAdmin=Array.isArray(quarts)?quarts:[];
  transfertsAdmin=dernieresEntreesTransfert(Array.isArray(transferts)?transferts:[]);
  renderQuartsAdmin();
}

// Chaque transfert a DEUX lignes (sortie de l'ancien véhicule, entrée dans le nouveau) qui partagent transfert_id : on ne
// garde que l'ENTRÉE (celle dont le début est le plus tardif des deux) pour n'afficher qu'une seule ligne par transfert.
function dernieresEntreesTransfert(lignes){
  const parTransfert={};
  (lignes||[]).forEach(l=>{
    const g=parTransfert[l.transfert_id];
    if(!g||l.debut>g.debut) parTransfert[l.transfert_id]=l;
  });
  return Object.values(parTransfert);
}

function texteRaisonAValider(r){
  if(r==='fin_estimee') return 'Fermé automatiquement (heure estimée) : à confirmer ou corriger.';
  if(r==='ouvert_par_equipage') return 'Ouvert automatiquement : ajouté à bord sans avoir touché « Je commence ».';
  if(r==='ouvert_par_passe') return 'Ouvert automatiquement : passe débutée sans avoir touché « Je commence ».';
  if(r==='fin_contestee') return 'L’employé conteste son heure de fin (quart terminé par quelqu’un d’autre).';
  return 'À vérifier.';
}

function renderQuartsAdmin(){
  const body=document.getElementById('admin-body');
  body.innerHTML='';

  const titreQ=document.createElement('div');
  titreQ.style='padding:10px 16px 4px;font-size:10px;color:#fb923c;text-transform:uppercase;letter-spacing:.8px;font-weight:700;';
  titreQ.textContent='⏱ À valider ('+quartsAValiderAdmin.length+')';
  body.appendChild(titreQ);

  if(!quartsAValiderAdmin.length){
    const vide=document.createElement('div');
    vide.style.cssText='padding:16px;text-align:center;color:#6b7a8d;font-size:13px;';
    vide.textContent='✔ Aucun quart à valider.';
    body.appendChild(vide);
  }else{
    quartsAValiderAdmin.forEach(q=>{
      const div=document.createElement('div');
      div.className='emp-item';

      const info=document.createElement('div');
      info.className='emp-info';
      const nom=document.createElement('div');
      nom.className='emp-nom';
      nom.textContent=(q.utilisateurs&&q.utilisateurs.nom)||'?';
      const detail=document.createElement('div');
      detail.className='emp-detail';
      detail.textContent=dateHeure(q.debut)+' → '+(q.fin?dateHeure(q.fin):'en cours')+' · '+texteRaisonAValider(q.raison_a_valider);
      info.appendChild(nom);info.appendChild(detail);
      div.appendChild(info);

      const actions=document.createElement('div');
      actions.className='emp-actions';
      const btV=document.createElement('button');
      btV.type='button';
      btV.className='emp-btn';
      btV.textContent='✏️ Vérifier / Corriger';
      btV.onclick=()=>ouvrirCorrectionQuart(q);
      actions.appendChild(btV);
      div.appendChild(actions);

      body.appendChild(div);
    });
  }

  const titreT=document.createElement('div');
  titreT.style='padding:14px 16px 4px;font-size:10px;color:#7dd3fc;text-transform:uppercase;letter-spacing:.8px;font-weight:700;';
  titreT.textContent='🔁 Transferts récents';
  body.appendChild(titreT);

  if(!transfertsAdmin.length){
    const vide=document.createElement('div');
    vide.style.cssText='padding:16px;text-align:center;color:#6b7a8d;font-size:13px;';
    vide.textContent='Aucun transfert récent.';
    body.appendChild(vide);
  }else{
    transfertsAdmin.forEach(t=>{
      const div=document.createElement('div');
      div.className='emp-item';

      const info=document.createElement('div');
      info.className='emp-info';
      const nom=document.createElement('div');
      nom.className='emp-nom';
      nom.textContent=(t.utilisateurs&&t.utilisateurs.nom)||'?';
      const detail=document.createElement('div');
      detail.className='emp-detail';
      const vehicule=t.passes&&t.passes.equipes&&t.passes.equipes.nom;
      detail.textContent=dateHeure(t.debut)+(vehicule?' · vers '+vehicule:'');
      info.appendChild(nom);info.appendChild(detail);
      div.appendChild(info);

      const actions=document.createElement('div');
      actions.className='emp-actions';
      const btA=document.createElement('button');
      btA.type='button';
      btA.className='emp-btn del';
      btA.textContent='↩ Annuler';
      btA.onclick=()=>annulerTransfertAdmin(t);
      actions.appendChild(btA);
      div.appendChild(actions);

      body.appendChild(div);
    });
  }
}

function messageErreurQuart(error){
  if(estErreurReseau(error)) return '📴 Pas de réseau : rien n’a été changé.';
  const msg=String((error&&error.message)||'');
  if(msg.includes('quart_encore_ouvert')) return '❌ Ce quart est encore ouvert : attends qu’il soit terminé.';
  if(msg.includes('quart_introuvable')) return '❌ Ce quart n’existe plus (la liste va se rafraîchir).';
  if(msg.includes('non_autorise')) return '❌ Réservé à l’administrateur.';
  if(String(error&&error.code)==='23P01') return '❌ Ce nouvel horaire chevauche un autre quart de cet employé.';
  if(String(error&&error.code)==='23514'||msg.includes('periode_invalide')) return '❌ La fin doit être après le début.';
  return '❌ '+(msg||'Une erreur est survenue.');
}

// « 2026-09-22T14:30 » (heure LOCALE du téléphone, comme un champ datetime-local le veut)
function versDatetimeLocal(iso){
  const d=new Date(iso);
  if(isNaN(d.getTime())) return '';
  const p=n=>String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes());
}

// ── « Vérifier / corriger » un quart ────────────────────
function ouvrirCorrectionQuart(q){
  _quartIdEnCorrection=q.id;
  document.getElementById('qc-nom').textContent=(q.utilisateurs&&q.utilisateurs.nom)||'?';
  document.getElementById('qc-raison').textContent=texteRaisonAValider(q.raison_a_valider);
  document.getElementById('qc-debut').value=versDatetimeLocal(q.debut);
  document.getElementById('qc-fin').value=q.fin?versDatetimeLocal(q.fin):'';
  document.getElementById('qc-note').value='';
  document.getElementById('correction-quart-overlay').classList.add('open');
}
function fermerCorrectionQuart(){
  document.getElementById('correction-quart-overlay').classList.remove('open');
}
function bgClickQC(e){
  if(e.target===document.getElementById('correction-quart-overlay')) fermerCorrectionQuart();
}

// Une seule action (« Valider ») : que l'heure ait été changée ou non, elle confirme le quart (le sort de « à valider »).
async function validerQuart(){
  const q=quartsAValiderAdmin.find(x=>x.id===_quartIdEnCorrection);
  if(!q) return;
  const debutVal=document.getElementById('qc-debut').value;
  const finVal=document.getElementById('qc-fin').value;
  if(!debutVal||!finVal){toast('⚠ Entre une heure de début et de fin');return;}
  const debut=new Date(debutVal), fin=new Date(finVal);
  if(!(fin.getTime()>debut.getTime())){toast('⚠ La fin doit être après le début');return;}
  const note=document.getElementById('qc-note').value.trim()||null;   // le serveur l'AJOUTE à la note déjà là (jamais ne la remplace)
  showSync(true);
  let data=null,error=null;
  try{
    const r=await db.rpc('admin_corriger_quart',{p_quart_id:q.id,p_debut:debut.toISOString(),p_fin:fin.toISOString(),p_note:note});
    data=r.data;error=r.error;
  }catch(e){error=e;signalerEchecReseau(e);}
  showSync(false);
  if(error){
    toast(messageErreurQuart(error));
    if(String(error.message||'').includes('quart_introuvable')) await chargerQuartsAdmin();   // le quart a changé ailleurs : la liste se relit toute seule
    return;
  }
  if(!data||data.statut!=='corrige'){toast('❌ Impossible de valider ce quart');return;}
  toast('✔ Quart validé');
  fermerCorrectionQuart();
  await chargerQuartsAdmin();
}

// ── Annuler un transfert (fonction serveur : deux lignes de equipage_periodes à faire correspondre) ──
async function annulerTransfertAdmin(t){
  const nom=(t.utilisateurs&&t.utilisateurs.nom)||'cet employé';
  if(!(await confirmer('Annuler ce transfert ?',nom+' retourne dans son véhicule d’origine.','Annuler le transfert','Non'))) return;
  showSync(true);
  let data=null,error=null;
  try{
    const r=await db.rpc('admin_annuler_transfert',{p_transfert_id:t.transfert_id});
    data=r.data;error=r.error;
  }catch(e){error=e;signalerEchecReseau(e);}
  showSync(false);
  if(error){toast(messageErreurQuart(error));return;}
  if(!data||data.statut!=='transfert_annule'){toast('❌ Impossible d’annuler ce transfert');return;}
  toast('↩ '+nom+' est de retour dans son véhicule d’origine');
  await chargerQuartsAdmin();
}
