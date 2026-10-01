// js/admin-clients.js — Panneau administrateur, onglet « Clients » : le RÉPERTOIRE des clients (demande 5, chantier D, étape 1 : 1ᵉʳ oct. 2026)
//
// Le répertoire (table « clients », fichier SQL 30) a été rempli depuis QuickBooks (278 fiches, aucun avis activé). Cet onglet sert à le tenir à jour : chercher une fiche, la corriger
// (nom, adresse, courriel, téléphone, CELLULAIRE), choisir « avertir par courriel », créer une fiche, ARCHIVER une fiche (jamais effacée : actif = false).
// À venir (étapes 2 et 3 du chantier D) : relier les arrêts qui n'ont pas encore de fiche, et les inscriptions reçues de la page publique.
//
// Réservé à l'ADMINISTRATEUR (les règles d'accès de la table le garantissent). Lecture et écriture DIRECTES sur la table (règle clients_admin) : aucune fonction serveur. Les colonnes du
// CONSENTEMENT (avis_texto, désabonnements, consentement exprès aux promotions) ne s'écrivent JAMAIS d'ici (le serveur refuse l'écriture directe) : l'écran les montre en lecture seule.
// Changer le cellulaire d'une fiche inscrite aux textos ANNULE son inscription (le serveur le fait : l'accord valait pour l'ancien numéro) : l'écran le dit avant d'enregistrer.
// Le nombre d'arrêts d'une fiche vient de la liste des arrêts actifs déjà chargée par l'application (stops.client_id) : aucune lecture de plus.
const CLIENTS_PAGE=1000;      // lignes lues par requête (le service de données n'en rend pas plus de 1000)
const CLIENTS_PAGES_MAX=20;   // garde-fou : jamais plus de 20 000 fiches lues
const CLIENTS_COLONNES='id,nom,nom_entreprise,type_client,adresse,ville,code_postal,courriel,telephone,cellulaire,avis_courriel,avis_texto,desabonne_courriel_le,desabonne_texto_le,desabonne_promo_le,notes,actif';
const CLIENTS_TYPES=[['particulier','Particulier'],['investisseur','Investisseur'],['municipalite','Municipalité'],['commerce','Commerce'],['syndicat','Syndicat de copropriété'],['autre','Autre']];

let clientsDonnees=null;      // les fiches lues (tableau) ; null tant qu'elles ne sont pas lues
let clientsFiltre='tous';     // 'tous' | 'sansarret' | 'sanscontact' | 'archives'
let clientsRecherche='';
let _clientsOccupe=false;     // une écriture est en cours (pas de double envoi)
let _clientsLecture=0;        // le numéro de la dernière lecture demandée (une réponse plus vieille est ignorée)
let _clientsFiche=null;       // la fiche ouverte dans la feuille (null = une nouvelle fiche)

// ── Fonctions pures (testées seules) ─────────────────────────────
// La clé d'un texte : sans accents, sans majuscules, sans ponctuation
function clientsCle(texte){
  return String(texte||'').normalize('NFD').replace(/\p{M}/gu,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
// Les 10 chiffres d'un numéro nord-américain (« (819) 555-1234 », « 1-819-555-1234 », « +1 819 555 1234 »…) ; null si ce n'en est pas un
function clientsTelChiffres(texte){
  let d=String(texte||'').replace(/\D/g,'');
  if(d.length===11&&d[0]==='1') d=d.slice(1);
  return /^[2-9]\d{2}[2-9]\d{6}$/.test(d)?d:null;
}
// « 819 555-1234 » ; un texte qui n'est pas un numéro de 10 chiffres est montré tel quel (QuickBooks en avait de toutes les formes)
function clientsTelAffiche(texte){
  const d=clientsTelChiffres(texte);
  if(d) return d.slice(0,3)+' '+d.slice(3,6)+'-'+d.slice(6);
  return String(texte||'').trim();
}
function clientsCourrielValide(texte){
  const t=String(texte||'').trim();
  return t.length<=150&&/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t);
}
// Combien d'arrêts ACTIFS par fiche (client_id → nombre)
function clientsCompterArrets(arrets){
  const m=new Map();
  (arrets||[]).forEach(s=>{if(s&&s.client_id&&s.actif!==false) m.set(s.client_id,(m.get(s.client_id)||0)+1);});
  return m;
}
function clientsSansContact(f){return !String(f.courriel||'').trim()&&!String(f.telephone||'').trim()&&!String(f.cellulaire||'').trim();}
// Les fiches qui passent le filtre et la recherche : CHAQUE mot tapé doit se trouver dans le nom, l'entreprise, l'adresse, la ville, le courriel ou un numéro (dans n'importe quel ordre).
// Les fiches archivées ne se voient que dans le filtre « Archivés ».
function clientsFiltrer(fiches,arretsParClient,filtre,recherche){
  const mots=clientsCle(recherche).split(' ').filter(Boolean);
  return (fiches||[]).filter(f=>{
    if(filtre==='archives'){if(f.actif!==false) return false;}
    else if(f.actif===false) return false;
    if(filtre==='sansarret'&&(arretsParClient.get(f.id)||0)>0) return false;
    if(filtre==='sanscontact'&&!clientsSansContact(f)) return false;
    if(mots.length){
      const cle=clientsCle([f.nom,f.nom_entreprise,f.adresse,f.ville,f.courriel].join(' '));
      const nums=[f.telephone,f.cellulaire].map(x=>String(x||'').replace(/\D/g,'')).join(' ');
      if(!mots.every(m=>cle.includes(m)||(/^\d{3,}$/.test(m)&&nums.includes(m)))) return false;
    }
    return true;
  });
}
function clientsResume(fiches,arretsParClient){
  const actives=(fiches||[]).filter(f=>f.actif!==false);
  return {
    actives:actives.length,
    archivees:(fiches||[]).length-actives.length,
    avecArret:actives.filter(f=>(arretsParClient.get(f.id)||0)>0).length,
    sansContact:actives.filter(clientsSansContact).length,
    avisCourriel:actives.filter(f=>f.avis_courriel&&!f.desabonne_courriel_le).length,   // (un désabonné ne compte plus)
    avisTexto:actives.filter(f=>f.avis_texto&&!f.desabonne_texto_le).length,
  };
}
// Ce que la fiche contient comme moyens de joindre le client, pour la liste : « ✉ a@b.ca · ☎ 819 555-1234 · 📱 819 555-9999 »
function clientsTexteContact(f){
  const p=[];
  if(String(f.courriel||'').trim()) p.push('✉ '+f.courriel.trim());
  if(String(f.telephone||'').trim()) p.push('☎ '+clientsTelAffiche(f.telephone));
  if(String(f.cellulaire||'').trim()) p.push('📱 '+clientsTelAffiche(f.cellulaire));
  return p.join(' · ');
}
function clientsTexteAdresse(f){
  return [String(f.adresse||'').trim(),String(f.ville||'').trim()].filter(Boolean).join(', ');
}

// ── Petites aides d'écran ────────────────────────────────────────
function clientsEl(balise,classe,texte){
  const e=document.createElement(balise);
  if(classe) e.className=classe;
  if(texte!==undefined) e.textContent=texte;
  return e;
}
function clientsMessage(texte){return clientsEl('div','su-message',texte);}
function clientsErreurReseau(e){return typeof estErreurReseau==='function'&&estErreurReseau(e);}

// ── Lecture ──────────────────────────────────────────────────────
async function clientsLireTout(){
  const toutes=[];
  for(let page=0;page<CLIENTS_PAGES_MAX;page++){
    const r=await db.from('clients').select(CLIENTS_COLONNES).order('nom',{ascending:true}).order('id',{ascending:true}).range(page*CLIENTS_PAGE,page*CLIENTS_PAGE+CLIENTS_PAGE-1);
    if(r.error) throw r.error;
    const lot=Array.isArray(r.data)?r.data:[];
    toutes.push(...lot);
    if(lot.length<CLIENTS_PAGE) break;
  }
  return toutes;
}
function chargerClientsAdmin(){return clientsOuvrir();}
async function clientsOuvrir(){
  const numero=++_clientsLecture;
  const body=document.getElementById('admin-body');
  body.innerHTML='';
  body.appendChild(clientsMessage('Chargement du répertoire…'));
  let fiches=null,erreur=null;
  try{fiches=await clientsLireTout();}catch(e){erreur=e;}
  if(numero!==_clientsLecture) return;   // une lecture plus récente a pris la relève
  if(erreur){
    body.innerHTML='';
    const code=String((erreur&&erreur.code)||'');
    const msg=String((erreur&&erreur.message)||'');
    const absente=code==='PGRST205'||code==='42P01'||(/clients/.test(msg)&&/schema cache|does not exist/.test(msg));
    body.appendChild(clientsMessage(clientsErreurReseau(erreur)?'📴 Pas de réseau : le répertoire n’a pas pu être lu.':absente?'Le répertoire des clients n’est pas encore activé dans ta base (fichier SQL 30).':'❌ Impossible de lire le répertoire. Vérifie la connexion, puis réessaie.'));
    const bMaj=clientsEl('button','lf-btn','↻ Réessayer');bMaj.type='button';bMaj.onclick=()=>clientsOuvrir();
    const a=clientsEl('div','su-actions');a.appendChild(bMaj);body.appendChild(a);
    return;
  }
  clientsDonnees=fiches;
  renderClientsAdmin();
}

// ── L'écran : la barre (filtres, recherche) puis la liste ────────
function renderClientsAdmin(){
  const body=document.getElementById('admin-body');
  body.innerHTML='';
  const barre=clientsEl('div','su-barre');
  const filtres=clientsEl('div','su-filtres');
  [['tous','Tous'],['sansarret','Sans arrêt'],['sanscontact','Sans contact'],['archives','Archivés']].forEach(([id,texte])=>{
    const b=clientsEl('button','su-puce'+(clientsFiltre===id?' on':''),texte);
    b.type='button';
    b.dataset.filtre=id;
    b.onclick=()=>{clientsFiltre=id;Array.from(filtres.children).forEach(x=>{if(x.dataset&&x.dataset.filtre) x.className='su-puce'+(x.dataset.filtre===clientsFiltre?' on':'');});renderClientsListe();};
    filtres.appendChild(b);
  });
  const iRech=clientsEl('input','su-recherche');
  iRech.type='text';iRech.id='cl-recherche';iRech.placeholder='Chercher un client…';iRech.value=clientsRecherche;
  iRech.oninput=()=>{clientsRecherche=iRech.value;renderClientsListe();};
  filtres.appendChild(iRech);
  barre.appendChild(filtres);
  body.appendChild(barre);
  const liste=clientsEl('div','');
  liste.id='cl-liste';
  body.appendChild(liste);
  renderClientsListe();
}

function renderClientsListe(){
  const zone=document.getElementById('cl-liste');
  if(!zone) return;
  zone.innerHTML='';
  const fiches=clientsDonnees||[];
  const parArret=clientsCompterArrets(typeof stops!=='undefined'?stops:[]);
  const r=clientsResume(fiches,parArret);
  zone.appendChild(clientsEl('div','su-resume',
    r.actives+' fiche'+(r.actives>1?'s':'')+' · '+r.avecArret+' avec arrêt'+(r.avecArret>1?'s':'')+' · '+r.sansContact+' sans moyen de joindre · '+r.avisCourriel+' avis par courriel · '+r.avisTexto+' inscrit'+(r.avisTexto>1?'s':'')+' aux textos'+(r.archivees?' · '+r.archivees+' archivée'+(r.archivees>1?'s':''):'')));
  const lignes=clientsFiltrer(fiches,parArret,clientsFiltre,clientsRecherche);
  if(!lignes.length) zone.appendChild(clientsMessage(fiches.length?'Aucune fiche ne correspond.':'Le répertoire est vide.'));
  lignes.forEach(f=>zone.appendChild(clientsLigne(f,parArret.get(f.id)||0)));
  const actions=clientsEl('div','su-actions');
  const bNouveau=clientsEl('button','lf-btn nouveau','＋ Nouveau client');bNouveau.type='button';bNouveau.onclick=()=>clientsOuvrirFeuille(null);
  const bMaj=clientsEl('button','lf-btn','↻ Actualiser');bMaj.type='button';bMaj.onclick=()=>clientsOuvrir();
  actions.appendChild(bNouveau);actions.appendChild(bMaj);
  zone.appendChild(actions);
}

function clientsLigne(f,nbArrets){
  const div=clientsEl('div','su-ligne');
  const haut=clientsEl('div','su-haut');
  const nom=clientsEl('button','su-nom',f.nom);
  nom.type='button';
  nom.onclick=()=>clientsOuvrirFeuille(f);
  haut.appendChild(nom);
  const droite=clientsEl('div','su-droite');
  if(f.actif===false) droite.appendChild(clientsEl('span','su-badge aucun','Archivée'));
  if(f.avis_courriel&&!f.desabonne_courriel_le) droite.appendChild(clientsEl('span','su-badge ok','Avis courriel'));
  if(f.desabonne_courriel_le) droite.appendChild(clientsEl('span','su-badge retard','Désabonné (courriel)'));
  if(f.avis_texto&&!f.desabonne_texto_le) droite.appendChild(clientsEl('span','su-badge ok','Avis texto'));
  if(f.desabonne_texto_le) droite.appendChild(clientsEl('span','su-badge retard','Désabonné (texto)'));
  droite.appendChild(clientsEl('span','su-n',nbArrets?'🛑 '+nbArrets+' arrêt'+(nbArrets>1?'s':''):'aucun arrêt'));
  haut.appendChild(droite);
  div.appendChild(haut);
  if(String(f.nom_entreprise||'').trim()&&clientsCle(f.nom_entreprise)!==clientsCle(f.nom)) div.appendChild(clientsEl('div','su-adresse',f.nom_entreprise));   // (QuickBooks répète souvent le nom : une seule fois à l'écran)
  const adr=clientsTexteAdresse(f);
  if(adr) div.appendChild(clientsEl('div','su-adresse',adr));
  const contact=clientsTexteContact(f);
  div.appendChild(clientsEl('div','su-temps',contact||'Aucun moyen de joindre ce client'));
  return div;
}

// ── La feuille d'une fiche (modifier / créer) ────────────────────
function clientsChamp(corps,id,libelle,type,valeur,extra){
  const c=clientsEl('div','su-champ cl-champ');
  c.appendChild(clientsEl('label','',libelle));
  const i=clientsEl('input','');
  i.id=id;i.type=type||'text';i.value=valeur||'';
  if(extra) Object.keys(extra).forEach(k=>{i[k]=extra[k];});
  c.appendChild(i);
  corps.appendChild(c);
  return i;
}
function clientsOuvrirFeuille(f){
  _clientsFiche=f;
  const corps=document.getElementById('clients-feuille-corps');
  corps.innerHTML='';
  document.getElementById('clients-feuille-titre').textContent=f?f.nom:'Nouveau client';
  const v=f||{};
  clientsChamp(corps,'cl-nom','Nom','text',v.nom,{maxLength:150,placeholder:'Nom du client'});
  clientsChamp(corps,'cl-entreprise','Entreprise (facultatif)','text',v.nom_entreprise,{maxLength:150});
  const cType=clientsEl('div','su-champ cl-champ');
  cType.appendChild(clientsEl('label','','Type de client'));
  const sel=clientsEl('select','');
  sel.id='cl-type';
  CLIENTS_TYPES.forEach(([val,txt])=>{const o=clientsEl('option','',txt);o.value=val;sel.appendChild(o);});
  sel.value=v.type_client||'particulier';
  cType.appendChild(sel);
  corps.appendChild(cType);
  clientsChamp(corps,'cl-adresse','Adresse','text',v.adresse,{maxLength:200});
  clientsChamp(corps,'cl-ville','Ville','text',v.ville,{maxLength:100});
  clientsChamp(corps,'cl-cp','Code postal','text',v.code_postal,{maxLength:10});
  clientsChamp(corps,'cl-courriel','Courriel','email',v.courriel,{maxLength:150,placeholder:'nom@exemple.ca'});
  clientsChamp(corps,'cl-tel','Téléphone','tel',v.telephone,{maxLength:30});
  clientsChamp(corps,'cl-cell','Cellulaire (pour les textos)','tel',v.cellulaire?clientsTelAffiche(v.cellulaire):'',{maxLength:30,placeholder:'819 555-1234'});
  const caseAvis=clientsEl('label','su-case');
  const cb=clientsEl('input','');
  cb.type='checkbox';cb.id='cl-avis-courriel';cb.checked=!!v.avis_courriel;
  caseAvis.appendChild(cb);
  caseAvis.appendChild(clientsEl('span','','Avertir ce client par courriel (avis de passage)'));
  corps.appendChild(caseAvis);
  const etatTexto=f?(f.desabonne_texto_le?'Désabonné des textos (a répondu ARRET).':f.avis_texto?'Inscrit aux avis par texto.':'Pas inscrit aux avis par texto : le client s’inscrit lui-même sur la page web.'):'Pas inscrit aux avis par texto : le client s’inscrit lui-même sur la page web.';
  corps.appendChild(clientsEl('div','su-adresse cl-etat-texto',etatTexto+(f&&f.desabonne_courriel_le?' Désabonné des courriels.':'')));
  const cNotes=clientsEl('div','su-champ cl-champ');
  cNotes.appendChild(clientsEl('label','','Notes (facultatif)'));
  const ta=clientsEl('textarea','');
  ta.id='cl-notes';ta.value=v.notes||'';ta.maxLength=2000;
  cNotes.appendChild(ta);
  corps.appendChild(cNotes);
  const boutons=clientsEl('div','su-boutons');
  const bAnn=clientsEl('button','lf-btn fermer','Annuler');bAnn.type='button';bAnn.onclick=()=>clientsFermerFeuille();
  const bOk=clientsEl('button','lf-btn nouveau',f?'Enregistrer':'Créer la fiche');bOk.type='button';bOk.id='cl-enregistrer';bOk.onclick=()=>clientsEnregistrer();
  boutons.appendChild(bAnn);boutons.appendChild(bOk);
  corps.appendChild(boutons);
  if(f){
    const bArch=clientsEl('button','lf-btn',f.actif===false?'↩ Réactiver cette fiche':'🗄 Archiver cette fiche');
    bArch.type='button';bArch.id='cl-archiver';bArch.style.marginTop='10px';bArch.style.width='100%';
    bArch.onclick=()=>clientsArchiver(f);
    corps.appendChild(bArch);
  }
  document.getElementById('clients-feuille-overlay').classList.add('open');
}
function clientsFermerFeuille(){
  document.getElementById('clients-feuille-overlay').classList.remove('open');
  _clientsFiche=null;
}
function clientsBgFeuille(e){
  if(e.target===document.getElementById('clients-feuille-overlay')) clientsFermerFeuille();
}
function clientsValeur(id){
  const e=document.getElementById(id);
  return e?String(e.value||'').trim():'';
}

// Lit le formulaire : {valeurs} ou {probleme:'…'}
function clientsLireFormulaire(){
  const nom=clientsValeur('cl-nom');
  if(!nom) return {probleme:'⚠ Entre le nom du client'};
  if(nom.length>150) return {probleme:'⚠ Le nom est trop long (150 caractères au plus)'};
  const courriel=clientsValeur('cl-courriel');
  if(courriel&&!clientsCourrielValide(courriel)) return {probleme:'⚠ Ce courriel ne semble pas valide'};
  const cellTexte=clientsValeur('cl-cell');
  let cellulaire=null;
  if(cellTexte){
    const d=clientsTelChiffres(cellTexte);
    if(!d) return {probleme:'⚠ Le cellulaire doit avoir 10 chiffres (ex. 819 555-1234)'};
    cellulaire='+1'+d;
  }
  const avis=!!document.getElementById('cl-avis-courriel').checked;
  if(avis&&!courriel) return {probleme:'⚠ Pour avertir par courriel, il faut un courriel'};
  const vide=t=>t===''?null:t;
  return {valeurs:{
    nom,nom_entreprise:vide(clientsValeur('cl-entreprise')),type_client:clientsValeur('cl-type')||'particulier',
    adresse:vide(clientsValeur('cl-adresse')),ville:vide(clientsValeur('cl-ville')),code_postal:vide(clientsValeur('cl-cp')),
    courriel:vide(courriel.toLowerCase()),telephone:vide(clientsValeur('cl-tel')),cellulaire,avis_courriel:avis,notes:vide(clientsValeur('cl-notes')),
  }};
}
function clientsMessageErreur(e){
  if(clientsErreurReseau(e)) return '📴 Pas de réseau : rien n’a été changé.';
  const m=String((e&&e.message)||'');
  if(/cellulaire_invalide/.test(m)) return '❌ Ce cellulaire n’est pas valide.';
  if(/clients_courriel_format/.test(m)) return '❌ Ce courriel n’est pas valide.';
  return '❌ L’enregistrement a échoué'+(m?' : '+m:'')+'.';
}
async function clientsEnregistrer(){
  if(_clientsOccupe) return;
  const lu=clientsLireFormulaire();
  if(lu.probleme){toast(lu.probleme);return;}
  const v=lu.valeurs;
  const f=_clientsFiche;
  if(f){
    // le cellulaire change pour une fiche inscrite aux textos : l'accord valait pour l'ancien numéro (le serveur l'annule)
    const ancien=f.cellulaire||null;
    if(f.avis_texto&&v.cellulaire!==ancien){
      if(!(await confirmer('Changer le cellulaire ?','Cette fiche est inscrite aux avis par texto. L’inscription valait pour l’ancien numéro : elle sera annulée, et le client devra s’inscrire de nouveau.','Changer','Annuler'))) return;
    }
  }else{
    const cle=clientsCle(v.nom);
    const meme=(clientsDonnees||[]).find(x=>clientsCle(x.nom)===cle);
    if(meme&&!(await confirmer('Cette fiche existe peut-être déjà','Il y a déjà une fiche « '+meme.nom+' ». En créer une autre ?','Créer quand même','Annuler'))) return;
  }
  _clientsOccupe=true;
  showSync(true);
  let r;
  try{
    r=f?await db.from('clients').update(v).eq('id',f.id).select(CLIENTS_COLONNES)
       :await db.from('clients').insert([v]).select(CLIENTS_COLONNES);
  }catch(e){r={data:null,error:e};}
  showSync(false);
  _clientsOccupe=false;
  if(r.error){toast(clientsMessageErreur(r.error));return;}
  if(!r.data||r.data.length===0){toast('❌ Rien n’a été enregistré (accès refusé ?)');return;}
  const nouvelle=r.data[0];
  if(f){const i=clientsDonnees.findIndex(x=>x.id===f.id);if(i>=0) clientsDonnees[i]=nouvelle;}
  else{clientsDonnees.push(nouvelle);clientsDonnees.sort((a,b)=>String(a.nom).localeCompare(String(b.nom),'fr'));}
  clientsFermerFeuille();
  toast(f?'✔ Fiche enregistrée':'✔ Fiche créée');
  renderClientsListe();
}
async function clientsArchiver(f){
  if(_clientsOccupe) return;
  const archiver=f.actif!==false;
  if(archiver&&!(await confirmer('Archiver '+f.nom+' ?','La fiche disparaît de la liste (onglet « Archivés ») mais n’est jamais effacée. Plus aucun avis ne lui sera envoyé.','Archiver','Annuler'))) return;
  _clientsOccupe=true;
  showSync(true);
  let r;
  try{r=await db.from('clients').update({actif:!archiver}).eq('id',f.id).select(CLIENTS_COLONNES);}catch(e){r={data:null,error:e};}
  showSync(false);
  _clientsOccupe=false;
  if(r.error){toast(clientsMessageErreur(r.error));return;}
  if(!r.data||r.data.length===0){toast('❌ Rien n’a été changé (accès refusé ?)');return;}
  const i=clientsDonnees.findIndex(x=>x.id===f.id);
  if(i>=0) clientsDonnees[i]=r.data[0];
  clientsFermerFeuille();
  toast(archiver?'🗄 Fiche archivée':'↩ Fiche réactivée');
  renderClientsListe();
}
