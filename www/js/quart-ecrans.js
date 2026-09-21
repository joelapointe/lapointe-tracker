// js/quart-ecrans.js — Étape 17, morceau 2 : les gros boutons du punch (« ▶ JE COMMENCE » / « ■ JE TERMINE ») et la confirmation de l'heure
//
// Décisions de Joé (20 et 21 septembre 2026) :
//   • À l'ouverture de l'application, si la personne n'est pas en service : un grand écran « ▶ JE COMMENCE » avec un petit lien « voir la carte ».
//     Il n'est JAMAIS bloquant : la carte reste à un toucher, et l'écran ne revient pas tout seul (une seule fois par ouverture et par personne).
//   • La pastille du haut (quart.js) est un bouton : hors service, elle rouvre l'écran d'accueil ; en service, elle ouvre « ■ JE TERMINE ».
//     Deux touchers (ouvrir, puis confirmer) : jamais une fin de quart par accident.
//   • Une CONFIRMATION VISUELLE de l'heure enregistrée (« ✔ Quart commencé à 06 h 42 »). En ligne, c'est l'heure du SERVEUR (l'horloge du
//     téléphone ne peut pas fausser un punch fait en ligne) ; sans réseau, c'est l'heure du téléphone, avec « ⏳ envoyé au retour du signal ».
//   • « Je termine » avec une passe en cours : l'écran le dit (« ta passe sera terminée aussi », décision du cahier, section 7). Le serveur ferme
//     la passe et sort la personne du camion ; hors réseau, tours.js et vehicules.js le montrent tout de suite à l'écran.
// Même patron que les autres gestes (passe.js, arrets.js) : en ligne, un délai de 10 s (avecDelai) puis la file en cas de panne ; sans réseau, la file
// (file-attente.js). Le numéro d'un quart est fabriqué par le téléphone (nouvelId) : un renvoi ne crée jamais deux quarts.
// Position : la dernière connue du GPS déjà actif (lastPos). Sans position, le punch se fait quand même (jamais bloquant). La lecture précise = morceau 3.
let _accueilQuartPour=null;     // à QUELLE personne l'écran d'accueil a déjà été montré depuis l'ouverture de l'application
let _ecranQuart=null;           // l'écran affiché : 'accueil', 'fin', 'avis', 'confirmation', ou null
let _envoiQuart=false;          // un seul geste du punch à la fois (pas de double toucher)
let _tConfirmationQuart=null;
let DELAI_CONFIRMATION_QUART_MS=7000;   // la confirmation se ferme toute seule (OK la ferme tout de suite)
let _verificationQuart=false;   // (fermer un écran relance la vérification : jamais de récursion)
let _equipeFin=null;            // « Terminer aussi le quart de : » {passeId, membres:[{utilisateur_id,nom}], coches:{id:true}, source, chargement}
const FIN_EQUIPE_HEURES=3;      // on ne propose l'équipe d'une passe déjà fermée que si elle s'est terminée il y a moins de 3 h (le serveur a le dernier mot : réglage fin_equipe_apres_passe_heures)

function positionDuPunch(){
  return {lat:lastPos?lastPos[0]:null,lon:lastPos?lastPos[1]:null,precision:null};
}

// ── L'écran d'accueil : une seule fois par ouverture et par personne ──
// Appelé chaque fois que l'état du quart est posé (quart.js, poserQuart). Que la personne soit en service ou non, on note qu'on a regardé :
// après un « Je termine », l'écran d'accueil ne doit PAS réapparaître juste après la confirmation.
// Un quart TERMINÉ PAR LE CHAUFFEUR (avisFin, quart.js) passe AVANT l'écran d'accueil : il ne se fait jamais écraser par lui, et l'accueil attend qu'il soit lu.
function verifierAccueilQuart(){
  if(!currentUser||!_quartConnu||_verificationQuart) return;
  _verificationQuart=true;
  try{
    synchroniserEcranQuart();
    if(_ecranQuart!==null||_envoiQuart) return;   // un écran est déjà ouvert : ce qui attend sera décidé à sa fermeture (fermerEcranQuart)
    if(avisFin){ouvrirEcranQuart('avis');return;}
    if(_accueilQuartPour===currentUser.id) return;
    _accueilQuartPour=currentUser.id;
    if(!enService()) ouvrirEcranQuart('accueil');
  }finally{
    _verificationQuart=false;
  }
}
// L'état a changé sous un écran ouvert (le serveur a fermé le quart, un autre téléphone a commencé…) : l'écran devenu inutile se ferme
function synchroniserEcranQuart(){
  if(_envoiQuart) return;   // un geste est en cours : c'est lui qui décide de l'écran
  if(_ecranQuart==='accueil'&&enService()) fermerEcranQuart();
  else if(_ecranQuart==='fin'&&!enService()) fermerEcranQuart();
}

// La pastille du haut
function pastilleQuartTouchee(){
  if(!currentUser) return;
  if(enService()){ouvrirEcranQuart('fin');return;}
  if(_quartConnu){ouvrirEcranQuart('accueil');return;}
  toast('Je ne sais pas encore si tu es en service : un instant…');
  chargerMonQuart();
}

// ── Les écrans ─────────────────────────────────────────
function ouvrirEcranQuart(quel){
  const o=document.getElementById('quart-overlay'),boite=document.getElementById('quart-boite');
  if(!o||!boite) return;
  clearTimeout(_tConfirmationQuart);_tConfirmationQuart=null;
  _ecranQuart=quel;
  if(quel==='fin') preparerEquipeFin();
  boite.innerHTML=quel==='fin'?htmlFinQuart():(quel==='avis'?htmlAvisFin():htmlAccueilQuart());
  o.classList.toggle('plein',quel==='accueil');
  o.classList.add('open');
  majEcranQuart();
}
function fermerEcranQuart(){
  clearTimeout(_tConfirmationQuart);_tConfirmationQuart=null;
  _ecranQuart=null;
  const o=document.getElementById('quart-overlay');
  if(o){o.classList.remove('open');o.classList.remove('plein');}
  verifierAccueilQuart();   // ce qui attendait (un avis à lire, l'écran d'accueil) passe maintenant
}
function bgClickQuart(e){
  // (l'écran d'accueil ne se ferme que par « voir la carte » : un toucher à côté ne doit rien faire)
  if(e.target===document.getElementById('quart-overlay')&&_ecranQuart&&_ecranQuart!=='accueil') fermerEcranQuart();
}
function majEcranQuart(){
  ['btn-quart-commencer','btn-quart-terminer','btn-quart-ok','btn-quart-signaler'].forEach(id=>{
    const b=document.getElementById(id);
    // (« JE TERMINE » attend aussi la lecture de l'équipe : jamais un toucher trop rapide qui oublierait les passagers)
    if(b) b.disabled=_envoiQuart||(id==='btn-quart-terminer'&&!!_equipeFin&&_equipeFin.chargement);
  });
}
const NOTE_HORS_RESEAU_QUART='<div class="quart-note">📴 Pas de réseau : l’heure est gardée sur ton téléphone et sera envoyée au retour du signal.</div>';

function htmlAccueilQuart(){
  const nom=currentUser&&currentUser.nom?currentUser.nom:'';
  return '<div id="quart-titre" class="quart-salut">Bonjour'+(nom?', '+esc(nom):'')+'</div>'+
    '<div class="quart-sous">Touche le bouton pour commencer ton quart de travail.</div>'+
    '<button id="btn-quart-commencer" type="button" class="quart-gros commence" onclick="commencerQuart()">▶ JE COMMENCE</button>'+
    '<div id="quart-msg" class="quart-msg" role="alert"></div>'+
    (reseau.enLigne?'':NOTE_HORS_RESEAU_QUART)+
    '<button type="button" class="quart-lien" onclick="fermerEcranQuart()">voir la carte</button>';
}

function htmlFinQuart(){
  const q=monQuart,m=maPasse(),b=monBord();
  let h='<div id="quart-titre" class="quart-salut">■ Terminer ton quart ?</div>';
  const duree=q&&q.debut?dureeTexte(q.debut,new Date().toISOString()):'';
  h+=q&&q.debut
    ?'<div class="quart-sous">En service depuis '+esc(heureCourte(q.debut))+(duree?' · '+esc(duree)+' de travail':'')+'</div>'
    :'<div class="quart-sous">Tu es en service.</div>';
  if(m) h+='<div class="quart-avert">🚜 Ta passe n° '+esc(numeroPasse(m.tour))+' ('+esc(nomRoute(m.tour.route_id)||'route')+') sera terminée aussi.</div>';
  else if(b) h+='<div class="quart-avert">Tu descends de « '+esc(nomVehiculeDe(b.passe.equipe_id)||'ce camion')+' ».</div>';
  if(q&&q.a_valider) h+='<div class="quart-note">Ce quart s’est ouvert automatiquement : l’administrateur le validera.</div>';
  h+=htmlEquipeFin();
  if(!reseau.enLigne) h+=NOTE_HORS_RESEAU_QUART;
  h+='<div class="quart-actions"><button id="btn-quart-terminer" type="button" class="quart-gros termine" onclick="terminerQuart()">■ JE TERMINE</button>'+
    '<div id="quart-msg" class="quart-msg" role="alert"></div>'+
    '<button type="button" class="quart-lien" onclick="fermerEcranQuart()">Non, continuer</button></div>';
  return h;
}

// La confirmation : « ✔ Quart commencé à » et, EN GROS sur sa propre ligne (jamais coupée en deux), l'heure enregistrée « 06 h 42 »
// (lignes : détails ; attente : « ⏳ envoyé au retour du signal » quand rien n'est encore parti ; heure vide : pas de grosse heure ;
//  garder : la confirmation NE se ferme PAS toute seule, parce qu'elle porte un avertissement à lire)
function montrerConfirmationQuart(titre,heure,lignes,attente,garder){
  const o=document.getElementById('quart-overlay'),boite=document.getElementById('quart-boite');
  if(!o||!boite) return;
  clearTimeout(_tConfirmationQuart);_tConfirmationQuart=null;
  _ecranQuart='confirmation';
  boite.innerHTML='<div class="quart-coche" aria-hidden="true">✔</div>'+
    '<div id="quart-titre" class="quart-salut">'+esc(titre)+'</div>'+
    (heure?'<div class="quart-heure">'+esc(heure)+'</div>':'')+
    (lignes||[]).map(l=>'<div class="quart-info">'+esc(l)+'</div>').join('')+
    (attente?'<div class="quart-note">'+esc(attente)+'</div>':'')+
    '<button type="button" class="quart-ok" onclick="fermerEcranQuart()">OK</button>';
  o.classList.remove('plein');
  o.classList.add('open');
  if(!garder) _tConfirmationQuart=setTimeout(fermerEcranQuart,DELAI_CONFIRMATION_QUART_MS);
}
// Un message d'erreur : dans l'écran s'il est ouvert (le message flottant est plus bas que lui), sinon en message flottant
function messageQuart(texte){
  const z=(_ecranQuart==='accueil'||_ecranQuart==='fin'||_ecranQuart==='avis')?document.getElementById('quart-msg'):null;
  if(z) z.textContent=texte; else toast(texte);
}
function messageErreurQuart(e){
  const m=String((e&&e.message)||'');
  if(m.includes('non_autorise')) return 'Ton compte ne peut pas faire ce geste.';
  if(m.includes('quart_introuvable')) return 'Ce quart n’existe plus ou n’est pas à toi.';
  if(m.includes('geste_trop_ancien')) return 'Le geste date de plus de 3 jours : le serveur ne l’accepte plus.';
  return 'Pas de réseau ou erreur. Réessaie.';
}

// ── « ▶ JE COMMENCE » ──────────────────────────────────
async function commencerQuart(){
  if(_envoiQuart||!currentUser) return;
  if(enService()){fermerEcranQuart();toast('Tu es déjà en service.');return;}   // (un autre téléphone, ou une passe, l'a déjà ouvert)
  _envoiQuart=true;majEcranQuart();
  try{
    const id=nouvelId(),moment=new Date().toISOString(),pos=positionDuPunch();
    const args={id,lat:pos.lat,lon:pos.lon,precision:pos.precision};
    if(!reseau.enLigne) return await commencerQuartSansReseau(args,moment);
    showSync(true);
    let r;
    try{
      r=await avecDelai(db.rpc('quart_commencer',{p_id:id,...positionPrecisionArgs(args)}),FILE_DELAI_DIRECT_MS);   // (sans heure : c'est celle du serveur)
    }catch(err){
      r={data:null,error:err};
    }
    showSync(false);
    // Pas de réponse : le MÊME numéro de quart passe à la file, avec l'heure du toucher (un renvoi ne crée jamais deux quarts)
    if(r.error&&estErreurReseau(r.error)){signalerEchecReseau(r.error);return await commencerQuartSansReseau(args,moment);}
    if(r.error){messageQuart('❌ '+messageErreurQuart(r.error));return;}
    const d=r.data||{};
    if(d.statut==='chevauchement'){
      messageQuart('❌ Ce quart chevauche un autre de tes quarts : il n’a pas été enregistré. Parles-en à l’administrateur.');
      await chargerMonQuart();
      return;
    }
    if(d.statut==='deja_en_quart'){
      await chargerMonQuart();
      fermerEcranQuart();
      toast('Tu étais déjà en service.');
      return;
    }
    // « commence » (ou « deja_enregistre » : un renvoi) : le serveur a le quart. On le pose tout de suite (une relecture qui échouerait ne doit pas dire le contraire).
    const debut=d.debut||moment;
    const q={id:d.quart_id||id,debut,fin:null,debut_source:'manuel',a_valider:false,raison_a_valider:null};
    installerQuart(q);
    lectureReussie('quart',q);
    montrerConfirmationQuart('Quart commencé à',heureCourte(debut),[]);
    chargerMonQuart();   // (relecture de contrôle, sans attendre)
  }finally{
    showSync(false);
    _envoiQuart=false;majEcranQuart();
  }
}
// Sans réseau : le geste est gardé sur le téléphone, la personne est en service tout de suite à l'écran (quart.js : superposerQuart)
async function commencerQuartSansReseau(args,moment){
  const r=await enfiler('quart_commencer',args,{libelle:'▶ Quart commencé',moment});
  if(!r.ok){messageQuart(MESSAGE_GESTE_NON_GARDE);return;}   // jamais « commencé » si rien n'est gardé
  montrerConfirmationQuart('Quart commencé à',heureCourte(moment),[],'⏳ Envoyé au retour du signal'+texteGardeSeulementEnMemoire(r));
}

// ── « ■ JE TERMINE » ───────────────────────────────────
async function terminerQuart(){
  if(_envoiQuart||!currentUser) return;
  const q=monQuart,m=maPasse();
  if(!q&&!m){fermerEcranQuart();toast('Tu n’es pas en service.');return;}
  _envoiQuart=true;majEcranQuart();
  try{
    const moment=new Date().toISOString(),pos=positionDuPunch();
    // Sans numéro (quartId null) = « mon quart ouvert » : celui qu'une passe a ouvert toute seule n'a pas de numéro connu du téléphone
    const args={quartId:(q&&q.id)||null,lat:pos.lat,lon:pos.lon,precision:pos.precision};
    const avant={debut:q?q.debut:null,passe:m?numeroPasse(m.tour):null};
    const equipe=equipeCochee();   // les personnes cochées, relevées AU TOUCHER (la passe, elle, va se fermer)
    if(!reseau.enLigne) return await terminerQuartSansReseau(args,moment,avant,equipe);
    showSync(true);
    let r;
    try{
      r=await avecDelai(db.rpc('quart_terminer',{p_quart_id:args.quartId,...positionPrecisionArgs(args)}),FILE_DELAI_DIRECT_MS);   // (sans heure : c'est celle du serveur)
    }catch(err){
      r={data:null,error:err};
    }
    showSync(false);
    if(r.error&&estErreurReseau(r.error)){signalerEchecReseau(r.error);return await terminerQuartSansReseau(args,moment,avant,equipe);}
    if(r.error&&String(r.error.message||'').includes('quart_introuvable')){
      // Le quart n'existe plus (fermé automatiquement, ou par l'administrateur) : on remet l'écran à jour et on le dit
      await rafraichirApresQuart();
      fermerEcranQuart();
      toast('Ce quart n’existe plus : il était déjà terminé.');
      return;
    }
    if(r.error){messageQuart('❌ '+messageErreurQuart(r.error));return;}
    const d=r.data||{};
    const fin=d.fin||moment;
    // Le serveur n'a plus de quart ouvert pour moi (terminé, déjà terminé, ou rien à terminer) : on le pose tout de suite, puis on relit ce que ça touche
    installerQuart(null);
    lectureReussie('quart',null);
    // L'équipe : chaque personne cochée, à la MÊME seconde que moi (celle que le serveur m'a donnée), avant de relire les passes
    const bilan=await terminerEquipe(equipe,fin);
    _equipeFin=null;
    await rafraichirApresQuart();
    if(d.statut==='pas_en_quart'&&!equipe.personnes.length){fermerEcranQuart();toast('Tu n’étais pas en service.');return;}
    montrerConfirmationQuart(d.statut==='deja_termine'?'Quart déjà terminé à':'Quart terminé à',heureCourte(fin),lignesFinQuart(avant,fin,d.passe_fermee).concat(lignesEquipe(bilan)),null,bilan.problemes.length>0);
  }finally{
    showSync(false);
    _envoiQuart=false;majEcranQuart();
  }
}
// Sans réseau : le geste est gardé ; ma passe se ferme tout de suite à l'écran et je sors du camion (tours.js, vehicules.js).
// Les personnes cochées suivent, dans l'ordre, avec la MÊME heure (elles partiront toutes au retour du signal).
async function terminerQuartSansReseau(args,moment,avant,equipe){
  const r=await enfiler('quart_terminer',args,{libelle:'■ Quart terminé',moment});
  if(!r.ok){messageQuart(MESSAGE_GESTE_NON_GARDE);return;}   // jamais « terminé » si rien n'est gardé
  const bilan={ok:[],attente:[],problemes:[]};
  const pos=positionDuPunch();
  for(const p of (equipe&&equipe.personnes)||[]){
    const g=await enfiler('quart_terminer_equipier',{passeId:equipe.passeId,userId:p.utilisateur_id,nom:p.nom,lat:pos.lat,lon:pos.lon,precision:pos.precision},{libelle:'■ Quart terminé : '+p.nom,moment});
    if(g.ok) bilan.ok.push(p.nom); else bilan.problemes.push('Le quart de '+p.nom+' n’a pas pu être gardé sur le téléphone : à refaire plus tard.');
  }
  _equipeFin=null;
  _passeVue=null;   // je viens de terminer moi-même : pas de résumé de passe
  renderAll();majCarte();
  montrerConfirmationQuart('Quart terminé à',heureCourte(moment),lignesFinQuart(avant,moment,false).concat(lignesEquipe(bilan)),'⏳ Envoyé au retour du signal'+texteGardeSeulementEnMemoire(r),bilan.problemes.length>0);
}
function lignesFinQuart(avant,fin,passeFermee){
  const l=[];
  const duree=avant&&avant.debut?dureeTexte(avant.debut,fin):'';
  if(duree) l.push('Durée : '+duree);
  if((avant&&avant.passe)||passeFermee) l.push('Ta passe'+(avant&&avant.passe?' n° '+avant.passe:'')+' a été terminée aussi.');
  return l;
}
// Après une fin de quart faite en ligne : ce que le serveur a fait (ma passe fermée, ma place à bord, mon quart) est relu
async function rafraichirApresQuart(){
  await chargerMonQuart();
  await chargerTours();
  await chargerPositionsVehicules();
  await chargerVehiculesEtEquipages();
  _passeVue=null;   // je viens de terminer moi-même : pas de résumé de passe (remis à zéro APRÈS les relectures : un dessin intermédiaire aurait pu le reposer)
  renderAll();majCarte();
}

// ── « Terminer aussi le quart de : ☑ Marc ☑ Nina » (étape 17, équipage) ──
// Décision de Joé (21 sept.) : les cases sont COCHÉES d'avance ; le chauffeur décoche celui qui continue ailleurs. Seul le CHAUFFEUR voit cette liste.
// D'où viennent les noms : l'équipage de MA passe en cours ; sinon (la passe s'est fermée toute seule à 100 %, ou je viens de la terminer) l'équipe à bord à la fin de
// ma dernière passe, si elle s'est terminée il y a moins de 3 h (equipage_precedent, SQL 17 ; le SQL 21 l'accepte). Un passager n'a pas de liste.
function preparerEquipeFin(){
  _equipeFin=null;
  const m=(typeof maPasse==='function')?maPasse():null;
  if(m){
    const passeId=m.passe.passe_id;
    const membres=(equipages[passeId]||[]).filter(x=>x.utilisateur_id!==currentUser.id).map(x=>({utilisateur_id:x.utilisateur_id,nom:x.nom||'?'}));
    _equipeFin={passeId,membres,coches:{},source:'passe',chargement:false};
    membres.forEach(x=>{_equipeFin.coches[x.utilisateur_id]=true;});
    return;
  }
  if(typeof monBord==='function'&&monBord()) return;   // un passager ne termine le quart de personne
  const jeton={passeId:null,membres:[],coches:{},source:'precedente',chargement:true};
  _equipeFin=jeton;
  lireEquipeDeFin().then(res=>{
    if(_equipeFin!==jeton) return;   // l'écran a été fermé (ou rouvert) entre-temps
    jeton.chargement=false;
    if(res&&res.passe_id&&res.fin&&Date.now()-Date.parse(res.fin)<=FIN_EQUIPE_HEURES*3600000){
      jeton.passeId=res.passe_id;
      jeton.membres=(res.membres||[]).map(x=>({utilisateur_id:x.utilisateur_id,nom:x.nom||'?'}));
      jeton.membres.forEach(x=>{jeton.coches[x.utilisateur_id]=true;});
    }
    if(_ecranQuart==='fin') rafraichirEcranFin();
  });
}
// L'équipe de ma dernière passe : le serveur si on l'atteint (3 s au plus), sinon la copie du téléphone (gardée à chaque lecture de l'écran « Débuter »)
async function lireEquipeDeFin(){
  if(reseau.enLigne){
    try{
      const r=await avecDelai(db.rpc('equipage_precedent'),3000);
      if(r.error) throw r.error;
      const d=r.data||{};
      const brut={passe_id:d.passe_id||null,fin:d.fin||null,membres:Array.isArray(d.membres)?d.membres:[]};
      lectureReussie('equipeDeFin',brut);
      return brut;
    }catch(e){
      signalerEchecReseau(e);
      if(!estErreurReseau(e)) return null;
    }
  }
  const c=await cacheLire('equipeDeFin');
  return (c&&c.data&&typeof c.data==='object')?c.data:null;
}
function htmlEquipeFin(){
  const e=_equipeFin;
  if(!e||e.chargement||!e.membres.length) return '';
  return '<div class="quart-equipe"><div class="quart-equipe-titre">Terminer aussi le quart de :</div>'+
    e.membres.map(x=>{
      const on=!!e.coches[x.utilisateur_id];
      return '<button type="button" class="quart-equipier'+(on?' coche':'')+'" aria-pressed="'+(on?'true':'false')+'" onclick="basculerEquipierQuart(\''+esc(x.utilisateur_id)+'\')"><span class="quart-case">'+(on?'☑':'☐')+'</span> '+esc(x.nom)+'</button>';
    }).join('')+'</div>';
}
function basculerEquipierQuart(id){
  if(_envoiQuart||!_equipeFin||_ecranQuart!=='fin') return;
  if(!_equipeFin.membres.some(x=>x.utilisateur_id===id)) return;
  _equipeFin.coches[id]=!_equipeFin.coches[id];
  rafraichirEcranFin();
}
function rafraichirEcranFin(){
  const boite=document.getElementById('quart-boite');
  if(!boite||_ecranQuart!=='fin') return;
  boite.innerHTML=htmlFinQuart();
  majEcranQuart();
}
// Les personnes cochées, avec la passe qu'elles quittent : {passeId, personnes:[{utilisateur_id, nom}]}
function equipeCochee(){
  const e=_equipeFin;
  if(!e||!e.passeId) return {passeId:null,personnes:[]};
  return {passeId:e.passeId,personnes:e.membres.filter(x=>e.coches[x.utilisateur_id])};
}
// Termine le quart d'UNE personne (en ligne, avec un délai ; sinon la file, avec la même heure). Renvoie {etat:'ok'|'attente'|'perdu'|'refuse', texte?}
async function terminerQuartEquipier(passeId,p,moment){
  const pos=positionDuPunch();
  const args={passeId,userId:p.utilisateur_id,nom:p.nom,lat:pos.lat,lon:pos.lon,precision:pos.precision};
  const enAttente=async()=>{
    const g=await enfiler('quart_terminer_equipier',args,{libelle:'■ Quart terminé : '+p.nom,moment});
    return g.ok?{etat:'attente'}:{etat:'perdu',texte:MESSAGE_GESTE_NON_GARDE};
  };
  if(!reseau.enLigne) return await enAttente();
  let r;
  try{
    r=await avecDelai(db.rpc('quart_terminer_equipier',{p_passe_id:passeId,p_utilisateur_id:p.utilisateur_id,p_moment:moment,...positionPrecisionArgs(args)}),FILE_DELAI_DIRECT_MS);
  }catch(err){
    r={data:null,error:err};
  }
  if(r.error&&estErreurReseau(r.error)){signalerEchecReseau(r.error);return await enAttente();}
  if(r.error) return {etat:'refuse',texte:'Le quart de '+p.nom+' n’a pas pu être terminé : '+messageErreurQuart(r.error)};
  const d=r.data||{},s=d.statut;
  if(s==='termine'||s==='deja_termine'||s==='pas_en_quart') return {etat:'ok'};
  return {etat:'refuse',texte:raisonQuartEquipier(p.nom,d)};
}
// Toutes les personnes cochées, l'une après l'autre : {ok:[noms], attente:[noms], problemes:[textes]}
async function terminerEquipe(equipe,moment){
  const bilan={ok:[],attente:[],problemes:[]};
  for(const p of (equipe&&equipe.personnes)||[]){
    const r=await terminerQuartEquipier(equipe.passeId,p,moment);
    if(r.etat==='ok') bilan.ok.push(p.nom);
    else if(r.etat==='attente') bilan.attente.push(p.nom);
    else bilan.problemes.push(r.texte);
  }
  return bilan;
}
function lignesEquipe(b){
  const l=[];
  if(b.ok.length) l.push('Quart terminé aussi pour : '+b.ok.join(', ')+'.');
  if(b.attente.length) l.push('⏳ '+b.attente.join(', ')+' : envoyé au retour du signal.');
  b.problemes.forEach(t=>l.push('⚠ '+t));
  return l;
}

// ── Le passager : « Luc a terminé ton quart à 16 h 05 » [OK] [Ce n'est pas exact] ──
// Décision de Joé (21 sept.) : une carte au milieu de l'écran (il s'agit de sa paie), à l'ouverture de l'application ou dans la minute qui suit.
// « Ce n'est pas exact » met le quart « à valider » pour l'administrateur (l'heure de fin ne change pas) ; « OK » et « Ce n'est pas exact » l'ont lu :
// la carte ne revient pas (le dernier avis lu est gardé sur ce téléphone).
function quandQuart(iso){
  const d=new Date(iso),a=new Date();
  if(isNaN(d.getTime())||d.toDateString()===a.toDateString()) return 'à';
  if(d.toDateString()===new Date(a.getTime()-86400000).toDateString()) return 'hier à';
  try{return 'le '+d.toLocaleDateString('fr-CA',{day:'numeric',month:'long'})+' à';}catch(e){return 'le '+d.toISOString().slice(0,10)+' à';}
}
function htmlAvisFin(){
  const a=avisFin;
  const par=a&&a.parId&&typeof employes!=='undefined'?(employes.find(e=>e.id===a.parId)||{}).nom:'';
  return '<div id="quart-titre" class="quart-salut">Ton quart a été terminé</div>'+
    '<div class="quart-qui">'+(par?esc(par):'Ton chauffeur')+' a terminé ton quart '+esc(quandQuart(a.fin))+'</div>'+
    '<div class="quart-heure">'+esc(heureCourte(a.fin))+'</div>'+
    '<button id="btn-quart-ok" type="button" class="quart-gros ok" onclick="avisFinLu()">OK</button>'+
    '<div id="quart-msg" class="quart-msg" role="alert"></div>'+
    '<button id="btn-quart-signaler" type="button" class="quart-signaler" onclick="signalerErreurFinQuart()">Ce n’est pas exact</button>';
}
function marquerAvisLu(a){
  if(a&&currentUser) ecrireMemo(CLE_AVIS_VU+currentUser.id,a.quartId);
  if(avisFin===a) avisFin=null;
}
function avisFinLu(){
  if(_envoiQuart) return;
  marquerAvisLu(avisFin);
  fermerEcranQuart();
}
async function signalerErreurFinQuart(){
  if(_envoiQuart||!avisFin) return;
  const a=avisFin;
  _envoiQuart=true;majEcranQuart();
  try{
    let r=null;
    if(reseau.enLigne){
      showSync(true);
      try{
        r=await avecDelai(db.rpc('quart_signaler_erreur',{p_quart_id:a.quartId,p_note:null}),FILE_DELAI_DIRECT_MS);
      }catch(err){
        r={data:null,error:err};
      }
      showSync(false);
    }
    if(!r||(r.error&&estErreurReseau(r.error))){   // sans réseau : le signalement est gardé, il partira au retour du signal
      if(r) signalerEchecReseau(r.error);
      const g=await enfiler('quart_signaler_erreur',{quartId:a.quartId},{libelle:'⚠ Fin de quart contestée'});
      if(!g.ok){messageQuart(MESSAGE_GESTE_NON_GARDE);return;}
      marquerAvisLu(a);
      montrerConfirmationQuart('C’est signalé','',['L’administrateur va vérifier ton quart.'],'⏳ Envoyé au retour du signal'+texteGardeSeulementEnMemoire(g));
      return;
    }
    if(r.error){messageQuart('❌ '+messageErreurQuart(r.error));return;}
    const d=r.data||{};
    if(d.statut==='signale'||d.statut==='deja_signale'){
      marquerAvisLu(a);
      montrerConfirmationQuart('C’est signalé','',['L’administrateur va vérifier ton quart.']);
      return;
    }
    marquerAvisLu(a);   // un refus (déjà validé par l'administrateur…) : la raison reste à l'écran, « OK » ferme
    messageQuart(raisonSignalementQuart(d));
  }finally{
    showSync(false);
    _envoiQuart=false;majEcranQuart();
  }
}
