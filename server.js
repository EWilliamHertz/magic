require('dotenv').config();
const express = require('express');
const https = require('https');
const http = require('http');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

app.get('/api/config', (req, res) => {
    res.json({
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        databaseURL: process.env.FIREBASE_DATABASE_URL,
        projectId: process.env.FIREBASE_PROJECT_ID
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

app.listen(PORT, () => console.log(`HatakePlay engine running on port ${PORT}`));
