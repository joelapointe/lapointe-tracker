// js/partage-fichier.js — Remettre un FICHIER à la personne : le PDF du suivi des passages, le CSV de la paie… (la feuille de partage d'Android, ou un téléchargement dans un navigateur)
//
// POURQUOI : dans l'application du téléphone (APK Capacitor), un « téléchargement » (un lien <a download> vers un fichier temporaire du navigateur) ne fait RIEN : ni Capacitor ni l'application n'ont d'écouteur de
// téléchargement pour la WebView d'Android. On écrit donc le fichier dans le dossier TEMPORAIRE de l'application (plugin « Filesystem »), puis on ouvre la feuille de partage d'Android (plugin « Share » : imprimer,
// courriel, Drive, WhatsApp…). Les plugins sont trouvés comme le fait tracking.js pour les autres (pluginNatif : Capacitor.Plugins.<Nom>). Dans un navigateur (essais sur ordinateur) : le téléchargement habituel.
// Ce que les tests ne peuvent PAS prouver : la vraie feuille de partage d'Android (essai sur le téléphone de Joé).
//
// Utilisation :   partagerFichier(octets,{nom:'suivi.pdf',typeMime:'application/pdf',titre:'Suivi des passages',invite:'Envoyer ou imprimer le suivi',erreur:'❌ …',telecharge:'✔ …'})   (octets : un Uint8Array)

let _partageOccupe=false;   // un partage est en cours (pas deux feuilles de partage à la fois)

// Les octets en base64 (par petits paquets : une seule grande liste d'arguments ferait planter les longs fichiers)
function octetsEnBase64(octets){
  let s='';
  for(let i=0;i<octets.length;i+=8192) s+=String.fromCharCode.apply(null,octets.subarray(i,i+8192));
  return btoa(s);
}

// Sur le téléphone : écrit le fichier dans le dossier temporaire puis ouvre la feuille de partage. Dans un navigateur : le télécharge. Renvoie 'partage' ou 'telecharge'.
// o : {nom (avec l'extension), typeMime, titre (sujet du courriel, nom du document), invite (le titre de la feuille de partage)}
async function remettreFichier(octets,o){
  const fichiers=pluginNatif('Filesystem'),partage=pluginNatif('Share');
  if(fichiers&&partage){
    const ecrit=await fichiers.writeFile({path:o.nom,data:octetsEnBase64(octets),directory:'CACHE'});
    if(!ecrit||!ecrit.uri) throw new Error('fichier non écrit');
    await partage.share({title:o.titre,text:o.titre,url:ecrit.uri,dialogTitle:o.invite});
    return 'partage';
  }
  // l'application du téléphone SANS ses deux plugins (une vieille version) : un « téléchargement » n'y marcherait pas : on le dit
  if(typeof Capacitor!=='undefined'&&typeof Capacitor.isNativePlatform==='function'&&Capacitor.isNativePlatform()) throw new Error('plugins de partage absents');
  const blob=new Blob([octets],{type:o.typeMime});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;a.download=o.nom;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),60000);
  return 'telecharge';
}

// Remet le fichier ET dit à la personne ce qui doit l'être : rien quand la feuille de partage est fermée sans rien choisir (ce n'est pas une erreur), o.erreur si le fichier n'a pas pu être remis,
// o.telecharge dans un navigateur. Un 2e appel pendant que la feuille de partage est ouverte ne fait rien.
async function partagerFichier(octets,o){
  if(_partageOccupe) return;
  _partageOccupe=true;
  try{
    const r=await remettreFichier(octets,o);
    if(r==='telecharge') toast(o.telecharge);
  }catch(e){
    if(/cancel|abort|dismiss/i.test(String((e&&e.message)||e))) return;
    toast(o.erreur);
  }finally{
    _partageOccupe=false;
  }
}
