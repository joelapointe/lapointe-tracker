// Serveur de DÉMONSTRATION sur grand écran :  node serveur-demo-pc.mjs [port]     (port par défaut : 8126)
// Sert le dossier www/ tel quel, SAUF vendor/supabase.min.js, remplacé par demo-pc-fausse-base.js : une fausse bibliothèque Supabase
// remplie de données INVENTÉES (clients, arrêts, passes, journal des avis…). Aucune connexion à ta vraie base : ni lecture, ni écriture
// (même le test « le serveur répond-il ? » de l'appli reçoit une fausse réponse). L'application s'ouvre déjà connectée en administrateur.
// Sert seulement sur localhost. Sert à regarder et à régler la mise en page (grand écran, téléphone) avec des données réalistes, sans toucher aux vraies.
// Le fichier de la fausse base est relu à chaque chargement de page : on peut le modifier sans redémarrer le serveur.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const RACINE = path.resolve(fileURLToPath(new URL('../../www/', import.meta.url)));
const FAUSSE_BASE = fileURLToPath(new URL('./demo-pc-fausse-base.js', import.meta.url));
const PORT = Number(process.argv[2]) || 8126;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

http.createServer((req, rep) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  if (url === '/vendor/supabase.min.js') {
    return fs.readFile(FAUSSE_BASE, (err, contenu) => {
      if (err) { rep.writeHead(500); return rep.end('Fausse base introuvable'); }
      rep.writeHead(200, { 'Content-Type': TYPES['.js'], 'Cache-Control': 'no-store' });
      rep.end(contenu);
    });
  }
  const fichier = path.resolve(RACINE, '.' + (url === '/' ? '/index.html' : url));
  if (!fichier.startsWith(RACINE + path.sep) && fichier !== RACINE) { rep.writeHead(403); return rep.end('Interdit'); }
  fs.readFile(fichier, (err, contenu) => {
    if (err) { rep.writeHead(404); return rep.end('Introuvable'); }
    rep.writeHead(200, { 'Content-Type': TYPES[path.extname(fichier)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    rep.end(contenu);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Démonstration sur http://localhost:${PORT}/ (dossier www/ + fausse base de données INVENTÉES : aucune vraie base)`));
