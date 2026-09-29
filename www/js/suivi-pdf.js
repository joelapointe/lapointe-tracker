// js/suivi-pdf.js — Onglet « Suivi » : l'EXPORT EN PDF de la feuille (demande 4 de Joé : « extraire en PDF pour imprimer au besoin »)
//
// La même feuille que celle qu'il imprime aujourd'hui : lettre en PAYSAGE, un titre (« SUIVI DES PASSAGES PAR CLIENT », « Entretien Lapointe - Saison 2026 »), une section par route avec le nombre
// de clients (« LOUISEVILLE — 3 clients »), un client par ligne : « # | Client : Adresse | Dates des passages », les dates écrites en toutes lettres (« 20 avr., 12 mai »). Ajouts : la colonne
// « Passages » (le nombre de dates), et, si le service a un RYTHME, la colonne « État » (À jour / À faire / En retard, en jours). Le PDF montre EXACTEMENT ce que l'écran montre : le filtre
// (« À faire », « Aucun passage ») et la recherche s'appliquent, et la 1re page le dit. Il se fabrique sur le téléphone, sans réseau (pdf-simple.js).
// Remise du fichier : sur le téléphone (APK Capacitor), le plugin « Filesystem » l'écrit dans le dossier temporaire de l'application, puis le plugin « Share » ouvre la feuille de partage d'Android
// (imprimer, courriel, Drive, WhatsApp…). Dans un navigateur (essais sur ordinateur) : téléchargement d'un fichier. Ce que les tests ne peuvent PAS prouver : la feuille de partage réelle d'Android
// (essai sur le téléphone de Joé).
const SUIVI_PDF_L=792,SUIVI_PDF_H=612,SUIVI_PDF_MARGE=36;
const SUIVI_PDF_LARGEUR_UTILE=SUIVI_PDF_L-2*SUIVI_PDF_MARGE;   // 720
const SUIVI_PDF_HAUT_SUITE=52;      // le haut du tableau sur les pages suivantes (la 1re page a son grand titre)
const SUIVI_PDF_BAS=568;            // le tableau ne descend jamais plus bas : le pied de page est en dessous
const SUIVI_PDF_TAILLE=9,SUIVI_PDF_INTERLIGNE=11.5;
const SUIVI_PDF_HAUT_ENTETE=17,SUIVI_PDF_HAUT_SECTION=19;
const SUIVI_PDF_LIGNES_MAX=40;      // garde-fou : une case ne dépasse jamais 40 lignes (elle tient toujours sur une page)
const SUIVI_PDF_MOIS=['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'];
const SUIVI_PDF_COULEUR_ETAT={aucun:'#b91c1c',retard:'#b91c1c',afaire:'#b45309',ok:'#15803d'};

let _suiviPdfOccupe=false;   // une exportation est en cours (pas deux feuilles de partage à la fois)

// « 1er janvier 2026 », « 29 septembre 2026 »
function suiviPdfDateLongue(jour){
  const m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(jour||'');
  if(!m) return '';
  const j=Number(m[3]);
  return (j===1?'1er':String(j))+' '+SUIVI_PDF_MOIS[Number(m[2])-1]+' '+m[1];
}
// « Saison 2026 » ; si la date de départ est d'une année passée : « Saison 2025-2026 »
function suiviPdfSaison(depuis,aujourdhui){
  const a=Number(String(depuis||'').slice(0,4)),b=Number(String(aujourdhui||'').slice(0,4));
  return (a&&a<b)?'Saison '+a+'-'+b:'Saison '+b;
}
// Le nom du fichier : sans accents ni espaces (« Suivi-des-passages_Coupe-de-gazon_2026-09-29.pdf »)
function suiviPdfNomFichier(service,aujourdhui){
  const s=String(service||'').normalize('NFD').replace(/\p{M}/gu,'').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
  return 'Suivi-des-passages'+(s?'_'+s:'')+'_'+aujourdhui+'.pdf';
}
// Ce que le filtre et la recherche de l'écran retiennent, en mots (rien : « Tous les clients » sans recherche)
function suiviPdfTexteFiltre(filtre,recherche,rythme){
  const morceaux=[];
  if(filtre==='afaire') morceaux.push(rythme?'clients à faire (sans passage, à faire ou en retard : rythme de '+rythme+' jours)':'clients sans passage');
  else if(filtre==='aucun') morceaux.push('clients sans passage');
  const r=String(recherche||'').trim();
  if(r) morceaux.push('recherche « '+r+' »');
  return morceaux.join(' ; ');
}
// Les dates d'une case, coupées ENTRE deux dates (jamais au milieu de « 12 mai ») : « 20 avr., 12 mai, » puis la suite
function suiviPdfDatesEnLignes(dates,largeur,taille){
  const lignes=[];
  let courante='';
  dates.forEach((d,i)=>{
    const piece=d+(i<dates.length-1?',':'');
    const essai=courante?courante+' '+piece:piece;
    if(!courante||pdfLargeur(essai,taille,false)<=largeur){courante=essai;return;}
    lignes.push(courante);
    courante=piece;
  });
  if(courante) lignes.push(courante);
  return lignes;
}
// Au plus SUIVI_PDF_LIGNES_MAX lignes : la dernière finit par « … » (sans dépasser la largeur)
function suiviPdfLimiter(lignes,largeur,taille,gras){
  if(lignes.length<=SUIVI_PDF_LIGNES_MAX) return lignes;
  const c=lignes.slice(0,SUIVI_PDF_LIGNES_MAX);
  let derniere=c[c.length-1];
  while(derniere&&pdfLargeur(derniere+'…',taille,gras)>largeur) derniere=derniere.slice(0,-1);
  c[c.length-1]=derniere.replace(/[ ,]+$/,'')+'…';
  return c;
}
function suiviPdfPluriel(n,mot){return n+' '+mot+(n>1?'s':'');}
// Un texte sur UNE ligne : terminé par « … » s'il dépasse la largeur (un nom de service très long, une longue recherche)
function suiviPdfAjuster(texte,largeur,taille,gras){
  let t=pdfNettoyer(texte);
  if(pdfLargeur(t,taille,gras)<=largeur) return t;
  while(t&&pdfLargeur(t+'…',taille,gras)>largeur) t=t.slice(0,-1);
  return t.replace(/ +$/,'')+'…';
}

// Fabrique le PDF (un Uint8Array).
// o : {service, saison, depuis ('AAAA-MM-JJ'), aujourdhui ('AAAA-MM-JJ'), filtre (texte, ou ''), rythme (jours ou null), maintenant (un Date),
//      sections:[{nom, lignes:[{numero, libelle, dates:['20 avr.',…], total, etat, jours}]}]}
function suiviPdfConstruire(o){
  const M=SUIVI_PDF_MARGE,T=SUIVI_PDF_TAILLE;
  const doc=pdfNouveau({largeur:SUIVI_PDF_L,hauteur:SUIVI_PDF_H,titre:'Suivi des passages - '+o.service,auteur:'Entretien Lapointe',date:o.maintenant});
  const avecEtat=!!o.rythme;
  const col=avecEtat
    ?{n:{x:36,l:30},client:{x:66,l:270},dates:{x:336,l:284},etat:{x:620,l:80},nb:{x:700,l:56}}
    :{n:{x:36,l:30},client:{x:66,l:300},dates:{x:366,l:334},nb:{x:700,l:56}};
  const clients=o.sections.reduce((s,x)=>s+x.lignes.length,0);
  const passages=o.sections.reduce((s,x)=>s+x.lignes.reduce((t,l)=>t+l.total,0),0);
  const pages=[];
  let page=null,y=0;

  const enteteTableau=()=>{
    page.rect(M,y,SUIVI_PDF_LARGEUR_UTILE,SUIVI_PDF_HAUT_ENTETE,{remplissage:'#f0f0f0'});
    const b=y+12;
    page.texte(col.n.x+col.n.l-6,b,'#',{taille:T,gras:true,align:'right'});
    page.texte(col.client.x+6,b,'Client : Adresse',{taille:T,gras:true});
    page.texte(col.dates.x+6,b,'Dates des passages',{taille:T,gras:true});
    if(avecEtat) page.texte(col.etat.x+6,b,'État',{taille:T,gras:true});
    page.texte(col.nb.x+col.nb.l-6,b,'Passages',{taille:T,gras:true,align:'right'});
    page.trait(M,y+SUIVI_PDF_HAUT_ENTETE,M+SUIVI_PDF_LARGEUR_UTILE,y+SUIVI_PDF_HAUT_ENTETE,{epaisseur:1,couleur:'#333333'});
    y+=SUIVI_PDF_HAUT_ENTETE;
  };
  const nouvellePage=()=>{
    page=doc.page();
    pages.push(page);
    if(pages.length===1){
      page.texte(M,50,'SUIVI DES PASSAGES PAR CLIENT',{taille:16,gras:true});
      page.texte(M,68,suiviPdfAjuster('Entretien Lapointe - '+o.saison+' - '+o.service,SUIVI_PDF_LARGEUR_UTILE,11,false),{taille:11});
      page.texte(M,83,'Passages depuis le '+suiviPdfDateLongue(o.depuis)+' · '+suiviPdfPluriel(clients,'client')+' · '+suiviPdfPluriel(passages,'passage')+' · Imprimé le '+suiviPdfDateLongue(o.aujourdhui),{taille:T,couleur:'#666666'});
      y=92;
      if(o.filtre){
        page.texte(M,96,suiviPdfAjuster('Liste : '+o.filtre,SUIVI_PDF_LARGEUR_UTILE,T,true),{taille:T,gras:true,couleur:'#444444'});
        y=105;
      }
    }else{
      page.texte(M,44,suiviPdfAjuster('SUIVI DES PASSAGES PAR CLIENT - '+o.service+' (suite)',SUIVI_PDF_LARGEUR_UTILE,T,false),{taille:T,couleur:'#666666'});
      y=SUIVI_PDF_HAUT_SUITE;
    }
    enteteTableau();
  };
  const bande=(nom,n,suite)=>{
    page.rect(M,y,SUIVI_PDF_LARGEUR_UTILE,SUIVI_PDF_HAUT_SECTION,{remplissage:'#e5e5e5'});
    page.texte(M+6,y+13,String(nom).toLocaleUpperCase('fr')+(suite?' (suite)':''),{taille:10,gras:true});
    page.texte(M+SUIVI_PDF_LARGEUR_UTILE-6,y+13,suiviPdfPluriel(n,'client'),{taille:T,align:'right',couleur:'#555555'});
    y+=SUIVI_PDF_HAUT_SECTION;
  };
  // Le contenu d'une ligne (les cases coupées en lignes) et sa hauteur
  const mesurer=l=>{
    const client=suiviPdfLimiter(pdfDecouper(l.libelle,col.client.l-12,T,false),col.client.l-12,T,false);
    // (sans passage : « Aucun passage » en gris ; la colonne « État », s'il y en a une, le dit déjà en rouge)
    const dates=l.dates.length?suiviPdfLimiter(suiviPdfDatesEnLignes(l.dates,col.dates.l-12,T),col.dates.l-12,T,false):(avecEtat?['']:['Aucun passage']);
    let etat=[];
    if(avecEtat&&l.etat&&l.etat!=='neutre'){
      const texte=(l.etat==='aucun')?SUIVI_TEXTE_ETAT.aucun:SUIVI_TEXTE_ETAT[l.etat]+' · '+l.jours+' j';
      etat=pdfDecouper(texte,col.etat.l-12,8,true);
    }
    const n=Math.max(client.length,dates.length,etat.length,1);
    return {l,client,dates,etat,n,h:3+T+(n-1)*SUIVI_PDF_INTERLIGNE+5};
  };
  const dessinerLigne=r=>{
    const b=y+3+T;
    page.texte(col.n.x+col.n.l-6,b,String(r.l.numero),{taille:T,align:'right'});
    r.client.forEach((t,i)=>page.texte(col.client.x+6,b+i*SUIVI_PDF_INTERLIGNE,t,{taille:T}));
    r.dates.forEach((t,i)=>page.texte(col.dates.x+6,b+i*SUIVI_PDF_INTERLIGNE,t,{taille:T,couleur:r.l.dates.length?'#000000':'#888888'}));
    r.etat.forEach((t,i)=>page.texte(col.etat.x+6,b+i*SUIVI_PDF_INTERLIGNE,t,{taille:8,gras:true,couleur:SUIVI_PDF_COULEUR_ETAT[r.l.etat]||'#000000'}));
    page.texte(col.nb.x+col.nb.l-6,b,String(r.l.total),{taille:T,align:'right'});
    page.trait(M,y+r.h,M+SUIVI_PDF_LARGEUR_UTILE,y+r.h,{epaisseur:0.4,couleur:'#cccccc'});
    y+=r.h;
  };

  nouvellePage();
  o.sections.forEach(s=>{
    s.lignes.forEach((l,k)=>{
      const r=mesurer(l);
      // une section ne commence jamais seule au bas d'une page : sa bande et sa 1re ligne tiennent ensemble
      if(y+(k===0?SUIVI_PDF_HAUT_SECTION:0)+r.h>SUIVI_PDF_BAS){
        nouvellePage();
        if(k>0) bande(s.nom,s.lignes.length,true);
      }
      if(k===0) bande(s.nom,s.lignes.length,false);
      dessinerLigne(r);
    });
  });
  // le pied de chaque page
  pages.forEach((p,i)=>{
    p.texte(M,SUIVI_PDF_H-22,suiviPdfAjuster('Entretien Lapointe - Suivi des passages - '+o.service,SUIVI_PDF_LARGEUR_UTILE-80,8,false),{taille:8,couleur:'#888888'});
    p.texte(M+SUIVI_PDF_LARGEUR_UTILE,SUIVI_PDF_H-22,'Page '+(i+1)+' / '+pages.length,{taille:8,couleur:'#888888',align:'right'});
  });
  return doc.octets();
}

// ── Ce que l'écran montre, mis en données pour le PDF ──────────────
function suiviPdfDonnees(){
  const rythme=suiviRythmeDe(suiviService);
  const annee=new Date().getFullYear();
  const lignes=suiviFiltrer(suiviLignes(),suiviFiltre,suiviRecherche);
  const aujourdhui=suiviAujourdhui();
  return {
    service:suiviService,saison:suiviPdfSaison(suiviDonnees.depuis,aujourdhui),depuis:suiviDonnees.depuis,aujourdhui,rythme,maintenant:new Date(),
    filtre:suiviPdfTexteFiltre(suiviFiltre,suiviRecherche,rythme),
    sections:suiviGrouper(lignes).map(s=>({nom:s.nom,lignes:s.lignes.map((l,i)=>({numero:i+1,libelle:suiviLibelle(l),dates:l.dates.map(d=>suiviDateCourte(d.jour,annee)),total:l.total,etat:l.etat,jours:l.jours}))})),
  };
}

// ── La remise du fichier ─────────────────────────────
// Les octets en base64 (par petits paquets : une seule grande liste d'arguments ferait planter les longs fichiers)
function suiviPdfBase64(octets){
  let s='';
  for(let i=0;i<octets.length;i+=8192) s+=String.fromCharCode.apply(null,octets.subarray(i,i+8192));
  return btoa(s);
}
// Sur le téléphone : écrit le fichier dans le dossier temporaire puis ouvre la feuille de partage. Dans un navigateur : le télécharge. Renvoie 'partage' ou 'telecharge'.
async function suiviPdfRemettre(octets,nom,titre){
  const fichiers=pluginNatif('Filesystem'),partage=pluginNatif('Share');
  if(fichiers&&partage){
    const ecrit=await fichiers.writeFile({path:nom,data:suiviPdfBase64(octets),directory:'CACHE'});
    if(!ecrit||!ecrit.uri) throw new Error('fichier non écrit');
    await partage.share({title:titre,text:titre,url:ecrit.uri,dialogTitle:'Envoyer ou imprimer le suivi'});
    return 'partage';
  }
  // l'application du téléphone SANS ses deux plugins (une vieille version) : un « téléchargement » n'y marcherait pas : on le dit
  if(typeof Capacitor!=='undefined'&&typeof Capacitor.isNativePlatform==='function'&&Capacitor.isNativePlatform()) throw new Error('plugins de partage absents');
  const blob=new Blob([octets],{type:'application/pdf'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  return 'telecharge';
}

// Le bouton « 📄 Exporter en PDF » de l'onglet Suivi
async function suiviExporterPdf(){
  if(_suiviPdfOccupe) return;
  if(!suiviDonnees||!suiviService){toast('Rien à exporter.');return;}
  _suiviPdfOccupe=true;
  try{
    const donnees=suiviPdfDonnees();
    if(!donnees.sections.length){toast('Rien à exporter : aucun client dans la liste.');return;}
    let octets;
    try{octets=suiviPdfConstruire(donnees);}
    catch(e){toast('❌ Le PDF n’a pas pu être préparé.');return;}
    const nom=suiviPdfNomFichier(donnees.service,donnees.aujourdhui);
    try{
      const r=await suiviPdfRemettre(octets,nom,'Suivi des passages - '+donnees.service);
      if(r==='telecharge') toast('✔ PDF téléchargé');
    }catch(e){
      // fermer la feuille de partage sans rien choisir n'est pas une erreur
      if(/cancel|abort|dismiss/i.test(String((e&&e.message)||e))) return;
      toast('❌ Le PDF n’a pas pu être envoyé à l’application de partage du téléphone.');
    }
  }finally{
    _suiviPdfOccupe=false;
  }
}
