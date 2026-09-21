// js/quart.js — Étape 17 : le quart de travail (punch « Je commence / Je termine »). Morceau 1 : « suis-je en service ? »
//
// L'employé est EN SERVICE quand il a un quart ouvert (colonne « fin » vide). Le serveur ouvre aussi un quart tout seul quand quelqu'un est
// ajouté à l'équipage ou débute une passe sans avoir puncher (« à valider » par l'administrateur). On ne lit QUE ses propres quarts.
// Même principe que pour les tours (tours.js), les équipages (vehicules.js) et les problèmes (problemes.js) : `monQuart` est TOUJOURS la copie du
// serveur avec, par-dessus, les gestes faits sans réseau et pas encore envoyés (file-attente.js) ; une relecture ne les défait jamais.
let monQuart=null;          // {id, debut, debut_source, a_valider, raison_a_valider, local} : le quart ouvert affiché, sinon null
let _quartServeur=null;     // la copie du serveur, telle quelle (jamais modifiée)
let _quartConnu=false;      // a-t-on déjà su (du serveur ou de la copie du téléphone) si on est en service ?

// Lit MON quart ouvert. En cas d'échec (pas de réseau…), on GARDE ce qu'on savait. Renvoie true si la lecture a réussi.
async function chargerMonQuart(){
  if(!currentUser) return false;
  try{
    const{data,error}=await db.from('quarts').select('id, debut, fin, debut_source, a_valider, raison_a_valider').eq('utilisateur_id',currentUser.id).is('fin',null).order('debut',{ascending:false}).limit(1);
    if(error) throw error;
    const ouverts=(Array.isArray(data)?data:[]).filter(x=>x&&!x.fin);   // (un quart fini n'est jamais « en cours », quoi que réponde le serveur)
    const q=ouverts.length?ouverts[0]:null;
    installerQuart(q);
    lectureReussie('quart',q);   // (la copie gardée reste celle du serveur : jamais le résultat superposé)
    return true;
  }catch(e){
    signalerEchecReseau(e);
    return false;
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
