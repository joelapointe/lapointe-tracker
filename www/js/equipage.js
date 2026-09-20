// js/equipage.js — L'équipage (étape 15) : qui est à bord, choisir une personne, avertissements nommés, ajouter à bord
//
// Règles décidées par Joé (voir le cahier, section 7) :
//   • Une équipe = un véhicule ; seul le CHAUFFEUR de la passe (et l'administrateur, étape 19) modifie l'équipage, à tout moment.
//   • Si on ajoute quelqu'un déjà à bord d'un AUTRE véhicule, l'application AVERTIT en NOMMANT le véhicule et demande si la personne
//     change de véhicule. Oui = transfert (sortie de l'autre passe et entrée ici à la même heure). Non = rien ne change.
//   • Avertissement aussi (donné par le serveur) si la personne a terminé son quart depuis moins de 4 h.
//   • 2 ou 3 touchers au maximum ; chaque geste porte un identifiant unique (« cle_client ») : renvoyé, il ne crée jamais de doublon
//     (l'étape 16, hors réseau, s'en servira).
let employes=[];        // [{id, nom}] : les employés actifs (noms seulement, jamais de téléphone)

// Lit les employés actifs (pour choisir qui monte à bord). En cas d'échec, on garde ce qu'on savait. Renvoie true si la lecture a réussi.
async function chargerEmployes(){
  try{
    const{data,error}=await db.from('utilisateurs').select('id, nom').eq('actif',true).order('nom');
    if(error) throw error;
    employes=(Array.isArray(data)?data:[]).map(x=>({id:x.id,nom:x.nom||'?'})).sort((a,b)=>a.nom.localeCompare(b.nom,'fr'));   // en ordre alphabétique, quoi que réponde le serveur
    lectureReussie('employes',employes);
    return true;
  }catch(e){
    signalerEchecReseau(e);
    return false;
  }
}

// Où est cette personne en ce moment ? null (libre), sinon {vehicule, chauffeur:vrai si elle CONDUIT ce véhicule, passeId}
function ouEstIl(userId){
  for(const t of tours){
    if(!tourEnCours(t)) continue;
    for(const p of t.passes){
      const m=(equipages[p.passe_id]||[]).find(x=>x.utilisateur_id===userId);
      if(m) return {vehicule:nomVehiculeDe(p.equipe_id)||'un autre camion',chauffeur:m.role==='chauffeur',passeId:p.passe_id};
    }
  }
  return null;
}

// La question posée avant de faire monter quelqu'un, d'après les avertissements du serveur
function questionAvertissements(nom,avertissements){
  const lignes=[];
  (avertissements||[]).forEach(a=>{
    if(a.type==='conflit_vehicule') lignes.push(nom+' est à bord de « '+(a.vehicule||'un autre camion')+' » : le faire monter le fait quitter ce véhicule.');
    else if(a.type==='quart_termine') lignes.push(nom+' a terminé son quart '+ilYa(a.fin)+'.');
  });
  return {titre:'Faire monter '+nom+' ?',texte:(lignes.join(' ')||nom+' est peut-être ailleurs.')+' Le faire monter quand même ?'};
}

// Un geste « ajouter à bord » : la même clé au renvoi = jamais de doublon
async function appelAjouterEquipier(passeId,userId,cle,forcer){
  try{
    return await db.rpc('equipage_ajouter',{p_cle_client:cle,p_passe_id:passeId,p_utilisateur_id:userId,p_lat:lastPos?lastPos[0]:null,p_lon:lastPos?lastPos[1]:null,p_forcer:!!forcer});
  }catch(e){
    return {data:null,error:e};
  }
}

// Conclut un ajout à partir de la réponse du serveur. Un avertissement devient une question NOMMÉE ; « oui » refait le geste avec « forcer »
// (transfert). Renvoie {statut: 'ajoute'|'transfere'|'deja'|'ignore'|'refuse'|'passe_terminee'|'erreur', …}
async function conclureAjout(passeId,personne,cle,r){
  if(r.error) return {statut:'erreur',error:r.error};
  const d=r.data||{};
  if(d.statut==='ajoute'||d.statut==='transfere') return {statut:d.statut};
  if(d.statut==='deja_a_bord') return {statut:'deja'};
  if(d.statut==='refuse') return {statut:'refuse',raison:d.raison,vehicule:d.vehicule};
  if(d.statut==='passe_terminee') return {statut:'passe_terminee'};
  if(d.statut==='avertissement'){
    const q=questionAvertissements(personne.nom,d.avertissements);
    if(!(await confirmer(q.titre,q.texte,'Oui, le faire monter','Non'))) return {statut:'ignore'};
    const r2=await appelAjouterEquipier(passeId,personne.utilisateur_id,cle,true);
    if(r2.error) return {statut:'erreur',error:r2.error};
    const s2=r2.data&&r2.data.statut;
    if(s2==='ajoute'||s2==='transfere') return {statut:s2};
    if(s2==='deja_a_bord') return {statut:'deja'};
    if(s2==='refuse') return {statut:'refuse',raison:r2.data.raison,vehicule:r2.data.vehicule};
    return {statut:'erreur'};
  }
  return {statut:'erreur'};
}

function messageRefusEquipage(nom,c){
  if(c.statut==='refuse'&&c.raison==='chauffeur_ailleurs') return nom+' conduit déjà « '+(c.vehicule||'un autre camion')+' ».';
  if(c.statut==='passe_terminee') return 'Cette passe est terminée.';
  return 'Impossible de faire monter '+nom+'.';
}

// ── Choisir une personne dans la liste des employés ────
// exclus : ensemble de numéros qu'on ne propose pas ; auChoix({id, nom}) est appelé quand on touche un nom
let _auChoixPersonne=null;
function ouvrirChoixPersonne(titre,exclus,auChoix){
  const corps=document.getElementById('choix-body');
  document.getElementById('choix-title').textContent=titre;
  corps.innerHTML='';
  const liste=employes.filter(e=>!(currentUser&&e.id===currentUser.id)&&!exclus.has(e.id));
  if(!liste.length){
    const v=document.createElement('div');
    v.className='choix-vide';
    v.textContent=employes.length?'Tout le monde est déjà là.':'Liste des employés indisponible. Vérifie la connexion, puis réessaie.';
    corps.appendChild(v);
  }
  liste.forEach(e=>{
    const ou=ouEstIl(e.id);
    const b=document.createElement('button');
    b.type='button';
    b.className='choix-personne'+(ou?' ailleurs':'');
    b.innerHTML=esc(e.nom)+(ou?'<small>'+(ou.chauffeur?'🚜 conduit ':'à bord de ')+'« '+esc(ou.vehicule)+' »</small>':'');
    b.onclick=()=>{ fermerChoixPersonne(); return auChoix(e); };
    corps.appendChild(b);
  });
  _auChoixPersonne=auChoix;
  document.getElementById('choix-overlay').classList.add('open');
}
function fermerChoixPersonne(){
  document.getElementById('choix-overlay').classList.remove('open');
  _auChoixPersonne=null;
}
function bgClickChoix(e){
  if(e.target===document.getElementById('choix-overlay')) fermerChoixPersonne();
}
