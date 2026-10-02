// js/admin-avis.js — Panneau administrateur, onglet « Clients », puce « Avis aux clients » : AVERTIR LES CLIENTS « nous passons chez vous dans environ X heures » (demande 5, chantier D, étape 4 : 2 oct. 2026)
//
// Joé choisit une ROUTE (ou des clients à la main) et un DÉLAI (1, 2, 3, 4, 6 h, « demain » ou un nombre d'heures), regarde l'APERÇU (qui recevra quoi, avec le message EXACT, et qui ne recevra rien et
// pourquoi), puis ENVOIE. Un « courriel d'essai » part à sa propre adresse, jamais à un client.
// Tout passe par la fonction serveur « envoyer-avis » (fichiers SQL 31 et 32) : l'application ne fabrique JAMAIS un message ni ne décide à qui l'envoyer, et n'écrit RIEN elle-même (ni journal, ni
// consentement). Les règles (courriel seulement si « avertir par courriel » est coché dans la fiche, texto seulement si le client s'est inscrit, jamais de texto de 21 h à 6 h, UN SEUL avis par client, par
// canal et par jour) sont celles de la base : l'aperçu les montre avant l'envoi, la base les applique de nouveau à l'envoi. Rien n'est JAMAIS mis en file d'attente hors réseau : un avis ne part pas « plus tard ».
// Les clients viennent des ARRÊTS déjà chargés par l'application (stops, avec leur fiche : stops.client_id) et du répertoire lu par admin-clients.js (qui doit être chargé avant ce fichier : il en emprunte
// la barre, la recherche et la feuille). Un arrêt sans fiche ne peut rien recevoir.
const AVIS_DELAIS=[['1h','1 h'],['2h','2 h'],['3h','3 h'],['4h','4 h'],['6h','6 h'],['demain','Demain']];
const AVIS_APERCU_MAX_MS=10*60*1000;   // un aperçu de plus de 10 minutes n'autorise plus l'envoi (l'heure, ou un autre avis, a pu tout changer)
const AVIS_MAX_LIGNES=300;             // la fonction n'en accepte pas plus d'un coup
const AVIS_MOTIFS={                    // le motif d'un refus, selon le canal (« courriel » ou « texto »)
  pas_active:{courriel:'avis par courriel non activés (case « Avertir par courriel » de la fiche)',texto:'pas inscrit aux textos',defaut:'avis non activés'},
  pas_de_coordonnee:{courriel:'aucun courriel dans la fiche',texto:'aucun cellulaire dans la fiche',defaut:'aucune coordonnée'},
  desabonne:{courriel:'désabonné des courriels',texto:'désabonné des textos (a répondu ARRET)',defaut:'désabonné'},
  hors_heures:{defaut:'texto interdit de 21 h à 6 h (heure du Québec)'},
  deja_averti_aujourdhui:{defaut:'déjà averti aujourd’hui'},
  client_introuvable:{defaut:'fiche archivée ou introuvable'},
  ligne_invalide:{defaut:'ligne invalide'},
  echec_fournisseur:{courriel:'le service de courriel a refusé l’envoi',texto:'le service de textos a refusé l’envoi',defaut:'le fournisseur a refusé l’envoi'},
};

let avisSource='';            // '' (rien choisi), l'identifiant d'une route, ou '__main__' (clients à la main)
let avisDelai='';             // '3h', 'demain'…
let avisCoches=new Set();     // les identifiants de clients cochés
let avisApercu=null;          // {signature, quand, lignes, heure_permise_texto} : ce que la base a montré, pour CE délai et CES clients
let avisResultat=null;        // {lignes, avertissement} : le résultat du dernier envoi
let avisDefiler=false;        // un aperçu ou un résultat vient d'arriver : l'écran défile jusqu'à lui (une seule fois)
let _avisOccupe=false;        // un appel est en cours (jamais deux envois à la fois)

// ── Fonctions pures (testées seules) ─────────────────────────────
function avisDelaiValide(d){
  return typeof d==='string'&&(d==='demain'||(/^[1-9][0-9]?h$/.test(d)&&Number(d.slice(0,-1))<=72));
}
// Le délai tapé en heures (« 5 », « 5 h », « 5h ») → « 5h » ; null si ce n'est pas 1 à 72
function avisDelaiDeSaisie(texte){
  const m=/^\s*([0-9]{1,2})\s*h?\s*$/i.exec(String(texte||''));
  if(!m) return null;
  const d=Number(m[1])+'h';
  return avisDelaiValide(d)?d:null;
}
function avisLibelleDelai(d){
  return d==='demain'?'demain':'environ '+Number(String(d).slice(0,-1))+' h';
}
// « A », « A et B », « A, B et C »
function avisListeFrancais(l){
  const t=(l||[]).filter(Boolean);
  return t.length<2?t.join(''):t.slice(0,-1).join(', ')+' et '+t[t.length-1];
}
// Ce qu'un client pourrait recevoir, d'après sa fiche (INDICATIF : la base décide, à l'aperçu puis à l'envoi)
function avisCanaux(f){
  if(!f||f.actif===false) return {courriel:false,texto:false};
  return {
    courriel:!!(f.avis_courriel&&String(f.courriel||'').trim()&&!f.desabonne_courriel_le),
    texto:!!(f.avis_texto&&String(f.cellulaire||'').trim()&&!f.desabonne_texto_le),
  };
}
// Les clients qu'on peut avertir : un par fiche, d'après les arrêts ACTIFS reliés à une fiche active (de la route choisie, ou de toutes avec « __main__ »).
// Le service est celui des arrêts (« Coupe de gazon et Désherbage »), l'adresse celle des arrêts (dans l'ordre des arrêts). Les arrêts sans fiche et les clients sans service ni adresse sont comptés à part.
function avisCandidats(arrets,fiches,source){
  const rien={clients:[],sansFiche:0,incomplets:0};
  if(!source) return rien;
  const parId=new Map((fiches||[]).map(f=>[f.id,f]));
  const groupes=new Map();
  let sansFiche=0;
  (arrets||[]).forEach(s=>{
    if(!s||s.actif===false) return;
    if(source!=='__main__'&&s.route_id!==source) return;
    const f=s.client_id?parId.get(s.client_id):null;
    if(!f||f.actif===false){sansFiche++;return;}
    if(!groupes.has(f.id)) groupes.set(f.id,{fiche:f,adresses:[],services:[]});
    const g=groupes.get(f.id);
    const ad=String(s.adresse||'').trim();
    if(ad&&!g.adresses.includes(ad)) g.adresses.push(ad);
    const sv=String(s.service||'').trim();
    if(sv&&!g.services.includes(sv)) g.services.push(sv);
  });
  const clients=[];
  let incomplets=0;
  groupes.forEach(g=>{
    const toutes=avisListeFrancais(g.adresses);
    const adresse=(toutes.length<=200?toutes:g.adresses[0]||'').slice(0,200);
    const ensemble=avisListeFrancais(g.services);
    const service=(ensemble.length<=100?ensemble:g.services[0]||'').slice(0,100);
    if(!adresse||!service){incomplets++;return;}
    clients.push({client_id:g.fiche.id,nom:g.fiche.nom,adresse,nbAdresses:g.adresses.length,service,canaux:avisCanaux(g.fiche)});
  });
  clients.sort((a,b)=>String(a.nom).localeCompare(String(b.nom),'fr'));
  return {clients,sansFiche,incomplets};
}
// Les lignes envoyées à la fonction pour les clients cochés
function avisLignes(clients,coches){
  return (clients||[]).filter(c=>coches.has(c.client_id)).map(c=>({client_id:c.client_id,service:c.service,adresse:c.adresse}));
}
// Ce qui identifie une demande : un aperçu ne vaut QUE pour le même délai et les mêmes lignes
function avisSignature(delai,lignes){
  return JSON.stringify([delai,[...lignes].sort((a,b)=>String(a.client_id).localeCompare(String(b.client_id)))]);
}
function avisLibelleMotif(motif,canal){
  const m=AVIS_MOTIFS[motif];
  if(!m) return String(motif||'raison inconnue');
  return m[canal]||m.defaut||String(motif);
}
// Le résumé d'un aperçu ou d'un envoi : combien de courriels et de textos (les lignes non refusées), combien refusés et pourquoi (texte → nombre)
function avisResumer(lignes){
  const r={courriels:0,textos:0,envoyes:0,echecs:0,refuses:0,motifs:{}};
  (lignes||[]).forEach(l=>{
    if(l.statut==='refuse'){
      r.refuses++;
      const t=avisLibelleMotif(l.motif,l.canal);
      r.motifs[t]=(r.motifs[t]||0)+1;
      return;
    }
    if(l.canal==='courriel') r.courriels++;
    else if(l.canal==='texto') r.textos++;
    if(l.statut==='envoye') r.envoyes++;
    else if(l.statut==='echec') r.echecs++;
  });
  return r;
}
function avisTexteMotifs(motifs){
  return Object.keys(motifs||{}).map(t=>motifs[t]+' × '+t).join(' · ');
}
// « 12 courriels + 3 textos »
function avisTexteMessages(r){
  const p=[];
  if(r.courriels) p.push(r.courriels+' courriel'+(r.courriels>1?'s':''));
  if(r.textos) p.push(r.textos+' texto'+(r.textos>1?'s':''));
  return p.join(' + ');
}
// Un client qui reçoit déjà un avis par un canal n'a pas à se faire dire qu'il n'est pas inscrit à l'autre : ce refus-là est NORMAL (un client au courriel seulement n'est pas inscrit aux textos), il est caché.
// Tous les autres refus (désabonné, hors des heures, déjà averti, aucune coordonnée…) restent affichés ; un client qui ne reçoit rien voit TOUS ses refus.
function avisVisibles(lignes){
  const recoit=new Set((lignes||[]).filter(l=>l.statut!=='refuse').map(l=>l.client_id));
  return (lignes||[]).filter(l=>!(l.statut==='refuse'&&l.motif==='pas_active'&&recoit.has(l.client_id)));
}
// Les lignes dans l'ordre de l'écran : celles qui partent (ou sont parties), puis les échecs, puis les refus ; chacune dans l'ordre du nom
const AVIS_RANG={a_envoyer:0,envoye:0,echec:1,refuse:2};
function avisTrier(lignes,nomDe){
  return [...lignes].sort((a,b)=>(AVIS_RANG[a.statut]??3)-(AVIS_RANG[b.statut]??3)||nomDe(a.client_id).localeCompare(nomDe(b.client_id),'fr')||String(a.canal).localeCompare(String(b.canal)));
}
// Le message d'un code d'erreur de la fonction d'envoi. « action » : ce qui était demandé. Après une panne PENDANT « envoyer », des avis sont PEUT-ÊTRE partis : on ne dit jamais « rien n'a été envoyé »
function avisMessageErreur(e,action){
  const code=e&&e.code;
  if(action==='envoyer'&&['reseau','erreur_interne','erreur','reponse_illisible','configuration'].includes(code)){
    return '⚠ La réponse du serveur n’est pas arrivée : certains avis sont peut-être partis. Refais « Voir ce qui partira » : les clients déjà avertis aujourd’hui y sont marqués.';
  }
  const m={
    reseau:'📴 Pas de réseau : rien n’a été envoyé.',
    fonction_absente:'❌ La fonction d’envoi n’est pas installée chez Supabase (« envoyer-avis »).',
    non_autorise:'❌ Réservé à l’administrateur : reconnecte-toi, puis réessaie.',
    delai_invalide:'❌ Le délai est invalide.',
    requete_invalide:'❌ La demande est invalide'+((e&&e.message)?' : '+e.message:'.'),
    canaux_invalides:'❌ Les canaux demandés sont invalides.',
    textos_non_actives:'❌ Les textos ne sont pas encore activés (en attente de l’approbation de Twilio). Rien n’a été envoyé.',
    modele_introuvable:'❌ Aucun modèle de message n’est en vigueur.',
    sql_absent:'❌ Les fichiers SQL 31 et 32 ne sont pas tous exécutés chez Supabase.',
    base_erreur:'❌ La base a refusé la demande : rien n’a été envoyé (voir les journaux de la fonction).',
    courriel_absent:'❌ Ton compte n’a pas de courriel : impossible d’envoyer un essai.',
    envoi_echoue:'❌ '+((e&&e.message)||'L’envoi a échoué.'),
    configuration:'❌ La fonction d’envoi n’est pas configurée correctement.',
    erreur_interne:'❌ Erreur interne de la fonction d’envoi : réessaie ; sinon, regarde ses journaux.',
  }[code];
  return m||('❌ '+((e&&e.message)||'Une erreur est survenue.'));
}

// ── L'appel à la fonction serveur ────────────────────────────────
// Rend la réponse (ok:true) ou {erreur:{code,message}}. Aucun envoi n'est jamais mis en file hors réseau : pas de réseau = erreur, point.
async function avisAppeler(corps){
  try{
    const r=await db.functions.invoke('envoyer-avis',{body:corps});
    if(r&&r.error){
      if(r.error.context&&r.error.context.status===401) return {erreur:{code:'non_autorise',message:''}};   // la passerelle de Supabase répond 401 à un jeton absent ou périmé : la fonction n'a RIEN fait (« reconnecte-toi » dit tout)
      return {erreur:await lireErreurFonction(r.error)};
    }
    const d=r&&r.data;
    if(!d||d.ok!==true) return {erreur:{code:(d&&d.erreur)||'reponse_illisible',message:(d&&d.message)||''}};
    return d;
  }catch(e){
    if(typeof signalerEchecReseau==='function') signalerEchecReseau(e);
    return {erreur:{code:(typeof estErreurReseau==='function'&&estErreurReseau(e))?'reseau':'erreur',message:String((e&&e.message)||e||'')}};
  }
}

// ── L'état, vu de l'écran ────────────────────────────────────────
function avisRoutes(){return typeof routes!=='undefined'&&Array.isArray(routes)?routes:[];}
function avisFiches(){return typeof clientsDonnees!=='undefined'&&Array.isArray(clientsDonnees)?clientsDonnees:[];}
function avisCandidatsDe(source){return avisCandidats(typeof stops!=='undefined'?stops:[],avisFiches(),source);}
function avisCandidatsActuels(){return avisCandidatsDe(avisSource);}
function avisLignesCochees(){return avisLignes(avisCandidatsActuels().clients,avisCoches);}
function avisPret(){
  const n=avisLignesCochees().length;
  return !!avisSource&&avisDelaiValide(avisDelai)&&n>0&&n<=AVIS_MAX_LIGNES;
}
function avisInvalider(){avisApercu=null;avisResultat=null;}
// À l'ouverture de l'onglet (ou après « Actualiser ») : un aperçu ou un résultat d'avant ne vaut plus
function avisReinitialiser(){avisInvalider();}
// Une route supprimée depuis : la sélection repart de zéro
function avisVerifierSource(){
  if(avisSource&&avisSource!=='__main__'&&!avisRoutes().some(r=>r.id===avisSource)){avisSource='';avisCoches=new Set();avisInvalider();}
}
function avisNomClient(id){
  const f=avisFiches().find(x=>x.id===id);
  return f?f.nom:'(client inconnu)';
}

// ── L'écran (la zone « cl-liste » de l'onglet Clients) ───────────
function avisEcran(zone){
  avisVerifierSource();
  zone.appendChild(clientsEl('div','su-adresse av-note','Un client reçoit un avis seulement si sa fiche le permet (case « Avertir par courriel », ou inscrit aux textos). Rien ne part avant ton « Envoyer ».'));
  // 1. la route
  const cRoute=clientsEl('div','su-champ cl-champ av-bloc');
  cRoute.appendChild(clientsEl('label','','1. Quels clients ?'));
  const sel=clientsEl('select','');
  sel.id='av-route';
  const o0=clientsEl('option','','— Choisir une route —');o0.value='';sel.appendChild(o0);
  avisRoutes().forEach(r=>{
    const n=avisCandidatsDe(r.id).clients.length;
    const o=clientsEl('option','',r.nom+' ('+n+' client'+(n>1?'s':'')+')');o.value=r.id;sel.appendChild(o);
  });
  const om=clientsEl('option','','Choisir les clients à la main');om.value='__main__';sel.appendChild(om);
  sel.value=avisSource;
  sel.onchange=()=>avisChoisirSource(sel.value);
  cRoute.appendChild(sel);
  zone.appendChild(cRoute);
  // 2. le délai
  const cDelai=clientsEl('div','su-champ cl-champ av-bloc');
  cDelai.appendChild(clientsEl('label','','2. Dans combien de temps passez-vous chez eux ?'));
  const puces=clientsEl('div','su-puces');
  puces.id='av-delais';
  AVIS_DELAIS.forEach(([val,txt])=>{
    const b=clientsEl('button','su-puce'+(avisDelai===val?' on':''),txt);
    b.type='button';b.dataset.delai=val;
    b.onclick=()=>avisChoisirDelai(val);
    puces.appendChild(b);
  });
  cDelai.appendChild(puces);
  const autre=clientsEl('input','');
  autre.type='number';autre.id='av-autre';autre.min='1';autre.max='72';autre.placeholder='Autre délai, en heures (1 à 72)';
  autre.value=!avisDelai||AVIS_DELAIS.some(d=>d[0]===avisDelai)?'':String(Number(avisDelai.slice(0,-1)));
  autre.oninput=()=>avisChoisirDelai(avisDelaiDeSaisie(autre.value)||'',true);
  cDelai.appendChild(autre);
  zone.appendChild(cDelai);
  // 3. ce qui se passe (résumé, boutons, aperçu, résultat) ; 4. la liste des clients
  const bas=clientsEl('div','');
  bas.id='av-bas';
  zone.appendChild(bas);
  if(avisSource){
    const {clients,sansFiche,incomplets}=avisCandidatsActuels();
    const outils=clientsEl('div','av-outils');
    const bTout=clientsEl('button','lf-btn','Tout cocher');bTout.type='button';bTout.id='av-tout';
    bTout.onclick=()=>{avisFiltrer(clients).forEach(c=>avisCoches.add(c.client_id));avisInvalider();renderClientsListe();};
    const bRien=clientsEl('button','lf-btn','Tout décocher');bRien.type='button';bRien.id='av-rien';
    bRien.onclick=()=>{avisCoches=new Set();avisInvalider();renderClientsListe();};
    outils.appendChild(bTout);outils.appendChild(bRien);
    zone.appendChild(outils);
    if(sansFiche) zone.appendChild(clientsEl('div','su-adresse av-note',sansFiche>1?'⚠ '+sansFiche+' arrêts de cette sélection ne sont pas reliés à une fiche : ils ne recevront rien (voir « Arrêts sans fiche »).':'⚠ 1 arrêt de cette sélection n’est pas relié à une fiche : il ne recevra rien (voir « Arrêts sans fiche »).'));
    if(incomplets) zone.appendChild(clientsEl('div','su-adresse av-note',incomplets>1?'⚠ '+incomplets+' clients n’ont pas de service ou d’adresse sur leur arrêt : ils ne peuvent pas être avertis.':'⚠ 1 client n’a pas de service ou d’adresse sur son arrêt : il ne peut pas être averti.'));
    const liste=clientsEl('div','');
    liste.id='av-clients';
    zone.appendChild(liste);
    avisListeClients(liste,clients);
  }
  renderAvisBas();
}

// La recherche de l'onglet (la même que pour les autres puces) s'applique à la liste des clients à avertir
function avisFiltrer(clients){
  const mots=clientsCle(clientsRecherche).split(' ').filter(Boolean);
  if(!mots.length) return clients;
  return clients.filter(c=>{const cle=clientsCle(c.nom+' '+c.adresse+' '+c.service);return mots.every(m=>cle.includes(m));});
}
function avisListeClients(zone,clients){
  const vus=avisFiltrer(clients);
  if(!vus.length) zone.appendChild(clientsMessage(clients.length?'Aucun client ne correspond.':'Aucun client à avertir ici (aucun arrêt relié à une fiche).'));
  vus.forEach(c=>{
    const ligne=clientsEl('label','su-case av-client');
    const cb=clientsEl('input','');
    cb.type='checkbox';cb.checked=avisCoches.has(c.client_id);cb.dataset.client=c.client_id;
    cb.onchange=()=>{if(cb.checked) avisCoches.add(c.client_id); else avisCoches.delete(c.client_id);avisInvalider();renderAvisBas();};
    ligne.appendChild(cb);
    const txt=clientsEl('div','');
    txt.appendChild(clientsEl('div','su-nom av-nom',c.nom));
    txt.appendChild(clientsEl('div','su-adresse',c.adresse+(c.nbAdresses>1?' ('+c.nbAdresses+' adresses)':'')+' · '+c.service));
    const icones=[c.canaux.courriel?'✉ courriel':'',c.canaux.texto?'📱 texto':''].filter(Boolean).join(' · ');
    txt.appendChild(clientsEl('div','su-temps',icones||'Aucun avis activé pour ce client'));
    ligne.appendChild(txt);
    zone.appendChild(ligne);
  });
}

function avisChoisirSource(id){
  avisSource=id;avisInvalider();
  // une route : on coche d'office les clients que leur fiche permet d'avertir (l'aperçu vérifie tout) ; « à la main » : rien de coché
  const {clients}=avisCandidatsActuels();
  avisCoches=new Set(id&&id!=='__main__'?clients.filter(c=>c.canaux.courriel||c.canaux.texto).map(c=>c.client_id):[]);
  renderClientsListe();
}
function avisChoisirDelai(d,saisie){
  avisDelai=d;avisInvalider();
  const puces=document.getElementById('av-delais');
  if(puces) Array.from(puces.children).forEach(x=>{if(x.dataset&&x.dataset.delai) x.className='su-puce'+(x.dataset.delai===avisDelai?' on':'');});
  if(!saisie){const i=document.getElementById('av-autre');if(i) i.value='';}
  renderAvisBas();
}

// ── Le bas de l'écran : résumé, boutons, aperçu, résultat ────────
function renderAvisBas(){
  const zone=document.getElementById('av-bas');
  if(!zone) return;
  zone.innerHTML='';
  const actions=clientsEl('div','su-actions');
  if(avisSource){
    const n=avisLignesCochees().length;
    zone.appendChild(clientsEl('div','su-resume av-resume',n+' client'+(n>1?'s':'')+' coché'+(n>1?'s':'')+' sur '+avisCandidatsActuels().clients.length+(avisDelaiValide(avisDelai)?' · passage '+avisLibelleDelai(avisDelai):' · choisis un délai')+(n>AVIS_MAX_LIGNES?' · '+AVIS_MAX_LIGNES+' au plus à la fois':'')));
    const bApercu=clientsEl('button','lf-btn nouveau','👁 Voir ce qui partira');
    bApercu.type='button';bApercu.id='av-apercu';bApercu.disabled=_avisOccupe||!avisPret();
    bApercu.onclick=()=>avisFaireApercu();
    actions.appendChild(bApercu);
  }
  const bEssai=clientsEl('button','lf-btn','✉ M’envoyer un courriel d’essai');
  bEssai.type='button';bEssai.id='av-essai';bEssai.disabled=_avisOccupe;
  bEssai.onclick=()=>avisEssai();
  actions.appendChild(bEssai);
  zone.appendChild(actions);
  const boite=avisApercu?avisRendreApercu(zone):avisResultat?avisRendreResultat(zone):null;
  if(boite&&avisDefiler){avisDefiler=false;if(typeof boite.scrollIntoView==='function') boite.scrollIntoView({behavior:'smooth',block:'start'});}
}

// Un appel à la fois : l'écran est bloqué (boutons grisés) jusqu'à la réponse, même si elle tarde ou échoue
async function avisSeul(travail){
  if(_avisOccupe) return;
  _avisOccupe=true;
  renderAvisBas();
  try{await travail();}
  finally{_avisOccupe=false;showSync(false);renderAvisBas();}
}

// ── L'aperçu : ce que la base enverrait, SANS rien écrire ni envoyer ──
function avisFaireApercu(){
  return avisSeul(async()=>{
    if(!avisPret()) return;
    const lignes=avisLignesCochees(),delai=avisDelai;
    const signature=avisSignature(delai,lignes);
    showSync(true);
    const r=await avisAppeler({action:'apercu',delai,lignes});
    showSync(false);
    if(r.erreur){toast(avisMessageErreur(r.erreur,'apercu'));return;}
    if(signature!==avisSignature(avisDelai,avisLignesCochees())) return;   // la sélection a changé pendant l'attente : cet aperçu ne vaut plus
    avisApercu={signature,quand:Date.now(),lignes:Array.isArray(r.lignes)?r.lignes:[],heure_permise_texto:r.heure_permise_texto};
    avisResultat=null;
    avisDefiler=true;
  });
}
function avisLigneTexte(l){
  return avisNomClient(l.client_id)+(l.canal?' · '+(l.canal==='courriel'?'✉':'📱'):'');
}
function avisRendreApercu(zone){
  const a=avisApercu;
  const visibles=avisVisibles(a.lignes);
  const r=avisResumer(visibles);
  const nb=r.courriels+r.textos;
  const boite=clientsEl('div','av-boite');
  boite.id='av-apercu-boite';
  boite.appendChild(clientsEl('div','su-section','Ce qui partirait'));
  boite.appendChild(clientsEl('div','su-resume av-resume',nb?'✔ '+avisTexteMessages(r)+' — passage '+avisLibelleDelai(avisDelai):'Rien ne partirait.'));
  if(r.refuses) boite.appendChild(clientsEl('div','su-adresse av-note','✖ Refusés ('+r.refuses+') : '+avisTexteMotifs(r.motifs)));
  if(a.lignes.some(l=>l.canal==='courriel')&&!a.lignes.some(l=>l.canal==='texto')) boite.appendChild(clientsEl('div','su-adresse av-note','📱 Les textos ne sont pas encore activés : aucun texto ne partira (les courriels, oui).'));
  if(a.heure_permise_texto===false&&a.lignes.some(l=>l.canal==='texto')) boite.appendChild(clientsEl('div','su-adresse av-note','Il est entre 21 h et 6 h (heure du Québec) : les textos sont refusés, les courriels partent.'));
  avisTrier(visibles,avisNomClient).forEach(l=>{
    const div=clientsEl('div','su-ligne av-ligne');
    const haut=clientsEl('div','su-haut');
    const nom=clientsEl('button','su-nom',avisLigneTexte(l));
    nom.type='button';
    if(l.statut==='a_envoyer'&&l.message) nom.onclick=()=>avisMontrerMessage(l);   // (un refus n'a pas de message à lire : rien ne partira)
    haut.appendChild(nom);
    const droite=clientsEl('div','su-droite');
    droite.appendChild(clientsEl('span','su-badge '+(l.statut==='a_envoyer'?'ok':'retard'),l.statut==='a_envoyer'?'Partira':'Refusé'));
    haut.appendChild(droite);
    div.appendChild(haut);
    if(l.statut==='a_envoyer') div.appendChild(clientsEl('div','su-temps','→ '+(l.destinataire||'')+' · toucher le nom pour lire le message'));
    else div.appendChild(clientsEl('div','su-adresse',avisLibelleMotif(l.motif,l.canal)));
    boite.appendChild(div);
  });
  const act=clientsEl('div','su-actions');
  const bEnv=clientsEl('button','lf-btn nouveau','✉ Envoyer maintenant ('+nb+' message'+(nb>1?'s':'')+')');
  bEnv.type='button';bEnv.id='av-envoyer';bEnv.disabled=_avisOccupe||!nb;
  bEnv.onclick=()=>avisEnvoyer();
  act.appendChild(bEnv);
  boite.appendChild(act);
  zone.appendChild(boite);
  return boite;
}
// Le message EXACT d'une ligne de l'aperçu, dans la feuille
function avisMontrerMessage(l){
  const corps=document.getElementById('clients-feuille-corps');
  corps.innerHTML='';
  document.getElementById('clients-feuille-titre').textContent=avisNomClient(l.client_id);
  corps.appendChild(clientsEl('div','su-adresse',(l.canal==='courriel'?'Courriel à ':'Texto à ')+(l.destinataire||'(aucun)')));
  if(l.objet) corps.appendChild(clientsEl('div','su-cible av-objet','Objet : '+l.objet));
  corps.appendChild(clientsEl('div','av-message',l.message));
  if(l.canal==='courriel') corps.appendChild(clientsEl('div','su-adresse','Au moment de l’envoi, « [lien de désabonnement] » devient le lien personnel de ce client.'));
  const b=clientsEl('div','su-boutons');
  const bF=clientsEl('button','lf-btn fermer','Fermer');bF.type='button';bF.onclick=()=>clientsFermerFeuille();
  b.appendChild(bF);corps.appendChild(b);
  document.getElementById('clients-feuille-overlay').classList.add('open');
}

// ── L'envoi ──────────────────────────────────────────────────────
function avisEnvoyer(){
  return avisSeul(async()=>{
    if(!avisApercu) return;
    if(Date.now()-avisApercu.quand>AVIS_APERCU_MAX_MS){avisApercu=null;toast('⏱ L’aperçu date de plus de 10 minutes : refais-le avant d’envoyer.');return;}
    const lignes=avisLignesCochees(),delai=avisDelai;
    if(avisApercu.signature!==avisSignature(delai,lignes)){avisApercu=null;toast('⚠ La sélection a changé : refais l’aperçu.');return;}
    const r0=avisResumer(avisApercu.lignes);
    if(!(r0.courriels+r0.textos)) return;
    const clientsRecevant=new Set(avisApercu.lignes.filter(l=>l.statut==='a_envoyer').map(l=>l.client_id)).size;
    const oui=await confirmer('Envoyer les avis ?',avisTexteMessages(r0)+' à '+clientsRecevant+' client'+(clientsRecevant>1?'s':'')+' : « nous passons chez vous '+(delai==='demain'?'demain':'dans '+avisLibelleDelai(delai))+' ». Un avis envoyé ne se reprend pas.','Envoyer','Annuler');
    if(!oui) return;
    showSync(true);
    const r=await avisAppeler({action:'envoyer',delai,lignes});
    showSync(false);
    if(typeof journalInvalider==='function') journalInvalider();   // (admin-avis-journal.js) l'envoi, même raté, a pu ajouter des lignes au journal : il sera relu à la prochaine visite
    if(r.erreur){avisApercu=null;toast(avisMessageErreur(r.erreur,'envoyer'));return;}   // (après un échec, l'aperçu est refait : il dira qui a déjà été averti)
    avisApercu=null;
    avisResultat={lignes:Array.isArray(r.lignes)?r.lignes:[],avertissement:r.avertissement||null};
    avisDefiler=true;
    const res=avisResumer(avisResultat.lignes);
    toast(!res.envoyes&&!res.echecs?'Aucun avis n’est parti (tous refusés).':res.echecs?'⚠ '+res.envoyes+' envoyé'+(res.envoyes>1?'s':'')+', '+res.echecs+' en échec':'✔ '+res.envoyes+' avis envoyé'+(res.envoyes>1?'s':''));
  });
}
function avisRendreResultat(zone){
  const visibles=avisVisibles(avisResultat.lignes);
  const res=avisResumer(visibles);
  const boite=clientsEl('div','av-boite');
  boite.id='av-resultat';
  boite.appendChild(clientsEl('div','su-section','Résultat de l’envoi'));
  boite.appendChild(clientsEl('div','su-resume av-resume',[res.envoyes?'✔ '+res.envoyes+' envoyé'+(res.envoyes>1?'s':''):'✖ Aucun envoyé',res.echecs?'✖ '+res.echecs+' en échec':'',res.refuses?res.refuses+' refusé'+(res.refuses>1?'s':''):''].filter(Boolean).join(' · ')));
  if(avisResultat.avertissement) boite.appendChild(clientsEl('div','su-badge retard av-avertissement',avisResultat.avertissement));
  if(res.refuses) boite.appendChild(clientsEl('div','su-adresse av-note','Refusés : '+avisTexteMotifs(res.motifs)));
  avisTrier(visibles,avisNomClient).forEach(l=>{
    const div=clientsEl('div','su-ligne av-ligne');
    const haut=clientsEl('div','su-haut');
    haut.appendChild(clientsEl('span','su-nom av-nom',avisLigneTexte(l)));
    const droite=clientsEl('div','su-droite');
    droite.appendChild(clientsEl('span','su-badge '+(l.statut==='envoye'?'ok':'retard'),l.statut==='envoye'?'Envoyé':l.statut==='echec'?'Échec':'Refusé'));
    haut.appendChild(droite);
    div.appendChild(haut);
    if(l.statut!=='envoye') div.appendChild(clientsEl('div','su-adresse',avisLibelleMotif(l.motif,l.canal)));
    boite.appendChild(div);
  });
  zone.appendChild(boite);
  return boite;
}

// ── Le courriel d'essai (à l'administrateur seulement : l'adresse de SON compte, jamais un client) ──
function avisEssai(){
  return avisSeul(async()=>{
    if(!(await confirmer('Courriel d’essai ?','Un courriel « [ESSAI] » partira à l’adresse de TON compte administrateur, jamais à un client. Rien n’est noté au journal.','Envoyer','Annuler'))) return;
    showSync(true);
    const r=await avisAppeler({action:'essai_courriel'});
    showSync(false);
    if(r.erreur){toast(avisMessageErreur(r.erreur,'essai_courriel'));return;}
    toast('✔ Courriel d’essai envoyé : regarde ta boîte de réception (et les pourriels).');
  });
}
