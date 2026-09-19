// Petit serveur local pour essayer l'application (dossier www/) dans un navigateur :  node serveur-www.mjs [port]
// Sert seulement le dossier www/, sur localhost. Aucun accès à autre chose.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const RACINE = path.resolve(fileURLToPath(new URL('../../www/', import.meta.url)));
const PORT = Number(process.argv[2]) || 8123;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

http.createServer((req, rep) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  const fichier = path.resolve(RACINE, '.' + (url === '/' ? '/index.html' : url));
  if (!fichier.startsWith(RACINE + path.sep) && fichier !== RACINE) { rep.writeHead(403); return rep.end('Interdit'); }
  fs.readFile(fichier, (err, contenu) => {
    if (err) { rep.writeHead(404); return rep.end('Introuvable'); }
    rep.writeHead(200, { 'Content-Type': TYPES[path.extname(fichier)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    rep.end(contenu);
  });
}).listen(PORT, '127.0.0.1', () => console.log(`Application sur http://localhost:${PORT}/ (dossier www/)`));
