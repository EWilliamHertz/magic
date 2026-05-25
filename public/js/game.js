let localCards = {}, draggedCard = null, offsetX = 0, offsetY = 0, handScrollOffset = 0;
let isMulliganPhase = false, cardsToBottom = 0, selectedForBottom = [];
const C_W = 140, C_H = 196;

function startHandScroll(s) { window.hScroll = setInterval(() => { handScrollOffset += s; if(handScrollOffset > 0) handScrollOffset = 0; renderTable(); }, 30); }
function stopHandScroll() { clearInterval(window.hScroll); }
function toggleTools() { const p = document.getElementById('tools-panel'); p.style.display = p.style.display === 'none' ? 'block' : 'none'; }
function updateLife(amt) { db.ref(`lobbies/${currentLobbyId}/players/${currentUser.uid}/life`).transaction(l => (l||20)+amt); }

// The New Strict Zone Logic replaces coordinate sniffing
document.addEventListener('mousemove', e => { if (draggedCard) { const el = document.querySelector(`[data-card-id='${draggedCard}']`); if (el) { el.style.left = `${e.clientX - offsetX}px`; el.style.top = `${e.clientY - offsetY}px`; }}});
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

window.listenToTable = function() { db.ref(`lobbies/${currentLobbyId}/cards`).on('value', snap => { localCards = snap.val() || {}; renderTable(); }); };

function genHTML(data) {
    if (!data.faceUp) return `<div style="width:100%;height:100%;background:radial-gradient(circle,#34495e,#1a252f);border:6px solid #111;border-radius:6px;display:flex;align-items:center;justify-content:center;flex-direction:column;"><span style="color:#f39c12;font-family:Georgia;font-size:20px;font-weight:bold;">MAGIC</span></div>`;
    return `<div style="width:100%;height:100%;display:flex;flex-direction:column;font-family:Georgia;text-align:left;position:relative;">
        ${data.image && data.image !== "none" ? `<div style="position:absolute;top:0;left:0;width:100%;height:100%;background-image:url('${data.image}');background-size:cover;opacity:0.25;z-index:1;"></div>` : ''}
        <div style="position:relative;z-index:2;display:flex;flex-direction:column;height:100%;padding:6px;box-sizing:border-box;">
            <div style="font-weight:bold;font-size:12px;background:#34495e;color:white;padding:4px;">${data.name}</div>
            <div style="font-size:10px;font-weight:bold;padding:2px;background:#bdc3c7;color:#2c3e50;">${data.typeLine || 'Card'}</div>
            <div style="font-size:10px;padding:4px;flex:1;overflow-y:auto;">${data.oracleText ? data.oracleText.replace(/\n/g, '<br>') : ''}</div>
            ${data.pt ? `<div style="text-align:right;font-weight:bold;font-size:12px;padding:4px;background:#ecf0f1;">${data.pt}</div>` : ''}
        </div></div>`;
}

function renderTable() {
    const layer = document.getElementById('card-layer');
    let cArr = Object.entries(localCards).map(([k, v]) => ({ id: k, data: v })).sort((a,b) => (a.data.sortOrder||0) - (b.data.sortOrder||0));
    const currIds = new Set(cArr.map(c => c.id));
    Array.from(layer.children).forEach(ch => { if (!currIds.has(ch.dataset.cardId)) layer.removeChild(ch); });

    let myDeckCount = 0;
    const dkRect = document.getElementById('my-deck-zone').getBoundingClientRect();

    cArr.forEach(({id, data}, i) => {
        if (data.zone === 'sideboard') return;
        if (data.owner === currentUser.uid && data.zone === 'deck') { myDeckCount++; return; } // Don't render deck items individually

        const isMine = data.owner === currentUser.uid, inHand = data.zone === 'hand';
        let rX = isMine ? data.x + (inHand ? handScrollOffset : 0) : window.innerWidth - data.x - C_W;
        let rY = isMine ? data.y : window.innerHeight - data.y - C_H;

        let el = layer.querySelector(`[data-card-id='${id}']`);
        if (!el) {
            el = document.createElement('div'); el.dataset.cardId = id; layer.appendChild(el);
            el.onmousedown = e => {
                if(e.button!==0) return;
                if(isMulliganPhase && inHand && isMine && cardsToBottom > 0) {
                    if(selectedForBottom.includes(id)) selectedForBottom = selectedForBottom.filter(c => c !== id);
                    else if(selectedForBottom.length < cardsToBottom) selectedForBottom.push(id);
                    document.getElementById('btn-confirm-bottom').innerText = `Confirm Bottom (${selectedForBottom.length}/${cardsToBottom})`;
                    renderTable(); return;
                }
                draggedCard = id; draggedCardOwner = data.owner;
                offsetX = e.clientX - parseFloat(el.style.left||0); offsetY = e.clientY - parseFloat(el.style.top||0);
                el.style.zIndex = 10000; e.preventDefault();
            };
            el.ondblclick = e => {
                e.stopPropagation();
                if (isMine && inHand) {
                    const topHalf = /Creature|Planeswalker/.test(data.typeLine || "");
                    db.ref(`lobbies/${currentLobbyId}/cards/${id}`).update({ zone: 'battlefield', x: window.innerWidth/2 - 100 + Math.random()*150, y: topHalf ? window.innerHeight/2 - 150 : window.innerHeight/2 + 50, faceUp: true });
                } else if (isMine && data.zone === 'battlefield') db.ref(`lobbies/${currentLobbyId}/cards/${id}`).update({ tapped: !localCards[id].tapped });
            };
            el.oncontextmenu = e => { e.preventDefault(); if(isMine && !draggedCard){ window.contextCardId = id; window.contextCardData = localCards[id]; const m = document.getElementById('context-menu'); m.style.display = 'block'; m.style.left = e.clientX+'px'; m.style.top = e.clientY+'px'; }};
        }

        if (draggedCard !== id) {
            el.className = 'card' + (inHand && isMine ? ' hand-card' : '');
            el.style.left = `${rX}px`; el.style.top = `${rY}px`;
            el.style.zIndex = i + (inHand ? 1000 : 10);
            el.innerHTML = generateCardFaceHTML(data);
            el.style.transform = data.tapped ? 'rotate(90deg)' : 'rotate(0deg)';
            
            if (selectedForBottom.includes(id)) { el.style.transform += ' translateY(-30px)'; el.style.boxShadow = '0 0 20px #e74c3c'; el.style.border = '2px solid #e74c3c'; el.style.zIndex = 5001; }
        }
    });

    document.getElementById('deck-counter').innerText = myDeckCount;
    // Render the Top Deck Card visually static on the zone
    if (myDeckCount > 0 && !draggedCard) {
        document.getElementById('my-deck-zone').style.backgroundImage = `url('/api/card-image?url=https://upload.wikimedia.org/wikipedia/en/a/aa/Magic_the_gathering_card_back.jpg')`;
        document.getElementById('my-deck-zone').style.backgroundSize = 'cover';
    } else {
        document.getElementById('my-deck-zone').style.backgroundImage = 'none';
    }
}

// Menus
function contextAction(act) {
    if(!window.contextCardId) return; const ref = db.ref(`lobbies/${currentLobbyId}/cards/${window.contextCardId}`);
    if(act==='flip') ref.update({ faceUp: !window.contextCardData.faceUp });
    else if(act==='add-counter') ref.update({ counters: (window.contextCardData.counters || 0) + 1 });
    else if(act==='sub-counter') ref.update({ counters: (window.contextCardData.counters || 0) - 1 });
    else if(act==='hand') ref.update({ zone: 'hand', x: 100, y: window.innerHeight - 150, faceUp: true, tapped: false });
    else if(act==='deck') ref.update({ zone: 'deck', faceUp: false, tapped: false, sortOrder: Math.random() });
    else if(act==='bottom') ref.update({ zone: 'deck', faceUp: false, tapped: false, sortOrder: 99999 + Math.random() });
    else if(act==='grave') ref.update({ zone: 'graveyard', x: document.getElementById('my-grave-zone').getBoundingClientRect().left, y: document.getElementById('my-grave-zone').getBoundingClientRect().top, faceUp: true, tapped: false });
    else if(act==='exile') ref.update({ zone: 'exile', x: document.getElementById('my-exile-zone').getBoundingClientRect().left, y: document.getElementById('my-exile-zone').getBoundingClientRect().top, faceUp: true, tapped: false });
    document.getElementById('context-menu').style.display = 'none';
}

function untapAll() { let upd={}; Object.keys(localCards).forEach(k => { if(localCards[k].owner === currentUser.uid && localCards[k].tapped) upd[`${k}/tapped`] = false; }); if(Object.keys(upd).length>0) db.ref(`lobbies/${currentLobbyId}/cards`).update(upd); }
function spawnToken() {
    db.ref(`lobbies/${currentLobbyId}/cards`).push({ name: document.getElementById('token-name').value || "Token", image: "none", typeLine: "Token", oracleText: document.getElementById('token-oracle').value, pt: document.getElementById('token-pt').value, x: 200, y: 200, zone: 'battlefield', owner: currentUser.uid, faceUp: true, tapped: false, counters: 0, sortOrder: Date.now() });
    document.getElementById('token-name').value = ''; document.getElementById('token-oracle').value = ''; document.getElementById('token-pt').value = ''; toggleTools(); notify("Token Created");
}
function rollD20() { notify(`Rolled D20: ${Math.floor(Math.random()*20)+1}`, "info"); toggleTools(); }

// Mulligan & Deck
async function importSavedDeck() {
    const did = document.getElementById('playmat-deck-select').value; if(!did) return;
    document.getElementById('spawn-modal').style.display = 'none'; notify("Fetching MTG API Data...", "info");
    
    let cards = [];
    for (let l of userDecks[did].list.split('\n')) {
        l = l.trim(); if(!l) continue;
        if(l.toLowerCase().includes('sideboard')) continue; // Skip SB for now in main parser
        const match = l.match(/^(\d+)\s+(.+)$/);
        if(match) {
            try {
                const res = await fetch(`/api/card-data?fuzzy=${encodeURIComponent(match[2].trim())}`);
                const json = res.ok ? await res.json() : { name: match[2] };
                for(let i=0; i<parseInt(match[1]); i++) cards.push({ name: json.name||match[2], image: json.image_url||"none", oracleText: json.oracle_text, typeLine: json.type_line, pt: json.power ? `${json.power}/${json.toughness}` : "", zone: 'deck' });
            } catch(e) {}
        }
    }
    for(let i=cards.length-1; i>0; i--) { const j = Math.floor(Math.random()*(i+1)); [cards[i], cards[j]] = [cards[j], cards[i]]; } 
    
    const upd = {}; cards.forEach((c, i) => { upd[`lobbies/${currentLobbyId}/cards/${Date.now()+i}`] = { ...c, owner: currentUser.uid, faceUp: false, tapped: false, sortOrder: Math.random() }; });
    db.ref().update(upd).then(() => { notify("Deck Spawned", "success"); document.getElementById('game-start-controls').style.display = 'flex'; document.getElementById('btn-draw-hand').style.display = 'block'; });
}

function handleDrawHandClick() { document.getElementById('btn-draw-hand').style.display = 'none'; document.getElementById('mulligan-controls').style.display = 'flex'; isMulliganPhase = true; drawCardsLogic(7); }
function drawCard() { if (isMulliganPhase) return notify("Cannot draw during mulligan phase!", "error"); drawCardsLogic(1); }

function drawCardsLogic(amt) {
    let d = Object.entries(localCards).filter(([,v]) => v.owner === currentUser.uid && v.zone === 'deck').sort((a,b) => (a[1].sortOrder||0) - (b[1].sortOrder||0));
    let hCount = Object.values(localCards).filter(v => v.owner === currentUser.uid && v.zone === 'hand').length;
    if(d.length < amt) return notify("Empty Library", "error");
    
    const upd = {};
    for(let i=0; i<amt; i++) { upd[`lobbies/${currentLobbyId}/cards/${d[i][0]}/zone`] = 'hand'; upd[`lobbies/${currentLobbyId}/cards/${d[i][0]}/x`] = 100 + ((hCount+i)*120); upd[`lobbies/${currentLobbyId}/cards/${d[i][0]}/y`] = window.innerHeight - 150; upd[`lobbies/${currentLobbyId}/cards/${d[i][0]}/faceUp`] = true; }
    db.ref().update(upd);
}

function takeMulligan() {
    if(cardsToBottom > 0) return notify("Confirm bottoms first!", "error");
    mulliganCount++; cardsToBottom = mulliganCount; selectedForBottom = [];
    const upd = {};
    Object.keys(localCards).forEach(k => { if(localCards[k].owner === currentUser.uid && localCards[k].zone === 'hand') { upd[`${k}/zone`] = 'deck'; upd[`${k}/faceUp`] = false; upd[`${k}/sortOrder`] = Math.random(); } });
    db.ref(`lobbies/${currentLobbyId}/cards`).update(upd).then(() => { 
        drawCardsLogic(7); 
        document.getElementById('mulligan-instructions').innerText = `Select exactly ${cardsToBottom} card(s) to bottom.`; 
        document.getElementById('btn-keep-hand').style.display = 'none'; document.getElementById('btn-confirm-bottom').style.display = 'block'; document.getElementById('btn-confirm-bottom').innerText = `Confirm Bottom (0/${cardsToBottom})`;
    });
}

function confirmBottom() {
    if (selectedForBottom.length !== cardsToBottom) return notify(`Select exactly ${cardsToBottom} card(s).`, "error");
    const upd = {};
    selectedForBottom.forEach((id, idx) => { upd[`lobbies/${currentLobbyId}/cards/${id}/zone`] = 'deck'; upd[`lobbies/${currentLobbyId}/cards/${id}/faceUp`] = false; upd[`lobbies/${currentLobbyId}/cards/${id}/sortOrder`] = 99999 + idx; });
    db.ref(`lobbies/${currentLobbyId}/cards`).update(upd).then(() => {
        cardsToBottom = 0; selectedForBottom = [];
        document.getElementById('btn-confirm-bottom').style.display = 'none'; document.getElementById('btn-keep-hand').style.display = 'block'; document.getElementById('mulligan-instructions').innerText = "Keep or Mulligan again.";
    });
}
function keepHand() { if(cardsToBottom > 0) return notify(`Bottom ${cardsToBottom} more card(s)!`, "error"); isMulliganPhase = false; document.getElementById('game-start-controls').style.display = 'none'; notify("Game Started!", "success"); }