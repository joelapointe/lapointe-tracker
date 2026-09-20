// js/equipage-panneau.js — PENDANT LA PASSE : le panneau « Équipage » (étape 15c)
//
// Le bouton « 👤 Équipage · N à bord » du bandeau ouvre la liste de ceux qui sont à bord. Le CHAUFFEUR peut en retirer et en ajouter
// (« ＋ Ajouter » → un nom : 3 touchers en tout) ; un passager voit la liste sans pouvoir la changer. Les changements faits sur les
// autres téléphones arrivent en temps réel : le panneau se met à jour tout seul. Les questions (déjà à bord ailleurs, quart terminé
// depuis peu) et les clés uniques contre les doublons sont dans equipage.js.
let _equipageOccupe=false;   // un seul geste à la fois (pas de double toucher)

// La passe dont le panneau parle : la mienne (je conduis), sinon celle d'un camion où je suis passager
function passeDuPanneau(){
  const m=maPasse();
  if(m) return {passeId:m.passe.passe_id,equipeId:m.passe.equipe_id,tour:m.tour,chauffeur:true};
  const b=monBord();
  return b?{passeId:b.passe.passe_id,equipeId:b.passe.equipe_id,tour:b.tour,chauffeur:false}:null;
}
function nbABord(passeId){return (equipages[passeId]||[]).length;}

async function ouvrirEquipage(){
  if(!currentUser||!passeDuPanneau()) return;
  document.getElementById('equipage-overlay').classList.add('open');
  majPanneauEquipage();
  if(!employes.length) chargerEmployes();   // la liste pour « ＋ Ajouter » (en arrière-plan)
}
function fermerEquipage(){
  document.getElementById('equipage-overlay').classList.remove('open');
}
function bgClickEquipage(e){
  if(e.target===document.getElementById('equipage-overlay')) fermerEquipage();
}

// Redessine le panneau s'il est ouvert (appelé à chaque changement des tours et des équipages)
function majPanneauEquipage(){
  const o=document.getElementById('equipage-overlay');
  if(!o||!o.classList.contains('open')) return;
  const p=passeDuPanneau();
  if(!p){fermerEquipage();return;}   // ma passe est terminée, ou je ne suis plus à bord
  document.getElementById('equipage-sub').textContent='🚜 '+(nomVehiculeDe(p.equipeId)||'Camion')+' · Passe n° '+numeroPasse(p.tour);
  const corps=document.getElementById('equipage-body');
  corps.innerHTML='';
  const liste=(equipages[p.passeId]||[]).slice();
  if(!liste.length){
    const v=document.createElement('div');
    v.className='eq-vide';
    v.textContent='Aucune information sur l’équipage pour l’instant.';
    corps.appendChild(v);
  }
  liste.forEach(m=>{
    const ligne=document.createElement('div');
    ligne.className='eq-ligne';
    const nom=document.createElement('div');
    nom.className='eq-nom';
    nom.textContent=m.nom+((currentUser&&m.utilisateur_id===currentUser.id)?' (toi)':'');
    ligne.appendChild(nom);
    if(m.role==='chauffeur'){
      const tag=document.createElement('div');
      tag.className='eq-role';
      tag.textContent='🚜 Chauffeur';
      ligne.appendChild(tag);
    }else if(p.chauffeur){
      const b=document.createElement('button');
      b.type='button';
      b.className='eq-retirer';
      b.textContent='✕ Retirer';
      b.onclick=()=>retirerDuVehicule(m.utilisateur_id);
      ligne.appendChild(b);
    }
    corps.appendChild(ligne);
  });
  if(!p.chauffeur){
    const note=document.createElement('div');
    note.className='eq-note';
    note.textContent='Seul le chauffeur modifie l’équipage.';
    corps.appendChild(note);
  }
  document.getElementById('btn-equipage-ajouter').style.display=p.chauffeur?'flex':'none';
}

function messageErreurEquipage(e){
  const m=String((e&&e.message)||'');
  if(m.includes('non_autorise')) return 'Seul le chauffeur de la passe peut modifier l’équipage.';
  if(m.includes('utilisateur_inactif')) return 'Cette personne n’est plus active.';
  if(m.includes('chauffeur_ne_peut_etre_retire')) return 'Le chauffeur ne peut pas être retiré.';
  if(m.includes('passe_introuvable')) return 'Cette passe n’existe plus.';
  return 'Pas de réseau ou erreur. Réessaie.';
}

// Relit l'équipage et redessine tout ce qui le montre (camions de la carte, bandeau, panneau)
async function actualiserEquipage(){
  await chargerVehiculesEtEquipages();
  await chargerTours();
  renderAll();majCarte();
  majPanneauEquipage();
}

// « ＋ Ajouter » : la liste des employés, sans ceux déjà à bord ; ceux qui sont à bord ailleurs sont marqués (la question nomme le véhicule)
async function ajouterAuVehicule(){
  const p=passeDuPanneau();
  if(!p||!p.chauffeur||_equipageOccupe) return;
  if(!employes.length) await chargerEmployes();
  const exclus=new Set((equipages[p.passeId]||[]).map(x=>x.utilisateur_id));
  ouvrirChoixPersonne('Qui monte avec toi ?',exclus,e=>ajouterPersonneAuVehicule(p.passeId,{utilisateur_id:e.id,nom:e.nom}));
}
async function ajouterPersonneAuVehicule(passeId,personne){
  if(_equipageOccupe) return;
  _equipageOccupe=true;
  try{
    const avant=ouEstIl(personne.utilisateur_id);   // où elle était (pour dire d'où elle vient)
    showSync(true);
    const cle=nouvelId();
    const r=await appelAjouterEquipier(passeId,personne.utilisateur_id,cle,false);
    showSync(false);
    const c=await conclureAjout(passeId,personne,cle,r);   // un avertissement (déjà à bord ailleurs, quart terminé) devient une question nommée
    if(c.statut==='ignore') return;                          // « Non » : rien ne change
    if(c.statut==='erreur'){toast('❌ '+messageErreurEquipage(c.error));return;}
    if(c.statut==='refuse'||c.statut==='passe_terminee'){toast('⚠ '+messageRefusEquipage(personne.nom,c));return;}
    await actualiserEquipage();
    toast(c.statut==='transfere'?'👤 '+personne.nom+' transféré'+(avant?' depuis '+avant.vehicule:''):(c.statut==='deja'?'👤 '+personne.nom+' était déjà à bord':'👤 '+personne.nom+' est à bord'));
  }finally{
    showSync(false);
    _equipageOccupe=false;
  }
}

// « ✕ Retirer » : confirmation, puis equipage_retirer. Dans les 2 premières minutes le serveur ANNULE l'ajout (et, si c'était un
// transfert, la personne retourne dans son camion d'origine) ; plus tard, elle descend simplement.
async function retirerDuVehicule(userId){
  const p=passeDuPanneau();
  if(!p||!p.chauffeur||_equipageOccupe) return;
  const membre=(equipages[p.passeId]||[]).find(x=>x.utilisateur_id===userId);
  if(!membre||membre.role==='chauffeur') return;
  const nomVeh=nomVehiculeDe(p.equipeId)||'ce camion';
  if(!(await confirmer('Retirer '+membre.nom+' ?',membre.nom+' descend de « '+nomVeh+' » maintenant.','Oui, retirer','Non'))) return;
  if(_equipageOccupe) return;
  _equipageOccupe=true;
  try{
    showSync(true);
    let r;
    try{
      r=await db.rpc('equipage_retirer',{p_cle_client:nouvelId(),p_passe_id:p.passeId,p_utilisateur_id:userId,p_lat:lastPos?lastPos[0]:null,p_lon:lastPos?lastPos[1]:null});
    }catch(err){
      r={data:null,error:err};
    }
    showSync(false);
    if(r.error){toast('❌ '+messageErreurEquipage(r.error));return;}
    await actualiserEquipage();
    const s=r.data&&r.data.statut;
    if(s==='annule') toast('↩ Ajout de '+membre.nom+' annulé'+(r.data.retour_vehicule_precedent?' · retour dans son camion':''));
    else if(s==='pas_a_bord') toast('👤 '+membre.nom+' n’était plus à bord');
    else toast('👤 '+membre.nom+' est descendu');
  }finally{
    showSync(false);
    _equipageOccupe=false;
  }
}
