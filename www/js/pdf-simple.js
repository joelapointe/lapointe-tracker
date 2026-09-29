// js/pdf-simple.js — Un tout petit ÉCRIVAIN DE PDF (demande 4 de Joé : le PDF du suivi des passages, à imprimer)
//
// Il écrit du texte, des traits et des rectangles sur des pages : c'est tout ce qu'il faut à une feuille de suivi. POURQUOI « maison » : aucune bibliothèque de 350 Ko à copier dans
// l'application, à tenir à jour et à surveiller ; le fichier produit est simple (polices Helvetica et Helvetica-Bold, que TOUT lecteur de PDF connaît : rien à embarquer) et tout se
// teste sans téléphone (test-pdf-simple.mjs relit le fichier octet par octet).
// Les positions sont en POINTS (1 pouce = 72 points) ; l'origine est en HAUT à gauche de la page et y DESCEND (comme à l'écran). Une lettre en paysage : 792 × 612.
// Les accents : les textes sont écrits dans la table Windows-1252 (le « WinAnsiEncoding » du PDF) : é è à ç ô œ « » ’ – … €. Un caractère absent de cette table devient « ? ».
//
// Utilisation :   const doc=pdfNouveau({titre:'…',date:new Date()});   const p=doc.page();   p.texte(36,60,'Bonjour',{taille:12,gras:true});   p.trait(36,70,756,70);   const octets=doc.octets();   (un Uint8Array)

// Largeur de chaque caractère (en millièmes du corps) pour les codes Windows-1252 32 à 255 ; les codes qui ne s'écrivent jamais (les 5 que cette table n'utilise pas, le trait d'union conditionnel 173 qui est retiré
// du texte, et 127) n'ont pas de largeur utile.
// Mesurées avec Arial, dont les largeurs sont celles de Helvetica (sauf 5 caractères rares, corrigés plus bas) : le lecteur de PDF met les mêmes largeurs à l'écran et à l'impression.
const PDF_LARGEURS_REGULIER=[
  278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,   // codes 32 à 47
  556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,   // codes 48 à 63
  1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,   // codes 64 à 79
  667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,   // codes 80 à 95
  333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,   // codes 96 à 111
  556,556,333,500,278,556,500,722,500,500,500,334,260,334,584,500,   // codes 112 à 127
  556,0,222,556,333,1000,556,556,333,1000,667,333,1000,0,611,0,   // codes 128 à 143
  0,222,222,333,333,350,556,1000,333,1000,500,333,944,0,500,667,   // codes 144 à 159
  278,333,556,556,556,556,260,556,333,737,370,556,584,0,737,552,   // codes 160 à 175
  400,549,333,333,333,576,537,333,333,333,365,556,834,834,834,611,   // codes 176 à 191
  667,667,667,667,667,667,1000,722,667,667,667,667,278,278,278,278,   // codes 192 à 207
  722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,   // codes 208 à 223
  556,556,556,556,556,556,889,500,556,556,556,556,278,278,278,278,   // codes 224 à 239
  556,556,556,556,556,556,556,549,611,556,556,556,556,500,556,500,   // codes 240 à 255
];
const PDF_LARGEURS_GRAS=[
  278,333,474,556,556,889,722,238,333,333,389,584,278,333,278,278,   // codes 32 à 47
  556,556,556,556,556,556,556,556,556,556,333,333,584,584,584,611,   // codes 48 à 63
  975,722,722,722,722,667,611,778,722,278,556,722,611,833,722,778,   // codes 64 à 79
  667,778,722,667,611,722,667,944,667,667,611,333,278,333,584,556,   // codes 80 à 95
  333,556,611,556,611,556,333,611,611,278,278,556,278,889,611,611,   // codes 96 à 111
  611,611,389,556,333,611,556,778,556,556,500,389,280,389,584,500,   // codes 112 à 127
  556,0,278,556,500,1000,556,556,333,1000,667,333,1000,0,611,0,   // codes 128 à 143
  0,278,278,500,500,350,556,1000,333,1000,556,333,944,0,500,667,   // codes 144 à 159
  278,333,556,556,556,556,280,556,333,737,370,556,584,0,737,552,   // codes 160 à 175
  400,549,333,333,333,576,556,333,333,333,365,556,834,834,834,611,   // codes 176 à 191
  722,722,722,722,722,722,1000,722,667,667,667,667,278,278,278,278,   // codes 192 à 207
  722,722,778,778,778,778,778,584,778,722,722,722,722,667,667,611,   // codes 208 à 223
  556,556,556,556,556,556,889,556,556,556,556,556,278,278,278,278,   // codes 224 à 239
  611,611,611,611,611,611,611,549,611,611,611,611,611,556,611,556,   // codes 240 à 255
];
// Les rares caractères où Arial n'a pas la largeur de Helvetica (les valeurs de Helvetica, celles du fichier de métriques d'Adobe) : ¯ (175), ± (177), µ (181), · (183) et ÷ (247)
PDF_LARGEURS_REGULIER[175-32]=333;PDF_LARGEURS_GRAS[175-32]=333;
PDF_LARGEURS_REGULIER[177-32]=584;PDF_LARGEURS_GRAS[177-32]=584;
PDF_LARGEURS_REGULIER[181-32]=556;PDF_LARGEURS_GRAS[181-32]=611;
PDF_LARGEURS_REGULIER[183-32]=278;PDF_LARGEURS_GRAS[183-32]=278;
PDF_LARGEURS_REGULIER[247-32]=584;PDF_LARGEURS_GRAS[247-32]=584;

// Les caractères du bloc 0x80–0x9F de Windows-1252 (tout le reste de la table est le Latin-1 : même code)
const PDF_CP1252_SPECIAUX={0x20AC:0x80,0x201A:0x82,0x0192:0x83,0x201E:0x84,0x2026:0x85,0x2020:0x86,0x2021:0x87,0x02C6:0x88,0x2030:0x89,0x0160:0x8A,0x2039:0x8B,0x0152:0x8C,0x017D:0x8E,
  0x2018:0x91,0x2019:0x92,0x201C:0x93,0x201D:0x94,0x2022:0x95,0x2013:0x96,0x2014:0x97,0x02DC:0x98,0x2122:0x99,0x0161:0x9A,0x203A:0x9B,0x0153:0x9C,0x017E:0x9E,0x0178:0x9F};

// Le code Windows-1252 d'un caractère (son point de code Unicode) ; 63 (« ? ») s'il n'existe pas dans cette table
function pdfOctetDe(cp){
  if(cp>=32&&cp<=126) return cp;
  if(cp>=0xA0&&cp<=0xFF&&cp!==0xAD) return cp;
  if(PDF_CP1252_SPECIAUX[cp]) return PDF_CP1252_SPECIAUX[cp];
  return 63;
}
// Un texte prêt à écrire : espaces réduits à un seul (retours à la ligne et tabulations compris), caractères invisibles retirés, chaque caractère absent de la table remplacé
// (par sa lettre sans accent si elle existe, sinon « ? »)
function pdfNettoyer(texte){
  let sortie='';
  let espace=true;   // (rien au début du texte)
  for(const ch of String(texte==null?'':texte).normalize('NFC')){
    const cp=ch.codePointAt(0);
    if(cp===0xAD||(cp>=0x200B&&cp<=0x200F)||cp===0xFEFF||/^\p{M}$/u.test(ch)) continue;   // (les marques combinantes comprennent les sélecteurs de variante des emoji, U+FE0F)
    if(/^\s$/.test(ch)){if(!espace) sortie+=' ';espace=true;continue;}
    espace=false;
    if(pdfOctetDe(cp)!==63||cp===63){sortie+=ch;continue;}
    const base=ch.normalize('NFD').codePointAt(0);
    sortie+=(base>=33&&base<=126)?String.fromCodePoint(base):'?';
  }
  return sortie.replace(/ $/,'');
}
// La largeur d'un texte, en points, pour une taille de police (en points) ; gras : Helvetica-Bold
function pdfLargeur(texte,taille,gras){
  const t=gras?PDF_LARGEURS_GRAS:PDF_LARGEURS_REGULIER;
  let somme=0;
  for(const ch of pdfNettoyer(texte)) somme+=t[pdfOctetDe(ch.codePointAt(0))-32]||0;
  return somme*taille/1000;
}
// Coupe un texte en lignes qui tiennent dans une largeur (en points) : aux espaces ; un mot plus large que la ligne est coupé au caractère près. Toujours au moins une ligne.
function pdfDecouper(texte,largeurMax,taille,gras){
  const propre=pdfNettoyer(texte);
  if(!propre) return [''];
  const largeur=t=>pdfLargeur(t,taille,gras);
  const lignes=[];
  let courante='';
  for(const mot of propre.split(' ')){
    const essai=courante?courante+' '+mot:mot;
    if(largeur(essai)<=largeurMax){courante=essai;continue;}
    if(courante){lignes.push(courante);courante='';}
    if(largeur(mot)<=largeurMax){courante=mot;continue;}
    let reste=Array.from(mot);
    while(reste.length){
      let n=1;
      while(n<reste.length&&largeur(reste.slice(0,n+1).join(''))<=largeurMax) n++;
      const morceau=reste.slice(0,n).join('');
      reste=reste.slice(n);
      if(reste.length) lignes.push(morceau); else courante=morceau;
    }
  }
  lignes.push(courante);
  return lignes;
}

// ── L'écriture du fichier ──────────────────────────────
function pdfAscii(s){const r=new Uint8Array(s.length);for(let i=0;i<s.length;i++) r[i]=s.charCodeAt(i)&255;return r;}
function pdfAssembler(morceaux){let n=0;morceaux.forEach(m=>{n+=m.length;});const r=new Uint8Array(n);let p=0;morceaux.forEach(m=>{r.set(m,p);p+=m.length;});return r;}
// Un nombre pour le PDF : deux décimales au plus, jamais de notation scientifique
function pdfNombre(n){
  n=Number(n);
  if(!isFinite(n)) return '0';
  return (Math.round(n*100)/100).toFixed(2).replace(/\.?0+$/,'');   // (« 12.50 » → « 12.5 », « 100.00 » → « 100 », « 0.00 » → « 0 »)
}
// Une couleur « #rrggbb » → « r g b » (0 à 1) ; la couleur par défaut si elle est illisible
function pdfCouleur(c,defaut){
  const m=/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c||'')||/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(defaut);
  return [m[1],m[2],m[3]].map(h=>pdfNombre(parseInt(h,16)/255)).join(' ');
}
// Un texte pour les informations du document : UTF-16 en hexadécimal (accents corrects partout)
function pdfTexteUtf16(texte){
  let h='FEFF';
  for(let i=0;i<texte.length;i++) h+=texte.charCodeAt(i).toString(16).toUpperCase().padStart(4,'0');
  return '<'+h+'>';
}
function pdfDateInfo(d){
  const p=n=>String(n).padStart(2,'0');
  return 'D:'+d.getFullYear()+p(d.getMonth()+1)+p(d.getDate())+p(d.getHours())+p(d.getMinutes())+p(d.getSeconds());
}

function pdfPage(largeur,hauteur){
  const morceaux=[];
  const ecrire=s=>morceaux.push(pdfAscii(s));
  return {
    morceaux,
    // Un texte dont la ligne de base est à (x, y) ; o : {taille (10), gras, couleur ('#000000'), align ('left', 'right' ou 'center' : x est alors le bord droit ou le centre)}
    texte(x,y,texte,o){
      o=o||{};
      const taille=Number(o.taille)>0?Number(o.taille):10;
      const propre=pdfNettoyer(texte);
      if(!propre) return;
      let px=Number(x)||0;
      const l=pdfLargeur(propre,taille,!!o.gras);
      if(o.align==='right') px-=l; else if(o.align==='center') px-=l/2;
      ecrire('BT\n/'+(o.gras?'F2':'F1')+' '+pdfNombre(taille)+' Tf\n'+pdfCouleur(o.couleur,'#000000')+' rg\n'+pdfNombre(px)+' '+pdfNombre(hauteur-(Number(y)||0))+' Td\n(');
      const octets=[];
      for(const ch of propre){
        const b=pdfOctetDe(ch.codePointAt(0));
        if(b===40||b===41||b===92) octets.push(92);
        octets.push(b);
      }
      morceaux.push(Uint8Array.from(octets));
      ecrire(') Tj\nET\n');
    },
    // Un trait de (x1, y1) à (x2, y2) ; o : {epaisseur (0.5), couleur ('#000000')}
    trait(x1,y1,x2,y2,o){
      o=o||{};
      const e=Number(o.epaisseur)>0?Number(o.epaisseur):0.5;
      ecrire(pdfCouleur(o.couleur,'#000000')+' RG\n'+pdfNombre(e)+' w\n'+pdfNombre(x1)+' '+pdfNombre(hauteur-y1)+' m\n'+pdfNombre(x2)+' '+pdfNombre(hauteur-y2)+' l\nS\n');
    },
    // Un rectangle dont le coin HAUT gauche est à (x, y) ; o : {remplissage ('#rrggbb'), contour ('#rrggbb'), epaisseur (0.5)}
    rect(x,y,l,h,o){
      o=o||{};
      if(!o.remplissage&&!o.contour) return;
      let s='';
      if(o.remplissage) s+=pdfCouleur(o.remplissage,'#ffffff')+' rg\n';
      if(o.contour) s+=pdfCouleur(o.contour,'#000000')+' RG\n'+pdfNombre(Number(o.epaisseur)>0?Number(o.epaisseur):0.5)+' w\n';
      s+=pdfNombre(x)+' '+pdfNombre(hauteur-y-h)+' '+pdfNombre(l)+' '+pdfNombre(h)+' re\n'+(o.remplissage&&o.contour?'B':(o.remplissage?'f':'S'))+'\n';
      ecrire(s);
    },
  };
}

// o : {largeur (792), hauteur (612), titre, auteur, date (un Date : la date de création écrite dans le fichier)}
function pdfNouveau(o){
  o=o||{};
  const largeur=Number(o.largeur)>0?Number(o.largeur):792;
  const hauteur=Number(o.hauteur)>0?Number(o.hauteur):612;
  const pages=[];
  const doc={
    largeur,hauteur,
    page(){const p=pdfPage(largeur,hauteur);pages.push(p);return p;},
    nbPages(){return pages.length;},
    // Le fichier PDF complet (un Uint8Array). Objets : 1 catalogue, 2 liste des pages, 3 et 4 les polices, 5 les informations, puis pour chaque page : la page (6, 8…) et son contenu (7, 9…).
    octets(){
      if(!pages.length) doc.page();
      const sortie=[];
      let position=0;
      const decalages=[];
      const ajouter=b=>{sortie.push(b);position+=b.length;};
      const objet=(n,contenu)=>{decalages[n]=position;ajouter(pdfAscii(n+' 0 obj\n'+contenu+'\nendobj\n'));};
      ajouter(pdfAscii('%PDF-1.4\n%'));
      ajouter(Uint8Array.from([0xE2,0xE3,0xCF,0xD3,10]));   // (des octets > 127 : le fichier est « binaire » pour les programmes qui le transportent)
      objet(1,'<< /Type /Catalog /Pages 2 0 R >>');
      objet(2,'<< /Type /Pages /Count '+pages.length+' /Kids ['+pages.map((p,i)=>(6+2*i)+' 0 R').join(' ')+'] >>');
      objet(3,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
      objet(4,'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
      let info='<< /Producer (Lapointe Tracker)';
      if(o.titre) info+=' /Title '+pdfTexteUtf16(String(o.titre));
      if(o.auteur) info+=' /Author '+pdfTexteUtf16(String(o.auteur));
      if(o.date instanceof Date&&!isNaN(o.date.getTime())) info+=' /CreationDate ('+pdfDateInfo(o.date)+')';
      objet(5,info+' >>');
      pages.forEach((p,i)=>{
        const n=6+2*i;
        objet(n,'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+pdfNombre(largeur)+' '+pdfNombre(hauteur)+'] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents '+(n+1)+' 0 R >>');
        const contenu=pdfAssembler(p.morceaux);
        decalages[n+1]=position;
        ajouter(pdfAscii((n+1)+' 0 obj\n<< /Length '+contenu.length+' >>\nstream\n'));
        ajouter(contenu);
        ajouter(pdfAscii('\nendstream\nendobj\n'));
      });
      const nbObjets=5+2*pages.length;
      const debutXref=position;
      let xref='xref\n0 '+(nbObjets+1)+'\n0000000000 65535 f \n';
      for(let n=1;n<=nbObjets;n++) xref+=String(decalages[n]).padStart(10,'0')+' 00000 n \n';
      xref+='trailer\n<< /Size '+(nbObjets+1)+' /Root 1 0 R /Info 5 0 R >>\nstartxref\n'+debutXref+'\n%%EOF\n';
      ajouter(pdfAscii(xref));
      return pdfAssembler(sortie);
    },
  };
  return doc;
}
