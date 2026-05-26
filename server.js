require('dotenv').config();
const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

console.log('[Server] Firebase config loaded:', {
    projectId: process.env.FIREBASE_PROJECT_ID,
    authDomain: process.env.FIREBASE_AUTH_DOMAIN,
    databaseUrl: process.env.FIREBASE_DATABASE_URL ? 'configured' : 'missing'
});

app.get('/api/config', (req, res) => {
    console.log('[API] /config requested');
    res.json({
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        databaseURL: process.env.FIREBASE_DATABASE_URL,
        projectId: process.env.FIREBASE_PROJECT_ID
    });
});

// Health check endpoint - verify server and Firebase config are loaded
app.get('/api/health', (req, res) => {
    const firebaseConfig = {
        hasApiKey: !!process.env.FIREBASE_API_KEY,
        hasAuthDomain: !!process.env.FIREBASE_AUTH_DOMAIN,
        hasDatabaseUrl: !!process.env.FIREBASE_DATABASE_URL,
        hasProjectId: !!process.env.FIREBASE_PROJECT_ID
    };
    
    const isHealthy = Object.values(firebaseConfig).every(v => v);
    
    res.status(isHealthy ? 200 : 500).json({
        status: isHealthy ? 'ok' : 'degraded',
        firebase: firebaseConfig,
        projectId: process.env.FIREBASE_PROJECT_ID,
        timestamp: new Date().toISOString()
    });
});

// Test auth endpoint - helps verify Firebase auth is working
app.post('/api/test-auth', (req, res) => {
    const { email, password, action } = req.body;
    
    if (!email || !password || !action) {
        return res.status(400).json({ success: false, message: 'Missing email, password, or action' });
    }
    
    console.log(`[Test Auth] ${action} attempt for: ${email}`);
    
    // We can't actually test auth from Node.js with Firebase, but we can verify config exists
    const hasConfig = process.env.FIREBASE_API_KEY && 
                     process.env.FIREBASE_AUTH_DOMAIN && 
                     process.env.FIREBASE_DATABASE_URL;
    
    if (!hasConfig) {
        return res.status(500).json({ 
            success: false, 
            message: 'Firebase configuration is missing' 
        });
    }
    
    // Return success if config is loaded (actual auth happens in browser)
    res.status(200).json({
        success: true,
        message: `Firebase ${action} auth is ready. Authenticate in the browser.`,
        firebaseConfigured: true
    });
});

// MTG API via Scryfall (reliable, HTTPS, accurate card data)
app.get('/api/card-data', (req, res) => {
    const name = req.query.fuzzy;
    if (!name) return res.status(400).send('Missing name');

    const options = {
        hostname: 'api.scryfall.com',
        path: `/cards/named?fuzzy=${encodeURIComponent(name)}`,
        headers: {
            'User-Agent': 'HatakePlay/1.0 (contact@hatake.se)',
            'Accept': 'application/json'
        }
    };

    https.get(options, (proxyRes) => {
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
            try {
                const card = JSON.parse(data);
                if (card.object === 'error') return res.status(404).json({ name });

                // Handle double-faced cards
                const imageUrl = card.image_uris?.normal
                    || card.card_faces?.[0]?.image_uris?.normal
                    || null;

                const oracleText = card.oracle_text
                    || card.card_faces?.map(f => f.oracle_text).join('\n---\n')
                    || '';

                res.json({
                    name: card.name,
                    type_line: card.type_line || '',
                    oracle_text: oracleText,
                    power: card.power || null,
                    toughness: card.toughness || null,
                    image_url: imageUrl
                });
            } catch (e) {
                res.status(500).send('Parse error');
            }
        });
    }).on('error', e => res.status(500).send(e.message));
});

// Universal Image Proxy — handles HTTP and HTTPS to prevent mixed-content errors
app.get('/api/card-image', (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl || targetUrl === 'none') return res.status(400).send('No URL');

    const client = targetUrl.startsWith('https') ? https : http;
    client.get(targetUrl, { headers: { 'User-Agent': 'HatakePlay/1.0' } }, (proxyRes) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'image/jpeg');
        proxyRes.pipe(res);
    }).on('error', () => res.status(500).send('Image Proxy Error'));
});

app.listen(PORT, () => {
    console.log('╔════════════════════════════════════════╗');
    console.log('║       HatakePlay Engine Started        ║');
    console.log(`║       Port: ${PORT}                          ║`);
    console.log('║                                        ║');
    console.log('║   API Endpoints:                       ║');
    console.log('║   - GET  /api/config (Firebase)       ║');
    console.log('║   - GET  /api/health (Status Check)   ║');
    console.log('║   - POST /api/test-auth (Auth Test)   ║');
    console.log('║   - GET  /api/card-data (Scryfall)    ║');
    console.log('║   - GET  /api/card-image (Proxy)      ║');
    console.log('║                                        ║');
    console.log('╚════════════════════════════════════════╝');
});
