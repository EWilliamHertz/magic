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

// FIX 4: Chat input Enter key support
document.addEventListener('DOMContentLoaded', () => {
    const chatInput = document.getElementById('chat-input');
    if (chatInput) {
        chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                sendChatMessage();
            }
        });
    }
});

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
        
        // ROADMAP 4: Spell Announcement (Hand -> Battlefield)
        if(localCards[draggedCard].zone === 'hand' && z === 'battlefield') {
            logAction(`cast ${localCards[draggedCard].name}`);
        }

        db.ref(`lobbies/${currentLobbyId}/cards/${draggedCard}`).update({ x: nX, y: nY, zone: z });
        draggedCard = null;
    }
});
let gameState = {}, playersData = {};

window.listenToTable = function() { 
    db.ref(`lobbies/${currentLobbyId}/cards`).on('value', snap => { localCards = snap.val() || {}; renderTable(); }); 
    
    // Core Game State Listener
    db.ref(`lobbies/${currentLobbyId}/gameState`).on('value', snap => { 
        if(!snap.exists()) return; 
        gameState = snap.val(); 
        window.currentGameState = gameState;
        renderPhaseTracker(); 
        showCombatPanel();
    });
    
    // Player Stats (Mana) Listener
    db.ref(`lobbies/${currentLobbyId}/players`).on('value', snap => { 
        playersData = snap.val() || {}; 
        window.allCards = localCards;
        renderManaPool(); 
        renderOpponentLife();
    });

    // Game Log Listener
    db.ref(`lobbies/${currentLobbyId}/log`).limitToLast(50).on('child_added', snap => {
        const v = snap.val();
        const logEl = document.getElementById('game-log');
        const time = new Date(v.time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        logEl.innerHTML += `<div class="log-entry"><span class="log-time">[${time}]</span> ${v.text}</div>`;
        logEl.scrollTop = logEl.scrollHeight;
    });

    // FIX 3: Listen to opponent board
    listenToOpponentBoard();
    
    // FIX 4: Listen to chat messages
    listenToChat();
};

// ROADMAP 4: Game Actions & Logging
function logAction(msg) {
    const name = document.getElementById('user-display-name').innerText;
    db.ref(`lobbies/${currentLobbyId}/log`).push({ text: `<b>${name}</b> ${msg}`, time: Date.now() });
}

// ROADMAP 5: Mana Pool
function addMana(color, amt = 1) {
    db.ref(`lobbies/${currentLobbyId}/players/${currentUser.uid}/mana/${color}`).transaction(c => Math.max(0, (c || 0) + amt))
      .then(() => { if(amt > 0) logAction(`added {${color}} to mana pool.`); });
}

function removeMana(color) {
    addMana(color, -1);
}
function emptyManaPool(uid) {
    if(uid) db.ref(`lobbies/${currentLobbyId}/players/${uid}/mana`).set({ W:0, U:0, B:0, R:0, G:0, C:0 });
}
function renderManaPool() {
    const myMana = playersData[currentUser.uid]?.mana || {W:0, U:0, B:0, R:0, G:0, C:0};
    Object.keys(myMana).forEach(c => { const el = document.getElementById(`mana-${c}`); if(el) el.innerText = myMana[c]; });
}

// ROADMAP 1 & 2: Phases & Priority
const PHASES = ['untap', 'upkeep', 'draw', 'main1', 'combat', 'main2', 'end'];

function passPriority() {
    if(gameState.priority !== currentUser.uid) return notify("You don't have priority!", "error");
    
    const opponentId = Object.keys(playersData).find(id => id !== currentUser.uid) || currentUser.uid;
    let passed = gameState.passed || {};
    passed[currentUser.uid] = true;

    if (passed[opponentId] || opponentId === currentUser.uid) {
        advancePhase(); // Both passed, proceed
    } else {
        db.ref(`lobbies/${currentLobbyId}/gameState`).update({ priority: opponentId, passed: passed });
        logAction("passed priority.");
    }
}

function advancePhase() {
    if (gameState.turn !== currentUser.uid) return;

    let idx = PHASES.indexOf(gameState.phase);
    let nextPhase = PHASES[idx + 1];
    let nextTurn = gameState.turn;

    if (!nextPhase) {
        nextPhase = 'untap';
        nextTurn = Object.keys(playersData).find(id => id !== currentUser.uid) || currentUser.uid;
        logAction("ended their turn.");
    }

    // ROADMAP 3: Auto-Untap & Auto-Draw
    if (nextTurn === currentUser.uid && nextPhase === 'untap') { untapAll(); logAction("moved to Untap step."); } 
    else if (nextTurn === currentUser.uid && nextPhase === 'draw') { drawCardsLogic(1); logAction("drew a card for turn."); }
    else { logAction(`moved to ${nextPhase.toUpperCase()}`); }

    emptyManaPool(currentUser.uid); // Mana drains on phase transitions

    db.ref(`lobbies/${currentLobbyId}/gameState`).update({
        turn: nextTurn, phase: nextPhase, priority: nextTurn, passed: {}
    });
}

function renderPhaseTracker() {
    const isMyTurn = gameState.turn === currentUser.uid;
    const hasPriority = gameState.priority === currentUser.uid;
    
    const ind = document.getElementById('turn-indicator');
    ind.innerText = isMyTurn ? "Your Turn" : "Opponent's Turn";
    ind.style.color = isMyTurn ? "#2ecc71" : "#e74c3c";
    
    const btn = document.getElementById('btn-pass-priority');
    btn.disabled = !hasPriority;
    btn.innerText = hasPriority ? "Pass Priority" : "Waiting...";
    btn.style.background = hasPriority ? "#2ecc71" : "#7f8c8d";

    PHASES.forEach(p => {
        const el = document.getElementById(`phase-${p}`);
        if(el) {
            if(gameState.phase === p) el.classList.add('active');
            else el.classList.remove('active');
        }
    });
    
    showCombatPanel();
}

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
    const dkRect = document.getElementById('my-deck-zone').getBoundingClientRect();

  cArr.forEach(({id, data}, i) => {
        // FIX: Explicitly destroy the HTML element if it enters the deck or sideboard
        if (data.zone === 'sideboard' || data.zone === 'deck') { 
            if (data.owner === currentUser.uid && data.zone === 'deck') myDeckCount++;
            const staleEl = layer.querySelector(`[data-card-id='${id}']`);
            if (staleEl) staleEl.remove();
            return; 
        }

        const isMine = data.owner === currentUser.uid, inHand = data.zone === 'hand';
        let rX = isMine ? data.x + (inHand ? handScrollOffset : 0) : window.innerWidth - data.x - C_W;
        let rY = isMine ? data.y : window.innerHeight - data.y - C_H;
        if (inHand && isMine) rY = window.innerHeight - 60; // FIX: Show only ~60px of top portion

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

            // Double-click: ONLY hand → battlefield (smart snap), or ONLY battlefield → tap/untap
            el.ondblclick = e => {
    e.stopPropagation();
    const live = localCards[id]; // always read fresh from localCards
    if (!live || live.owner !== currentUser.uid) return;

    if (live.zone === 'hand') {
        const bfH = window.innerHeight - 100;
        const isTopSnap = /Creature|Planeswalker/.test(live.typeLine || '');
        const snapY = isTopSnap
            ? bfH * 0.15 + Math.random() * (bfH * 0.2)
            : bfH * 0.55 + Math.random() * (bfH * 0.2);
        const snapX = 80 + Math.random() * (window.innerWidth - C_W - 160);
        db.ref(`lobbies/${currentLobbyId}/cards/${id}`).update({
            zone: 'battlefield', x: snapX, y: snapY, faceUp: true, tapped: false
        });
    } else if (live.zone === 'battlefield') {
        db.ref(`lobbies/${currentLobbyId}/cards/${id}`).update({ tapped: !live.tapped });
    }
    // graveyard, exile, deck: no double-click action
};
 el.oncontextmenu = e => { e.preventDefault(); if(isMine && !draggedCard){ window.contextCardId = id; window.contextCardData = localCards[id]; const m = document.getElementById('context-menu'); m.style.display = 'block'; m.style.left = e.clientX+'px'; m.style.top = e.clientY+'px'; }};
        }

        // Trigger Zoom Preview on Hover
        if (el) {
            el.onmouseenter = () => {
                const preview = document.getElementById('card-preview-panel');
                preview.style.display = 'block';
                // Force faceUp true so we can read the text even if it's currently face down
                preview.innerHTML = genHTML({...data, faceUp: true}); 
            };
            el.onmouseleave = () => { document.getElementById('card-preview-panel').style.display = 'none'; };
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
        document.getElementById('my-deck-zone').style.backgroundImage = `url('/card-back.png')`;
        document.getElementById('my-deck-zone').style.backgroundSize = 'cover';
    } else {
        document.getElementById('my-deck-zone').style.backgroundImage = 'none';
    }
}

// Context menu actions
function contextAction(act) {
    if(!window.contextCardId) return;
    const ref = db.ref(`lobbies/${currentLobbyId}/cards/${window.contextCardId}`);
    if(act==='tap')           ref.update({ tapped: !window.contextCardData.tapped });
    else if(act==='flip')          ref.update({ faceUp: !window.contextCardData.faceUp });
    else if(act==='add-counter') ref.update({ counters: (window.contextCardData.counters || 0) + 1 });
    else if(act==='sub-counter') ref.update({ counters: (window.contextCardData.counters || 0) - 1 });
else if(act==='hand') {
        let hCount = Object.values(localCards).filter(v => v.owner === currentUser.uid && v.zone === 'hand').length;
        let nX = window.innerWidth/2 - 250 + (hCount * 60);
        ref.update({ zone: 'hand', x: nX, y: window.innerHeight - 150, faceUp: true, tapped: false });
    }    else if(act==='deck')     ref.update({ zone: 'deck', faceUp: false, tapped: false, sortOrder: Math.random() });
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

    let mainboardCards = [];
    let sideboardCards = [];
    const lines = userDecks[did].list.split('\n');
    let isMainboard = true;
    
    for (let l of lines) {
        l = l.trim();
        if(!l) continue;
        
        // Check for sideboard section
        if(l.toLowerCase() === 'sideboard') {
            isMainboard = false;
            continue;
        }
        
        const match = l.match(/^(\d+)\s+(.+)$/);
        if(match) {
            try {
                const res = await fetch(`/api/card-data?fuzzy=${encodeURIComponent(match[2].trim())}`);
                const json = res.ok ? await res.json() : { name: match[2].trim() };
                const cardCount = parseInt(match[1]);
                
                for(let i = 0; i < cardCount; i++) {
                    const cardData = {
                        name: json.name || match[2].trim(),
                        image: json.image_url || 'none',
                        oracleText: json.oracle_text || '',
                        typeLine: json.type_line || '',
                        pt: json.power ? `${json.power}/${json.toughness}` : '',
                        zone: isMainboard ? 'deck' : 'sideboard'
                    };
                    
                    if(isMainboard) {
                        mainboardCards.push(cardData);
                    } else {
                        sideboardCards.push(cardData);
                    }
                }
                // Small delay to respect Scryfall rate limit
                await new Promise(r => setTimeout(r, 80));
            } catch(e) {
                const cardData = { name: match[2].trim(), image: 'none', oracleText: '', typeLine: '', pt: '', zone: isMainboard ? 'deck' : 'sideboard' };
                if(isMainboard) {
                    mainboardCards.push(cardData);
                } else {
                    sideboardCards.push(cardData);
                }
            }
        }
    }

    // Fisher-Yates shuffle mainboard only
    for(let i = mainboardCards.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [mainboardCards[i], mainboardCards[j]] = [mainboardCards[j], mainboardCards[i]];
    }

    // Warn if deck sizes are wrong
    if(mainboardCards.length !== 60) {
        notify(`Warning: Mainboard has ${mainboardCards.length} cards (should be 60)`, 'info');
    }
    if(sideboardCards.length !== 15) {
        notify(`Warning: Sideboard has ${sideboardCards.length} cards (should be 15)`, 'info');
    }

    const upd = {};
    mainboardCards.forEach((c, i) => {
        upd[`lobbies/${currentLobbyId}/cards/${Date.now()}_mb_${i}`] = {
            ...c,
            owner: currentUser.uid,
            faceUp: false,
            tapped: false,
            counters: 0,
            sortOrder: i  // sortOrder = shuffle index → preserves Fisher-Yates order
        };
    });
    
    sideboardCards.forEach((c, i) => {
        upd[`lobbies/${currentLobbyId}/cards/${Date.now()}_sb_${i}`] = {
            ...c,
            owner: currentUser.uid,
            faceUp: false,
            tapped: false,
            counters: 0,
            sortOrder: i
        };
    });

    db.ref().update(upd).then(() => {
        notify(`Deck spawned! (${mainboardCards.length} mainboard, ${sideboardCards.length} sideboard)`, 'success');
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

function drawFromLibrary() {
    if (isMulliganPhase) return notify('Cannot draw during mulligan phase!', 'error');
    drawCard();
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
// --- ROADMAP 7 & UX: LIBRARY TOOLS ---
window.promptMill = function() {
    const x = parseInt(prompt("How many cards to mill?"));
    if (!x || isNaN(x)) return;
    let deck = Object.entries(localCards).filter(([,v]) => v.owner === currentUser.uid && v.zone === 'deck').sort((a,b) => (a[1].sortOrder||0) - (b[1].sortOrder||0));
    if (deck.length < x) return notify("Not enough cards.", "error");
    
    let upd = {};
    const gr = document.getElementById('my-grave-zone').getBoundingClientRect();
    for (let i = 0; i < x; i++) {
        upd[`lobbies/${currentLobbyId}/cards/${deck[i][0]}/zone`] = 'graveyard';
        upd[`lobbies/${currentLobbyId}/cards/${deck[i][0]}/x`] = gr.left;
        upd[`lobbies/${currentLobbyId}/cards/${deck[i][0]}/y`] = gr.top;
        upd[`lobbies/${currentLobbyId}/cards/${deck[i][0]}/faceUp`] = true;
    }
    db.ref().update(upd).then(() => logAction(`milled ${x} cards.`));
};

window.openSearchLibrary = function() {
    const modal = document.getElementById('search-modal');
    const grid = document.getElementById('search-grid');
    grid.innerHTML = '';
    
    let deck = Object.entries(localCards).filter(([,v]) => v.owner === currentUser.uid && v.zone === 'deck').sort((a,b) => (a[1].sortOrder||0) - (b[1].sortOrder||0));
    
    deck.forEach(([id, data]) => {
        const el = document.createElement('div');
        el.style.width = '140px'; el.style.height = '196px'; el.style.position = 'relative';
        el.innerHTML = generateCardFaceHTML({...data, faceUp: true}); 
        
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); display:none; flex-direction:column; justify-content:center; align-items:center; gap:5px; z-index:10; border-radius:6px;';
        overlay.innerHTML = `
            <button style="font-size:11px; padding:5px; width:80%;" onclick="moveFromSearch('${id}', 'hand')">To Hand</button>
            <button style="font-size:11px; padding:5px; width:80%;" onclick="moveFromSearch('${id}', 'battlefield')">To Battlefield</button>
            <button style="font-size:11px; padding:5px; width:80%; background:#e74c3c;" onclick="moveFromSearch('${id}', 'graveyard')">To Grave</button>
        `;
        el.onmouseenter = () => overlay.style.display = 'flex';
        el.onmouseleave = () => overlay.style.display = 'none';
        
        el.appendChild(overlay);
        grid.appendChild(el);
    });
    modal.style.display = 'block';
    logAction("is searching their library.");
};

window.moveFromSearch = function(id, destZone) {
    let nX = 0, nY = 0, faceUp = true;
    if (destZone === 'hand') {
        let hCount = Object.values(localCards).filter(v => v.owner === currentUser.uid && v.zone === 'hand').length;
        nX = window.innerWidth/2 - 250 + (hCount * 60);
        nY = window.innerHeight - 150;
    } else if (destZone === 'battlefield') {
        nX = window.innerWidth/2; nY = window.innerHeight/2;
    } else if (destZone === 'graveyard') {
        const gr = document.getElementById('my-grave-zone').getBoundingClientRect();
        nX = gr.left; nY = gr.top;
    }
    db.ref(`lobbies/${currentLobbyId}/cards/${id}`).update({ zone: destZone, x: nX, y: nY, faceUp: faceUp });
    openSearchLibrary(); // Refresh grid
};

let scryQueue = [];
window.scryCards = function(num) {
    let deck = Object.entries(localCards).filter(([,v]) => v.owner === currentUser.uid && v.zone === 'deck').sort((a,b) => (a[1].sortOrder||0) - (b[1].sortOrder||0));
    if(deck.length < num) return notify("Not enough cards.", "error");
    
    scryQueue = deck.slice(0, num);
    renderScryModal();
    document.getElementById('scry-modal').style.display = 'block';
    logAction(`is scrying ${num}.`);
};

function renderScryModal() {
    const grid = document.getElementById('scry-grid');
    grid.innerHTML = '';
    if(scryQueue.length === 0) {
        document.getElementById('scry-modal').style.display = 'none';
        return;
    }
    const [id, data] = scryQueue[0];
    
    const el = document.createElement('div');
    el.style.width = '200px'; el.style.height = '280px'; el.style.margin = '0 auto';
    el.innerHTML = generateCardFaceHTML({...data, faceUp: true});
    grid.appendChild(el);
    
    grid.innerHTML += `
        <div style="margin-top:15px; display:flex; gap:10px; justify-content:center;">
            <button onclick="resolveScry('${id}', 'top')">Keep on Top</button>
            <button onclick="resolveScry('${id}', 'bottom')" style="background:#e74c3c;">Put on Bottom</button>
        </div>
    `;
}

window.resolveScry = function(id, pos) {
    scryQueue.shift();
    if (pos === 'bottom') db.ref(`lobbies/${currentLobbyId}/cards/${id}`).update({ sortOrder: 99999 + Math.random() });
    renderScryModal();
};

// --- ROADMAP 1: MID-GAME SIDEBOARDING (BO3) ---
// This hooks into your existing Game Over listener
function triggerGameOver(loser) {
    document.getElementById('sideboard-modal').style.display = 'flex';
    renderSideboardUI();
    logAction(`Game Over. ${loser} was defeated. Entering sideboarding phase.`);
}

function renderSideboardUI() {
    const mbGrid = document.getElementById('sb-mainboard');
    const sbGrid = document.getElementById('sb-sideboard');
    mbGrid.innerHTML = ''; sbGrid.innerHTML = '';
    
    let mbCount = 0; let sbCount = 0;
    
    Object.entries(localCards).forEach(([id, data]) => {
        if(data.owner !== currentUser.uid) return;
        
        const el = document.createElement('div');
        el.style.width = '100px'; el.style.height = '140px'; el.style.cursor = 'pointer';
        el.innerHTML = generateCardFaceHTML({...data, faceUp: true});
        
        if (data.zone === 'sideboard') {
            sbCount++;
            el.onclick = () => { db.ref(`lobbies/${currentLobbyId}/cards/${id}`).update({ zone: 'deck', faceUp: false }); setTimeout(renderSideboardUI, 100); };
            sbGrid.appendChild(el);
        } else {
            mbCount++;
            el.onclick = () => { db.ref(`lobbies/${currentLobbyId}/cards/${id}`).update({ zone: 'sideboard', faceUp: true }); setTimeout(renderSideboardUI, 100); };
            mbGrid.appendChild(el);
        }
    });
    document.getElementById('mb-count').innerText = mbCount;
    document.getElementById('sb-count').innerText = sbCount;
}

window.submitSideboardAndRematch = function() {
    const upd = {};
    const dX = document.getElementById('my-deck-zone').getBoundingClientRect().left;
    const dY = document.getElementById('my-deck-zone').getBoundingClientRect().top;
    
    Object.entries(localCards).forEach(([id, data]) => {
        if(data.owner !== currentUser.uid) return;
        if(data.zone !== 'sideboard') {
            upd[`lobbies/${currentLobbyId}/cards/${id}/zone`] = 'deck';
            upd[`lobbies/${currentLobbyId}/cards/${id}/x`] = dX;
            upd[`lobbies/${currentLobbyId}/cards/${id}/y`] = dY;
            upd[`lobbies/${currentLobbyId}/cards/${id}/faceUp`] = false;
            upd[`lobbies/${currentLobbyId}/cards/${id}/tapped`] = false;
            upd[`lobbies/${currentLobbyId}/cards/${id}/counters`] = 0;
            upd[`lobbies/${currentLobbyId}/cards/${id}/sortOrder`] = Math.random(); // Auto Shuffle
        }
    });
    
    db.ref().update(upd).then(() => {
        db.ref(`lobbies/${currentLobbyId}/players/${currentUser.uid}`).update({ life: 20 });
        document.getElementById('sideboard-modal').style.display = 'none';
        document.getElementById('game-start-controls').style.display = 'flex';
        document.getElementById('btn-draw-hand').style.display = 'block';
        notify("Deck submitted! Ready for Game 2.", "success");
        logAction("finished sideboarding and is ready.");
    });
};
// --- Draggable & Minimizable Game Log ---
let logDrag = false, logX = 0, logY = 0;
const logContainer = document.getElementById('game-log-container');
const logHandle = document.getElementById('log-drag-handle');

if (logHandle) {
    logHandle.addEventListener('mousedown', (e) => {
        if (e.target.id === 'log-toggle-icon') return; // Don't drag if clicking minimize
        logDrag = true;
        const rect = logContainer.getBoundingClientRect();
        logX = e.clientX - rect.left;
        logY = e.clientY - rect.top;
        logContainer.style.right = 'auto'; // Break free from right-alignment
    });
}

document.addEventListener('mousemove', (e) => {
    if (!logDrag) return;
    logContainer.style.left = (e.clientX - logX) + 'px';
    logContainer.style.top = (e.clientY - logY) + 'px';
});

document.addEventListener('mouseup', () => logDrag = false);

window.toggleLog = function() {
    const content = document.getElementById('game-log');
    const icon = document.getElementById('log-toggle-icon');
    if (content.style.display === 'none') {
        content.style.display = 'flex';
        icon.innerText = '▼';
    } else {
        content.style.display = 'none';
        icon.innerText = '▲';
    }
};
// --- ROADMAP 7: Graveyard / Exile Viewer ---
window.openZoneViewer = function(zoneName, ownerId) {
    const modal = document.getElementById('zone-viewer-modal');
    const grid = document.getElementById('zone-viewer-grid');
    document.getElementById('zone-viewer-title').innerText = zoneName.toUpperCase();
    grid.innerHTML = '';
    
    let cardsInZone = Object.entries(localCards).filter(([,v]) => v.owner === ownerId && v.zone === zoneName);
    
    cardsInZone.forEach(([id, data]) => {
        const el = document.createElement('div');
        el.style.width = '140px'; el.style.height = '196px'; el.style.position = 'relative';
        el.innerHTML = generateCardFaceHTML({...data, faceUp: true}); 
        
        if (ownerId === currentUser.uid) {
            const overlay = document.createElement('div');
            overlay.style.cssText = 'position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.8); display:none; flex-direction:column; justify-content:center; align-items:center; gap:5px; z-index:10; border-radius:6px;';
            overlay.innerHTML = `
                <button style="font-size:11px; padding:5px; width:80%;" onclick="moveFromViewer('${id}', 'hand')">To Hand</button>
                <button style="font-size:11px; padding:5px; width:80%;" onclick="moveFromViewer('${id}', 'battlefield')">To Battlefield</button>
            `;
            el.onmouseenter = () => overlay.style.display = 'flex';
            el.onmouseleave = () => overlay.style.display = 'none';
            el.appendChild(overlay);
        }
        grid.appendChild(el);
    });
    modal.style.display = 'block';
};

window.moveFromViewer = function(id, destZone) {
    let nX = 0, nY = 0;
    if (destZone === 'hand') {
        let hCount = Object.values(localCards).filter(v => v.owner === currentUser.uid && v.zone === 'hand').length;
        nX = window.innerWidth/2 - 250 + (hCount * 60);
        nY = window.innerHeight - 150;
    } else if (destZone === 'battlefield') {
        nX = window.innerWidth/2; nY = window.innerHeight/2;
    }
    db.ref(`lobbies/${currentLobbyId}/cards/${id}`).update({ zone: destZone, x: nX, y: nY, faceUp: true });
    document.getElementById('zone-viewer-modal').style.display = 'none';
};

// FIX 8: showLibraryMenu context menu
window.showLibraryMenu = function(event) {
    const menu = document.getElementById('library-menu');
    menu.style.display = 'block';
    menu.style.left = event.clientX + 'px';
    menu.style.top = event.clientY + 'px';
};

// FIX 8: Helper function to hide all menus
function hideMenus() {
    document.getElementById('context-menu').style.display = 'none';
    document.getElementById('library-menu').style.display = 'none';
}

// FIX 9: Card preview popup when hovering
function showCardPreview(cardData, x, y) {
    if(!cardData) return;
    const preview = document.getElementById('card-preview-panel');
    preview.innerHTML = generateCardFaceHTML({...cardData, faceUp: true});
    preview.style.display = 'block';
    
    // Position popup so it doesn't go off-screen
    let posX = x + 10;
    let posY = y + 10;
    
    // Adjust if would go off-screen
    if(posX + 220 > window.innerWidth) posX = window.innerWidth - 220 - 10;
    if(posY + 308 > window.innerHeight) posY = window.innerHeight - 308 - 10;
    
    preview.style.left = posX + 'px';
    preview.style.top = posY + 'px';
}

// FIX 6: Create/use Magic card back image
window.toggleManaPool = function() {
    const pool = document.getElementById('mana-pool');
    pool.style.display = pool.style.display === 'none' ? 'block' : 'none';
};

// Helper function for card generation HTML (used in preview)
function genHTML(data) {
    return generateCardFaceHTML(data);
}

// FIX 3: Listen to opponent board in real-time
function listenToOpponentBoard() {
    const opponentId = Object.keys(playersData || {}).find(id => id !== currentUser.uid);
    if (!opponentId) return;
    
    db.ref(`lobbies/${currentLobbyId}/cards`).on('value', snap => {
        const allCards = snap.val() || {};
        const oppCards = Object.entries(allCards)
            .filter(([, card]) => card.owner === opponentId && card.zone === 'battlefield')
            .map(([id, card]) => ({id, ...card}));
        
        let html = '';
        oppCards.forEach(card => {
            html += `<div style="width:60px; height:90px; background:linear-gradient(135deg, #667eea 0%, #764ba2 100%); border:1px solid #3498db; border-radius:4px; display:flex; align-items:center; justify-content:center; color:white; font-size:0.7em; text-align:center; padding:3px; cursor:not-allowed; opacity:0.8;">${card.name}</div>`;
        });
        document.getElementById('opponent-battlefield').innerHTML = html || '<div style="color:#95a5a6;">No creatures</div>';
        
        // Update zone counters
        const oppDeck = Object.values(allCards).filter(c => c.owner === opponentId && c.zone === 'deck').length;
        const oppGrave = Object.values(allCards).filter(c => c.owner === opponentId && c.zone === 'graveyard').length;
        const oppExile = Object.values(allCards).filter(c => c.owner === opponentId && c.zone === 'exile').length;
        
        document.getElementById('opp-deck-count').innerText = oppDeck;
        document.getElementById('opp-grave-count').innerText = oppGrave;
        document.getElementById('opp-exile-count').innerText = oppExile;
    });
}

// FIX 3: Update opponent life in real-time
function renderOpponentLife() {
    if (!playersData) return;
    const opponentId = Object.keys(playersData).find(id => id !== currentUser.uid);
    if (!opponentId) return;
    
    const oppData = playersData[opponentId];
    const oppName = oppData.name || 'Opponent';
    document.getElementById('opp-name').innerText = oppName;
    document.getElementById('opp-avatar').src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${oppName}`;
    
    const newLife = oppData.life || 20;
    const oldLife = parseInt(document.getElementById('opp-life-total').innerText) || 20;
    
    document.getElementById('opp-life-total').innerText = newLife;
    
    if (newLife < oldLife) {
        document.getElementById('opp-life-total').style.animation = 'pulse 0.5s';
        setTimeout(() => document.getElementById('opp-life-total').style.animation = '', 500);
    }
}

// FIX 4: Send chat message
function sendChatMessage() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    
    const now = new Date();
    const time = now.getHours().toString().padStart(2, '0') + ':' + now.getMinutes().toString().padStart(2, '0');
    
    db.ref(`lobbies/${currentLobbyId}/chat/${Date.now()}`).set({
        author: currentUser.email.split('@')[0],
        message: text,
        time: time,
        uid: currentUser.uid
    });
    
    input.value = '';
    console.log(`[Chat] You said '${text}'`);
}

// FIX 4: Listen to chat messages
function listenToChat() {
    db.ref(`lobbies/${currentLobbyId}/chat`).limitToLast(50).on('child_added', snap => {
        const msg = snap.val();
        const isYours = msg.uid === currentUser.uid;
        const color = isYours ? '#2ecc71' : '#3498db';
        const align = isYours ? 'flex-end' : 'flex-start';
        
        const chatDiv = document.createElement('div');
        chatDiv.style.cssText = `align-self:${align}; background:${color}; color:white; padding:8px 12px; border-radius:8px; max-width:80%; margin:5px 0; word-wrap:break-word;`;
        chatDiv.innerHTML = `<div style="font-size:0.8em; opacity:0.8;">${msg.author} ${msg.time}</div><div>${msg.message}</div>`;
        
        document.getElementById('chat-messages').appendChild(chatDiv);
        document.getElementById('chat-messages').scrollTop = document.getElementById('chat-messages').scrollHeight;
    });
}

// FIX 5: Show combat panel
function showCombatPanel() {
    const gameState = window.currentGameState || {};
    if (gameState.phase === 'combat' && gameState.priority === currentUser.uid) {
        document.getElementById('combat-panel').style.display = 'block';
        renderAttackersList();
    } else {
        document.getElementById('combat-panel').style.display = 'none';
    }
}

// FIX 5: Render list of creatures to attack with
function renderAttackersList() {
    const creatures = Object.values(window.allCards || {})
        .filter(c => c.owner === currentUser.uid && c.zone === 'battlefield' && c.type.includes('Creature'));
    
    let html = '';
    creatures.forEach(c => {
        const isSelected = (window.selectedAttackers || []).includes(c.id);
        html += `<div onclick="toggleAttacker('${c.id}')" style="padding:8px; background:${isSelected ? 'rgba(220,20,60,0.3)' : 'rgba(52,152,219,0.2)'}; border:${isSelected ? '2px solid #e74c3c' : '1px solid #3498db'}; border-radius:4px; margin:5px 0; cursor:pointer; color:#ecf0f1;">${c.name}</div>`;
    });
    document.getElementById('attackers-list').innerHTML = html || '<div style="color:#95a5a6; text-align:center;">No creatures</div>';
}

// FIX 5: Toggle attacker selection
window.selectedAttackers = [];
function toggleAttacker(cardId) {
    const idx = window.selectedAttackers.indexOf(cardId);
    if (idx > -1) {
        window.selectedAttackers.splice(idx, 1);
    } else {
        window.selectedAttackers.push(cardId);
    }
    renderAttackersList();
}

// FIX 5: Declare attackers
function declareAttackers() {
    if (window.selectedAttackers.length === 0) return notify('Select at least one attacker', 'error');
    
    db.ref(`lobbies/${currentLobbyId}/gameState`).update({
        attackers: window.selectedAttackers
    });
    
    notify(`Attacking with ${window.selectedAttackers.length} creature(s)`, 'success');
    window.selectedAttackers = [];
    document.getElementById('combat-panel').style.display = 'none';
    passPriority();
}

// FIX 5: Skip combat
function skipCombat() {
    db.ref(`lobbies/${currentLobbyId}/gameState`).update({
        attackers: []
    });
    window.selectedAttackers = [];
    document.getElementById('combat-panel').style.display = 'none';
    passPriority();
}