require('dotenv').config();
const express = require('express');
const https = require('https');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Cache for MTGJSON data
let mtgjsonCache = {};
let cacheLastUpdated = 0;
const CACHE_DURATION = 3600000; // 1 hour

app.get('/api/config', (req, res) => {
    res.json({
        apiKey: process.env.FIREBASE_API_KEY,
        authDomain: process.env.FIREBASE_AUTH_DOMAIN,
        databaseURL: process.env.FIREBASE_DATABASE_URL,
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID
    });
});

// MTGJSON/Scryfall unified card endpoint
app.route('/api/card-data').get((req, res) => {
    const cardName = req.query.exact;
    if (!cardName) return res.status(400).send('Missing card name');
    
    // Use Scryfall API (official source that aggregates MTGJSON data)
    const scryfallUrl = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}`;
    
    https.get(scryfallUrl, { headers: { 'User-Agent': 'MTGSandbox/1.0' } }, (proxyRes) => {
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
            if (proxyRes.statusCode === 200) {
                try {
                    const cardData = JSON.parse(data);
                    // Return comprehensive card data from MTGJSON/Scryfall
                    const response = {
                        name: cardData.name,
                        image_uris: cardData.image_uris,
                        card_faces: cardData.card_faces,
                        mana_cost: cardData.mana_cost,
                        type_line: cardData.type_line,
                        oracle_text: cardData.oracle_text,
                        power: cardData.power,
                        toughness: cardData.toughness,
                        colors: cardData.colors,
                        set: cardData.set,
                        rarity: cardData.rarity,
                        keywords: cardData.keywords,
                        layout: cardData.layout
                    };
                    res.json(response);
                } catch (e) {
                    res.status(500).json({ error: 'Error parsing card data' });
                }
            } else {
                res.status(proxyRes.statusCode).json({ error: 'Card not found' });
            }
        });
    }).on('error', (err) => res.status(500).json({ error: err.message }));
});

app.route('/api/card-image').get((req, res) => {
    const targetUrl = req.query.url;
    if (!targetUrl || !targetUrl.includes('scryfall.io')) return res.status(400).send('Invalid URL');

    https.get(targetUrl, (proxyRes) => {
        if (proxyRes.statusCode !== 200) return res.status(proxyRes.statusCode).send('Error');
        res.setHeader('Content-Type', proxyRes.headers['content-type']);
        proxyRes.pipe(res);
    }).on('error', (err) => res.status(500).send('Proxy error'));
});

app.listen(PORT, () => console.log(`MTG Sandbox server running on port ${PORT}`));
