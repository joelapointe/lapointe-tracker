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
// « 30 sept. 2026, 21:35 » (l'année est écrite : une inscription peut dater de l'an dernier) ; texte vide si la date est illisible
function clientsDate(iso){
  const d=new Date(iso);
  if(isNaN(d.getTime())) return '';
  try{return d.toLocaleString('fr-CA',{year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});}
  catch(e){return d.toISOString().slice(0,16).replace('T',' ');}
}
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
  clientsInscriptions=await clientsLireInscriptions();   // (null si la table est absente ou en panne : l'écran « Inscriptions » le dit)
  if(numero!==_clientsLecture) return;
  renderClientsAdmin();
}

// ── L'écran : la barre (filtres, recherche) puis la liste ────────
function renderClientsAdmin(){
  const body=document.getElementById('admin-body');
  body.innerHTML='';
  const barre=clientsEl('div','su-barre');
  const filtres=clientsEl('div','su-filtres');
  const nbSansFiche=clientsGrouperArrets(typeof stops!=='undefined'?stops.filter(s=>!s.client_id):[]).length;
  [['tous','Tous'],['sansarret','Sans arrêt'],['sanscontact','Sans contact'],['archives','Archivés'],['arrets','Arrêts sans fiche ('+nbSansFiche+')'],['inscriptions','Inscriptions'+(clientsInscriptions?' ('+clientsInscNouvelles(clientsInscriptions).length+')':'')]].forEach(([id,texte])=>{
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
  if(clientsFiltre==='arrets'){clientsListeArrets(zone);return;}
  if(clientsFiltre==='inscriptions'){clientsListeInscriptions(zone);return;}
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
function clientsOuvrirFeuille(f,prerempli,aLier,inscALier){
  _clientsFiche=f;
  _clientsInscALier=f?null:(inscALier||null);   // créer une fiche À PARTIR d'une inscription : elle y sera reliée après la création
  _clientsALier=f?null:(aLier||null);   // créer une fiche À PARTIR d'un arrêt : l'arrêt y sera relié après la création
  const corps=document.getElementById('clients-feuille-corps');
  corps.innerHTML='';
  document.getElementById('clients-feuille-titre').textContent=f?f.nom:'Nouveau client';
  const v=f||prerempli||{};
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
  if(_clientsInscALier) corps.appendChild(clientsEl('div','su-adresse cl-lier-info','L’inscription de « '+_clientsInscALier.nom+' » sera reliée à cette fiche : son cellulaire ('+clientsTelAffiche(_clientsInscALier.cellulaire)+') y sera ajouté et elle sera inscrite aux avis par texto.'));
  if(_clientsALier) corps.appendChild(clientsEl('div','su-adresse cl-lier-info','L’arrêt « '+_clientsALier.adresse+' » ('+_clientsALier.ids.length+' arrêt'+(_clientsALier.ids.length>1?'s':'')+') sera relié à cette fiche.'));
  if(f){
    const reliees=clientsArretsDeFiche(f.id);
    corps.appendChild(clientsEl('div','su-adresse cl-arrets-titre',reliees.length?'Arrêts reliés à cette fiche ('+reliees.reduce((n,g)=>n+g.ids.length,0)+') :':'Aucun arrêt relié à cette fiche (voir « Arrêts sans fiche »).'));
    reliees.forEach(g=>{
      const ligne=clientsEl('div','su-detail cl-arret');
      ligne.appendChild(clientsEl('span','',g.adresse+(g.services.length?' · '+g.services.join(', '):'')));
      const bD=clientsEl('button','emp-btn','Délier');bD.type='button';bD.onclick=()=>clientsDelier(g,f);
      ligne.appendChild(bD);
      corps.appendChild(ligne);
    });
  }
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
  _clientsALier=null;
  _clientsInscALier=null;
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
  let lien=null;
  if(!f&&_clientsALier){
    const groupe=_clientsALier;
    lien=await clientsEcrireLien(groupe.ids,nouvelle.id);
    if(lien.partiel) clientsMajArretsLocaux([...lien.partiel],nouvelle.id);
    if(lien.ok) clientsMajArretsLocaux(groupe.ids,nouvelle.id);
  }
  let rel=null;
  const inscALier=f?null:_clientsInscALier;
  if(inscALier){
    _clientsOccupe=true;
    rel=await clientsAppelerRelier(inscALier,nouvelle.id);
    _clientsOccupe=false;
    if(rel.ok||/deja_traitee/.test(rel.code||'')) await clientsRecharger();
  }
  clientsFermerFeuille();
  if(rel) toast(rel.ok?'✔ Fiche créée et inscription reliée.'+clientsMessagePromo(rel.promo):'⚠ Fiche créée, mais l’inscription n’a pas pu être reliée : '+rel.erreur.replace(/^❌ /,''));
  else toast(lien&&lien.erreur?'⚠ Fiche créée, mais l’arrêt n’a pas pu être relié : '+lien.erreur.replace(/^❌ /,''):lien&&lien.ok?'✔ Fiche créée et arrêt relié':f?'✔ Fiche enregistrée':'✔ Fiche créée');
  if(clientsFiltre==='arrets'||clientsFiltre==='inscriptions') renderClientsAdmin(); else renderClientsListe();
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

// ═════════════════════════════════════════════════════════════════
// ÉTAPE 2 : RELIER LES ARRÊTS QUI N'ONT PAS ENCORE DE FICHE (stops.client_id)
// ═════════════════════════════════════════════════════════════════
// Un « arrêt » est une ligne de route (une adresse + un service) ; la même adresse a souvent deux arrêts (tonte, déneigement). L'écran groupe les arrêts ACTIFS sans fiche par ADRESSE
// et propose, pour chacune, les fiches les plus probables (même numéro civique et même rue, ou même nom) ; Joé choisit, ou crée une nouvelle fiche à partir de l'arrêt.
// Relier = écrire client_id sur TOUS les arrêts de l'adresse (règle d'accès de l'étape 8 : l'administrateur peut modifier stops). Délier (depuis la fiche) remet client_id à vide.
// Rien d'autre n'est jamais modifié sur l'arrêt, et aucun avis n'est activé.
const CLIENTS_MOTS_VOIE=['rue','ch','chemin','boul','boulevard','avenue','av','route','rte','rang','place','pl','de','du','des','la','le','l','d','et','est','ouest','nord','sud','n','s','e','o'];
let _clientsALier=null;       // le groupe d'arrêts à relier à la fiche qu'on est en train de CRÉER (null sinon)

function clientsNumeroCivique(adresse){
  const m=/^\s*(\d+)/.exec(String(adresse||''));
  return m?m[1]:null;
}
// Le premier mot « utile » de la rue (sans « rue », « de la »… ; « st » et « ste » deviennent « saint » et « sainte »)
function clientsMotRue(adresse){
  const sans=clientsCle(String(adresse||'').replace(/^\s*\d+[\s-]*/,'')).replace(/\bst\b/g,'saint').replace(/\bste\b/g,'sainte');
  return sans.split(' ').find(w=>w&&!/^\d+$/.test(w)&&!CLIENTS_MOTS_VOIE.includes(w))||'';
}
// Les arrêts actifs, groupés par adresse : [{cle, adresse, noms:[…], services:[…], ids:[…]}], dans l'ordre de l'adresse
function clientsGrouperArrets(arrets){
  const g=new Map();
  (arrets||[]).forEach(s=>{
    if(!s||s.actif===false) return;
    const cle=clientsCle(s.adresse)||('id:'+s.id);
    if(!g.has(cle)) g.set(cle,{cle,adresse:String(s.adresse||'').trim(),noms:[],services:[],ids:[]});
    const x=g.get(cle);
    const nom=String(s.client||'').trim();
    if(nom&&!x.noms.includes(nom)) x.noms.push(nom);
    const sv=String(s.service||'').trim();
    if(sv&&!x.services.includes(sv)) x.services.push(sv);
    x.ids.push(s.id);
  });
  return [...g.values()].sort((a,b)=>a.cle.localeCompare(b.cle,'fr'));
}
// Les fiches les plus probables pour un groupe d'arrêts : même numéro civique ET même rue (4 points) ; même nom, ou l'un contenu dans l'autre (3 points)
function clientsSuggestions(groupe,fiches,max){
  const civ=clientsNumeroCivique(groupe.adresse),mot=clientsMotRue(groupe.adresse);
  const noms=groupe.noms.map(clientsCle).filter(Boolean);
  const scores=[];
  (fiches||[]).forEach(f=>{
    if(f.actif===false) return;
    let pts=0;
    if(civ&&mot&&clientsNumeroCivique(f.adresse)===civ&&clientsMotRue(f.adresse)===mot) pts+=4;
    const cles=[clientsCle(f.nom),clientsCle(f.nom_entreprise)].filter(Boolean);
    if(noms.some(n=>cles.some(c=>c===n||(n.length>=5&&c.includes(n))||(c.length>=5&&n.includes(c))))) pts+=3;
    if(pts) scores.push({f,pts});
  });
  scores.sort((a,b)=>b.pts-a.pts||String(a.f.nom).localeCompare(String(b.f.nom),'fr'));
  return scores.slice(0,max||6).map(x=>x.f);
}
// Les groupes d'arrêts qui passent la recherche (chaque mot dans l'adresse, un nom ou un service)
function clientsFiltrerGroupes(groupes,recherche){
  const mots=clientsCle(recherche).split(' ').filter(Boolean);
  return (groupes||[]).filter(g=>{
    if(!mots.length) return true;
    const cle=clientsCle(g.adresse+' '+g.noms.join(' ')+' '+g.services.join(' '));
    return mots.every(m=>cle.includes(m));
  });
}

// Écrit (ou efface) client_id sur ces arrêts ; vérifie que TOUTES les lignes ont changé (les règles d'accès peuvent refuser sans erreur). Rend {ok:true} ou {erreur:'…', partiel:Set}
async function clientsEcrireLien(ids,clientId){
  let r;
  try{r=await db.from('stops').update({client_id:clientId}).in('id',ids).select('id');}catch(e){r={data:null,error:e};}
  if(r.error) return {erreur:clientsMessageErreur(r.error)};
  const touches=new Set((r.data||[]).map(x=>x.id));
  if(touches.size!==ids.length) return {erreur:'❌ '+(touches.size?'Seulement '+touches.size+' arrêt'+(touches.size>1?'s':'')+' sur '+ids.length+' ont changé':'Rien n’a été changé (accès refusé ?)')+'.',partiel:touches};
  return {ok:true};
}
function clientsMajArretsLocaux(ids,clientId){
  if(typeof stops==='undefined') return;
  const s=new Set(ids);
  stops.forEach(a=>{if(s.has(a.id)) a.client_id=clientId;});
}

// L'écran « Arrêts sans fiche » (la 5ᵉ puce de la barre)
function clientsListeArrets(zone){
  const tous=clientsGrouperArrets(typeof stops!=='undefined'?stops.filter(s=>!s.client_id):[]);
  const groupes=clientsFiltrerGroupes(tous,clientsRecherche);
  const nbArrets=tous.reduce((n,g)=>n+g.ids.length,0);
  zone.appendChild(clientsEl('div','su-resume',tous.length+' adresse'+(tous.length>1?'s':'')+' sans fiche ('+nbArrets+' arrêt'+(nbArrets>1?'s':'')+')'));
  if(!groupes.length) zone.appendChild(clientsMessage(tous.length?'Aucune adresse ne correspond.':'✔ Tous les arrêts sont reliés à une fiche.'));
  groupes.forEach(g=>{
    const div=clientsEl('div','su-ligne');
    const haut=clientsEl('div','su-haut');
    const nom=clientsEl('button','su-nom',g.adresse||'(adresse vide)');
    nom.type='button';
    nom.onclick=()=>clientsOuvrirRelier(g);
    haut.appendChild(nom);
    const droite=clientsEl('div','su-droite');
    droite.appendChild(clientsEl('span','su-n','🛑 '+g.ids.length+' arrêt'+(g.ids.length>1?'s':'')));
    haut.appendChild(droite);
    div.appendChild(haut);
    div.appendChild(clientsEl('div','su-adresse',g.noms.length?'Nom sur l’arrêt : '+g.noms.join(' / '):'Aucun nom sur l’arrêt'));
    if(g.services.length) div.appendChild(clientsEl('div','su-temps',g.services.join(' · ')));
    zone.appendChild(div);
  });
}

// La feuille « Relier » : les fiches proposées, une recherche, et « créer une nouvelle fiche »
function clientsOuvrirRelier(groupe){
  _clientsFiche=null;_clientsALier=null;
  const corps=document.getElementById('clients-feuille-corps');
  corps.innerHTML='';
  document.getElementById('clients-feuille-titre').textContent='Relier cet arrêt à une fiche';
  corps.appendChild(clientsEl('div','su-cible',groupe.adresse||'(adresse vide)'));
  corps.appendChild(clientsEl('div','su-adresse',(groupe.noms.length?'Nom sur l’arrêt : '+groupe.noms.join(' / '):'Aucun nom sur l’arrêt')+' · '+groupe.ids.length+' arrêt'+(groupe.ids.length>1?'s':'')+(groupe.services.length?' ('+groupe.services.join(', ')+')':'')));
  const cRech=clientsEl('div','su-champ cl-champ');
  cRech.appendChild(clientsEl('label','','Chercher une fiche (sinon, les plus probables sont proposées)'));
  const iRech=clientsEl('input','');
  iRech.type='text';iRech.id='cl-relier-rech';iRech.placeholder='Nom, adresse, courriel…';
  cRech.appendChild(iRech);
  corps.appendChild(cRech);
  const liste=clientsEl('div','su-cases');
  liste.id='cl-relier-liste';
  corps.appendChild(liste);
  const dessiner=()=>{
    liste.innerHTML='';
    const fiches=clientsDonnees||[];
    const tape=iRech.value.trim();
    const choix=tape?clientsFiltrer(fiches,new Map(),'tous',tape).slice(0,30):clientsSuggestions(groupe,fiches,6);
    if(!choix.length){liste.appendChild(clientsMessage(tape?'Aucune fiche ne correspond.':'Aucune fiche probable : cherche par nom, ou crée une nouvelle fiche.'));return;}
    choix.forEach(f=>{
      const b=clientsEl('button','su-case cl-choix',f.nom+(clientsTexteAdresse(f)?' — '+clientsTexteAdresse(f):''));
      b.type='button';
      b.onclick=()=>clientsRelier(groupe,f);
      liste.appendChild(b);
    });
  };
  iRech.oninput=dessiner;
  dessiner();
  const boutons=clientsEl('div','su-boutons');
  const bAnn=clientsEl('button','lf-btn fermer','Annuler');bAnn.type='button';bAnn.onclick=()=>clientsFermerFeuille();
  const bNouv=clientsEl('button','lf-btn nouveau','＋ Nouvelle fiche');bNouv.type='button';bNouv.id='cl-relier-nouvelle';
  bNouv.onclick=()=>clientsOuvrirFeuille(null,{nom:groupe.noms[0]||'',adresse:groupe.adresse},groupe);
  boutons.appendChild(bAnn);boutons.appendChild(bNouv);
  corps.appendChild(boutons);
  document.getElementById('clients-feuille-overlay').classList.add('open');
}
async function clientsRelier(groupe,f){
  if(_clientsOccupe) return;
  if(!(await confirmer('Relier cet arrêt ?',groupe.ids.length+' arrêt'+(groupe.ids.length>1?'s':'')+' à l’adresse « '+groupe.adresse+' » seront reliés à la fiche « '+f.nom+' ».','Relier','Annuler'))) return;
  _clientsOccupe=true;
  showSync(true);
  const r=await clientsEcrireLien(groupe.ids,f.id);
  showSync(false);
  _clientsOccupe=false;
  if(r.partiel) clientsMajArretsLocaux([...r.partiel],f.id);
  if(r.erreur){toast(r.erreur);if(r.partiel) renderClientsAdmin();return;}
  clientsMajArretsLocaux(groupe.ids,f.id);
  clientsFermerFeuille();
  toast('✔ '+groupe.ids.length+' arrêt'+(groupe.ids.length>1?'s':'')+' relié'+(groupe.ids.length>1?'s':'')+' à '+f.nom);
  renderClientsAdmin();
}
// Les arrêts reliés à une fiche, groupés par adresse (pour la feuille de la fiche)
function clientsArretsDeFiche(clientId){
  return clientsGrouperArrets((typeof stops!=='undefined'?stops:[]).filter(s=>s.client_id===clientId));
}
async function clientsDelier(groupe,f){
  if(_clientsOccupe) return;
  if(!(await confirmer('Délier cet arrêt ?','« '+groupe.adresse+' » ne sera plus relié à la fiche « '+f.nom+' ». L’arrêt lui-même ne change pas.','Délier','Annuler'))) return;
  _clientsOccupe=true;
  showSync(true);
  const r=await clientsEcrireLien(groupe.ids,null);
  showSync(false);
  _clientsOccupe=false;
  if(r.partiel) clientsMajArretsLocaux([...r.partiel],null);
  if(r.erreur){toast(r.erreur);if(r.partiel) renderClientsAdmin();return;}
  clientsMajArretsLocaux(groupe.ids,null);
  toast('✔ Arrêt délié');
  clientsOuvrirFeuille(f);
  renderClientsAdmin();
}

// ═════════════════════════════════════════════════════════════════
// ÉTAPE 3 : LES INSCRIPTIONS REÇUES DE LA PAGE PUBLIQUE (entretienlapointe.ca/avis.html)
// ═════════════════════════════════════════════════════════════════
// Un client qui s'inscrit sur la page publique n'est PAS encore relié à une fiche : son inscription (table inscriptions_avis, fonction inscrire_avis) attend ici. Joé la RELIE à une fiche du
// répertoire (admin_relier_inscription : le cellulaire de l'inscription devient celui de la fiche, la fiche est inscrite aux avis par texto, la preuve du consentement est liée à la fiche, et le
// consentement exprès aux offres par courriel est noté si la personne l'a coché et si rien ne s'y oppose), l'IGNORE (admin_ignorer_inscription : numéro erroné, essai…) ou crée une NOUVELLE fiche
// à partir d'elle. Tout passe par ces fonctions serveur : l'application n'écrit JAMAIS elle-même un consentement. Une inscription traitée ne se retraite pas (le serveur le refuse).
const CLIENTS_INSC_COLONNES='id,nom,adresse,cellulaire,courriel,promo_accepte,statut,client_id,cree_le,traitee_le';
let clientsInscriptions=null;     // les inscriptions lues (tableau) ; null = pas lues (table absente, panne…)
let clientsInscFiltre='nouvelle'; // 'nouvelle' | 'traitees'
let _clientsInscALier=null;       // l'inscription à relier à la fiche qu'on est en train de CRÉER (null sinon)

// ── Fonctions pures ──────────────────────────────────────────────
function clientsInscNouvelles(liste){return (liste||[]).filter(i=>i.statut==='nouvelle');}
function clientsInscTraitees(liste){return (liste||[]).filter(i=>i.statut!=='nouvelle');}
// Les 10 chiffres d'un numéro (« +18195551234 » → « 8195551234 ») pour les comparer, quelle que soit l'écriture
function clientsChiffres10(texte){
  const d=String(texte||'').replace(/\D/g,'');
  return d.length>=10?d.slice(-10):'';
}
// Les fiches les plus probables pour une inscription : même cellulaire ou même téléphone (6 points), même courriel (5), même numéro civique ET même rue (4), même nom (3). Jamais une fiche archivée.
function clientsSuggestionsInscription(insc,fiches,max){
  const cel=clientsChiffres10(insc.cellulaire),mail=String(insc.courriel||'').trim().toLowerCase();
  const civ=clientsNumeroCivique(insc.adresse),mot=clientsMotRue(insc.adresse),nom=clientsCle(insc.nom);
  const scores=[];
  (fiches||[]).forEach(f=>{
    if(f.actif===false) return;
    let pts=0;
    if(cel&&(clientsChiffres10(f.cellulaire)===cel||clientsChiffres10(f.telephone)===cel)) pts+=6;
    if(mail&&String(f.courriel||'').trim().toLowerCase()===mail) pts+=5;
    if(civ&&mot&&clientsNumeroCivique(f.adresse)===civ&&clientsMotRue(f.adresse)===mot) pts+=4;
    const cles=[clientsCle(f.nom),clientsCle(f.nom_entreprise)].filter(Boolean);
    if(nom&&cles.some(c=>c===nom||(nom.length>=5&&c.includes(nom))||(c.length>=5&&nom.includes(c)))) pts+=3;
    if(pts) scores.push({f,pts});
  });
  scores.sort((a,b)=>b.pts-a.pts||String(a.f.nom).localeCompare(String(b.f.nom),'fr'));
  return scores.slice(0,max||6).map(x=>x.f);
}
// Ce que le serveur répond à « relier » à propos des offres par courriel
function clientsMessagePromo(code){
  return {
    appliquee:' Il accepte aussi les offres par courriel : c’est noté.',
    desabonne_des_courriels:' Il accepte les offres par courriel, mais il s’était désabonné des courriels : rien n’a été activé.',
    courriel_different:' Il accepte les offres par courriel, mais le courriel de la fiche est différent de celui de l’inscription : rien n’a été activé.',
    retire_depuis:' Il accepte les offres par courriel, mais il les a retirées depuis : rien n’a été activé.',
  }[code]||'';
}
function clientsMessageErreurInscription(e){
  if(clientsErreurReseau(e)) return '📴 Pas de réseau : rien n’a été changé.';
  const m=String((e&&e.message)||'');
  if(/inscription_deja_traitee/.test(m)) return '❌ Cette inscription a déjà été traitée (la liste va se rafraîchir).';
  if(/inscription_introuvable/.test(m)) return '❌ Cette inscription n’existe plus (la liste va se rafraîchir).';
  if(/client_introuvable/.test(m)) return '❌ Cette fiche n’existe plus ou est archivée.';
  if(/non_autorise/.test(m)) return '❌ Réservé à l’administrateur.';
  if(/Could not find the function|PGRST202|42883/.test(m+String((e&&e.code)||''))) return '❌ La fonction n’est pas installée sur Supabase (fichier SQL 30).';
  return '❌ L’opération a échoué'+(m?' : '+m:'')+'.';
}

// ── Lecture ──────────────────────────────────────────────────────
async function clientsLireInscriptions(){
  try{
    const r=await db.from('inscriptions_avis').select(CLIENTS_INSC_COLONNES).order('cree_le',{ascending:false}).order('id',{ascending:true}).range(0,CLIENTS_PAGE-1);
    if(r.error) return null;
    return Array.isArray(r.data)?r.data:[];
  }catch(e){return null;}
}
// Relit les fiches ET les inscriptions sans vider l'écran (après une opération du serveur qui change les deux)
async function clientsRecharger(){
  try{
    const fiches=await clientsLireTout();
    clientsDonnees=fiches;
  }catch(e){}
  const i=await clientsLireInscriptions();
  if(i) clientsInscriptions=i;
}

// ── L'écran « Inscriptions » ─────────────────────────────────────
function clientsListeInscriptions(zone){
  if(clientsInscriptions===null){
    zone.appendChild(clientsMessage('Les inscriptions n’ont pas pu être lues (ou le fichier SQL 30 n’est pas encore activé).'));
    const bMaj=clientsEl('button','lf-btn','↻ Réessayer');bMaj.type='button';bMaj.onclick=()=>clientsOuvrir();
    const a=clientsEl('div','su-actions');a.appendChild(bMaj);zone.appendChild(a);
    return;
  }
  const nouvelles=clientsInscNouvelles(clientsInscriptions),traitees=clientsInscTraitees(clientsInscriptions);
  const barre=clientsEl('div','su-puces');
  [['nouvelle','Nouvelles ('+nouvelles.length+')'],['traitees','Traitées ('+traitees.length+')']].forEach(([id,texte])=>{
    const b=clientsEl('button','su-puce'+(clientsInscFiltre===id?' on':''),texte);
    b.type='button';b.dataset.inscfiltre=id;
    b.onclick=()=>{clientsInscFiltre=id;renderClientsListe();};
    barre.appendChild(b);
  });
  const enveloppe=clientsEl('div','su-barre');   // (la marge de 16 px des autres puces)
  enveloppe.appendChild(barre);
  zone.appendChild(enveloppe);
  const liste=clientsInscFiltre==='nouvelle'?nouvelles:traitees;
  if(!liste.length) zone.appendChild(clientsMessage(clientsInscFiltre==='nouvelle'?'✔ Aucune nouvelle inscription à traiter.':'Aucune inscription traitée.'));
  liste.forEach(i=>{
    const div=clientsEl('div','su-ligne cl-insc');
    const haut=clientsEl('div','su-haut');
    const nom=clientsEl('button','su-nom',i.nom);
    nom.type='button';
    nom.onclick=()=>clientsOuvrirInscription(i);
    haut.appendChild(nom);
    const droite=clientsEl('div','su-droite');
    if(i.statut==='reliee'){const f=(clientsDonnees||[]).find(x=>x.id===i.client_id);droite.appendChild(clientsEl('span','su-badge ok','Reliée'+(f?' à '+f.nom:'')));}
    else if(i.statut==='ignoree') droite.appendChild(clientsEl('span','su-badge retard','Ignorée'));
    else droite.appendChild(clientsEl('span','su-badge afaire','Nouvelle'));
    if(i.promo_accepte) droite.appendChild(clientsEl('span','su-n','✉ offres par courriel'));
    haut.appendChild(droite);
    div.appendChild(haut);
    div.appendChild(clientsEl('div','su-adresse',i.adresse));
    div.appendChild(clientsEl('div','su-temps','📱 '+clientsTelAffiche(i.cellulaire)+(i.courriel?' · ✉ '+i.courriel:'')));
    div.appendChild(clientsEl('div','su-n',clientsDate(i.cree_le)));
    zone.appendChild(div);
  });
  const a=clientsEl('div','su-actions');
  const bMaj=clientsEl('button','lf-btn','↻ Actualiser');bMaj.type='button';bMaj.onclick=()=>clientsOuvrir();
  a.appendChild(bMaj);zone.appendChild(a);
}

// La feuille d'une inscription : ses renseignements, les fiches probables, une recherche, « Ignorer » et « Nouvelle fiche »
function clientsOuvrirInscription(insc){
  _clientsFiche=null;_clientsALier=null;_clientsInscALier=null;
  const corps=document.getElementById('clients-feuille-corps');
  corps.innerHTML='';
  document.getElementById('clients-feuille-titre').textContent=insc.nom;
  const ligne=(texte,classe)=>corps.appendChild(clientsEl('div',classe||'su-cible',texte));
  ligne(insc.adresse);
  ligne('📱 '+clientsTelAffiche(insc.cellulaire)+(insc.courriel?'  ✉ '+insc.courriel:''),'su-adresse');
  ligne('Reçue le '+clientsDate(insc.cree_le)+(insc.promo_accepte?' · accepte aussi les offres par courriel':''),'su-adresse');
  if(insc.statut!=='nouvelle'){
    const f=(clientsDonnees||[]).find(x=>x.id===insc.client_id);
    ligne(insc.statut==='reliee'?'Reliée'+(f?' à la fiche « '+f.nom+' »':'')+(insc.traitee_le?' le '+clientsDate(insc.traitee_le):'')+'.':'Ignorée'+(insc.traitee_le?' le '+clientsDate(insc.traitee_le):'')+'.','su-adresse cl-insc-statut');
    const b=clientsEl('div','su-boutons');
    const bF=clientsEl('button','lf-btn fermer','Fermer');bF.type='button';bF.onclick=()=>clientsFermerFeuille();
    b.appendChild(bF);corps.appendChild(b);
    document.getElementById('clients-feuille-overlay').classList.add('open');
    return;
  }
  const cRech=clientsEl('div','su-champ cl-champ');
  cRech.appendChild(clientsEl('label','','Relier à une fiche (les plus probables sont proposées)'));
  const iRech=clientsEl('input','');
  iRech.type='text';iRech.id='cl-insc-rech';iRech.placeholder='Chercher une fiche : nom, adresse, courriel…';
  cRech.appendChild(iRech);
  corps.appendChild(cRech);
  const liste=clientsEl('div','su-cases');
  liste.id='cl-insc-liste';
  corps.appendChild(liste);
  const dessiner=()=>{
    liste.innerHTML='';
    const fiches=clientsDonnees||[];
    const tape=iRech.value.trim();
    const choix=tape?clientsFiltrer(fiches,new Map(),'tous',tape).slice(0,30):clientsSuggestionsInscription(insc,fiches,6);
    if(!choix.length){liste.appendChild(clientsMessage(tape?'Aucune fiche ne correspond.':'Aucune fiche probable : cherche par nom, ou crée une nouvelle fiche.'));return;}
    choix.forEach(f=>{
      const b=clientsEl('button','su-case cl-choix',f.nom+(clientsTexteAdresse(f)?' — '+clientsTexteAdresse(f):''));
      b.type='button';
      b.onclick=()=>clientsRelierInscription(insc,f);
      liste.appendChild(b);
    });
  };
  iRech.oninput=dessiner;
  dessiner();
  const boutons=clientsEl('div','su-boutons');
  const bAnn=clientsEl('button','lf-btn fermer','Annuler');bAnn.type='button';bAnn.onclick=()=>clientsFermerFeuille();
  const bIgn=clientsEl('button','lf-btn','Ignorer');bIgn.type='button';bIgn.id='cl-insc-ignorer';bIgn.onclick=()=>clientsIgnorerInscription(insc);
  const bNouv=clientsEl('button','lf-btn nouveau','＋ Nouvelle fiche');bNouv.type='button';bNouv.id='cl-insc-nouvelle';
  bNouv.onclick=()=>clientsOuvrirFeuille(null,{nom:insc.nom,adresse:insc.adresse,courriel:insc.courriel||''},null,insc);
  boutons.appendChild(bAnn);boutons.appendChild(bIgn);boutons.appendChild(bNouv);
  corps.appendChild(boutons);
  document.getElementById('clients-feuille-overlay').classList.add('open');
}

// Appelle la fonction serveur « relier » (sans confirmation : l'appelant l'a déjà demandée) ; rend {ok:true, promo} ou {erreur}
async function clientsAppelerRelier(insc,clientId){
  let r;
  try{r=await db.rpc('admin_relier_inscription',{p_inscription_id:insc.id,p_client_id:clientId});}catch(e){r={data:null,error:e};}
  if(r.error) return {erreur:clientsMessageErreurInscription(r.error),code:String((r.error&&r.error.message)||'')};
  const d=r.data||{};
  if(d.statut!=='reliee') return {erreur:'❌ Réponse inattendue du serveur : rien n’est sûr, actualise la liste.',code:''};
  return {ok:true,promo:d.promo||'non_demandee'};
}
async function clientsRelierInscription(insc,f){
  if(_clientsOccupe) return;
  const ancien=clientsChiffres10(f.cellulaire),nouveau=clientsChiffres10(insc.cellulaire);
  const texte='Le cellulaire de la fiche deviendra le '+clientsTelAffiche(insc.cellulaire)+' et « '+f.nom+' » sera inscrit aux avis par texto (consentement du '+clientsDate(insc.cree_le)+').'
    +(ancien&&ancien!==nouveau?' Son cellulaire actuel ('+clientsTelAffiche(f.cellulaire)+') sera remplacé.':'')
    +(insc.promo_accepte?' Elle a aussi coché les offres par courriel.':'');
  if(!(await confirmer('Relier cette inscription à « '+f.nom+' » ?',texte,'Relier','Annuler'))) return;
  _clientsOccupe=true;
  showSync(true);
  const r=await clientsAppelerRelier(insc,f.id);
  showSync(false);
  _clientsOccupe=false;
  if(r.erreur){
    toast(r.erreur);
    if(/inscription_deja_traitee|inscription_introuvable/.test(r.code)){await clientsRecharger();clientsFermerFeuille();renderClientsAdmin();}
    return;
  }
  await clientsRecharger();
  clientsFermerFeuille();
  toast('✔ Inscription reliée à '+f.nom+'.'+clientsMessagePromo(r.promo));
  renderClientsAdmin();
}
async function clientsIgnorerInscription(insc){
  if(_clientsOccupe) return;
  if(!(await confirmer('Ignorer cette inscription ?','« '+insc.nom+' » ne sera reliée à aucune fiche et ne recevra aucun avis. Elle reste dans la liste « Traitées ».','Ignorer','Annuler'))) return;
  _clientsOccupe=true;
  showSync(true);
  let r;
  try{r=await db.rpc('admin_ignorer_inscription',{p_inscription_id:insc.id});}catch(e){r={data:null,error:e};}
  showSync(false);
  _clientsOccupe=false;
  if(r.error){
    toast(clientsMessageErreurInscription(r.error));
    if(/inscription_deja_traitee|inscription_introuvable/.test(String(r.error.message||''))){await clientsRecharger();clientsFermerFeuille();renderClientsAdmin();}
    return;
  }
  if(!r.data||r.data.statut!=='ignoree'){toast('❌ Réponse inattendue du serveur : actualise la liste.');return;}
  await clientsRecharger();
  clientsFermerFeuille();
  toast('✔ Inscription ignorée');
  renderClientsAdmin();
}
