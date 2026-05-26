function notify(msg, type = "success") {
    const colors = {
        'success': '#2ecc71',
        'error': '#e74c3c',
        'info': '#3498db'
    };
    const bg = colors[type] || colors.success;
    const duration = type === 'error' ? 5000 : 5000; // Increased from 3.5s to 5s
    
    const t = document.createElement('div'); 
    t.innerText = msg;
    
    // Improved positioning: center-bottom instead of bottom-right
    const boxShadow = type === 'error' 
        ? 'box-shadow: 0 8px 30px rgba(231, 76, 60, 0.4);' 
        : 'box-shadow: 0 8px 30px rgba(46, 204, 113, 0.4);';
    
    t.style.cssText = `position:fixed; bottom:40px; left:50%; transform:translateX(-50%) translateY(30px); background:${bg}; color:white; padding:16px 24px; border-radius:8px; z-index:15000; font-weight:bold; transition:all 0.3s ease; opacity:0; ${boxShadow} font-size:14px;`;
    document.body.appendChild(t);
    
    // Animate in
    setTimeout(() => { 
        t.style.opacity = '1'; 
        t.style.transform = 'translateX(-50%) translateY(0)'; 
    }, 10);
    
    // Animate out
    setTimeout(() => { 
        t.style.opacity = '0'; 
        t.style.transform = 'translateX(-50%) translateY(30px)';
        setTimeout(() => t.remove(), 300); 
    }, duration);
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
        console.log('[Firebase] Starting initialization...');
        const res = await fetch('/api/config'); 
        const cfg = await res.json();
        console.log('[Firebase] Config loaded:', { projectId: cfg.projectId, authDomain: cfg.authDomain });
        
        firebase.initializeApp(cfg); 
        db = firebase.database(); 
        auth = firebase.auth();
        console.log('[Firebase] Initialized successfully');
        
        auth.onAuthStateChanged(u => {
            if(u) { 
                console.log('[Auth] User logged in:', u.email);
                currentUser = u; 
                const name = u.displayName || u.email.split('@')[0];
                document.getElementById('user-display-name').innerText = name; 
                document.getElementById('user-avatar').src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${name}`;
                showScreen('dashboard-screen'); listenToLobbies(); listenToUserDecks(); 
            }
            else { 
                console.log('[Auth] No user logged in');
                currentUser = null; 
                showScreen('landing-screen'); 
            }
        });
    } catch(e) { 
        console.error('[Firebase] Initialization failed:', e);
        notify("Backend Connection Failed", "error"); 
    }
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
    
    // Get button reference and show loading state
    const btn = document.querySelector('[onclick="loginEmail()"]');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Signing in...";
    
    console.log('[Login] Attempting login for:', email);
    
    auth.signInWithEmailAndPassword(email, password)
        .then(result => {
            console.log('[Login] Success for:', email);
            notify("Login successful! Redirecting...", "success");
            btn.textContent = originalText;
            btn.disabled = false;
            // Clear form
            document.getElementById('auth-email-login').value = '';
            document.getElementById('auth-password-login').value = '';
        })
        .catch(e => {
            console.error('[Login] Failed:', e.code, e.message);
            // Provide user-friendly error messages
            let userMessage = e.message;
            if(e.code === 'auth/user-not-found') userMessage = "No account found with that email";
            if(e.code === 'auth/wrong-password') userMessage = "Incorrect password";
            if(e.code === 'auth/invalid-email') userMessage = "Invalid email address";
            if(e.code === 'auth/too-many-requests') userMessage = "Too many login attempts. Try again later.";
            
            notify(userMessage, "error");
            btn.textContent = originalText;
            btn.disabled = false;
        });
}
function registerEmail() { 
    const email = document.getElementById('auth-email-register').value;
    const password = document.getElementById('auth-password-register').value;
    const confirm = document.getElementById('auth-password-confirm').value;
    
    if(!email || !password || !confirm) return notify("Please fill in all fields", "error");
    if(password !== confirm) return notify("Passwords do not match", "error");
    
    // Get button reference and show loading state
    const btn = document.querySelector('[onclick="registerEmail()"]');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Creating account...";
    
    console.log('[Register] Attempting registration for:', email);
    
    auth.createUserWithEmailAndPassword(email, password)
        .then(result => {
            console.log('[Register] Success for:', email);
            notify("Account created! Logging you in...", "success");
            btn.textContent = originalText;
            btn.disabled = false;
            // Clear form
            document.getElementById('auth-email-register').value = '';
            document.getElementById('auth-password-register').value = '';
            document.getElementById('auth-password-confirm').value = '';
            // onAuthStateChanged will automatically log them in
        })
        .catch(e => {
            console.error('[Register] Failed:', e.code, e.message);
            // Provide user-friendly error messages
            let userMessage = e.message;
            if(e.code === 'auth/email-already-in-use') userMessage = "Email already in use. Try logging in instead.";
            if(e.code === 'auth/invalid-email') userMessage = "Invalid email address";
            if(e.code === 'auth/weak-password') userMessage = "Password is too weak (min 6 characters)";
            if(e.code === 'auth/operation-not-allowed') userMessage = "Registration is temporarily disabled";
            
            notify(userMessage, "error");
            btn.textContent = originalText;
            btn.disabled = false;
        });
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
    const format = document.getElementById('lobby-format').value;
    const bestOf = document.getElementById('lobby-best-of')?.value || '1';
    const maxPlayers = parseInt(document.getElementById('lobby-max-players').value);
    
    if(!format) return notify('Please select a format', 'error');
    
    currentLobbyId = db.ref('lobbies').push().key;
    db.ref(`lobbies/${currentLobbyId}`).set({ 
        format, 
        bestOf,
        maxPlayers, 
        hostId: currentUser.uid, 
        status: 'waiting', 
        players: { [currentUser.uid]: { name: currentUser.email, ready: false, life: 20 } } 
    });
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
window.promptNickname = function() {
    const nick = prompt("Enter your new nickname:");
    if (nick && currentUser) {
        currentUser.updateProfile({ displayName: nick }).then(() => {
            document.getElementById('user-display-name').innerText = nick;
            document.getElementById('user-avatar').src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${nick}`;
            notify("Nickname updated!", "success");
        });
    }
};

// FIX 2: Edit profile function
window.editProfile = function() {
    const nick = prompt("Enter your nickname:", document.getElementById('user-display-name').innerText);
    if (nick && currentUser) {
        currentUser.updateProfile({ displayName: nick }).then(() => {
            document.getElementById('user-display-name').innerText = nick;
            document.getElementById('user-avatar').src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${nick}`;
            notify("Profile updated!", "success");
        }).catch(e => notify(e.message, "error"));
    }
};

// FIX 2: Update avatar seed
window.updateAvatarSeed = function() {
    const seed = prompt("Enter avatar seed:", document.getElementById('user-display-name').innerText);
    if(seed) {
        document.getElementById('user-avatar').src = `https://api.dicebear.com/7.x/avataaars/svg?seed=${seed}`;
        notify("Avatar updated!", "success");
    }
};