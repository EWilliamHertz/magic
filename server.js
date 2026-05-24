require('dotenv').config();
const express = require('express');
const https = require('https');
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
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
        messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
        appId: process.env.FIREBASE_APP_ID
    });
});

app.route('/api/card-data').get((req, res) => {
    const cardName = req.query.exact;
    if (!cardName) return res.status(400).send('Missing card name');
    
    const scryfallUrl = `https://api.scryfall.com/cards/named?exact=${encodeURIComponent(cardName)}`;
    
    https.get(scryfallUrl, { headers: { 'User-Agent': 'MTGSandbox/1.0' } }, (proxyRes) => {
        let data = '';
        proxyRes.on('data', chunk => data += chunk);
        proxyRes.on('end', () => {
            if (proxyRes.statusCode === 200) res.json(JSON.parse(data));
            else res.status(proxyRes.statusCode).send('Card not found');
        });
    }).on('error', (err) => res.status(500).send(err.message));
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