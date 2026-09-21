// js/quart.js — Étape 17 : le quart de travail (punch « Je commence / Je termine »). Morceau 1 : « suis-je en service ? »
//
// L'employé est EN SERVICE quand il a un quart ouvert (colonne « fin » vide). Le serveur ouvre aussi un quart tout seul quand quelqu'un est
// ajouté à l'équipage ou débute une passe sans avoir puncher (« à valider » par l'administrateur). On ne lit QUE ses propres quarts.
// Même principe que pour les tours (tours.js), les équipages (vehicules.js) et les problèmes (problemes.js) : `monQuart` est TOUJOURS la copie du
// serveur avec, par-dessus, les gestes faits sans réseau et pas encore envoyés (file-attente.js) ; une relecture ne les défait jamais.
let monQuart=null;          // {id, debut, debut_source, a_valider, raison_a_valider, local} : le quart ouvert affiché, sinon null
let _quartServeur=null;     // la copie du serveur, telle quelle (jamais modifiée)
let _quartConnu=false;      // a-t-on déjà su (du serveur ou de la copie du téléphone) si on est en service ?
let avisFin=null;           // {quartId, fin, parId} : un quart TERMINÉ PAR QUELQU'UN D'AUTRE (le chauffeur) que la personne n'a pas encore lu (étape 17, équipage)
const AVIS_FIN_HEURES=24;                  // on n'annonce que les fins des dernières 24 heures
const CLE_AVIS_VU='lp_avis_quart_vu:';     // + numéro de l'employé : le dernier avis lu (« OK » ou « Ce n'est pas exact »)

// Lit MON quart ouvert. En cas d'échec (pas de réseau…), on GARDE ce qu'on savait. Renvoie true si la lecture a réussi.
async function chargerMonQuart(){
  if(!currentUser) return false;
  try{
    const{data,error}=await db.from('quarts').select('id, debut, fin, debut_source, a_valider, raison_a_valider').eq('utilisateur_id',currentUser.id).is('fin',null).order('debut',{ascending:false}).limit(1);
    if(error) throw error;
    const ouverts=(Array.isArray(data)?data:[]).filter(x=>x&&!x.fin);   // (un quart fini n'est jamais « en cours », quoi que réponde le serveur)
    const q=ouverts.length?ouverts[0]:null;
    avisFin=await lireAvisFin();   // AVANT de poser le quart : un avis passe avant l'écran d'accueil (quart-ecrans.js)
    installerQuart(q);
    lectureReussie('quart',q);   // (la copie gardée reste celle du serveur : jamais le résultat superposé)
    return true;
  }catch(e){
    signalerEchecReseau(e);
    return false;
  }
}
// Mon dernier quart TERMINÉ PAR LE CHAUFFEUR (fin_source « equipage », SQL 20) dans les dernières 24 h, s'il n'a pas encore été lu, contesté ou examiné
// par l'administrateur. Un passager sans téléphone en main le découvre ici. En cas d'échec de lecture, on GARDE ce qu'on savait.
async function lireAvisFin(){
  try{
    const{data,error}=await db.from('quarts').select('id, fin, fin_source, fin_par, a_valider, raison_a_valider, valide_le').eq('utilisateur_id',currentUser.id).eq('fin_source','equipage').order('fin',{ascending:false}).limit(1);
    if(error) throw error;
    const l=(Array.isArray(data)?data:[]).filter(x=>x&&x.fin&&x.fin_source==='equipage').sort((a,b)=>Date.parse(b.fin)-Date.parse(a.fin))[0];
    if(!l||Date.now()-Date.parse(l.fin)>AVIS_FIN_HEURES*3600000) return null;
    if(l.valide_le||(l.a_valider&&l.raison_a_valider==='fin_contestee')) return null;   // déjà examiné, ou déjà signalé
    if(lireMemo(CLE_AVIS_VU+currentUser.id)===l.id) return null;                            // déjà lu
    if(typeof employes!=='undefined'&&!employes.length&&typeof chargerEmployes==='function') await chargerEmployes();   // pour nommer le chauffeur
    return {quartId:l.id,fin:l.fin,parId:l.fin_par||null};
  }catch(e){
    return avisFin;
  }
}
function installerQuart(q){
  _quartServeur=q;
  _quartConnu=true;
  poserQuart();
}
function poserQuart(){
  if(!_quartConnu) return;   // pas encore lu : rien à superposer
  monQuart=superposerQuart(_quartServeur);
  majPastilleQuart();
  if(typeof verifierAccueilQuart==='function') verifierAccueilQuart();   // l'écran d'accueil « JE COMMENCE » (quart-ecrans.js)
}

// Renvoie la copie du serveur si rien n'attend, sinon une COPIE où les gestes en attente sont appliqués, dans l'ordre où ils ont été faits.
// Règles : (1) on ne touche JAMAIS à la copie du serveur ; (2) répétable sans doublon ; (3) on imite ce que ferait le serveur.
function superposerQuart(q){
  const attente=(typeof gestesEnAttente==='function')?gestesEnAttente():[];
  const concernes=attente.filter(g=>g.type==='quart_commencer'||g.type==='quart_terminer'||g.type==='debuter_passe');
  if(!concernes.length) return q;
  let cur=q?{...q}:null;
  concernes.forEach(g=>{
    const a=g.args||{};
    if(g.type==='quart_commencer'){
      if(!cur) cur={id:a.id,debut:g.moment,debut_source:'manuel',a_valider:false,raison_a_valider:null,local:true};   // déjà en service : le serveur répondrait « deja_en_quart »
    }else if(g.type==='quart_terminer'){
      // (sans numéro : « mon quart ouvert » ; avec un numéro : seulement ce quart-là)
      if(cur&&(!a.quartId||cur.id==null||a.quartId===cur.id)) cur=null;
    }else if(g.type==='debuter_passe'){
      // Débuter une passe sans être en service : le serveur ouvre le quart tout seul (à valider)
      if(!cur) cur={id:null,debut:g.moment,debut_source:'passe',a_valider:true,raison_a_valider:'ouvert_par_passe',local:true};
    }
  });
  return cur;
}

// En service : un quart ouvert, ou une passe à moi en cours (le serveur en a ouvert un pour elle)
function enService(){
  return !!monQuart||(typeof maPasse==='function'&&!!maPasse());
}

// ── La pastille du haut de l'écran ─────────────────────
// Elle prend la place du logo (le côté droit est déjà occupé par le GPS et « Déconnexion »).
function etatPastilleQuart(){
  if(monQuart) return {classe:'on',texte:'🟢 Depuis '+heureCourte(monQuart.debut)+(monQuart.local?' ⏳':''),titre:'En service depuis '+heureCourte(monQuart.debut)+(monQuart.a_valider?' (ouvert automatiquement : à valider)':'')+(monQuart.local?' — sera envoyé au retour du signal':'')};
  if(typeof maPasse==='function'&&maPasse()) return {classe:'on',texte:'🟢 En service',titre:'En service (ta passe est en cours)'};
  if(!_quartConnu) return {classe:'inconnu',texte:'⚪ …',titre:'État du quart inconnu (pas encore lu)'};
  return {classe:'off',texte:'⚪ Hors service',titre:'Pas en service'};
}
function majPastilleQuart(){
  const b=document.getElementById('quart-pastille');
  const logo=document.getElementById('logo');
  if(!b) return;
  if(!currentUser){
    b.style.display='none';
    if(logo) logo.style.display='';
    return;
  }
  const e=etatPastilleQuart();
  b.style.display='inline-flex';
  b.className='quart-'+e.classe;
  b.textContent=e.texte;
  b.setAttribute('title',e.titre);
  if(logo) logo.style.display='none';
}
