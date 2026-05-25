function notify(msg, type = "success") {
    const t = document.createElement('div'); t.innerText = msg;
    t.style.cssText = `position:fixed; bottom:20px; right:20px; background:${type === 'error' ? '#e74c3c' : '#2ecc71'}; color:white; padding:12px 20px; border-radius:6px; z-index:15000; font-weight:bold; transition:0.3s; opacity:0; transform:translateY(20px);`;
    document.body.appendChild(t);
    setTimeout(() => { t.style.opacity = '1'; t.style.transform = 'translateY(0)'; }, 10);
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 300); }, 3500);
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

function showScreen(id) { document.querySelectorAll('.screen').forEach(s => s.classList.remove('active-screen')); document.getElementById(id).classList.add('active-screen'); }
function loginEmail() { auth.signInWithEmailAndPassword(document.getElementById('auth-email').value, document.getElementById('auth-password').value).catch(e => notify(e.message, "error")); }
function registerEmail() { auth.createUserWithEmailAndPassword(document.getElementById('auth-email').value, document.getElementById('auth-password').value).catch(e => notify(e.message, "error")); }
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
        document.getElementById('user-decks-list').innerHTML = Object.keys(userDecks).map(id => `<div style="background:rgba(0,0,0,0.5); padding:10px; margin-bottom:5px; border-radius:6px; display:flex; justify-content:space-between;"><div><strong style="color:#3498db;">${userDecks[id].name}</strong></div><button onclick="openDeckBuilder('${id}')" style="background:#f39c12; padding:5px; border:none; border-radius:4px;">Edit</button></div>`).join('');
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
        let html = ''; snap.forEach(c => { if(c.val().status === 'waiting') html += `<div style="padding:10px; border:1px solid #34495e; margin-bottom:5px;">Lobby: ${c.val().format} <button onclick="joinLobby('${c.key}')" style="float:right; padding:5px;">Join</button></div>`; });
        document.getElementById('lobbies-list').innerHTML = html;
    });
}
function toggleReadyStrict() { db.ref(`lobbies/${currentLobbyId}/players/${currentUser.uid}/ready`).transaction(s => !s); }

function listenToCurrentLobby() {
    db.ref(`lobbies/${currentLobbyId}`).on('value', snap => {
        const lobby = snap.val(); if(!lobby) return;
        const pArray = Object.entries(lobby.players || {});
        document.getElementById('lobby-players-list').innerHTML = pArray.map(([, data]) => `<div style="color:${data.ready ? '#2ecc71' : '#e74c3c'}; padding:5px;">${data.name} - ${data.ready?'READY':'WAITING'}</div>`).join('');
        
        if (lobby.players[currentUser.uid]) document.getElementById('ready-btn').innerText = lobby.players[currentUser.uid].ready ? "Unready" : "Ready Up";

        if(lobby.status === 'playing') {
            if(!window.gameStarted) { window.gameStarted = true; notify("Match Started!"); showScreen('playmat'); document.getElementById('spawn-modal').style.display='block'; window.listenToTable(); }
        } else if(pArray.length === lobby.maxPlayers && pArray.every(([,p]) => p.ready) && lobby.hostId === currentUser.uid) {
            db.ref(`lobbies/${currentLobbyId}/status`).set('playing');
        }
    });
}