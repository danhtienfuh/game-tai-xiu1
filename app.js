import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const SUPABASE_URL = 'https://kbsrnizisacobvyupabk.supabase.co'; 
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imtic3JuaXppc2Fjb2J2eXVwYWJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTU4ODAzODAsImV4cCI6MjA3MTQ1NjM4MH0.qaprOno7D7s7l-pfuz3WqVG7-5yTh_GpGsIp-FkiuTE';

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const authScreen = document.getElementById('auth-screen');
const gameScreen = document.getElementById('game-screen');
const authError = document.getElementById('auth-error');

let currentUser = null;
let currentProfile = null;
let selectedBetAmount = 0;
let currentSessionId = null;

const toggleAuthModeBtn = document.getElementById('toggle-auth-mode');
const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');

toggleAuthModeBtn.addEventListener('click', (e) => {
    e.preventDefault();
    loginForm.classList.toggle('hidden');
    registerForm.classList.toggle('hidden');
    const isLogin = !loginForm.classList.contains('hidden');
    document.getElementById('auth-mode-label').textContent = isLogin ? 'Đăng nhập để tiếp tục' : 'Tạo tài khoản mới';
    document.getElementById('toggle-text').textContent = isLogin ? 'Chưa có tài khoản?' : 'Đã có tài khoản?';
    toggleAuthModeBtn.textContent = isLogin ? 'Đăng ký ngay' : 'Đăng nhập ngay';
    authError.textContent = '';
});

registerForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('register-username').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    authError.textContent = '';
    
    const { data, error } = await db.auth.signUp({
        email: email,
        password: password,
        options: {
            data: { 
                username: username,
                balance: 10000000
            }
        }
    });

    if (error) {
        authError.textContent = "Lỗi đăng ký: " + error.message;
    } else {
        document.getElementById('auth-forms').classList.add('hidden');
        document.getElementById('toggle-auth-mode').parentElement.classList.add('hidden');
        document.getElementById('auth-mode-label').textContent = "Đăng ký thành công!";
        authError.className = "text-sm text-green-400 text-center h-auto";
        authError.innerHTML = "Vui lòng kiểm tra hộp thư email của bạn để xác thực tài khoản trước khi đăng nhập.";
    }
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    authError.textContent = '';
    
    const { error } = await db.auth.signInWithPassword({ email, password });
    if (error) authError.textContent = "Lỗi đăng nhập: " + error.message;
});

document.getElementById('logout-button').addEventListener('click', () => {
    db.auth.signOut();
});

// --- Auth State Observer ---
db.auth.onAuthStateChange(async (event, session) => {
    const user = session?.user || null;

    if (user) {
        if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN') {
            currentUser = user;
            await initializeGame();
            authScreen.classList.add('hidden');
            gameScreen.classList.remove('hidden');
        }
    } else { 
        currentUser = null;
        currentProfile = null;
        authScreen.classList.remove('hidden');
        gameScreen.classList.add('hidden');
        db.removeAllChannels();
    }
});

// --- Game Initialization ---
async function initializeGame() {
    if (!currentUser) return;

    const fetchProfile = async (retries = 5) => {
        const { data } = await db.from('profiles').select().eq('id', currentUser.id).single();
        if (data) {
            return data;
        }
        if (retries > 0) {
            // Nếu không tìm thấy profile, đợi 500ms và thử lại
            console.log(`Profile not found, retrying... (${retries} attempts left)`);
            await new Promise(res => setTimeout(res, 500));
            return fetchProfile(retries - 1);
        }
        return null; // Trả về null nếu vẫn không có sau các lần thử
    };

    currentProfile = await fetchProfile();

    // Nếu sau nhiều lần thử vẫn không có profile, lúc này mới đăng xuất
    if (!currentProfile) {
        alert("Không thể tải được thông tin người dùng. Vui lòng thử lại.");
        return db.auth.signOut();
    }
    
    document.getElementById('user-display-name').textContent = currentProfile.username;
    document.getElementById('user-balance').textContent = currentProfile.balance.toLocaleString('vi-VN');
    
    // Hủy các kênh cũ trước khi tạo mới để tránh trùng lặp
    db.removeAllChannels();
    
    // Khởi tạo các kết nối realtime
    listenToProfileChanges();
    listenToGameState();
    setupChat();
    loadRecentSessions();
    loadBetHistory();
    loadRankings();
    setupBettingListeners();
    setupTabListeners();
}

function listenToProfileChanges() {
    db.channel('public:profiles:id=eq.' + currentUser.id)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, payload => {
        currentProfile = payload.new;
        document.getElementById('user-display-name').textContent = currentProfile.username;
        document.getElementById('user-balance').textContent = currentProfile.balance.toLocaleString('vi-VN');
      })
      .subscribe();
}

// --- Game State Logic ---
function listenToGameState() {
    db.channel('public:game_state')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, payload => {
        updateUIFromState(payload.new);
      })
      .subscribe();
    db.from('game_state').select('*').single().then(({ data }) => updateUIFromState(data));
}

function updateUIFromState(state) {
    if (!state) return;
    currentSessionId = state.current_session_id;
    document.getElementById('session-id').textContent = currentSessionId || '...';
    
    const endTime = new Date(state.session_end_time);
    const remainingTime = Math.max(0, Math.round((endTime - Date.now()) / 1000));
    
    updateTimer(remainingTime, state.status);

    if (state.status === 'ended' && currentSessionId) {
        db.from('sessions').select('*').eq('id', currentSessionId).single().then(({data}) => {
            if (data) showResults(data);
        });
    } else {
        resetForNewSession();
    }
}

let countdownInterval;
function updateTimer(seconds, status) {
    clearInterval(countdownInterval);
    const timerEl = document.getElementById('countdown-timer');
    const bettingControls = document.getElementById('betting-controls');
    let timeLeft = seconds;

    if (status === 'betting' && timeLeft > 0) {
        document.getElementById('countdown-container').classList.remove('hidden');
        document.getElementById('dice-result-container').classList.add('hidden');
        bettingControls.style.display = 'block';
        timerEl.textContent = timeLeft;
        countdownInterval = setInterval(() => {
            timeLeft--;
            timerEl.textContent = timeLeft;
            if (timeLeft <= 0) {
                clearInterval(countdownInterval);
                timerEl.textContent = "Chờ kết quả";
                bettingControls.style.display = 'none';
            }
        }, 1000);
    } else {
        timerEl.textContent = status === 'betting' ? "Chờ kết quả" : "Đang chờ phiên mới";
        bettingControls.style.display = 'none';
    }
}

function showResults(session) {
    document.getElementById('countdown-container').classList.add('hidden');
    document.getElementById('dice-result-container').classList.remove('hidden');
    
    const { dice, total, outcome } = session;
    const diceElements = [document.getElementById('dice1'), document.getElementById('dice2'), document.getElementById('dice3')];
    diceElements.forEach(d => d.classList.add('dice-rolling'));

    setTimeout(() => {
        diceElements.forEach((d, i) => {
            d.classList.remove('dice-rolling');
            d.style.backgroundImage = `url('https://www.htmlgames.com/static/dice/d${dice[i]}.svg')`;
        });
        document.getElementById('dice-total').textContent = `${total} - ${outcome}`;
        const lastResultEl = document.getElementById('last-result');
        lastResultEl.textContent = `${total} (${outcome})`;
        lastResultEl.className = outcome === 'TÀI' ? 'text-lg font-bold text-red-400' : 'text-lg font-bold text-blue-400';
    }, 1500);
}

function resetForNewSession() {
    document.getElementById('countdown-container').classList.remove('hidden');
    document.getElementById('dice-result-container').classList.add('hidden');
    document.getElementById('betting-controls').style.display = 'block';
    document.getElementById('bet-message').textContent = '';
    
    [document.getElementById('dice1'), document.getElementById('dice2'), document.getElementById('dice3')].forEach(d => {
        d.style.backgroundImage = '';
    });
    
    document.querySelectorAll('.bet-amount-button.bg-yellow-500').forEach(btn => {
        btn.classList.remove('bg-yellow-500', 'text-gray-900');
    });
    selectedBetAmount = 0;
}

// --- Betting Logic ---
function setupBettingListeners() {
    document.querySelectorAll('.bet-amount-button').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.bet-amount-button').forEach(btn => btn.classList.remove('bg-yellow-500', 'text-gray-900'));
            button.classList.add('bg-yellow-500', 'text-gray-900');
            selectedBetAmount = parseInt(button.dataset.amount);
        });
    });

    document.getElementById('bet-tai-button').addEventListener('click', () => handlePlaceBet('TÀI'));
    document.getElementById('bet-xiu-button').addEventListener('click', () => handlePlaceBet('XỈU'));
}

async function handlePlaceBet(choice) {
    const betMessageEl = document.getElementById('bet-message');
    if (selectedBetAmount <= 0) {
        betMessageEl.textContent = "Vui lòng chọn mức cược!";
        betMessageEl.className = "text-center mt-4 h-5 text-yellow-400 font-semibold";
        return;
    }

    const { data, error } = await db.rpc('place_bet', {
        p_session_id: currentSessionId,
        p_amount: selectedBetAmount,
        p_choice: choice
    });

    if (error || data.startsWith('ERROR')) {
        betMessageEl.textContent = error ? error.message : data;
        betMessageEl.className = "text-center mt-4 h-5 text-red-400 font-semibold";
    } else {
        betMessageEl.textContent = data;
        betMessageEl.className = "text-center mt-4 h-5 text-green-400 font-semibold";
    }
}

// --- Tabs Logic ---
function setupTabListeners() {
    document.querySelectorAll('.tab-button').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.tab-button').forEach(btn => {
                btn.classList.remove('text-gray-300', 'border-indigo-500');
                btn.classList.add('text-gray-500', 'border-transparent');
            });
            button.classList.add('text-gray-300', 'border-indigo-500');
            document.querySelectorAll('.tab-content').forEach(content => {
                content.classList.toggle('hidden', content.id !== `${button.dataset.tab}-tab`);
            });
        });
    });
}

// --- Chat Logic ---
function setupChat() {
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    
    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const message = chatInput.value.trim();
        if (message && currentUser) {
            await db.from('messages').insert({ text: message, username: currentProfile.username, user_id: currentUser.id });
            chatInput.value = '';
        }
    });

    const chatBox = document.getElementById('chat-box');
    db.channel('public:messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        chatBox.innerHTML += renderMessage(payload.new);
        chatBox.scrollTop = chatBox.scrollHeight;
      })
      .subscribe();
      
    db.from('messages').select('*').order('created_at').then(({data}) => {
        if(data) {
            chatBox.innerHTML = data.map(renderMessage).join('');
            chatBox.scrollTop = chatBox.scrollHeight;
        }
    });
}
function renderMessage(msg) {
    if (!currentUser) return '';
    const isCurrentUser = msg.user_id === currentUser.id;
    const usernameColor = isCurrentUser ? 'text-indigo-400' : 'text-green-400';
    return `<div class="text-sm">
                <span class="font-bold ${usernameColor}">${msg.username}:</span>
                <span class="text-gray-300">${msg.text}</span>
            </div>`;
}

// --- Data Loading for Tabs ---
function loadRecentSessions() {
    db.channel('public:sessions').on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sessions' }, () => loadRecentSessionsData()).subscribe();
    loadRecentSessionsData();
}
async function loadRecentSessionsData(){
    const { data } = await db.from('sessions').select('*').order('id', {ascending: false}).limit(50);
    if(data){
        document.getElementById('sessions-list').innerHTML = data.map(s => {
             const outcome = s.outcome;
             return `<div class="w-8 h-8 flex items-center justify-center rounded-full font-bold text-white ${outcome === 'TÀI' ? 'bg-red-600' : 'bg-blue-600'}" title="Phiên #${s.id} - ${s.total}">${outcome === 'TÀI' ? 'T' : 'X'}</div>`;
        }).join('');
    }
}

function loadBetHistory() {
    if (!currentUser) return;
    db.channel('public:bets:user_id=eq.'+currentUser.id).on('postgres_changes', { event: '*', schema: 'public', table: 'bets'}, () => loadBetHistoryData()).subscribe();
    loadBetHistoryData();
}
async function loadBetHistoryData(){
    if (!currentUser) return;
    const { data } = await db.from('bets').select('*').eq('user_id', currentUser.id).order('created_at', {ascending: false}).limit(30);
    const listEl = document.getElementById('history-list');
    if(!data || data.length === 0) {
        listEl.innerHTML = `<li class="text-center text-gray-500">Chưa có lịch sử cược.</li>`;
        return;
    }
    listEl.innerHTML = data.map(bet => {
        const statusClass = bet.status === 'win' ? 'text-green-400' : (bet.status === 'lose' ? 'text-red-400' : 'text-yellow-400');
        const statusText = bet.status === 'win' ? 'Thắng' : (bet.status === 'lose' ? 'Thua' : 'Chờ');
        return `<li class="p-3 bg-gray-700 rounded-lg text-sm">
            <div class="flex justify-between items-center"><span>Phiên #${bet.session_id}</span><span class="font-bold ${statusClass}">${statusText}</span></div>
            <div class="text-gray-400 mt-1">Cược <span class="font-semibold text-white">${bet.choice}</span> với <span class="font-semibold text-yellow-400">${bet.amount.toLocaleString('vi-VN')}</span></div>
         </li>`;
    }).join('');
}

function loadRankings() {
    db.channel('public:profiles').on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => loadRankingsData()).subscribe();
    loadRankingsData();
}
async function loadRankingsData() {
    const { data } = await db.from('profiles').select('*').order('balance', {ascending: false}).limit(20);
    if(data){
        const listEl = document.getElementById('ranking-list');
        const icons = ['fa-trophy text-yellow-400', 'fa-medal text-gray-400', 'fa-award text-yellow-600'];
        listEl.innerHTML = data.map((user, index) => {
            const rank = index + 1;
            const icon = rank <= 3 ? `<i class="fas ${icons[rank-1]} mr-3"></i>` : `<span class="font-bold text-gray-500 w-8 text-center mr-1">${rank}.</span>`;
            return `<li class="flex items-center p-3 bg-gray-900 rounded-lg">
                ${icon}
                <span class="flex-grow font-semibold text-gray-300">${user.username}</span>
                <span class="font-bold text-yellow-400">${user.balance.toLocaleString('vi-VN')}</span>
            </li>`;
        }).join('');
    }
}
