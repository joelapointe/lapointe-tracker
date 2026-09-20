// js/photos.js — Une photo par problème signalé (étape 14e)
//
// L'employé prend UNE photo en signalant un problème (bouton 📷). La photo est réduite sur le téléphone (JPEG, 1280 px au plus,
// environ 200 Ko), envoyée dans l'espace PRIVÉ « photos-problemes » au chemin imposé « numéro-employé/numéro-problème.jpg », puis
// reliée au problème par la fonction du serveur probleme_attacher_photo. Le texte du problème est toujours envoyé EN PREMIER :
// si la photo échoue (zone morte), le problème existe quand même et on peut ajouter la photo ensuite depuis la fiche de l'arrêt.
// Une photo se lit par un lien temporaire signé (aucune adresse publique) ; elle se voit comme le problème auquel elle est reliée.
// (Hors réseau : la photo attendra le retour du signal avec le reste, étape 16.)
const BUCKET_PHOTOS='photos-problemes';
const PHOTO_COTE_MAX=1280;                 // le plus grand côté, en pixels
const PHOTO_OCTETS_MAX=1800000;            // sous la limite de 2 Mo de l'espace privé
const PHOTO_QUALITES=[0.7,0.55,0.4];       // qualité JPEG essayée, de la meilleure à la plus légère
const PHOTO_VALIDE_S=3600;                 // durée d'un lien signé
let _photoChoisie=null;                    // {blob, url} : la photo prise pour le problème en cours de saisie
let _urlsPhotos={};                        // chemin -> {url, jusqua} : liens signés déjà obtenus (url null = échec, on ne réessaie pas avant 1 minute)
let _photosAResoudre=new Set();
let _resolutionEnCours=false;
let _photoApresCible=null;                 // problème auquel on ajoute une photo après coup
let _envoiPhotoApres=false;

// Défense en profondeur : la base impose déjà la forme « numéro/numéro.jpg » ; on ne met JAMAIS autre chose dans un attribut de la page
const FORME_UUID='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
function cheminPhotoValide(c){return new RegExp('^'+FORME_UUID+'/'+FORME_UUID+'[.]jpg$').test(String(c||''));}
function idValide(i){return new RegExp('^'+FORME_UUID+'$').test(String(i||''));}

function messagePhoto(e){
  const m=String((e&&e.message)||'');
  if(m.includes('pas_une_photo')) return '⚠ Ce fichier n’est pas une photo.';
  if(m.includes('photo_trop_lourde')) return '⚠ Photo trop lourde. Reprends-en une.';
  return '⚠ Photo illisible. Reprends-la.';
}

// Vieux navigateurs sans createImageBitmap : on passe par une image
function chargerImage(fichier){
  return new Promise((resolve,reject)=>{
    const url=URL.createObjectURL(fichier);
    const img=new Image();
    img.onload=()=>{URL.revokeObjectURL(url);resolve(img);};
    img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('photo_illisible'));};
    img.src=url;
  });
}

// Réduit la photo : 1280 px au plus, JPEG. Trop lourde ? on baisse la qualité, puis les dimensions. Renvoie un Blob.
async function reduirePhoto(fichier){
  if(!fichier||!/^image\//.test(fichier.type||'')) throw new Error('pas_une_photo');
  let source;
  try{
    // « from-image » : la photo est redressée comme le téléphone l'a prise (jamais couchée sur le côté)
    source=(typeof createImageBitmap==='function')?await createImageBitmap(fichier,{imageOrientation:'from-image'}):await chargerImage(fichier);
  }catch(e){
    throw new Error('photo_illisible');
  }
  try{
    const l0=source.width,h0=source.height;
    if(!(l0>0&&h0>0)) throw new Error('photo_illisible');
    let echelle=Math.min(1,PHOTO_COTE_MAX/Math.max(l0,h0));
    for(const q of PHOTO_QUALITES){
      const c=document.createElement('canvas');
      c.width=Math.max(1,Math.round(l0*echelle));
      c.height=Math.max(1,Math.round(h0*echelle));
      const ctx=c.getContext('2d');
      if(!ctx) throw new Error('photo_illisible');
      ctx.drawImage(source,0,0,c.width,c.height);
      const blob=await new Promise(res=>c.toBlob(res,'image/jpeg',q));
      if(!blob) throw new Error('photo_illisible');
      if(blob.size<=PHOTO_OCTETS_MAX) return blob;
      echelle*=0.8;   // encore trop lourde : on réduit aussi les dimensions
    }
    throw new Error('photo_trop_lourde');
  }finally{
    if(source&&typeof source.close==='function') source.close();
  }
}

// « Une photo existe déjà à ce chemin » : un renvoi après une réponse perdue, ce n'est pas une erreur
function dejaLa(e){
  return String(e&&e.statusCode)==='409'||/already exists|duplicate/i.test(String((e&&(e.message||e.error))||''));
}

// Envoie la photo dans l'espace privé, puis la relie au problème. Lance une erreur si l'un des deux gestes échoue.
async function envoyerPhotoProbleme(problemeId,blob){
  const chemin=currentUser.id+'/'+problemeId+'.jpg';
  const up=await db.storage.from(BUCKET_PHOTOS).upload(chemin,blob,{contentType:'image/jpeg',upsert:false});
  if(up.error&&!dejaLa(up.error)) throw up.error;
  const a=await db.rpc('probleme_attacher_photo',{p_probleme_id:problemeId});
  if(a.error) throw a.error;
}

// ── Dans la boîte « Signaler un problème » ─────────────
function ouvrirAppareilPhoto(){
  document.getElementById('prob-photo-input').click();
}
async function choisirPhotoProbleme(input){
  const f=input&&input.files&&input.files[0];
  if(!f) return;
  try{
    const blob=await reduirePhoto(f);
    retirerPhotoProbleme();
    _photoChoisie={blob,url:URL.createObjectURL(blob)};
    majApercuPhoto();
  }catch(e){
    toast(messagePhoto(e));
  }finally{
    try{input.value='';}catch(e){}   // la même photo pourra être choisie de nouveau
  }
}
function retirerPhotoProbleme(){
  if(_photoChoisie){try{URL.revokeObjectURL(_photoChoisie.url);}catch(e){}}
  _photoChoisie=null;
  majApercuPhoto();
}
function majApercuPhoto(){
  const bloc=document.getElementById('prob-photo-apercu');
  if(!bloc) return;
  bloc.style.display=_photoChoisie?'block':'none';
  document.getElementById('prob-photo-img').src=_photoChoisie?_photoChoisie.url:'';
  document.getElementById('prob-photo-taille').textContent=_photoChoisie?Math.max(1,Math.round(_photoChoisie.blob.size/1024))+' Ko':'';
  document.getElementById('prob-photo-btn').textContent=_photoChoisie?'📷 Changer la photo':'📷 Ajouter une photo';
}

// ── Lire une photo : liens temporaires signés ──────────
// Lien déjà connu, sinon null (et la photo est mise en file : les liens manquants sont demandés ensemble, puis la fiche est redessinée)
function photoUrl(chemin){
  const c=_urlsPhotos[chemin];
  if(c&&c.jusqua>Date.now()) return c.url;
  _photosAResoudre.add(chemin);
  return null;
}
async function resoudrePhotos(){
  if(_resolutionEnCours||!_photosAResoudre.size) return;
  _resolutionEnCours=true;
  const liste=Array.from(_photosAResoudre);
  _photosAResoudre.clear();
  try{
    const r=await db.storage.from(BUCKET_PHOTOS).createSignedUrls(liste,PHOTO_VALIDE_S);
    const lignes=(!r.error&&Array.isArray(r.data))?r.data:[];
    liste.forEach(ch=>{
      const l=lignes.find(x=>x.path===ch);
      const bon=!!(l&&l.signedUrl&&!l.error);
      _urlsPhotos[ch]={url:bon?l.signedUrl:null,jusqua:Date.now()+(bon?(PHOTO_VALIDE_S-600)*1000:60000)};
    });
  }catch(e){
    liste.forEach(ch=>{_urlsPhotos[ch]={url:null,jusqua:Date.now()+60000};});
  }
  _resolutionEnCours=false;
  if(currentUser) majCarte();
}
function planifierResolutionPhotos(){
  if(_photosAResoudre.size&&!_resolutionEnCours) resoudrePhotos();
}
// Un lien pour UNE photo (visionneuse, panneau administrateur)
async function urlPhotoAsync(chemin){
  const c=_urlsPhotos[chemin];
  if(c&&c.jusqua>Date.now()&&c.url) return c.url;
  try{
    const r=await db.storage.from(BUCKET_PHOTOS).createSignedUrl(chemin,PHOTO_VALIDE_S);
    if(!r.error&&r.data&&r.data.signedUrl){
      _urlsPhotos[chemin]={url:r.data.signedUrl,jusqua:Date.now()+(PHOTO_VALIDE_S-600)*1000};
      return r.data.signedUrl;
    }
  }catch(e){}
  return null;
}

// La visionneuse : la photo en grand
async function voirPhoto(chemin){
  const o=document.getElementById('photo-overlay');
  const img=document.getElementById('photo-plein');
  img.src='';
  o.classList.add('open');
  const u=await urlPhotoAsync(chemin);
  if(!o.classList.contains('open')) return;   // fermée pendant le chargement
  if(!u){fermerPhoto();toast('❌ Photo introuvable');return;}
  img.src=u;
}
function fermerPhoto(){
  document.getElementById('photo-overlay').classList.remove('open');
  document.getElementById('photo-plein').src='';
}

// ── Ajouter la photo APRÈS le signalement (elle n'avait pas pu partir) ──
function ajouterPhotoApres(problemeId){
  _photoApresCible=problemeId;
  document.getElementById('prob-photo-apres').click();
}
async function photoApresChoisie(input){
  const f=input&&input.files&&input.files[0];
  const id=_photoApresCible;
  _photoApresCible=null;
  if(!f||!id||_envoiPhotoApres) return;
  _envoiPhotoApres=true;   // un seul envoi à la fois
  try{
    const blob=await reduirePhoto(f);
    showSync(true);
    await envoyerPhotoProbleme(id,blob);
    showSync(false);
    await chargerProblemes();
    renderAll();majCarte();
    toast('📷 Photo ajoutée !');
  }catch(e){
    showSync(false);
    toast(e&&/^(pas_une_photo|photo_illisible|photo_trop_lourde)$/.test(String(e.message))?messagePhoto(e):'❌ Photo non envoyée. Réessaie.');
  }finally{
    _envoiPhotoApres=false;
    try{input.value='';}catch(e){}
  }
}
