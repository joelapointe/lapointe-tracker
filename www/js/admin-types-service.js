// js/admin-types-service.js — Panneau administrateur, onglet « Types de service » (étape 19)
//
// Un type de service = une ligne de la table « types_service » (nom + actif, étape 19, SQL 23). Les règles d'accès laissent déjà
// l'administrateur tout faire dessus (comme les véhicules) : AUCUNE fonction serveur n'est nécessaire ici, des écritures directes
// suffisent. stops.service reste un simple texte SANS lien (clé étrangère) vers cette table : désactiver ou renommer un type ne
// change jamais les arrêts déjà créés avec l'ancien texte — seul le menu déroulant « ＋ Nouveau stop » (liste-arrets.js,
// chargerTypesService/typesServiceActifs) en tient compte pour les PROCHAINS arrêts. On ne supprime donc jamais un type ici
// (comme les véhicules), seulement « Désactiver ».
// Demande 2 de Joé (29 sept. 2026) : chaque type a aussi une ICÔNE (colonne « icone », fichier SQL 27) qu'on choisit ici dans la banque d'icônes (icones-taches.js) ;
// le camion qui fait cette tâche la porte sur la carte. Tant qu'aucune n'est choisie, l'icône est celle que le nom laisse deviner (« Par défaut »).
let typesServiceAdmin=[];   // [{id, nom, actif, icone}]
let _typeServiceIdEnEdition=null;   // null = « ＋ Nouveau type », sinon l'id du type qu'on renomme (même fenêtre pour les deux)
let _typeIconeEnEdition=null;       // le type dont on choisit l'icône (fenêtre « Icône de … »)

async function chargerTypesServiceAdmin(){
  const body=document.getElementById('admin-body');
  let data=null,error=null;
  try{
    let r=await db.from('types_service').select('id, nom, actif, icone').order('nom');
    if(r.error) r=await db.from('types_service').select('id, nom, actif').order('nom');   // le fichier SQL 27 pas encore exécuté : la liste s'affiche quand même
    data=r.data;error=r.error;
  }catch(e){error=e;}
  if(error){
    body.innerHTML='<div style="padding:16px;color:#ef4444;font-size:13px;">❌ Impossible de charger les types de service. Vérifie la connexion, puis réessaie.</div>';
    return;
  }
  typesServiceAdmin=Array.isArray(data)?data:[];
  renderTypesServiceAdmin();
}

function renderTypesServiceAdmin(){
  const body=document.getElementById('admin-body');
  body.innerHTML='';

  const zoneAjout=document.createElement('div');
  zoneAjout.style.cssText='padding:12px 16px;';
  const btAjout=document.createElement('button');
  btAjout.type='button';
  btAjout.className='lf-btn nouveau';
  btAjout.style.width='100%';
  btAjout.textContent='＋ NOUVEAU TYPE DE SERVICE';
  btAjout.onclick=ouvrirNouveauTypeService;
  zoneAjout.appendChild(btAjout);
  body.appendChild(zoneAjout);

  if(!typesServiceAdmin.length){
    const vide=document.createElement('div');
    vide.style.cssText='padding:16px;text-align:center;color:#6b7a8d;font-size:13px;';
    vide.textContent='Aucun type de service.';
    body.appendChild(vide);
    return;
  }

  typesServiceAdmin.forEach(t=>{
    const div=document.createElement('div');
    div.className='emp-item';

    const info=document.createElement('div');
    info.className='emp-info';
    const nom=document.createElement('div');
    nom.className='emp-nom';
    nom.textContent=t.nom;
    info.appendChild(nom);
    div.appendChild(info);

    const badge=document.createElement('div');
    badge.className='emp-badge '+(t.actif?'actif':'inactif');
    badge.textContent=t.actif?'Actif':'Désactivé';
    div.appendChild(badge);

    const actions=document.createElement('div');
    actions.className='emp-actions';

    const btRenommer=document.createElement('button');
    btRenommer.type='button';
    btRenommer.className='emp-btn';
    btRenommer.textContent='✏️ Renommer';
    btRenommer.onclick=()=>ouvrirRenommerTypeService(t);
    actions.appendChild(btRenommer);

    const btEtat=document.createElement('button');
    btEtat.type='button';
    btEtat.className='emp-btn';
    btEtat.textContent=t.actif?'Désactiver':'Réactiver';
    btEtat.onclick=()=>changerEtatTypeService(t);
    actions.appendChild(btEtat);

    div.appendChild(actions);

    // L'icône de la tâche : un bouton avec l'icône actuelle (choisie, sinon celle que le nom laisse deviner) ; il s'ouvre sur la banque. Il est le DERNIER élément de la ligne
    // dans la page mais s'affiche À GAUCHE (CSS : order:-1), pour que Joé voie d'un coup d'œil l'icône de chaque tâche.
    if(typeof svgIcone==='function'){
      const cle=estCleIcone(t.icone)?t.icone:iconeParNom(t.nom);
      const btIcone=document.createElement('button');
      btIcone.type='button';
      btIcone.className='ts-ico';
      btIcone.setAttribute('aria-label','Icône de '+t.nom+' : '+nomIcone(cle)+'. Toucher pour la changer');
      btIcone.innerHTML=svgIcone(cle);
      btIcone.onclick=()=>ouvrirIconeTache(t);
      div.appendChild(btIcone);
    }
    body.appendChild(div);
  });
}

function messageErreurTypeService(error){
  if(estErreurReseau(error)) return '📴 Pas de réseau : rien n’a été changé.';
  if(String(error&&error.code)==='23505') return '❌ Ce nom de type de service existe déjà.';
  return '❌ '+((error&&error.message)||'Une erreur est survenue.');
}

// ── Désactiver / réactiver ──────────────────────────────
async function changerEtatTypeService(t){
  const actif=!t.actif;
  if(!actif&&!(await confirmer('Désactiver '+t.nom+' ?','Il ne sera plus proposé pour un nouvel arrêt. Les arrêts déjà créés avec ce type ne changent pas.','Désactiver','Annuler'))) return;
  showSync(true);
  let error=null;
  try{
    const r=await db.from('types_service').update({actif}).eq('id',t.id);
    error=r.error;
  }catch(e){error=e;signalerEchecReseau(e);}
  showSync(false);
  if(error){toast(messageErreurTypeService(error));return;}
  toast(actif?'✔ '+t.nom+' est réactivé':'✔ '+t.nom+' est désactivé');
  await chargerTypesServiceAdmin();
}

// ── « ＋ Nouveau type de service » / « Renommer » (la même fenêtre sert aux deux) ──
function ouvrirNouveauTypeService(){
  _typeServiceIdEnEdition=null;
  document.getElementById('nts-titre').textContent='＋ Nouveau type de service';
  document.getElementById('nts-btn-save').textContent='Créer';
  document.getElementById('nts-nom').value='';
  document.getElementById('nouveau-type-service-overlay').classList.add('open');
}
function ouvrirRenommerTypeService(t){
  _typeServiceIdEnEdition=t.id;
  document.getElementById('nts-titre').textContent='Renommer un type de service';
  document.getElementById('nts-btn-save').textContent='Enregistrer';
  document.getElementById('nts-nom').value=t.nom;
  document.getElementById('nouveau-type-service-overlay').classList.add('open');
}
function fermerNouveauTypeService(){
  document.getElementById('nouveau-type-service-overlay').classList.remove('open');
}
function bgClickNTS(e){
  if(e.target===document.getElementById('nouveau-type-service-overlay')) fermerNouveauTypeService();
}
async function sauvegarderTypeService(){
  const nom=document.getElementById('nts-nom').value.trim();
  if(!nom){toast('⚠ Entre un nom de type de service');return;}
  const enEdition=_typeServiceIdEnEdition;
  showSync(true);
  let error=null;
  try{
    const r=enEdition
      ?await db.from('types_service').update({nom}).eq('id',enEdition)
      :await db.from('types_service').insert([{nom}]);
    error=r.error;
  }catch(e){error=e;signalerEchecReseau(e);}
  showSync(false);
  if(error){toast(messageErreurTypeService(error));return;}
  toast(enEdition?'✔ Type de service renommé':'✔ Type de service créé');
  fermerNouveauTypeService();
  await chargerTypesServiceAdmin();
  if(typeof chargerTypesService==='function') await chargerTypesService();   // le menu déroulant « ＋ Nouveau stop » (liste-arrets.js) suit tout de suite
}

// ── Le choix de l'icône d'une tâche (demande 2) ─────────
// La fenêtre montre d'abord « Par défaut » (l'icône que le nom laisse deviner ; choisi = la base garde « vide »), puis toute la banque d'icônes. Toucher une icône l'enregistre
// tout de suite (écriture directe sur types_service : l'administrateur y a déjà droit, comme pour renommer) et ferme la fenêtre. Sans réseau, rien n'est changé (message clair).
function tuileIconeTache(cleDessin,libelle,cleChoisie,choisie){
  const b=document.createElement('button');
  b.type='button';
  b.className='it-tuile'+(choisie?' choisie':'');
  b.setAttribute('aria-pressed',choisie?'true':'false');
  b.innerHTML=svgIcone(cleDessin,'it-ico');
  const l=document.createElement('span');
  l.textContent=libelle;
  b.appendChild(l);
  b.onclick=()=>choisirIconeTache(cleChoisie);
  return b;
}
function ouvrirIconeTache(t){
  if(typeof svgIcone!=='function') return;
  _typeIconeEnEdition=t;
  document.getElementById('it-titre').textContent='Icône de « '+t.nom+' »';
  const grille=document.getElementById('it-grille');
  grille.innerHTML='';
  const actuelle=estCleIcone(t.icone)?t.icone:null;
  const defaut=iconeParNom(t.nom);
  grille.appendChild(tuileIconeTache(defaut,'Par défaut ('+nomIcone(defaut)+')',null,actuelle===null));
  clesIcones().forEach(cle=>grille.appendChild(tuileIconeTache(cle,nomIcone(cle),cle,actuelle===cle)));
  document.getElementById('icone-tache-overlay').classList.add('open');
}
function fermerIconeTache(){
  document.getElementById('icone-tache-overlay').classList.remove('open');
}
function bgClickIconeTache(e){
  if(e.target===document.getElementById('icone-tache-overlay')) fermerIconeTache();
}
function messageErreurIconeTache(error){
  if(estErreurReseau(error)) return '📴 Pas de réseau : rien n’a été changé.';
  const texte=String((error&&error.message)||'')+' '+String((error&&error.code)||'');
  if(/icone/i.test(texte)&&/column|colonne|schema cache|42703|PGRST204/i.test(texte)) return '❌ La base n’est pas encore à jour pour les icônes : le fichier SQL 27 est à exécuter dans Supabase.';
  return '❌ '+((error&&error.message)||'Une erreur est survenue.');
}
// cle = la clé de l'icône choisie, ou null = « Par défaut »
async function choisirIconeTache(cle){
  const t=_typeIconeEnEdition;
  if(!t) return;
  if(cle!==null&&!estCleIcone(cle)) return;
  showSync(true);
  let error=null;
  try{
    const r=await db.from('types_service').update({icone:cle}).eq('id',t.id);
    error=r.error;
  }catch(e){error=e;signalerEchecReseau(e);}
  showSync(false);
  if(error){toast(messageErreurIconeTache(error));return;}
  toast(cle?'✔ Icône de '+t.nom+' : '+nomIcone(cle):'✔ Icône de '+t.nom+' : par défaut');
  fermerIconeTache();
  _typeIconeEnEdition=null;
  await chargerTypesServiceAdmin();
  if(typeof chargerTypesService==='function') await chargerTypesService();   // la carte (les camions de cette tâche) suit tout de suite
  if(typeof majVehicules==='function') majVehicules();
}
