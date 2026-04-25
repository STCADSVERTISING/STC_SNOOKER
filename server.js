const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e8 }); // Allow large base64 strings

const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));

const dataDir = path.join(__dirname, 'data');
const historyFile = path.join(dataDir, 'history.json');
const rosterFile = path.join(dataDir, 'roster.json');

if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir);
if (!fs.existsSync(historyFile)) fs.writeFileSync(historyFile, JSON.stringify([]));
if (!fs.existsSync(rosterFile)) fs.writeFileSync(rosterFile, JSON.stringify(['John Doe', 'Jane Smith', 'Ronnie', 'Judd']));

let matchHistory = JSON.parse(fs.readFileSync(historyFile));
let playersRoster = JSON.parse(fs.readFileSync(rosterFile));

const matchesFile = path.join(dataDir, 'matches.json');
if (!fs.existsSync(matchesFile)) fs.writeFileSync(matchesFile, JSON.stringify([]));

const playersFile = path.join(dataDir, 'players.json');
if (!fs.existsSync(playersFile)) fs.writeFileSync(playersFile, JSON.stringify([]));

const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// REST APIs for Match Setup
app.get('/api/matches', (req, res) => {
    res.json(JSON.parse(fs.readFileSync(matchesFile)));
});

app.post('/api/matches', (req, res) => {
    fs.writeFileSync(matchesFile, JSON.stringify(req.body, null, 2));
    res.json({ success: true });
});

app.get('/api/players', (req, res) => {
    res.json(JSON.parse(fs.readFileSync(playersFile)));
});

app.post('/api/players', (req, res) => {
    fs.writeFileSync(playersFile, JSON.stringify(req.body, null, 2));
    res.json({ success: true });
});

app.post('/api/upload', (req, res) => {
    try {
        const { filename, imageBase64 } = req.body;
        const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
        const filePath = path.join(uploadsDir, filename);
        fs.writeFileSync(filePath, base64Data, 'base64');
        res.json({ success: true, url: 'uploads/' + filename });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

let gameState = {
  player1: { name: 'ผู้เล่น 1', score: 0, frame: 0 },
  player2: { name: 'ผู้เล่น 2', score: 0, frame: 0 },
  activePlayer: 1,
  currentBreak: 0,
  redsLeft: 15,
  maxReds: 15,
  matchFormat: 3,
  gameMode: 'snooker',
  theme: 'theme-default',
  timer: { isRunning: false, startedAt: null, elapsedSeconds: 0 },
  history: [],
  frames: [], // Stores individual frame scores
  playersRoster: playersRoster,
  stats: {
    p1HighestBreak: 0,
    p2HighestBreak: 0,
    p1TotalPoints: 0,
    p2TotalPoints: 0
  },
  summary: {
    show: false,
    matchName: 'การแข่งขัน มาดามสนุ๊กเกอร์ ครั้งที่ 3',
    round: 'รอบ 8 คนสุดท้าย',
    isDoubles: false,
    p1Photo: 'p1.png',
    p2Photo: 'p2.png',
    p3Photo: 'p3.png',
    p4Photo: 'p4.png'
  }
};

io.on('connection', (socket) => {
  socket.emit('updateState', gameState);
  socket.emit('updateHistory', matchHistory);

  socket.on('action', (action) => {
    if (action.type === 'REQ_SCREENSHOT') {
      io.emit('TAKE_SCREENSHOT');
      return;
    }
    processAction(action);
    io.emit('updateState', gameState);
  });
  
  socket.on('SCREENSHOT_DATA', (data) => {
    io.emit('SCREENSHOT_READY', data);
  });
  
  socket.on('requestHistory', () => {
    socket.emit('updateHistory', matchHistory);
  });
});

function processAction(action) {
  const skipHistory = ['UNDO', 'SET_NAME', 'SET_MATCH_FORMAT', 'SET_MAX_REDS', 'TIMER_START', 'TIMER_PAUSE', 'TIMER_RESET', 'ADD_ROSTER', 'DEL_ROSTER', 'SAVE_MATCH', 'SET_THEME'];
  if (!skipHistory.includes(action.type)) {
    const stateCopy = JSON.parse(JSON.stringify({
      player1: gameState.player1,
      player2: gameState.player2,
      activePlayer: gameState.activePlayer,
      currentBreak: gameState.currentBreak,
      redsLeft: gameState.redsLeft,
      stats: gameState.stats,
      frames: gameState.frames,
      summary: gameState.summary
    }));
    gameState.history.push(stateCopy);
    if (gameState.history.length > 50) gameState.history.shift();
  }

  const now = Date.now();

  switch(action.type) {
    case 'ADD_SCORE':
      if (gameState.activePlayer !== action.player) {
        gameState.currentBreak = 0;
      }
      gameState.activePlayer = action.player;
      gameState.currentBreak += action.points;
      
      if (action.player === 1) {
        gameState.player1.score += action.points;
        gameState.stats.p1TotalPoints += action.points;
        if (gameState.currentBreak > gameState.stats.p1HighestBreak) gameState.stats.p1HighestBreak = gameState.currentBreak;
      }
      if (action.player === 2) {
        gameState.player2.score += action.points;
        gameState.stats.p2TotalPoints += action.points;
        if (gameState.currentBreak > gameState.stats.p2HighestBreak) gameState.stats.p2HighestBreak = gameState.currentBreak;
      }

      if (action.points === 1 && !action.isFreeBall && gameState.redsLeft > 0) {
        gameState.redsLeft -= 1;
      }
      break;

    case 'FOUL':
      const opponent = action.player === 1 ? 2 : 1;
      if (opponent === 1) {
        gameState.player1.score += action.points;
        gameState.stats.p1TotalPoints += action.points;
      }
      if (opponent === 2) {
        gameState.player2.score += action.points;
        gameState.stats.p2TotalPoints += action.points;
      }
      gameState.currentBreak = 0;
      gameState.activePlayer = opponent;
      break;

    case 'CUSTOM_SCORE':
      if (action.player === 1) {
        gameState.player1.score += action.points;
        gameState.stats.p1TotalPoints += action.points;
        if (gameState.player1.score < 0) gameState.player1.score = 0;
      }
      if (action.player === 2) {
        gameState.player2.score += action.points;
        gameState.stats.p2TotalPoints += action.points;
        if (gameState.player2.score < 0) gameState.player2.score = 0;
      }
      break;

    case 'UNDO':
      if (gameState.history.length > 0) {
        const prev = gameState.history.pop();
        gameState.player1 = prev.player1;
        gameState.player2 = prev.player2;
        gameState.activePlayer = prev.activePlayer;
        gameState.currentBreak = prev.currentBreak;
        gameState.redsLeft = prev.redsLeft;
        gameState.stats = prev.stats;
        if(prev.frames) gameState.frames = prev.frames;
      }
      break;

    case 'SET_NAME':
      if (action.player === 1) gameState.player1.name = action.name;
      if (action.player === 2) gameState.player2.name = action.name;
      break;

    case 'ADD_FRAME':
      gameState.frames.push({
        p1Score: gameState.player1.score,
        p2Score: gameState.player2.score,
        winner: action.player
      });
      if (action.player === 1) gameState.player1.frame += 1;
      if (action.player === 2) gameState.player2.frame += 1;
      resetTable();
      break;

    case 'SUB_FRAME':
      if (action.player === 1 && gameState.player1.frame > 0) {
          gameState.player1.frame -= 1;
          gameState.frames.pop();
      }
      if (action.player === 2 && gameState.player2.frame > 0) {
          gameState.player2.frame -= 1;
          gameState.frames.pop();
      }
      break;

    case 'SET_MATCH_FORMAT': gameState.matchFormat = action.format; break;
    case 'SET_MAX_REDS': 
      gameState.maxReds = action.reds; 
      gameState.redsLeft = action.reds; 
      break;
    case 'ADJUST_REDS':
      gameState.redsLeft += action.amount;
      if(gameState.redsLeft < 0) gameState.redsLeft = 0;
      if(gameState.redsLeft > gameState.maxReds) gameState.redsLeft = gameState.maxReds;
      break;

    case 'SET_THEME': 
      gameState.theme = action.theme; 
      break;

    case 'SET_GAME_MODE':
      gameState.gameMode = action.mode;
      break;

    case 'UPDATE_SUMMARY':
      gameState.summary = { ...gameState.summary, ...action.data };
      break;
    case 'TOGGLE_SUMMARY':
      gameState.summary.show = action.show;
      break;

    case 'RESET_FRAME': resetTable(); break;
    case 'RESET_MATCH':
      gameState.player1.frame = 0;
      gameState.player2.frame = 0;
      gameState.stats = { p1HighestBreak: 0, p2HighestBreak: 0, p1TotalPoints: 0, p2TotalPoints: 0 };
      gameState.frames = [];
      resetTable();
      break;

    case 'SAVE_MATCH':
      const record = {
        id: Date.now(),
        date: new Date().toLocaleString('th-TH'),
        player1: gameState.player1.name,
        player2: gameState.player2.name,
        score1: gameState.player1.frame,
        score2: gameState.player2.frame,
        format: gameState.matchFormat,
        stats: JSON.parse(JSON.stringify(gameState.stats)),
        frames: JSON.parse(JSON.stringify(gameState.frames))
      };
      matchHistory.unshift(record);
      fs.writeFileSync(historyFile, JSON.stringify(matchHistory, null, 2));
      io.emit('updateHistory', matchHistory);

      gameState.player1.frame = 0;
      gameState.player2.frame = 0;
      gameState.stats = { p1HighestBreak: 0, p2HighestBreak: 0, p1TotalPoints: 0, p2TotalPoints: 0 };
      gameState.frames = [];
      resetTable();
      break;

    case 'DELETE_HISTORY':
      matchHistory = matchHistory.filter(record => record.id !== action.id);
      fs.writeFileSync(historyFile, JSON.stringify(matchHistory, null, 2));
      io.emit('updateHistory', matchHistory);
      break;

    case 'SWAP_PLAYERS':
      const tempP1 = JSON.parse(JSON.stringify(gameState.player1));
      gameState.player1 = JSON.parse(JSON.stringify(gameState.player2));
      gameState.player2 = tempP1;
      const tempStatsP1Break = gameState.stats.p1HighestBreak;
      gameState.stats.p1HighestBreak = gameState.stats.p2HighestBreak;
      gameState.stats.p2HighestBreak = tempStatsP1Break;
      const tempStatsP1Total = gameState.stats.p1TotalPoints;
      gameState.stats.p1TotalPoints = gameState.stats.p2TotalPoints;
      gameState.stats.p2TotalPoints = tempStatsP1Total;
      // We do not swap frame history logic since it's already recorded
      break;

    case 'TIMER_START':
      if (!gameState.timer.isRunning) {
        gameState.timer.isRunning = true;
        gameState.timer.startedAt = now;
      }
      break;
    case 'TIMER_PAUSE':
      if (gameState.timer.isRunning) {
        gameState.timer.isRunning = false;
        gameState.timer.elapsedSeconds += Math.floor((now - gameState.timer.startedAt) / 1000);
      }
      break;
    case 'TIMER_RESET':
      gameState.timer.isRunning = false;
      gameState.timer.elapsedSeconds = 0;
      gameState.timer.startedAt = null;
      break;
      
    case 'ADD_ROSTER':
      if (action.name && !gameState.playersRoster.includes(action.name)) {
        gameState.playersRoster.push(action.name);
        fs.writeFileSync(rosterFile, JSON.stringify(gameState.playersRoster, null, 2));
      }
      break;
    case 'DEL_ROSTER':
      gameState.playersRoster = gameState.playersRoster.filter(n => n !== action.name);
      fs.writeFileSync(rosterFile, JSON.stringify(gameState.playersRoster, null, 2));
      break;
  }
}

function resetTable() {
  gameState.player1.score = 0;
  gameState.player2.score = 0;
  gameState.currentBreak = 0;
  gameState.redsLeft = gameState.maxReds;
  gameState.history = []; // Note: This clears undo history, not frame history
}

server.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
