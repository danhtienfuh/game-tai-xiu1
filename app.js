const { createClient } = supabase;

// THAY THẾ CÁC GIÁ TRỊ NÀY BẰNG THÔNG TIN CỦA BẠN
const SUPABASE_URL = 'YOUR_SUPABASE_URL'; // URL của bạn
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY'; // Anon key của bạn

const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- DOM Elements ---
const authScreen = document.getElementById('auth-screen');
const gameScreen = document.getElementById('game-screen');
const authError = document.getElementById('auth-error');

let currentUser = null;
let currentProfile = null;
let selectedBetAmount = 0;
let currentSessionId = null;
let realtimeChannel;

// --- Auth Logic ---
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
                balance: 10000000 // Gán số dư ban đầu
            }
        }
    });

    if (error) {
        authError.textContent = "Lỗi đăng ký: " + error.message;
    }
});

loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    authError.textContent = '';
    
    const { data, error } = await db.auth.signInWithPassword({
        email: email,
        password: password,
    });

    if (error) {
        authError.textContent = "Lỗi đăng nhập: " + error.message;
    }
});

document.getElementById('logout-button').addEventListener('click', () => {
    db.auth.signOut();
});

// --- Auth State Observer ---
db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
        currentUser = session.user;
        authScreen.classList.add('hidden');
        gameScreen.classList.remove('hidden');
        await initializeGame();
    } else if (event === 'SIGNED_OUT') {
        currentUser = null;
        currentProfile = null;
        authScreen.classList.remove('hidden');
        gameScreen.classList.add('hidden');
        if (realtimeChannel) {
            db.removeChannel(realtimeChannel);
        }
    }
});

// --- Game Initialization ---
async function initializeGame() {
    if (!currentUser) return;
    
    // Listen for user data changes
    db.channel('public:profiles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles', filter: `id=eq.${currentUser.id}` }, payload => {
        console.log('Profile update received!', payload.new);
        currentProfile = payload.new;
        document.getElementById('user-display-name').textContent = currentProfile.username;
        document.getElementById('user-balance').textContent = currentProfile.balance.toLocaleString('vi-VN');
      })
      .subscribe();
    
    // Fetch initial profile data
    const { data: profileData, error } = await db.from('profiles').select('*').eq('id', currentUser.id).single();
    if (profileData) {
        currentProfile = profileData;
        document.getElementById('user-display-name').textContent = currentProfile.username;
        document.getElementById('user-balance').textContent = currentProfile.balance.toLocaleString('vi-VN');
    }

    listenToGameState();
    setupBettingListeners();
    setupTabListeners();
    setupChat();
    loadRecentSessions();
    loadBetHistory();
    loadRankings();
}

// --- Game State Logic ---
function listenToGameState() {
    db.channel('public:game_state')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state', filter: 'id=eq.1' }, payload => {
        console.log('Game state changed!', payload.new);
        const state = payload.new;
        updateUIFromState(state);
      })
      .subscribe();
      
    // Fetch initial state
    db.from('game_state').select('*').eq('id', 1).single().then(({ data }) => {
        if(data) updateUIFromState(data);
    });
}

function updateUIFromState(state) {
    currentSessionId = state.current_session_id;
    document.getElementById('session-id').textContent = currentSessionId;
    
    const endTime = new Date(state.session_end_time);
    const remainingTime = Math.max(0, Math.round((endTime - Date.now()) / 1000));
    
    updateTimer(remainingTime, state.status);

    if (state.status === 'ended') {
        // Load the session result to show dice
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
    let timeLeft = seconds;

    if (status === 'betting') {
        document.getElementById('countdown-container').classList.remove('hidden');
        document.getElementById('dice-result-container').classList.add('hidden');
        document.getElementById('betting-controls').style.display = 'block';
        timerEl.textContent = timeLeft;
        countdownInterval = setInterval(() => {
            timeLeft--;
            timerEl.textContent = timeLeft;
            if (timeLeft <= 0) {
                clearInterval(countdownInterval);
                timerEl.textContent = "Chờ kết quả";
            }
        }, 1000);
    } else {
        timerEl.textContent = "Đang chờ phiên mới";
        document.getElementById('betting-controls').style.display = 'none';
    }
}

function showResults(session) {
    document.getElementById('countdown-container').classList.add('hidden');
    document.getElementById('dice-result-container').classList.remove('hidden');
    document.getElementById('betting-controls').style.display = 'none';
    
    const dice = session.dice;
    const total = session.total;
    const outcome = session.outcome;

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
    
    const diceElements = [document.getElementById('dice1'), document.getElementById('dice2'), document.getElementById('dice3')];
    diceElements.forEach(d => {
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
            document.querySelectorAll('.bet-amount-button').forEach(btn => {
                btn.classList.remove('bg-yellow-500', 'text-gray-900');
            });
            button.classList.add('bg-yellow-500', 'text-gray-900');
            selectedBetAmount = parseInt(button.dataset.amount);
        });
    });

    document.getElementById('bet-tai-button').addEventListener('click', () => placeBet('TÀI'));
    document.getElementById('bet-xiu-button').addEventListener('click', () => placeBet('XỈU'));
}

async function placeBet(choice) {
    const betMessageEl = document.getElementById('bet-message');
    if (selectedBetAmount <= 0) {
        betMessageEl.textContent = "Vui lòng chọn mức cược!";
        betMessageEl.className = "text-center mt-4 h-5 text-yellow-400 font-semibold";
        return;
    }
    if (selectedBetAmount > currentProfile.balance) {
        betMessageEl.textContent = "Số dư không đủ!";
        betMessageEl.className = "text-center mt-4 h-5 text-red-400 font-semibold";
        return;
    }

    const { error } = await db.from('bets').insert({
        user_id: currentUser.id,
        session_id: currentSessionId,
        amount: selectedBetAmount,
        choice: choice
    });

    if (error) {
        betMessageEl.textContent = "Lỗi đặt cược: " + error.message;
        betMessageEl.className = "text-center mt-4 h-5 text-red-400 font-semibold";
        console.error("Betting failed: ", error);
    } else {
        // Trừ tiền ở client để giao diện phản hồi nhanh, server sẽ tính toán lại sau
        const newBalance = currentProfile.balance - selectedBetAmount;
        await db.from('profiles').update({ balance: newBalance }).eq('id', currentUser.id);

        betMessageEl.textContent = `Đặt cược ${choice} - ${selectedBetAmount.toLocaleString('vi-VN')} thành công!`;
        betMessageEl.className = "text-center mt-4 h-5 text-green-400 font-semibold";
    }
}


// --- Tabs Logic ---
function setupTabListeners() {
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            tabButtons.forEach(btn => {
                btn.classList.remove('text-gray-300', 'border-indigo-500');
                btn.classList.add('text-gray-500', 'border-transparent');
            });
            button.classList.add('text-gray-300', 'border-indigo-500');

            const tabId = button.dataset.tab;
            tabContents.forEach(content => {
                content.classList.toggle('hidden', content.id !== `${tabId}-tab`);
            });
        });
    });
}

// --- Chat Logic ---
function setupChat() {
    const chatForm = document.getElementById('chat-form');
    const chatInput = document.getElementById('chat-input');
    const chatBox = document.getElementById('chat-box');

    chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const message = chatInput.value.trim();
        if (message && currentUser) {
            await db.from('messages').insert({
                text: message,
                username: currentProfile.username,
                user_id: currentUser.id,
            });
            chatInput.value = '';
        }
    });

    db.channel('public:messages')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, payload => {
        const msg = payload.new;
        chatBox.innerHTML += `
            <div class="text-sm">
                <span class="font-bold ${msg.user_id === currentUser.id ? 'text-indigo-400' : 'text-green-400'}">${msg.username}:</span>
                <span class="text-gray-300">${msg.text}</span>
            </div>`;
        chatBox.scrollTop = chatBox.scrollHeight;
      })
      .subscribe();
      
    // Load initial messages
    db.from('messages').select('*').order('created_at', {ascending: false}).limit(50).then(({data}) => {
        chatBox.innerHTML = data.reverse().map(msg => `
            <div class="text-sm">
                <span class="font-bold ${msg.user_id === currentUser.id ? 'text-indigo-400' : 'text-green-400'}">${msg.username}:</span>
                <span class="text-gray-300">${msg.text}</span>
            </div>
        `).join('');
        chatBox.scrollTop = chatBox.scrollHeight;
    });
}

// --- Data Loading for Tabs ---
function loadRecentSessions() {
    db.channel('public:sessions')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'sessions' }, payload => {
        loadRecentSessionsData(); // Reload all on new session
      })
      .subscribe();
    loadRecentSessionsData();
}
async function loadRecentSessionsData(){
    const { data } = await db.from('sessions').select('*').order('created_at', {ascending: false}).limit(50);
    if(data){
        const listEl = document.getElementById('sessions-list');
        listEl.innerHTML = data.map(session => {
             const outcome = session.outcome;
             return `<div class="w-8 h-8 flex items-center justify-center rounded-full font-bold text-white ${outcome === 'TÀI' ? 'bg-red-600' : 'bg-blue-600'}" title="Phiên #${session.id} - ${session.total}">${outcome === 'TÀI' ? 'T' : 'X'}</div>`;
        }).join('');
    }
}

function loadBetHistory() {
     if (!currentUser) return;
     db.channel('public:bets')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bets', filter: `user_id=eq.${currentUser.id}`}, payload => {
        loadBetHistoryData();
      })
      .subscribe();
    loadBetHistoryData();
}
async function loadBetHistoryData(){
    if (!currentUser) return;
    const { data } = await db.from('bets').select('*').eq('user_id', currentUser.id).order('created_at', {ascending: false}).limit(30);
    const listEl = document.getElementById('history-list');
    listEl.innerHTML = '';
    if(!data || data.length === 0) {
        listEl.innerHTML = `<li class="text-center text-gray-500">Chưa có lịch sử cược.</li>`;
        return;
    }
    listEl.innerHTML = data.map(bet => {
        const statusClass = bet.status === 'win' ? 'text-green-400' : (bet.status === 'lose' ? 'text-red-400' : 'text-yellow-400');
        const statusText = bet.status === 'win' ? 'Thắng' : (bet.status === 'lose' ? 'Thua' : 'Chờ');
        return `<li class="p-3 bg-gray-700 rounded-lg text-sm">
            <div class="flex justify-between items-center">
                <span>Phiên #${bet.session_id}</span>
                <span class="font-bold ${statusClass}">${statusText}</span>
            </div>
            <div class="text-gray-400 mt-1">
                Cược <span class="font-semibold text-white">${bet.choice}</span> với 
                <span class="font-semibold text-yellow-400">${bet.amount.toLocaleString('vi-VN')}</span>
            </div>
         </li>`;
    }).join('');
}


function loadRankings() {
    db.channel('public:profiles')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, payload => {
        loadRankingsData();
      })
      .subscribe();
    loadRankingsData();
}
async function loadRankingsData() {
    const { data } = await db.from('profiles').select('*').order('balance', {ascending: false}).limit(20);
    if(data){
        const listEl = document.getElementById('ranking-list');
        listEl.innerHTML = '';
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
