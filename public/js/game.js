let localCards = {}, draggedCard = null, offsetX = 0, offsetY = 0, handScrollOffset = 0;
let isMulliganPhase = false, cardsToBottom = 0, selectedForBottom = [], mulliganCount = 0;
const C_W = 140, C_H = 196;

function startHandScroll(s) { window.hScroll = setInterval(() => { handScrollOffset += s; if(handScrollOffset > 0) handScrollOffset = 0; renderTable(); }, 30); }
function stopHandScroll() { clearInterval(window.hScroll); }
function toggleTools() { const p = document.getElementById('tools-panel'); p.style.display = p.style.display === 'none' ? 'block' : 'none'; }
function updateLife(amt) { db.ref(`lobbies/${currentLobbyId}/players/${currentUser.uid}/life`).transaction(l => (l||20)+amt); }

document.addEventListener('mousemove', e => {
    if (draggedCard) {
        const el = document.querySelector(`[data-card-id='${draggedCard}']`);
        if (el) { el.style.left = `${e.clientX - offsetX}px`; el.style.top = `${e.clientY - offsetY}px`; }
    }
});
document.addEventListener('click', () => { document.getElementById('context-menu').style.display = 'none'; });

document.addEventListener('mouseup', e => {
    if(draggedCard) {
        let nX = e.clientX - offsetX, nY = e.clientY - offsetY, z = 'battlefield';
        if (nY > window.innerHeight - 220) { nX -= handScrollOffset; z = 'hand'; }
        else {
            const gr = document.getElementById('my-grave-zone').getBoundingClientRect();
            const ex = document.getElementById('my-exile-zone').getBoundingClientRect();
            if (Math.abs(nX - gr.left) < 70 && Math.abs(nY - gr.top) < 100) z = 'graveyard';
            else if (Math.abs(nX - ex.left) < 70 && Math.abs(nY - ex.top) < 100) z = 'exile';
        }
        db.ref(`lobbies/${currentLobbyId}/cards/${draggedCard}`).update({ x: nX, y: nY, zone: z });
        draggedCard = null;
    }
});

window.listenToTable = function() {
    db.ref(`lobbies/${currentLobbyId}/cards`).on('value', snap => { localCards = snap.val() || {}; renderTable(); });
};

// Generates card face HTML — shows real card art when available, text layout as fallback
function generateCardFaceHTML(data) {
    if (!data.faceUp) {
        return `<div style="width:100%;height:100%;background:radial-gradient(circle,#34495e,#1a252f);border:6px solid #111;border-radius:6px;display:flex;align-items:center;justify-content:center;flex-direction:column;"><span style="color:#f39c12;font-family:Georgia;font-size:20px;font-weight:bold;">✦ MAGIC ✦</span></div>`;
    }
    if (data.image && data.image !== 'none') {
        const proxyUrl = `/api/card-image?url=${encodeURIComponent(data.image)}`;
        return `<div style="width:100%;height:100%;background-image:url('${proxyUrl}');background-size:cover;background-position:center;border-radius:6px;"></div>`;
    }
    // Text-layout fallback for cards without an image
    return `<div style="width:100%;height:100%;display:flex;flex-direction:column;font-family:Georgia;text-align:left;position:relative;background:#ecf0f1;">
        <div style="position:relative;z-index:2;display:flex;flex-direction:column;height:100%;padding:6px;box-sizing:border-box;">
            <div style="font-weight:bold;font-size:12px;background:#34495e;color:white;padding:4px;border-radius:3px;">${data.name || 'Unknown'}</div>
            <div style="font-size:10px;font-weight:bold;padding:2px 4px;background:#bdc3c7;color:#2c3e50;">${data.typeLine || 'Card'}</div>
            <div style="font-size:10px;padding:4px;flex:1;overflow-y:auto;color:#2c3e50;">${data.oracleText ? data.oracleText.replace(/\n/g, '<br>') : ''}</div>
            ${data.pt ? `<div style="text-align:right;font-weight:bold;font-size:13px;padding:4px;background:#ecf0f1;color:#2c3e50;">${data.pt}</div>` : ''}
        </div>
    </div>`;
}

function renderTable() {
    const layer = document.getElementById('card-layer');
    let cArr = Object.entries(localCards).map(([k, v]) => ({ id: k, data: v })).sort((a,b) => (a.data.sortOrder||0) - (b.data.sortOrder||0));
    const currIds = new Set(cArr.map(c => c.id));
    Array.from(layer.children).forEach(ch => { if (!currIds.has(ch.dataset.cardId)) layer.removeChild(ch); });

    let myDeckCount = 0;

    cArr.forEach(({id, data}, i) => {
        if (data.zone === 'sideboard') return;
        if (data.owner === currentUser.uid && data.zone === 'deck') { myDeckCount++; return; }

        const isMine = data.owner === currentUser.uid, inHand = data.zone === 'hand';
        let rX = isMine ? data.x + (inHand ? handScrollOffset : 0) : window.innerWidth - data.x - C_W;
        let rY = isMine ? data.y : window.innerHeight - data.y - C_H;

        let el = layer.querySelector(`[data-card-id='${id}']`);
        if (!el) {
            el = document.createElement('div');
            el.dataset.cardId = id;
            layer.appendChild(el);

            el.onmousedown = e => {
                if(e.button !== 0) return;
                if(isMulliganPhase && inHand && isMine && cardsToBottom > 0) {
                    if(selectedForBottom.includes(id)) selectedForBottom = selectedForBottom.filter(c => c !== id);
                    else if(selectedForBottom.length < cardsToBottom) selectedForBottom.push(id);
                    document.getElementById('btn-confirm-bottom').innerText = `Confirm Bottom (${selectedForBottom.length}/${cardsToBottom})`;
                    renderTable(); return;
                }
                draggedCard = id;
                offsetX = e.clientX - parseFloat(el.style.left||0);
                offsetY = e.clientY - parseFloat(el.style.top||0);
                el.style.zIndex = 10000;
                e.preventDefault();
            };

            // Double-click: hand → battlefield (smart snap), battlefield → tap/untap
            el.ondblclick = e => {
                e.stopPropagation();
                if (isMine && inHand) {
                    const bfH = window.innerHeight - 220; // battlefield height (above hand zone)
                    const isTopSnap = /Creature|Planeswalker/.test(data.typeLine || '');
                    const snapY = isTopSnap
                        ? bfH * 0.15 + Math.random() * (bfH * 0.2)       // top 15–35%
                        : bfH * 0.55 + Math.random() * (bfH * 0.2);      // bottom 55–75%
                    const snapX = 80 + Math.random() * (window.innerWidth - C_W - 160);
                    db.ref(`lobbies/${currentLobbyId}/cards/${id}`).update({
                        zone: 'battlefield',
                        x: snapX,
                        y: snapY,
                        faceUp: true
                    });
                } else if (isMine && data.zone === 'battlefield') {
                    db.ref(`lobbies/${currentLobbyId}/cards/${id}`).update({ tapped: !localCards[id].tapped });
                }
            };

            el.oncontextmenu = e => {
                e.preventDefault();
                if(isMine && !draggedCard) {
                    window.contextCardId = id;
                    window.contextCardData = localCards[id];
                    const m = document.getElementById('context-menu');
                    m.style.display = 'block';
                    m.style.left = e.clientX + 'px';
                    m.style.top = e.clientY + 'px';
                }
            };
        }

        if (draggedCard !== id) {
            el.className = 'card' + (inHand && isMine ? ' hand-card' : '');
            el.style.left = `${rX}px`;
            el.style.top = `${rY}px`;
            el.style.zIndex = i + (inHand ? 1000 : 10);
            el.style.transform = data.tapped ? 'rotate(90deg)' : 'rotate(0deg)';
            el.innerHTML = generateCardFaceHTML(data);

            // Counter badge
            if (data.counters && data.counters !== 0) {
                const badge = document.createElement('div');
                badge.className = 'counter-badge';
                badge.innerText = data.counters > 0 ? `+${data.counters}` : data.counters;
                el.appendChild(badge);
            }

            if (selectedForBottom.includes(id)) {
                el.style.transform += ' translateY(-30px)';
                el.style.boxShadow = '0 0 20px #e74c3c';
                el.style.border = '2px solid #e74c3c';
                el.style.zIndex = 5001;
            }
        }
    });

    document.getElementById('deck-counter').innerText = myDeckCount;

    if (myDeckCount > 0 && !draggedCard) {
        document.getElementById('my-deck-zone').style.backgroundImage = `url('/api/card-image?url=${encodeURIComponent("https://upload.wikimedia.org/wikipedia/en/a/aa/Magic_the_gathering_card_back.jpg")}')`;
        document.getElementById('my-deck-zone').style.backgroundSize = 'cover';
    } else {
        document.getElementById('my-deck-zone').style.backgroundImage = 'none';
    }
}

// Context menu actions
function contextAction(act) {
    if(!window.contextCardId) return;
    const ref = db.ref(`lobbies/${currentLobbyId}/cards/${window.contextCardId}`);
    if(act==='flip')          ref.update({ faceUp: !window.contextCardData.faceUp });
    else if(act==='add-counter') ref.update({ counters: (window.contextCardData.counters || 0) + 1 });
    else if(act==='sub-counter') ref.update({ counters: (window.contextCardData.counters || 0) - 1 });
    else if(act==='hand')     ref.update({ zone: 'hand', x: 100, y: window.innerHeight - 150, faceUp: true, tapped: false });
    else if(act==='deck')     ref.update({ zone: 'deck', faceUp: false, tapped: false, sortOrder: Math.random() });
    else if(act==='bottom')   ref.update({ zone: 'deck', faceUp: false, tapped: false, sortOrder: 99999 + Math.random() });
    else if(act==='grave')    ref.update({ zone: 'graveyard', x: document.getElementById('my-grave-zone').getBoundingClientRect().left, y: document.getElementById('my-grave-zone').getBoundingClientRect().top, faceUp: true, tapped: false });
    else if(act==='exile')    ref.update({ zone: 'exile', x: document.getElementById('my-exile-zone').getBoundingClientRect().left, y: document.getElementById('my-exile-zone').getBoundingClientRect().top, faceUp: true, tapped: false });
    document.getElementById('context-menu').style.display = 'none';
}

function untapAll() {
    let upd = {};
    Object.keys(localCards).forEach(k => {
        if(localCards[k].owner === currentUser.uid && localCards[k].tapped) upd[`${k}/tapped`] = false;
    });
    if(Object.keys(upd).length > 0) db.ref(`lobbies/${currentLobbyId}/cards`).update(upd);
}

function spawnToken() {
    db.ref(`lobbies/${currentLobbyId}/cards`).push({
        name: document.getElementById('token-name').value || 'Token',
        image: 'none',
        typeLine: 'Token',
        oracleText: document.getElementById('token-oracle').value,
        pt: document.getElementById('token-pt').value,
        x: 200 + Math.random() * 200,
        y: 200 + Math.random() * 100,
        zone: 'battlefield',
        owner: currentUser.uid,
        faceUp: true,
        tapped: false,
        counters: 0,
        sortOrder: Date.now()
    });
    document.getElementById('token-name').value = '';
    document.getElementById('token-oracle').value = '';
    document.getElementById('token-pt').value = '';
    toggleTools();
    notify('Token Created');
}

function rollD20() { notify(`🎲 Rolled D20: ${Math.floor(Math.random()*20)+1}`, 'info'); toggleTools(); }

// Deck import — uses Scryfall via server proxy, sequential with tiny delay to respect rate limits
async function importSavedDeck() {
    const did = document.getElementById('playmat-deck-select').value;
    if(!did) return;
    document.getElementById('spawn-modal').style.display = 'none';
    notify('Fetching card data from Scryfall…', 'info');

    let cards = [];
    const lines = userDecks[did].list.split('\n');
    for (let l of lines) {
        l = l.trim();
        if(!l || l.toLowerCase().startsWith('sideboard')) continue;
        const match = l.match(/^(\d+)\s+(.+)$/);
        if(match) {
            try {
                const res = await fetch(`/api/card-data?fuzzy=${encodeURIComponent(match[2].trim())}`);
                const json = res.ok ? await res.json() : { name: match[2].trim() };
                for(let i = 0; i < parseInt(match[1]); i++) {
                    cards.push({
                        name: json.name || match[2].trim(),
                        image: json.image_url || 'none',
                        oracleText: json.oracle_text || '',
                        typeLine: json.type_line || '',
                        pt: json.power ? `${json.power}/${json.toughness}` : '',
                        zone: 'deck'
                    });
                }
                // Small delay to respect Scryfall rate limit
                await new Promise(r => setTimeout(r, 80));
            } catch(e) {
                cards.push({ name: match[2].trim(), image: 'none', oracleText: '', typeLine: '', pt: '', zone: 'deck' });
            }
        }
    }

    // Fisher-Yates shuffle
    for(let i = cards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cards[i], cards[j]] = [cards[j], cards[i]];
    }

    const upd = {};
    cards.forEach((c, i) => {
        upd[`lobbies/${currentLobbyId}/cards/${Date.now()}_${i}`] = {
            ...c,
            owner: currentUser.uid,
            faceUp: false,
            tapped: false,
            counters: 0,
            sortOrder: i  // sortOrder = shuffle index → preserves Fisher-Yates order
        };
    });

    db.ref().update(upd).then(() => {
        notify(`Deck spawned! (${cards.length} cards)`, 'success');
        document.getElementById('game-start-controls').style.display = 'flex';
        document.getElementById('btn-draw-hand').style.display = 'block';
    });
}

function handleDrawHandClick() {
    document.getElementById('btn-draw-hand').style.display = 'none';
    document.getElementById('mulligan-controls').style.display = 'flex';
    isMulliganPhase = true;
    drawCardsLogic(7);
}

function drawCard() {
    if (isMulliganPhase) return notify('Cannot draw during mulligan phase!', 'error');
    drawCardsLogic(1);
}

function drawCardsLogic(amt) {
    let d = Object.entries(localCards)
        .filter(([,v]) => v.owner === currentUser.uid && v.zone === 'deck')
        .sort((a,b) => (a[1].sortOrder||0) - (b[1].sortOrder||0));
    let hCount = Object.values(localCards).filter(v => v.owner === currentUser.uid && v.zone === 'hand').length;
    if(d.length < amt) return notify('Empty Library!', 'error');

    const upd = {};
    for(let i = 0; i < amt; i++) {
        const key = d[i][0];
        upd[`lobbies/${currentLobbyId}/cards/${key}/zone`] = 'hand';
        upd[`lobbies/${currentLobbyId}/cards/${key}/x`] = 80 + ((hCount + i) * (C_W + 10));
        upd[`lobbies/${currentLobbyId}/cards/${key}/y`] = window.innerHeight - C_H - 10;
        upd[`lobbies/${currentLobbyId}/cards/${key}/faceUp`] = true;
    }
    db.ref().update(upd);
}

function takeMulligan() {
    if(cardsToBottom > 0) return notify('Confirm your bottom cards first!', 'error');
    mulliganCount++;
    cardsToBottom = mulliganCount;
    selectedForBottom = [];

    const upd = {};
    Object.keys(localCards).forEach(k => {
        if(localCards[k].owner === currentUser.uid && localCards[k].zone === 'hand') {
            upd[`${k}/zone`] = 'deck';
            upd[`${k}/faceUp`] = false;
            upd[`${k}/sortOrder`] = Math.random();
        }
    });

    db.ref(`lobbies/${currentLobbyId}/cards`).update(upd).then(() => {
        // Wait briefly for Firebase listener to update localCards before drawing
        setTimeout(() => {
            drawCardsLogic(7);
            document.getElementById('mulligan-instructions').innerText = `Select exactly ${cardsToBottom} card(s) to put on the bottom.`;
            document.getElementById('btn-keep-hand').style.display = 'none';
            document.getElementById('btn-confirm-bottom').style.display = 'block';
            document.getElementById('btn-confirm-bottom').innerText = `Confirm Bottom (0/${cardsToBottom})`;
        }, 300);
    });
}

function confirmBottom() {
    if (selectedForBottom.length !== cardsToBottom) return notify(`Select exactly ${cardsToBottom} card(s).`, 'error');
    const upd = {};
    selectedForBottom.forEach((id, idx) => {
        upd[`lobbies/${currentLobbyId}/cards/${id}/zone`] = 'deck';
        upd[`lobbies/${currentLobbyId}/cards/${id}/faceUp`] = false;
        upd[`lobbies/${currentLobbyId}/cards/${id}/sortOrder`] = 99999 + idx;
    });
    db.ref(`lobbies/${currentLobbyId}/cards`).update(upd).then(() => {
        cardsToBottom = 0;
        selectedForBottom = [];
        document.getElementById('btn-confirm-bottom').style.display = 'none';
        document.getElementById('btn-keep-hand').style.display = 'block';
        document.getElementById('mulligan-instructions').innerText = 'Keep or Mulligan again.';
    });
}

function keepHand() {
    if(cardsToBottom > 0) return notify(`You still need to bottom ${cardsToBottom} card(s)!`, 'error');
    isMulliganPhase = false;
    mulliganCount = 0;
    document.getElementById('game-start-controls').style.display = 'none';
    notify('Game on! Good luck 🃏', 'success');
}
