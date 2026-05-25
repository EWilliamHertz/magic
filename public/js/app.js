function notify(msg, type = "success") {
    const t = document.createElement('div'); t.innerText = msg;
    t.style.cssText = `position:fixed; bottom:20px; right:20px; background:${type === 'error' ? '#e74c3c' : type === 'info' ? '#3498db' : '#2ecc71'}; color:white; padding:12px 20px; border-radius:6px; z-index:15000; font-weight:bold; transition:0.3s; opacity:0; transform:translateY(20px);`;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '1'; t.style.transform = 'translateY(0)'; }, 10);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
}

function switchAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.auth-form').forEach(f => f.classList.remove('active'));
    if(tab === 'login') {
        document.querySelectorAll('.auth-tab')[0].classList.add('active');
        document.getElementById('login-form').classList.add('active');
    } else {
        document.querySelectorAll('.auth-tab')[1].classList.add('active');
        document.getElementById('register-form').classList.add('active');
    }
}

let db, auth, currentUser, currentLobbyId, userDecks = {}, editingDeckId = null;

async function initApp() {
    try {
        const res = await fetch('/api/config'); const cfg = await res.json();
        firebase.initializeApp(cfg); db = firebase.database(); auth = firebase.auth();
        auth.onAuthStateChanged(u => {
            if(u) { currentUser = u; document.getElementById('user-display-name').innerText = u.displayName || u.email; showScreen('dashboard-screen'); listenToLobbies(); listenToUserDecks(); }
            else { currentUser = null; showScreen('landing-screen'); }
        });
    } catch(e) { notify("Backend Connection Failed", "error"); }
}
initApp();

function showScreen(id) {
    document.querySelectorAll('.screen').forEach(s => {
        s.style.display = 'none';
        s.classList.remove('active-screen');
    });
    const target = document.getElementById(id);
    // Use flex for all screens (they're all flex containers)
    target.style.display = 'flex';
    target.classList.add('active-screen');

    if (id === 'playmat') document.body.style.backgroundImage = "url('/playmat.png')";
    else document.body.style.backgroundImage = "none";
}
function loginEmail() { 
    const email = document.getElementById('auth-email-login').value;
    const password = document.getElementById('auth-password-login').value;
    if(!email || !password) return notify("Please fill in all fields", "error");
    auth.signInWithEmailAndPassword(email, password).catch(e => notify(e.message, "error")); 
}
function registerEmail() { 
    const email = document.getElementById('auth-email-register').value;
    const password = document.getElementById('auth-password-register').value;
    const confirm = document.getElementById('auth-password-confirm').value;
    if(!email || !password || !confirm) return notify("Please fill in all fields", "error");
    if(password !== confirm) return notify("Passwords do not match", "error");
    auth.createUserWithEmailAndPassword(email, password).catch(e => notify(e.message, "error")); 
}
function logout() { auth.signOut(); location.reload(); }

function openDeckBuilder(id = null) {
    editingDeckId = id;
    if(id && userDecks[id]) { document.getElementById('new-deck-name').value = userDecks[id].name; document.getElementById('new-deck-list').value = userDecks[id].list; document.getElementById('deck-builder-title').innerText = "Edit Deck"; }
    else { document.getElementById('new-deck-name').value = ''; document.getElementById('new-deck-list').value = ''; document.getElementById('deck-builder-title').innerText = "Create New Deck"; }
    showScreen('deck-builder-screen');
}
function saveDeck() {
    const name = document.getElementById('new-deck-name').value, list = document.getElementById('new-deck-list').value;
    if(!name || !list) return notify("Required fields missing", "error");
    const ref = editingDeckId ? db.ref(`users/${currentUser.uid}/decks/${editingDeckId}`).update({name, list}) : db.ref(`users/${currentUser.uid}/decks`).push({name, list, playtests:0});
    ref.then(() => { notify("Deck saved!"); showScreen('dashboard-screen'); });
}
function listenToUserDecks() {
    db.ref(`users/${currentUser.uid}/decks`).on('value', snap => {
        userDecks = snap.val() || {};
        if(Object.keys(userDecks).length === 0) {
            document.getElementById('user-decks-list').innerHTML = '<div style="text-align:center; color:#95a5a6; padding:20px;">No decks yet. Create one to get started!</div>';
        } else {
            document.getElementById('user-decks-list').innerHTML = Object.keys(userDecks).map(id => `<div class="deck-item"><div class="deck-name">${userDecks[id].name}</div><button onclick="openDeckBuilder('${id}')" style="background:#f39c12; padding:6px 12px; border:none; border-radius:4px; color:white; font-weight:600; cursor:pointer;">Edit</button></div>`).join('');
        }
        document.getElementById('playmat-deck-select').innerHTML = '<option value="">Select Deck...</option>' + Object.keys(userDecks).map(id => `<option value="${id}">${userDecks[id].name}</option>`).join('');
    });
}

function createLobby() {
    const format = document.getElementById('lobby-format').value, maxPlayers = parseInt(document.getElementById('lobby-max-players').value);
    currentLobbyId = db.ref('lobbies').push().key;
    db.ref(`lobbies/${currentLobbyId}`).set({ format, maxPlayers, hostId: currentUser.uid, status: 'waiting', players: { [currentUser.uid]: { name: currentUser.email, ready: false, life: 20 } } });
    showScreen('game-lobby-screen'); listenToCurrentLobby();
}
function joinLobby(id) { currentLobbyId = id; db.ref(`lobbies/${id}/players/${currentUser.uid}`).set({ name: currentUser.email, ready: false, life: 20 }); showScreen('game-lobby-screen'); listenToCurrentLobby(); }
function listenToLobbies() {
    db.ref('lobbies').on('value', snap => {
        let html = '';
        let hasLobbies = false;
        snap.forEach(c => { 
            if(c.val().status === 'waiting') {
                hasLobbies = true;
                const playerCount = Object.keys(c.val().players || {}).length;
                html += `<div class="lobby-item"><div class="lobby-info"><div class="lobby-format">${c.val().format}</div><div style="font-size:0.85em; color:#95a5a6;">${playerCount}/${c.val().maxPlayers} players</div></div><button onclick="joinLobby('${c.key}')">Join</button></div>`; 
            }
        });
        if(!hasLobbies) {
            html = '<div style="text-align:center; color:#95a5a6; padding:20px;">No lobbies available. Create one to get started!</div>';
        }
        document.getElementById('lobbies-list').innerHTML = html;
    });
}
function toggleReadyStrict() { db.ref(`lobbies/${currentLobbyId}/players/${currentUser.uid}/ready`).transaction(s => !s); }

function listenToCurrentLobby() {
    db.ref(`lobbies/${currentLobbyId}`).on('value', snap => {
        const lobby = snap.val(); if(!lobby) return;
        const pArray = Object.entries(lobby.players || {});
        document.getElementById('lobby-players-list').innerHTML = pArray.map(([, data]) => {
            const statusClass = data.ready ? 'ready' : 'waiting';
            const statusText = data.ready ? 'READY' : 'WAITING';
            return `<div class="player-item ${statusClass}"><div class="player-name">${data.name}</div><div class="player-status ${statusClass}">${statusText}</div></div>`;
        }).join('');
        
        if (lobby.players[currentUser.uid]) {
            const btn = document.getElementById('ready-btn');
            if(lobby.players[currentUser.uid].ready) {
                btn.innerText = "Unready";
                btn.classList.add('unready');
            } else {
                btn.innerText = "Ready Up";
                btn.classList.remove('unready');
            }
        }

        if(lobby.status === 'playing') {
            if(!window.gameStarted) { window.gameStarted = true; notify("Match Started!"); showScreen('playmat'); document.getElementById('spawn-modal').style.display='block'; window.listenToTable(); }
        } else if(pArray.length === lobby.maxPlayers && pArray.every(([,p]) => p.ready) && lobby.hostId === currentUser.uid) {
            // Initiate the State Engine
            db.ref(`lobbies/${currentLobbyId}`).update({
                status: 'playing',
                gameState: { turn: currentUser.uid, phase: 'untap', priority: currentUser.uid, passed: {} }
            });
        }
    });
}