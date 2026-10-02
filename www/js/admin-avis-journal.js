// js/admin-avis-journal.js — Panneau administrateur, onglet « Clients », puce « 📒 Journal des avis » (demande 5, chantier D, étape 5 : 2 oct. 2026)
//
// LE JOURNAL des avis aux clients (table « avis_envois », fichier SQL 31) en LECTURE SEULE : pour chaque avis envoyé, refusé ou raté : quand, à qui, par quel canal, avec quel message EXACT. C'est la preuve en
// cas de bris (« nous vous avions avisé le 2 octobre à 14 h 03 : voici le message ») et le moyen de savoir ce qui est VRAIMENT parti. Le journal n'est ni modifiable ni effaçable (la base le garantit, même pour
// l'administrateur) : cet écran ne peut que le lire. Réservé à l'administrateur (les règles d'accès de la table le garantissent).
// Dépend de admin-clients.js (la barre, la recherche, la feuille, le répertoire) et de admin-avis.js (les motifs de refus, le délai écrit), chargés avant ce fichier. Les noms des clients viennent du répertoire déjà lu.
const JOURNAL_PAGE=200;       // lignes lues par requête
const JOURNAL_PAGES_MAX=10;   // garde-fou : jamais plus de 2 000 lignes à l'écran (« Voir les suivantes » au plus 9 fois)
const JOURNAL_COLONNES='id,lot_id,cree_le,jour,client_id,canal,destinataire,delai,service,adresse,version_modele,objet,message,statut,motif,fournisseur_id,envoye_le,erreur';
const JOURNAL_STATUTS=[['tous','Tous'],['envoye','Envoyés'],['echec','Échecs'],['refuse','Refusés'],['en_attente','En attente']];
const JOURNAL_LIBELLES={envoye:'Envoyé',echec:'Échec',refuse:'Refusé',en_attente:'En attente'};

let journalLignes=null;       // les lignes lues (tableau, les plus récentes d'abord) ; null = pas encore lues
let journalFin=false;         // true : il n'y a plus de lignes plus anciennes à lire
let journalErreur='';         // le message d'une lecture ratée (vide : tout va bien)
let journalFiltre='tous';
let _journalLecture=0;        // le numéro de la dernière lecture demandée (une réponse plus vieille est ignorée)
let _journalOccupe=false;     // une lecture est en cours

// ── Fonctions pures (testées seules) ─────────────────────────────
// Les lignes qui passent le filtre de statut et la recherche : CHAQUE mot tapé doit se trouver dans le nom du client, le destinataire, le service ou l'adresse (dans n'importe quel ordre)
function journalFiltrer(lignes,filtre,recherche,nomDe){
  const mots=clientsCle(recherche).split(' ').filter(Boolean);
  return (lignes||[]).filter(l=>{
    if(filtre&&filtre!=='tous'&&l.statut!==filtre) return false;
    if(!mots.length) return true;
    const cle=clientsCle([nomDe(l.client_id),l.destinataire,l.service,l.adresse].join(' '));
    return mots.every(m=>cle.includes(m));
  });
}
// Combien de lignes par statut
function journalCompter(lignes){
  const r={tous:0,envoye:0,echec:0,refuse:0,en_attente:0};
  (lignes||[]).forEach(l=>{r.tous++;if(l.statut in r) r[l.statut]++;});
  return r;
}
// Les lignes groupées par jour (le jour du calendrier du Québec, tel que la base l'a noté), dans l'ordre reçu : [{jour, lignes}]
function journalGrouper(lignes){
  const groupes=[];
  (lignes||[]).forEach(l=>{
    const dernier=groupes[groupes.length-1];
    if(dernier&&dernier.jour===l.jour) dernier.lignes.push(l);
    else groupes.push({jour:l.jour,lignes:[l]});
  });
  return groupes;
}
// « 2 octobre 2026 » ; le texte reçu tel quel si la date est illisible
function journalJour(jour){
  const d=new Date(String(jour)+'T12:00:00');
  if(isNaN(d.getTime())) return String(jour||'');
  try{return d.toLocaleDateString('fr-CA',{year:'numeric',month:'long',day:'numeric'});}
  catch(e){return String(jour);}
}
// « 3 envoyés · 1 refusé » (un groupe de lignes)
function journalTexteCompte(lignes){
  const c=journalCompter(lignes);
  const p=[];
  if(c.envoye) p.push(c.envoye+' envoyé'+(c.envoye>1?'s':''));
  if(c.echec) p.push(c.echec+' échec'+(c.echec>1?'s':''));
  if(c.refuse) p.push(c.refuse+' refusé'+(c.refuse>1?'s':''));
  if(c.en_attente) p.push(c.en_attente+' en attente');
  return p.join(' · ');
}
// A-t-on tout lu ? Oui si la dernière page n'était pas pleine, ou si le garde-fou (2 000 lignes) est atteint
function journalEstFini(luDansLaPage,luAuTotal){
  return luDansLaPage<JOURNAL_PAGE||luAuTotal>=JOURNAL_PAGE*JOURNAL_PAGES_MAX;
}
// La raison à montrer sous une ligne : le motif d'un refus, l'échec du fournisseur, ou l'avertissement d'une ligne restée « en attente »
function journalRaison(l){
  if(l.statut==='refuse') return avisLibelleMotif(l.motif,l.canal);
  if(l.statut==='echec') return avisLibelleMotif('echec_fournisseur',l.canal);
  if(l.statut==='en_attente') return 'le résultat n’a pas été noté : le client l’a peut-être reçu';
  return '';
}

// ── Lecture ──────────────────────────────────────────────────────
async function journalLire(debut){
  const r=await db.from('avis_envois').select(JOURNAL_COLONNES).order('cree_le',{ascending:false}).order('id',{ascending:true}).range(debut,debut+JOURNAL_PAGE-1);
  if(r.error) throw r.error;
  return Array.isArray(r.data)?r.data:[];
}
// Le journal doit être relu à la prochaine visite (un envoi vient d'avoir lieu, ou l'onglet est rouvert)
function journalInvalider(){
  journalLignes=null;journalFin=false;journalErreur='';
  _journalLecture++;   // une lecture en cours ne doit pas remettre de vieilles lignes
}
// plus=false : relire depuis le début ; plus=true : ajouter les lignes plus anciennes
async function journalCharger(plus){
  if(_journalOccupe) return;
  _journalOccupe=true;
  const numero=++_journalLecture;
  if(plus&&journalLignes) renderClientsListe();   // (le bouton « Voir les suivants » se grise pendant la lecture)
  try{
    const debut=plus&&journalLignes?journalLignes.length:0;
    const lot=await journalLire(debut);
    if(numero!==_journalLecture) return;   // une lecture plus récente (ou un envoi) a pris la relève
    const vues=new Set(plus&&journalLignes?journalLignes.map(l=>l.id):[]);
    const nouvelles=lot.filter(l=>!vues.has(l.id));   // (une ligne arrivée pendant la lecture ne doit pas s'afficher deux fois)
    journalLignes=plus&&journalLignes?journalLignes.concat(nouvelles):nouvelles;
    journalFin=journalEstFini(lot.length,journalLignes.length);
    journalErreur='';
  }catch(e){
    if(numero!==_journalLecture) return;
    const code=String((e&&e.code)||'');
    const msg=String((e&&e.message)||'');
    const absente=code==='PGRST205'||code==='42P01'||(/avis_envois/.test(msg)&&/schema cache|does not exist/.test(msg));
    journalErreur=clientsErreurReseau(e)?'📴 Pas de réseau : le journal n’a pas pu être lu.':absente?'Le journal des avis n’est pas encore activé dans ta base (fichier SQL 31).':'❌ Impossible de lire le journal. Vérifie la connexion, puis réessaie.';
    if(!plus||!journalLignes) journalLignes=null;
  }finally{
    _journalOccupe=false;
    if(typeof clientsFiltre!=='undefined'&&clientsFiltre==='journal') renderClientsListe();
  }
}

// ── L'écran (la zone « cl-liste » de l'onglet Clients) ───────────
function journalEcran(zone){
  if(journalLignes===null&&!journalErreur&&!_journalOccupe) journalCharger(false);
  if(journalLignes===null){
    zone.appendChild(clientsMessage(journalErreur||'Chargement du journal…'));
    if(journalErreur){
      const a=clientsEl('div','su-actions');
      const b=clientsEl('button','lf-btn','↻ Réessayer');b.type='button';b.id='jr-reessayer';
      b.onclick=()=>{journalErreur='';renderClientsListe();};
      a.appendChild(b);zone.appendChild(a);
    }
    return;
  }
  const nomDe=avisNomClient;
  const compte=journalCompter(journalLignes);
  zone.appendChild(clientsEl('div','su-adresse av-note','Chaque avis envoyé (ou refusé, ou raté) est noté ici, avec le message exact. Le journal ne peut être ni modifié ni effacé : même pas par toi.'));
  const barre=clientsEl('div','su-barre');
  const puces=clientsEl('div','su-puces');
  puces.id='jr-puces';
  JOURNAL_STATUTS.forEach(([id,texte])=>{
    const b=clientsEl('button','su-puce'+(journalFiltre===id?' on':''),texte+' ('+compte[id]+')');
    b.type='button';b.dataset.statut=id;
    b.onclick=()=>{journalFiltre=id;renderClientsListe();};
    puces.appendChild(b);
  });
  barre.appendChild(puces);
  zone.appendChild(barre);
  if(compte.en_attente) zone.appendChild(clientsEl('div','su-adresse av-note','⚠ '+compte.en_attente+' avis « en attente » : l’envoi a été préparé mais son résultat n’a pas été noté (panne en plein envoi). '+(compte.en_attente>1?'Les clients l’ont':'Le client l’a')+' peut-être reçu.'));
  const vues=journalFiltrer(journalLignes,journalFiltre,clientsRecherche,nomDe);
  zone.appendChild(clientsEl('div','su-resume',(journalFin?'Le journal contient '+journalLignes.length+' avis':'Les '+journalLignes.length+' avis les plus récents')+(vues.length!==journalLignes.length?' · '+vues.length+' affiché'+(vues.length>1?'s':''):'')));
  if(!vues.length) zone.appendChild(clientsMessage(journalLignes.length?'Aucun avis ne correspond.':'Le journal est vide : aucun avis n’a encore été envoyé.'));
  journalGrouper(vues).forEach(g=>{
    const section=clientsEl('div','su-section');
    section.appendChild(clientsEl('span','',journalJour(g.jour)));
    section.appendChild(clientsEl('span','su-section-n',journalTexteCompte(g.lignes)));
    zone.appendChild(section);
    g.lignes.forEach(l=>zone.appendChild(journalLigne(l,nomDe)));
  });
  const actions=clientsEl('div','su-actions');
  if(!journalFin){
    const bPlus=clientsEl('button','lf-btn nouveau','Voir les '+JOURNAL_PAGE+' suivants');bPlus.type='button';bPlus.id='jr-plus';bPlus.disabled=_journalOccupe;
    bPlus.onclick=()=>journalCharger(true);
    actions.appendChild(bPlus);
  }
  const bMaj=clientsEl('button','lf-btn','↻ Actualiser');bMaj.type='button';bMaj.id='jr-maj';
  bMaj.onclick=()=>{journalInvalider();renderClientsListe();};
  actions.appendChild(bMaj);
  zone.appendChild(actions);
  if(journalErreur) zone.appendChild(clientsMessage(journalErreur));   // (une erreur en lisant la suite : les lignes déjà lues restent)
}

function journalLigne(l,nomDe){
  const div=clientsEl('div','su-ligne av-ligne');
  const haut=clientsEl('div','su-haut');
  const nom=clientsEl('button','su-nom',nomDe(l.client_id)+(l.canal?' · '+(l.canal==='courriel'?'✉':'📱'):''));
  nom.type='button';
  nom.onclick=()=>journalMontrer(l,nomDe);
  haut.appendChild(nom);
  const droite=clientsEl('div','su-droite');
  droite.appendChild(clientsEl('span','su-badge '+(l.statut==='envoye'?'ok':l.statut==='en_attente'?'afaire':'retard'),JOURNAL_LIBELLES[l.statut]||String(l.statut)));
  droite.appendChild(clientsEl('span','su-n',clientsDate(l.statut==='envoye'&&l.envoye_le?l.envoye_le:l.cree_le)));
  haut.appendChild(droite);
  div.appendChild(haut);
  div.appendChild(clientsEl('div','su-adresse',[l.destinataire||'(aucun destinataire)',avisLibelleDelai(l.delai),l.service].join(' · ')));
  const raison=journalRaison(l);
  if(raison) div.appendChild(clientsEl('div','su-temps',raison));
  return div;
}

// La feuille d'un avis : tout ce que le journal a gardé, dont le message EXACT
function journalMontrer(l,nomDe){
  const corps=document.getElementById('clients-feuille-corps');
  corps.innerHTML='';
  document.getElementById('clients-feuille-titre').textContent=nomDe(l.client_id);
  const ligne=(texte)=>corps.appendChild(clientsEl('div','su-adresse jr-detail',texte));
  ligne((JOURNAL_LIBELLES[l.statut]||String(l.statut))+(l.statut==='envoye'&&l.envoye_le?' le '+clientsDate(l.envoye_le):' · noté le '+clientsDate(l.cree_le)));
  const raison=journalRaison(l);
  if(raison) ligne('Raison : '+raison);
  ligne((l.canal==='courriel'?'Courriel à ':'Texto à ')+(l.destinataire||'(aucun destinataire)'));
  ligne('Délai annoncé : '+avisLibelleDelai(l.delai));
  ligne('Service : '+l.service);
  ligne('Adresse : '+l.adresse);
  ligne('Modèle de message : '+l.version_modele);
  if(l.objet) corps.appendChild(clientsEl('div','su-cible av-objet','Objet : '+l.objet));
  corps.appendChild(clientsEl('div','av-message',l.message));
  if(l.canal==='courriel') ligne('Au moment de l’envoi, « [lien de désabonnement] » était remplacé par le lien personnel du client.');
  if(l.fournisseur_id) ligne('Numéro chez le fournisseur ('+(l.canal==='courriel'?'Resend':'Twilio')+') : '+l.fournisseur_id);
  if(l.erreur) ligne('Erreur notée : '+l.erreur);
  ligne('Envoi groupé : '+String(l.lot_id||'').slice(0,8));
  const b=clientsEl('div','su-boutons');
  const bF=clientsEl('button','lf-btn fermer','Fermer');bF.type='button';bF.onclick=()=>clientsFermerFeuille();
  b.appendChild(bF);corps.appendChild(b);
  document.getElementById('clients-feuille-overlay').classList.add('open');
}
