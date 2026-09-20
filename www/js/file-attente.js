// js/file-attente.js — Étape 16b : la file d'attente commune des gestes faits sans réseau
//
// Un geste (compléter un arrêt, débuter, terminer, équipage, problème…) qui ne peut pas partir est GARDÉ sur le téléphone, puis envoyé
// au serveur dès que le signal revient. Règles (décidées avec Joé) :
//   • Rien ne se perd en silence : un geste est écrit sur le téléphone AVANT que l'écran dise « fait » ; un geste refusé par le serveur
//     ne disparaît pas, il va dans « Gestes non envoyés » avec sa raison, et il y reste jusqu'à ce qu'on le ferme à la main.
//   • Stockage : clés « file:<employé>:att:<ordre> » (en attente) et « file:<employé>:ref:<ordre> » (refusés). effacerCache() n'efface
//     que « cache: » : la file ne s'efface JAMAIS toute seule (ni à la déconnexion : elle est même BLOQUÉE tant qu'un geste attend).
//   • UN SEUL rejeu à la fois, gestes dans l'ordre où ils ont été faits, UN geste à la fois. Un geste n'est retiré qu'après une réponse
//     DÉFINITIVE du serveur ; si l'application se ferme en plein envoi, il repart au prochain démarrage (tous les gestes sont rejouables
//     sans doublon : identifiant ou clé client, ou effet déjà constaté).
//   • Trois sortes de résultat : panne PASSAGÈRE (réseau, serveur en panne, jeton à renouveler) = le geste reste en tête, la file attend,
//     et n'abandonne jamais ; REFUS définitif (règle du serveur) = liste « non envoyés » ; erreur INCONNUE = 5 essais espacés, puis la liste
//     (un geste coincé ne retient pas tous les autres).
//   • L'heure du geste est celle où il a été FAIT (p_moment), pas celle de l'envoi. Le serveur refuse un geste de plus de 3 jours.
//   • Conflit d'équipage au retour du signal (décision A) : le geste part avec « forcer » ; le serveur le marque « à vérifier » pour Joé.
//
// Types de gestes et leurs arguments (chacun est gardé par un écran : arrets.js, passe.js, equipage-panneau.js, problemes.js, photos.js ; et posé
// par-dessus la copie du serveur par tours.js, vehicules.js et problemes.js, pour que l'écran montre tout de suite son résultat) :
//   completer_arret {passeId, stopId, mode, lat, lon}        annuler_arret {passeId, stopId}
//   debuter_passe {passeId, routeId, equipeId, tache, lat, lon, equipage:[{utilisateur_id, cle_client, forcer, nom}]}
//   terminer_passe {passeId}                                  equipage_ajouter / equipage_retirer {cle, passeId, userId, nom, lat, lon}
//   probleme {id, stopId, passeId, note}                      probleme_photo {problemeId}  (+ la photo, gardée dans le geste)
const FILE_VERSION=1;
const FILE_ESSAIS_INCONNUS=5;                              // erreur inconnue : au bout de 5 essais, le geste va dans « non envoyés »
let FILE_DELAIS_MS=[5000,15000,45000,120000,300000];       // attente entre deux essais quand le serveur ne répond pas bien
let FILE_DELAI_APPEL_MS=30000;                             // un envoi qui ne répond pas en 30 s = panne passagère (la photo a le double)
let fileEtat={pour:null,att:[],ref:[],dernierOrdre:0,palier:0};   // « pour » : à quel employé appartient ce qui est chargé
let FILE_DELAI_DIRECT_MS=10000;                            // étape 16c : un geste fait EN LIGNE qui ne répond pas en 10 s passe à la file (même identifiant : aucun doublon)
let _minuterieFile=null;
let _rejeuEnCours=false,_rejeuDemande=false,_rejeuPromesse=null;
let _gesteEnEnvoi=null;   // l'identifiant du geste que le rejeu est en train d'envoyer (il ne peut plus être retiré de la file)

// Ce que dit l'écran quand un geste est gardé sur le téléphone au lieu d'être envoyé (étape 16c)
const TEXTE_ATTENTE=' · ⏳ envoyé au retour du signal';
const MESSAGE_GESTE_NON_GARDE='❌ Le téléphone n’a pas pu garder ce geste. Réessaie.';   // jamais « fait » si rien n'est gardé
function texteGardeSeulementEnMemoire(r){return r&&r.durable===false?' · garde l’application ouverte':'';}   // pas d'IndexedDB : le geste ne survivrait pas à la fermeture de l'application

// ── Les raisons des refus, en français ─────────────────
const RAISONS_GESTE={
  non_autorise:'Ce geste n’était pas permis (ce n’est pas ta passe, ou ton compte est désactivé).',
  passe_introuvable:'Cette passe n’existe plus.',
  arret_hors_route:'Cet arrêt n’est pas sur la route de la passe.',
  arret_hors_tache:'Cet arrêt n’a pas le même type de service que la passe.',
  delai_depasse:'Trop tard pour annuler (plus de 10 minutes).',
  passe_terminee:'La passe était déjà terminée.',
  impossible_de_rouvrir:'Impossible : une nouvelle passe était déjà commencée.',
  route_inactive:'Cette route n’est plus active.',
  equipe_inactive:'Ce véhicule n’est plus actif.',
  tache_requise:'La tâche de la passe manquait.',
  tache_sans_arret:'Cette route n’a aucun arrêt pour cette tâche.',
  passe_deja_en_cours:'Une passe était déjà commencée avec ce véhicule ou ce chauffeur.',
  geste_trop_ancien:'Le geste date de plus de 3 jours : le serveur ne l’accepte plus.',
  chauffeur_ne_peut_etre_retire:'Le chauffeur ne peut pas être retiré de sa passe.',
  utilisateur_inactif:'Cette personne n’est plus active.',
  probleme_introuvable:'Le problème n’avait pas été enregistré : la photo n’a pas pu y être reliée.',
  photo_introuvable:'La photo n’a pas pu être envoyée.',
  mode_invalide:'Le serveur a refusé ce geste (mode invalide).',
  tour_incoherent:'Le serveur a refusé ce geste (le tour n’est plus cohérent).'
};
function raisonDe(e){
  const m=String((e&&(e.message||e.error_description||e.error))||e||'');
  for(const k in RAISONS_GESTE){ if(m.includes(k)) return RAISONS_GESTE[k]; }
  return 'Refusé par le serveur'+(m?' : « '+m.slice(0,140)+' »':'')+'.';
}

// Une erreur du serveur : 'passager' (on réessaiera, sans jamais abandonner), 'definitif' (le serveur a dit non) ou 'inconnu' (5 essais)
function classerErreurGeste(e){
  if(estErreurReseau(e)) return 'passager';
  const code=String((e&&e.code)||'');
  const statut=Number(e&&(e.status||e.statusCode))||0;
  const m=String((e&&(e.message||e.error_description||e.error))||e||'');
  if(/jwt|PGRST30\d/i.test(code+' '+m)) return 'passager';            // jeton à renouveler : ce n'est pas la faute du geste
  if(statut>=500||statut===429||statut===408) return 'passager';        // serveur en panne ou débordé
  if(code==='42501') return 'inconnu';                                   // « accès refusé » : souvent une session pas encore renouvelée, pas un vrai refus
  if(code==='P0001'||/^(22|23)/.test(code)) return 'definitif';         // une règle du serveur (raise exception), donnée invalide, contrainte
  for(const k in RAISONS_GESTE){ if(m.includes(k)) return 'definitif'; }
  if(statut>=400&&statut<500) return 'definitif';
  return 'inconnu';
}

// ── Ce que chaque geste appelle, et comment on juge la réponse ──
// juger(item, données) : null = réussi ; {raison} = le serveur a répondu, mais le geste n'a pas été appliqué
function positionArgs(a){return {p_lat:a.lat!=null?a.lat:null,p_lon:a.lon!=null?a.lon:null};}
function raisonEquipier(nom,d){
  if(d&&d.raison==='chauffeur_ailleurs') return (nom||'Cette personne')+' conduit déjà « '+(d.vehicule||'un autre camion')+' ».';
  if(d&&d.statut==='passe_terminee') return 'La passe était déjà terminée.';
  return 'Impossible de faire monter '+(nom||'cette personne')+(d&&d.message?' : '+String(d.message).slice(0,100):'')+'.';
}
const EXECUTEURS={
  completer_arret:{
    appeler:(i)=>db.rpc('completer_arret',{p_passe_id:i.args.passeId,p_stop_id:i.args.stopId,p_moment:i.moment,p_mode:i.args.mode||'manuel',...positionArgs(i.args)}),
    juger:(i,d)=>d&&d.statut==='passe_terminee'?{raison:'La passe était déjà terminée : cet arrêt n’a pas été enregistré.'}:null
  },
  annuler_arret:{   // 16d : l'heure du geste s'ajoutera ici (p_moment) avec le fichier SQL 18
    appeler:(i)=>db.rpc('annuler_arret',{p_passe_id:i.args.passeId,p_stop_id:i.args.stopId}),
    juger:()=>null
  },
  debuter_passe:{
    appeler:(i)=>{
      const a=i.args,args={p_id:a.passeId,p_route_id:a.routeId,p_equipe_id:a.equipeId,p_moment:i.moment,p_tache:a.tache,...positionArgs(a)};
      if(a.equipage&&a.equipage.length) args.p_equipage=a.equipage.map(m=>({utilisateur_id:m.utilisateur_id,cle_client:m.cle_client,forcer:!!m.forcer}));
      return db.rpc('debuter_passe',args);
    },
    juger:()=>null
  },
  terminer_passe:{
    appeler:(i)=>db.rpc('terminer_passe',{p_passe_id:i.args.passeId,p_moment:i.moment}),
    juger:()=>null
  },
  equipage_ajouter:{
    appeler:(i)=>db.rpc('equipage_ajouter',{p_cle_client:i.args.cle,p_passe_id:i.args.passeId,p_utilisateur_id:i.args.userId,p_moment:i.moment,...positionArgs(i.args),p_forcer:true}),
    juger:(i,d)=>{
      const s=d&&d.statut;
      if(s==='ajoute'||s==='transfere'||s==='deja_a_bord') return null;
      return {raison:raisonEquipier(i.args.nom,d)};
    }
  },
  equipage_retirer:{
    appeler:(i)=>db.rpc('equipage_retirer',{p_cle_client:i.args.cle,p_passe_id:i.args.passeId,p_utilisateur_id:i.args.userId,p_moment:i.moment,...positionArgs(i.args)}),
    juger:()=>null
  },
  probleme:{   // 16d : « cree_le » (l'heure du geste) s'ajoutera ici avec le fichier SQL 18
    appeler:(i)=>db.from('problemes').insert([{id:i.args.id,stop_id:i.args.stopId,passe_id:i.args.passeId||null,note:i.args.note}]),
    juger:()=>null
  },
  probleme_photo:{
    appeler:async(i)=>{
      if(!i.photo) return {data:null,error:{message:'photo_introuvable'}};
      try{await envoyerPhotoProbleme(i.args.problemeId,i.photo);return {data:{},error:null};}
      catch(e){return {data:null,error:e};}
    },
    juger:()=>null
  }
};
// Un début de passe rejoué : les équipiers que le serveur n'a pas pu faire monter sont notés à part (rien ne se perd en silence)
function equipiersRefuses(item,d){
  const sortie=[];
  const noms={};
  ((item.args&&item.args.equipage)||[]).forEach(m=>{noms[m.utilisateur_id]=m.nom;});
  ((d&&d.equipage)||[]).forEach(x=>{
    const s=x&&x.statut;
    if(s==='ajoute'||s==='transfere'||s==='deja_a_bord') return;
    sortie.push({nom:noms[x.utilisateur_id]||'Un équipier',raison:raisonEquipier(noms[x.utilisateur_id],x)});
  });
  return sortie;
}

// ── Le stockage de la file ─────────────────────────────
let _serie=Promise.resolve();
// Toutes les écritures passent l'une après l'autre : le stockage et la mémoire ne se contredisent jamais
function enSerie(fn){
  const p=_serie.then(fn);
  _serie=p.then(()=>{},()=>{});
  return p;
}
function prefixeFile(){return 'file:'+currentUser.id+':';}
function cleFile(genre,ordre){return prefixeFile()+genre+':'+ordre;}
function prochainOrdre(){
  fileEtat.dernierOrdre=Math.max(Date.now(),fileEtat.dernierOrdre+1);   // jamais deux fois le même, jamais en arrière (même si l'horloge recule)
  return String(fileEtat.dernierOrdre).padStart(15,'0');
}
function fileValide(g){
  return !!(g&&typeof g==='object'&&g.v===FILE_VERSION&&typeof g.id==='string'&&typeof g.ordre==='string'&&EXECUTEURS[g.type]&&g.args&&typeof g.args==='object'&&typeof g.moment==='string');
}
// Charge (ou recharge) la file de l'employé connecté depuis le stockage
async function chargerFile(){
  if(!currentUser){fileEtat.pour=null;fileEtat.att=[];fileEtat.ref=[];return;}
  const uid=currentUser.id;
  const lignes=await magasinLister(prefixeFile());
  if(lignes===null) return;   // le stockage n'a pas répondu : on garde ce qu'on a
  const att=[],ref=[],dejaRef=new Set();
  let dernier=0;
  const lues=lignes.filter(l=>l&&l.valeur&&typeof l.valeur==='object');
  lues.forEach(l=>{if(l.cle.includes(':ref:')&&l.valeur.id) dejaRef.add(l.valeur.id);});
  for(const l of lues){
    const g=l.valeur;
    const genre=l.cle.slice(prefixeFile().length).split(':')[0];
    const ordre=l.cle.slice(l.cle.lastIndexOf(':')+1);
    dernier=Math.max(dernier,Number(ordre)||0);
    if(genre==='att'){
      if(g.id&&dejaRef.has(g.id)){await magasinRetirer(l.cle);continue;}   // refusé, mais l'application s'est fermée avant de le retirer d'ici
      if(fileValide(g)) att.push(g);
      else{   // illisible (autre version de l'application…) : jamais jeté en silence
        const r={v:FILE_VERSION,id:String(g.id||l.cle),ordre,type:g.type||'inconnu',args:{},moment:g.moment||new Date().toISOString(),libelle:g.libelle||'Geste illisible',essais:0,photo:null,refus:{raison:'Ce geste ne peut pas être relu par cette version de l’application.',le:new Date().toISOString()}};
        if(await magasinEcrire(cleFile('ref',ordre),r)){await magasinRetirer(l.cle);ref.push(r);}
      }
    }else if(genre==='ref'&&g.refus) ref.push(g);
  }
  if(currentUser&&currentUser.id===uid){
    fileEtat.pour=uid;fileEtat.att=att;fileEtat.ref=ref;
    fileEtat.dernierOrdre=Math.max(fileEtat.dernierOrdre,dernier);
  }
}
async function assurerChargee(){
  if(currentUser&&fileEtat.pour!==currentUser.id) await chargerFile();
}

// ── Ce que voit l'écran ────────────────────────────────
function fileDeLEmploye(){return currentUser&&fileEtat.pour===currentUser.id;}
function gestesEnAttente(){return fileDeLEmploye()?fileEtat.att.slice():[];}
function gestesNonEnvoyes(){return fileDeLEmploye()?fileEtat.ref.slice():[];}
function fileAGestes(){return gestesEnAttente().length+gestesNonEnvoyes().length>0;}
function pluriel(n,un,plusieurs){return n+' '+(n===1?un:plusieurs);}
// Les lignes ajoutées à la bande du haut (voir majBandeauReseau)
function texteBandeauFile(){
  const lignes=[];
  const a=gestesEnAttente().length,r=gestesNonEnvoyes().length;
  if(a) lignes.push('⏳ '+pluriel(a,'geste en attente','gestes en attente'));
  if(r) lignes.push('⚠ '+pluriel(r,'geste non envoyé','gestes non envoyés'));
  return lignes;
}

// ── Ajouter un geste ───────────────────────────────────
// options : {libelle, photo, moment}. Renvoie {ok:true, id, durable} ; {ok:false} si le téléphone n'a pas pu GARDER le geste (l'écran ne doit alors pas dire « fait »).
// durable:false = pas d'IndexedDB sur ce téléphone : le geste est gardé en mémoire vive seulement et ne survivra pas à la fermeture de l'application.
function enfiler(type,args,options){
  const o=options||{};
  return enSerie(async()=>{
    if(!currentUser||!EXECUTEURS[type]) return {ok:false};
    await assurerChargee();
    const ordre=prochainOrdre();
    const item={v:FILE_VERSION,id:nouvelId(),ordre,type,args:args||{},moment:o.moment||new Date().toISOString(),libelle:o.libelle||type,essais:0,photo:o.photo||null};
    if(!(await magasinEcrire(cleFile('att',ordre),item))) return {ok:false};
    fileEtat.att.push(item);
    if(typeof reappliquerGestes==='function') reappliquerGestes();   // l'écran montre tout de suite le résultat du geste (tours.js)
    majBandeauReseau();
    declencherRejeu();   // (sans attendre) s'il y a du signal, il part tout de suite
    return {ok:true,id:item.id,durable:await magasinDurable()};
  });
}
// Retire un geste qui n'est PAS encore parti (l'employé l'a annulé lui-même) : rien à envoyer au serveur. Renvoie true s'il a été retiré.
// Un geste en plein envoi ne se retire pas : le serveur l'aura peut-être déjà appliqué.
function retirerGesteSiPasParti(id){
  return enSerie(async()=>{
    const g=fileEtat.att.find(x=>x.id===id);
    if(!g||_gesteEnEnvoi===id) return false;
    if(!(await magasinRetirer(cleFile('att',g.ordre)))) return false;
    fileEtat.att=fileEtat.att.filter(x=>x.id!==id);
    if(typeof reappliquerGestes==='function') reappliquerGestes();
    majBandeauReseau();
    return true;
  });
}
async function retirerEnAttente(item){
  await enSerie(async()=>{
    await magasinRetirer(cleFile('att',item.ordre));
    fileEtat.att=fileEtat.att.filter(x=>x.id!==item.id);
    majBandeauReseau();
  });
}
async function sauverEnAttente(item){
  await enSerie(()=>magasinEcrire(cleFile('att',item.ordre),item));
}
// Un geste refusé : il passe dans « non envoyés » (écrit AVANT d'être retiré d'ici : jamais perdu entre les deux)
async function refuserGeste(item,raison){
  await enSerie(async()=>{
    const r={...item,photo:null,refus:{raison,le:new Date().toISOString()}};
    if(!(await magasinEcrire(cleFile('ref',item.ordre),r))) return;   // impossible de le noter : il reste en attente plutôt que d'être perdu
    await magasinRetirer(cleFile('att',item.ordre));
    fileEtat.att=fileEtat.att.filter(x=>x.id!==item.id);
    fileEtat.ref.push(r);
    majBandeauReseau();
  });
}
// Un refus qui ne vient pas d'un geste de la file (un équipier qui n'a pas pu monter dans une passe débutée hors réseau)
async function noterRefus(libelle,type,moment,raison){
  await enSerie(async()=>{
    const ordre=prochainOrdre();
    const r={v:FILE_VERSION,id:nouvelId(),ordre,type,args:{},moment,libelle,essais:0,photo:null,refus:{raison,le:new Date().toISOString()}};
    if(await magasinEcrire(cleFile('ref',ordre),r)){fileEtat.ref.push(r);majBandeauReseau();}
  });
}
// Le chauffeur ferme un geste non envoyé, un à un
async function fermerGesteNonEnvoye(id){
  await enSerie(async()=>{
    const g=fileEtat.ref.find(x=>x.id===id);
    if(!g) return;
    if(!(await magasinRetirer(cleFile('ref',g.ordre)))) return;
    fileEtat.ref=fileEtat.ref.filter(x=>x.id!==id);
    majBandeauReseau();
  });
  majListeGestes();
}

// ── Envoyer ────────────────────────────────────────────
function avecDelai(p,ms){
  let t;
  const limite=new Promise((_,rej)=>{t=setTimeout(()=>rej(new Error('The request timed out')),ms);});
  return Promise.race([Promise.resolve(p),limite]).finally(()=>clearTimeout(t));
}
// Envoie UN geste. Renvoie {genre:'ok'|'passager'|'definitif'|'inconnu', raison?, reseau?, equipiers?}
async function essaiGeste(item){
  const ex=EXECUTEURS[item.type];
  // Sans session valable, la demande partirait sans identité : on attend plutôt que de la faire refuser (le renouvellement demande du signal)
  try{
    const s=await avecDelai(db.auth.getSession(),FILE_DELAI_APPEL_MS);
    if(!(s&&s.data&&s.data.session)) return {genre:'passager',reseau:false};
  }catch(e){
    return {genre:'passager',reseau:estErreurReseau(e)};
  }
  let r;
  try{
    r=await avecDelai(ex.appeler(item),FILE_DELAI_APPEL_MS*(item.type==='probleme_photo'?2:1));
  }catch(e){
    r={data:null,error:e};
  }
  if(r&&r.error){
    if(item.type==='probleme'&&String(r.error.code)==='23505') return {genre:'ok'};   // le problème existe déjà sous ce numéro : un renvoi, pas un échec
    const c=classerErreurGeste(r.error);
    if(c==='passager') return {genre:'passager',reseau:estErreurReseau(r.error)};
    return {genre:c,raison:raisonDe(r.error)};
  }
  const d=r&&r.data;
  const refus=ex.juger(item,d);
  if(refus) return {genre:'definitif',raison:refus.raison};
  return {genre:'ok',equipiers:item.type==='debuter_passe'?equipiersRefuses(item,d):[]};
}

function arreterFile(){
  if(_minuterieFile){clearTimeout(_minuterieFile);_minuterieFile=null;}
}
function planifierReessai(){
  arreterFile();
  const delai=FILE_DELAIS_MS[Math.min(fileEtat.palier,FILE_DELAIS_MS.length-1)];
  fileEtat.palier++;
  _minuterieFile=setTimeout(()=>{
    _minuterieFile=null;
    if(currentUser&&reseau.enLigne) rejouerFile().then(apresRejeu,()=>{});   // hors réseau : c'est la sonde qui relancera
  },delai);
}
// Un passage : les gestes, dans l'ordre, un à la fois, jusqu'au premier qui ne peut pas partir
async function _passeDeRejeu(){
  const bilan={envoyes:0,refuses:0};
  const uid=currentUser&&currentUser.id;
  while(currentUser&&currentUser.id===uid&&reseau.enLigne){
    const item=fileEtat.att[0];   // le plus ancien
    if(!item) break;
    _gesteEnEnvoi=item.id;   // (pris tout de suite, sans attendre : à partir d'ici il ne peut plus être retiré par l'employé)
    const v=await essaiGeste(item);
    if(v.genre==='ok'){
      serveurAtteint();
      await retirerEnAttente(item);
      bilan.envoyes++;
      fileEtat.palier=0;
      for(const x of (v.equipiers||[])){await noterRefus('Équipage : '+x.nom+' (passe débutée sans réseau)','equipage_ajouter',item.moment,x.raison);bilan.refuses++;}
      continue;
    }
    if(v.genre==='definitif'){
      serveurAtteint();
      await refuserGeste(item,v.raison);
      bilan.refuses++;
      toast('⚠ Un geste n’a pas pu être envoyé : touche la bande du haut');
      continue;
    }
    if(v.genre==='inconnu'){
      item.essais=(item.essais||0)+1;
      if(item.essais>=FILE_ESSAIS_INCONNUS){
        await refuserGeste(item,v.raison+' (après '+FILE_ESSAIS_INCONNUS+' essais)');
        bilan.refuses++;
        toast('⚠ Un geste n’a pas pu être envoyé : touche la bande du haut');
        continue;
      }
      await sauverEnAttente(item);
      planifierReessai();
      break;
    }
    // panne passagère : le geste reste en tête, la file attend (jamais d'abandon)
    if(v.reseau) marquerHorsReseau();   // la sonde relancera l'envoi au retour du signal
    else planifierReessai();            // le serveur répond mal : nouvel essai espacé
    break;
  }
  _gesteEnEnvoi=null;
  return bilan;
}
// Rejoue la file. UN SEUL rejeu à la fois : une demande arrivée pendant un rejeu en cours le fait repasser une fois de plus (rien ne reste oublié).
async function rejouerFile(){
  if(_rejeuEnCours){_rejeuDemande=true;return _rejeuPromesse;}
  _rejeuEnCours=true;
  _rejeuPromesse=(async()=>{
    const total={envoyes:0,refuses:0,restants:0};
    try{
      await enSerie(assurerChargee);
      if(fileEtat.att.length) arreterFile();   // le nouvel essai part maintenant : l'ancienne minuterie ne sert plus
      do{
        _rejeuDemande=false;
        const b=await _passeDeRejeu();
        total.envoyes+=b.envoyes;total.refuses+=b.refuses;
      }while(_rejeuDemande&&reseau.enLigne&&_minuterieFile===null);   // (un nouvel essai espacé est déjà prévu : on ne le double pas)
    }finally{
      total.restants=fileEtat.att.length;
      _gesteEnEnvoi=null;
      _rejeuEnCours=false;
    }
    return total;
  })();
  return _rejeuPromesse;
}
// Lancé par un nouveau geste : seulement s'il y a du signal et qu'aucun essai espacé n'est déjà prévu (sinon on martèlerait le serveur)
function declencherRejeu(){
  if(!currentUser||!reseau.enLigne||_minuterieFile!==null||!fileEtat.att.length) return;
  rejouerFile().then(apresRejeu,()=>{});
}
// Des gestes sont partis (ou refusés) en dehors d'un retour de signal : les écrans se relisent
function apresRejeu(b){
  if(b&&(b.envoyes||b.refuses)&&typeof planifierRechargementTours==='function') planifierRechargementTours();
}
// À l'ouverture de l'application (après connexion) : la file de la séance précédente est relue, et envoyée s'il y a du signal
async function initialiserFile(){
  try{
    await enSerie(chargerFile);
    majBandeauReseau();
    declencherRejeu();
  }catch(e){}
}

// ── La liste « Gestes non envoyés » ────────────────────
function heureGeste(iso){
  const h=heureCourte(iso);
  return h?' · '+h:'';
}
function htmlListeGestes(){
  const att=gestesEnAttente(),ref=gestesNonEnvoyes();
  if(!att.length&&!ref.length) return '<div class="gestes-vide">Aucun geste en attente.</div>';
  let h='';
  if(ref.length){
    h+='<div class="gestes-titre">Non envoyés ('+ref.length+')</div>';
    ref.forEach(g=>{
      h+='<div class="geste geste-ref"><div class="geste-nom">'+esc(g.libelle)+'<span class="geste-heure">'+esc(heureGeste(g.moment))+'</span></div>'+
         '<div class="geste-raison">'+esc(g.refus&&g.refus.raison)+'</div>'+
         '<button type="button" class="geste-fermer" onclick="fermerGesteNonEnvoye(\''+esc(g.id)+'\')">Fermer</button></div>';
    });
  }
  if(att.length){
    h+='<div class="gestes-titre">En attente ('+att.length+')</div>';
    att.forEach(g=>{
      h+='<div class="geste"><div class="geste-nom">'+esc(g.libelle)+'<span class="geste-heure">'+esc(heureGeste(g.moment))+'</span></div>'+
         '<div class="geste-raison">Sera envoyé dès que le signal revient.</div></div>';
    });
  }
  return h;
}
function majListeGestes(){
  const corps=document.getElementById('gestes-corps');
  const fond=document.getElementById('gestes-overlay');
  if(!corps||!fond) return;
  const titre=document.getElementById('gestes-h');
  if(titre) titre.textContent=gestesNonEnvoyes().length?'Gestes non envoyés':'Gestes en attente';   // « non envoyés » = refusés par le serveur ; sinon ils attendent seulement le signal
  corps.innerHTML=htmlListeGestes();
  if(!fileAGestes()) fond.classList.remove('open');   // plus rien à montrer
}
function ouvrirListeGestes(){
  const fond=document.getElementById('gestes-overlay');
  if(!fond||!fileAGestes()) return;
  majListeGestes();
  fond.classList.add('open');
}
function fermerListeGestes(){
  const fond=document.getElementById('gestes-overlay');
  if(fond) fond.classList.remove('open');
}
function bgClickGestes(e){
  if(e.target===document.getElementById('gestes-overlay')) fermerListeGestes();
}
