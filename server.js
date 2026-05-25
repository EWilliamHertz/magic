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

// NEW MTG API PROXY (Bypasses Scryfall Blocks)
app.get('/api/card-data', (req, res) => {
    const name = req.query.fuzzy;
    if (!name) return res.status(400).send('Missing name');
    
    const mtgApiUrl = `https://api.magicthegathering.io/v1/cards?name=${encodeURIComponent(name)}`;
    
    https.get(mtgApiUrl, { headers: { 'User-Agent': 'HatakePlay/1.0' } }, (proxyRes) => {
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
            try {
                const json = JSON.parse(data);
                if (json.cards && json.cards.length > 0) {
                    // Grab exact match if available, otherwise first result
                    const card = json.cards.find(c => c.name.toLowerCase() === name.toLowerCase()) || json.cards[0];
                    res.json({
                        name: card.name,
                        type_line: card.type,
                        oracle_text: card.text,
                        power: card.power,
                        toughness: card.toughness,
                        image_url: card.imageUrl // From Gatherer
                    });
                } else {
                    res.status(404).send('Not found');
                }
            } catch (e) { res.status(500).send('Parse error'); }
        });
    }).on('error', e => res.status(500).send(e.message));
});

// Universal Image Proxy (Handles HTTP and HTTPS seamlessly to prevent mixed-content errors)
app.get('/api/card-image', (req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl || targetUrl === 'none') return res.status(400).send('No URL');
    
    const client = targetUrl.startsWith('https') ? https : http;
    client.get(targetUrl, (proxyRes) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Content-Type', proxyRes.headers['content-type'] || 'image/jpeg');
        proxyRes.pipe(res);
    }).on('error', () => res.status(500).send('Image Proxy Error'));
});

app.listen(PORT, () => console.log(`HatakePlay engine running on port ${PORT}`));