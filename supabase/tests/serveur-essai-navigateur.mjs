// Serveur d'ESSAI avec la VRAIE carte (Leaflet) mais SANS vraie base :  node serveur-essai-navigateur.mjs [port]     (port par défaut : 8124)
// Sert le dossier www/ tel quel, SAUF vendor/supabase.min.js, remplacé par une fausse bibliothèque : aucune connexion à ta vraie base Supabase (ni lecture, ni écriture).
// Sert seulement sur localhost. À utiliser pour ce que les tests simulés ne peuvent pas voir : le comportement réel de Leaflet (déplacements de la carte, glissements, zoom,
// bulles, rotation), à l'aide du navigateur d'essai (voir le cahier : « ESSAI DANS LE VRAI LEAFLET »). Pour ouvrir l'écran de l'application sans se connecter : dans la console
// de la page, `document.getElementById('login-screen').classList.remove('show'); currentUser={id:'u-luc',nom:'Luc',role:'employe'};` puis piloter les variables
// (tours, positionsVehicules, stops…) à la main et un faux GPS (Object.defineProperty(navigator,'geolocation',…)). Ne saisir AUCUN mot de passe dans cette page.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const RACINE = path.resolve(fileURLToPath(new URL('../../www/', import.meta.url)));
const PORT = Number(process.argv[2]) || 8124;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
const FAUX_SUPABASE = `
window.supabase={createClient:()=>{
  const chaine=()=>{const c={on:()=>c,subscribe:()=>c};return c;};
  const requete=()=>{const q={select:()=>q,eq:()=>q,is:()=>q,order:()=>q,single:()=>q,maybeSingle:()=>q,insert:()=>q,update:()=>q,delete:()=>q,then:(ok,ko)=>Promise.resolve({data:[],error:null}).then(ok,ko)};return q;};
  return {channel:chaine,from:requete,rpc:async()=>({data:null,error:null}),
    auth:{onAuthStateChange(){},getSession:async()=>({data:{session:null}}),signOut:async()=>({}),signInWithPassword:async()=>({data:null,error:{message:'essai'}})},
    storage:{from:()=>({createSignedUrls:async()=>({data:[],error:null})})}};
}};`;

http.createServer((req, rep) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/vendor/supabase.min.js') { rep.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' }); return rep.end(FAUX_SUPABASE); }
  const fichier = path.resolve(RACINE, '.' + (url === '/' ? '/index.html' : url));
  if (!fichier.startsWith(RACINE + path.sep) && fichier !== RACINE) { rep.writeHead(403); return rep.end('Interdit'); }
  fs.readFile(fichier, (err, contenu) => {
    if (err) { rep.writeHead(404); return rep.end('Introuvable'); }
    rep.writeHead(200, { 'Content-Type': TYPES[path.extname(fichier)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    rep.end(contenu);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Essai sur http://localhost:${PORT}/ (dossier www/ + fausse bibliothèque Supabase : aucune vraie base)`));
