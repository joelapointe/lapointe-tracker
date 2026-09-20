// js/problemes.js — Signalement des problèmes (étape 13)
// Plusieurs problèmes peuvent exister sur un même arrêt. Ils ne sont JAMAIS effacés (ni par un nouveau signalement, ni par une
// nouvelle passe) : chacun est rattaché à la passe de celui qui le signale et reste jusqu'à ce que l'administrateur le marque « lu ».
// Chaque employé voit les problèmes non lus (orange sur la carte) et QUI les a signalés (les noms des collègues sont visibles, pas leur téléphone).
let problemesNonLus=[];   // [{id, stop_id, passe_id, utilisateur_id, note, cree_le, utilisateurs:{nom}}] : ceux que la personne connectée a le droit de voir
let _tRechargeProblemes=null;
let _envoiProbleme=false;

// Lit les problèmes non lus. En cas d'échec (pas de réseau…), on GARDE ce qu'on savait.
async function chargerProblemes(){
  try{
    const{data,error}=await db.from('problemes').select('id, stop_id, passe_id, utilisateur_id, note, cree_le, photo_chemin, utilisateurs!utilisateur_id(nom)').eq('lu',false).order('cree_le',{ascending:true});
    if(error) throw error;
    problemesNonLus=Array.isArray(data)?data:[];
    lectureReussie('problemes',problemesNonLus);
  }catch(e){
    signalerEchecReseau(e);
    return false;
  }
  return true;
}
function problemesDe(s){return problemesNonLus.filter(p=>p.stop_id===s.id);}
function aProbleme(s){return problemesNonLus.some(p=>p.stop_id===s.id);}

// La passe à laquelle rattacher le signalement : celle de la personne (chauffeur ou à bord), de préférence dans le tour de
// l'arrêt ; sinon celle où elle se trouve ; sinon aucune (un signalement sans passe est permis).
function passePourSignalement(s){
  const mienne=p=>p.je_suis_chauffeur||p.je_suis_a_bord;
  const t=tourDe(s);
  let p=t?t.passes.find(mienne):null;
  if(!p){
    for(const x of tours){ p=x.passes.find(mienne); if(p) break; }
  }
  return p?p.passe_id:null;
}

// « il y a 5 min »
function ilYa(iso){
  const t=Date.parse(iso);
  if(!(t>0)) return '';
  const min=Math.max(0,Math.round((Date.now()-t)/60000));
  if(min<1) return 'à l’instant';
  if(min<60) return 'il y a '+min+' min';
  const h=Math.round(min/60);
  if(h<24) return 'il y a '+h+' h';
  const j=Math.round(h/24);
  return 'il y a '+j+' jour'+(j>1?'s':'');
}
// « 19 sept., 14:05 »
function dateHeure(iso){
  const d=new Date(iso);
  if(isNaN(d.getTime())) return '';
  try{return d.toLocaleString('fr-CA',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});}
  catch(e){return d.toISOString().slice(0,16).replace('T',' ');}
}

// Les problèmes d'un arrêt, pour sa fiche : les 3 plus récents (tout texte venant de la base passe par esc())
function htmlProblemes(s){
  const l=problemesDe(s);
  if(!l.length) return '';
  const recents=l.slice(-3).reverse();
  let h='<div class="sc-prob-titre">⚠ '+l.length+' problème'+(l.length>1?'s':'')+' signalé'+(l.length>1?'s':'')+'</div>';
  recents.forEach(p=>{
    const qui=(currentUser&&p.utilisateur_id===currentUser.id)?'vous':(p.utilisateurs&&p.utilisateurs.nom?p.utilisateurs.nom:'');   // « vous » pour les siens, sinon le nom de l'auteur
    // La photo (étape 14e) : miniature à toucher pour l'agrandir ; sinon, pour MES problèmes, un bouton pour l'ajouter après coup
    let photo='';
    if(p.photo_chemin&&cheminPhotoValide(p.photo_chemin)){
      const u=photoUrl(p.photo_chemin);
      photo=u?'<img class="sc-prob-photo" alt="Photo du problème" src="'+esc(u)+'" onclick="voirPhoto(\''+esc(p.photo_chemin)+'\')">'
             :'<button type="button" class="sc-prob-photo vide" onclick="voirPhoto(\''+esc(p.photo_chemin)+'\')">📷</button>';
    }else if(!p.photo_chemin&&currentUser&&p.utilisateur_id===currentUser.id&&idValide(p.id)){
      photo='<button type="button" class="sc-prob-ajout" onclick="ajouterPhotoApres(\''+esc(p.id)+'\')">📷 Ajouter une photo</button>';
    }
    h+='<div class="sc-prob-ligne">'+esc(p.note)+' <span>· '+(qui?esc(qui)+' · ':'')+esc(ilYa(p.cree_le))+'</span>'+photo+'</div>';
  });
  if(l.length>recents.length) h+='<div class="sc-prob-ligne"><span>… et '+(l.length-recents.length)+' autre'+(l.length-recents.length>1?'s':'')+'</span></div>';
  return h;
}

let _idProbleme=null;   // l'identifiant du problème en cours de saisie : le MÊME si on renvoie (jamais deux problèmes), et il sert de nom à la photo

function openProbleme(){
  if(activeIdx===null)return;
  const s=stops[activeIdx];
  document.getElementById('prob-addr-lbl').textContent=s.adresse;
  const note=document.getElementById('prob-note');
  note.value='';
  note.setAttribute('maxlength','500');
  _idProbleme=nouvelId();
  retirerPhotoProbleme();
  document.getElementById('prob-overlay').classList.add('open');
}

function closeProbleme(){
  document.getElementById('prob-overlay').classList.remove('open');
  retirerPhotoProbleme();
}

function bgClickProb(e){
  if(e.target===document.getElementById('prob-overlay'))closeProbleme();
}

async function envoyerProbleme(){
  if(activeIdx===null||_envoiProbleme)return;   // un seul envoi à la fois (pas de doublon si on touche deux fois)
  const s=stops[activeIdx];if(!s)return;
  const note=document.getElementById('prob-note').value.trim();
  if(!note){toast('⚠ Écris une note');return;}

  _envoiProbleme=true;
  showSync(true);
  // Rien n'est effacé : un nouveau signalement s'ajoute aux autres. Ni le nom ni « lu » ne sont envoyés : la base met
  // elle-même le nom de la personne connectée, et un problème neuf n'est jamais « lu ».
  let error=null;
  try{
    const r=await db.from('problemes').insert([{id:_idProbleme,stop_id:s.id,passe_id:passePourSignalement(s),note:note}]);
    error=r.error;
  }catch(e){
    error=e;
  }
  // Réponse perdue puis renvoi : le problème existe déjà sous ce même identifiant (doublon de clé) : ce n'est pas un échec
  if(error&&String(error.code)==='23505') error=null;

  if(error){
    showSync(false);
    _envoiProbleme=false;
    toast('❌ Problème non envoyé (pas de réseau ?). Réessaie.');   // la note (et la photo) restent dans la boîte
    return;
  }

  // La photo, APRÈS le texte : si elle échoue, le problème est quand même signalé
  const avecPhoto=!!_photoChoisie;
  let photoEnvoyee=true;
  if(avecPhoto){
    try{
      await envoyerPhotoProbleme(_idProbleme,_photoChoisie.blob);
    }catch(e){
      photoEnvoyee=false;
    }
  }
  showSync(false);
  _envoiProbleme=false;

  await chargerProblemes();
  renderAll();
  toast(!avecPhoto?'⚠ Problème signalé !':(photoEnvoyee?'⚠ Problème signalé avec photo !':'⚠ Problème envoyé, photo non envoyée'));
  closeProbleme();
  closeCard();
  checkProblemes();
}

// Un problème signalé (ou marqué « lu ») sur un autre téléphone : on relit une seule fois même si plusieurs changements arrivent d'un coup
function planifierRechargementProblemes(){
  clearTimeout(_tRechargeProblemes);
  _tRechargeProblemes=setTimeout(async()=>{
    if(!currentUser) return;
    if(await chargerProblemes()){ renderAll(); majCarte(); checkProblemes(); }
  },300);
}

// Pastille rouge sur le bouton ADMIN : nombre de problèmes non lus
function checkProblemes(){
  const nb=problemesNonLus.length;
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
