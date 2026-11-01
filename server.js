const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 8080;
const ROOT_DIR = __dirname;
const DATA_DIR = path.join(ROOT_DIR, 'data', 'museums');

// Ensure data directory exists on startup
fs.mkdirSync(DATA_DIR, { recursive: true });

const MIME_TYPES = {
    '.html': 'text/html; charset=UTF-8',
    '.css': 'text/css; charset=UTF-8',
    '.js': 'application/javascript; charset=UTF-8',
    '.mjs': 'application/javascript; charset=UTF-8',
    '.json': 'application/json; charset=UTF-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4'
};

// --- Helpers ---
function sendJSON(res, statusCode, data) {
    const body = JSON.stringify(data);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json; charset=UTF-8',
        'Access-Control-Allow-Origin': '*',
        'Content-Length': Buffer.byteLength(body)
    });
    res.end(body);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', () => {
            try { resolve(JSON.parse(body || '{}')); }
            catch (e) { reject(new Error('Invalid JSON')); }
        });
        req.on('error', reject);
    });
}

function sanitizeSlug(slug) {
    let s = String(slug || '').toLowerCase().trim().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
    if (!s) s = 'museum-' + Date.now().toString(36);
    return s;
}

// --- API Handlers ---

// GET /api/museums — list all saved personalized museums
function handleListMuseums(res) {
    try {
        const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json'));
        const list = files.map(f => {
            try {
                const raw = fs.readFileSync(path.join(DATA_DIR, f), 'utf-8');
                const d = JSON.parse(raw);
                return { slug: d.slug, for: d.for, createdAt: d.createdAt };
            } catch { return null; }
        }).filter(Boolean);
        sendJSON(res, 200, list);
    } catch (e) {
        sendJSON(res, 500, { error: 'Failed to list museums' });
    }
}

// GET /api/museums/:slug — load a personalized museum
function handleGetMuseum(res, slug) {
    const safe = sanitizeSlug(slug);
    if (!safe) return sendJSON(res, 400, { error: 'Invalid slug' });

    const filePath = path.join(DATA_DIR, `${safe}.json`);
    if (!fs.existsSync(filePath)) return sendJSON(res, 404, { error: 'Museum not found' });

    try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        sendJSON(res, 200, data);
    } catch {
        sendJSON(res, 500, { error: 'Failed to read museum data' });
    }
}

// POST /api/museums — save a personalized museum
async function handleSaveMuseum(req, res) {
    try {
        const body = await readBody(req);
        const slug = sanitizeSlug(body.slug || body.for);
        if (!slug) return sendJSON(res, 400, { error: 'slug or for field is required' });

        const payload = {
            slug,
            for: String(body.for || slug),
            dedication: body.dedication || {},
            artworks: body.artworks || [],
            memories: body.memories || [],
            artworkOverrides: body.artworkOverrides || {},
            customArts: body.customArts || [],
            createdAt: body.createdAt || new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        const filePath = path.join(DATA_DIR, `${slug}.json`);
        fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
        sendJSON(res, 200, { ok: true, slug, link: `/?m=${slug}&for=${encodeURIComponent(payload.for)}` });
    } catch (e) {
        sendJSON(res, 400, { error: e.message });
    }
}

// DELETE /api/museums/:slug
function handleDeleteMuseum(res, slug) {
    const safe = sanitizeSlug(slug);
    const filePath = path.join(DATA_DIR, `${safe}.json`);
    if (!fs.existsSync(filePath)) return sendJSON(res, 404, { error: 'Not found' });
    fs.unlinkSync(filePath);
    sendJSON(res, 200, { ok: true });
}

// --- Main HTTP Server ---
const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, HEAD, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(204); res.end(); return;
    }

    const urlObj = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = urlObj.pathname;

    // ── API Routes ──
    if (pathname === '/api/museums' && req.method === 'GET') {
        return handleListMuseums(res);
    }
    if (pathname === '/api/museums' && req.method === 'POST') {
        return handleSaveMuseum(req, res);
    }
    const museumMatch = pathname.match(/^\/api\/museums\/([^/]+)$/);
    if (museumMatch && req.method === 'GET') {
        return handleGetMuseum(res, museumMatch[1]);
    }
    if (museumMatch && req.method === 'DELETE') {
        return handleDeleteMuseum(res, museumMatch[1]);
    }

    // ── Static File Serving ──
    let reqPath = pathname;
    if (reqPath === '/' || reqPath === '') reqPath = '/index.html';

    const safePath = path.normalize(reqPath).replace(/^(\.\.[\\/])+/, '');
    const filePath = path.join(ROOT_DIR, safePath);
    const resolvedPath = path.resolve(filePath);

    // Prevent directory traversal
    if (!resolvedPath.startsWith(path.resolve(ROOT_DIR))) {
        res.writeHead(403, { 'Content-Type': 'text/plain; charset=UTF-8' });
        res.end('403 Forbidden');
        return;
    }

    fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=UTF-8' });
            res.end('404 Not Found: ' + reqPath);
            return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || 'application/octet-stream';
        const range = req.headers.range;

        if (range && (ext === '.mp3' || ext === '.mp4')) {
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1;
            const chunkSize = (end - start) + 1;
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${stats.size}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunkSize,
                'Content-Type': contentType
            });
            fs.createReadStream(filePath, { start, end }).pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': stats.size,
                'Content-Type': contentType,
                'Accept-Ranges': 'bytes'
            });
            fs.createReadStream(filePath).pipe(res);
        }
    });
});

server.listen(PORT, () => {
    console.log(`\n🏛️  3D Virtual Museum is running!`);
    console.log(`👉 Admin:   http://localhost:${PORT}/`);
    console.log(`📡 API:     http://localhost:${PORT}/api/museums\n`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ Port ${PORT} is already in use. Close the existing server first.`);
    } else {
        console.error('Server error:', err);
    }
});
