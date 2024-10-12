
const WebSocket = require('ws');
const uuidv4 = require('uuid').v4;

const wss = new WebSocket.Server({ port: 8080 });

let rooms = {};
let clients = {};

wss.on('connection', (ws) => {
  ws.on('message', (message) => {
    const data = JSON.parse(message);
    const { type, room, playerId } = data;

    switch (type) {
      case 'join':
        handleJoin(ws, room, playerId);
        break;
      case 'checkJoin':
        checkRoom(ws, room, playerId);
        break;
      case 'move':
        handleMove(data);
        break;
      case 'switchRequest':
        handleSwitchRequest(room, playerId);
        break;
      case 'message':
        handleMessage(room, data.text);
        break;
      case 'playAgain':
        handlePlayAgain(room, playerId);
        break;
      case 'syncState':  // New case to handle state sync
        handleSyncState(ws, room);
        break;
      default:
        break;
    }
  });

  ws.on('close', () => {
    handleDisconnect(ws);
  });
});


function checkRoom(ws, roomId, playerId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      player1: null,
      player2: null,
      board: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
      turnPlayer: 1,
      readyToPlayAgain: {},
      connections: {},
      moveCnt: 0
    };
  }

  const room = rooms[roomId];

  // Only assign WebSocket connection if the player is allowed to join
  if (Object.keys(room.connections).length >= 2) {
    ws.send(JSON.stringify({
      type: 'joinNotAllowed',
      message: 'Room is full.'
    }));
    ws.close();  // Close the third player's connection without modifying existing players
    return;
  }

  // Continue if the room is not full
  room.connections[playerId] = ws;

  ws.send(JSON.stringify({
    type: 'joinAllowed',
    message: 'Room is free to join.'
  }));
}

// Handle player joining the game
function handleJoin(ws, roomId, playerId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      player1: null,
      player2: null,
      board: [[0, 0, 0], [0, 0, 0], [0, 0, 0]],
      turnPlayer: 1,
      readyToPlayAgain: {},
      connections: {},
      moveCnt: 0
    };
  }

  const room = rooms[roomId];
  room.connections[playerId] = ws;

  const currMoveCnt=room.moveCnt

  let winner = false
  let winnerPlayer=0

  if (checkWin(room.board, 1)){
    winner=true
    winnerPlayer=1
  } else if (checkWin(room.board, 2)){
    winner=true
    winnerPlayer=2
  }

  let gameOver = winner || currMoveCnt === 9; 

  //if room is full, send error message to client
  if (room.player1 && room.player2) {
    // Room is full, send an error message to the third player
    ws.send(JSON.stringify({
      type: 'error',
      message: 'Room is full. You will be redirected to the homepage.'
    }));
    ws.close();  // Optionally close the WebSocket connection for the third player
    return;
  }
  

  // Assign player1 and player2
  if (!room.player1) {
    room.player1 = playerId;
    ws.send(JSON.stringify({ type: 'playerNumber', playerNumber: 1, playerId}));
  } else if (!room.player2) {
    room.player2 = playerId;
    ws.send(JSON.stringify({ type: 'playerNumber', playerNumber: 2, playerId }));
  }

  // Sync current game state for reconnections
  ws.send(JSON.stringify({
    type: 'syncState',
    board: room.board,
    turnPlayer: room.turnPlayer,
    moves:room.moveCnt,
    player1: room.player1,
    player2: room.player2,
    moves:room.moveCnt,
    winnerPlayer:winnerPlayer,
    gameOver:gameOver,
    readyToPlayAgain: room.readyToPlayAgain,
    connections: Object.keys(room.connections).length
  }));

  // Start game when both players have joined
  if (room.player1 && room.player2) {
    broadcast(roomId, { type: 'start', message: 'Both players connected!' });
  }
}

function handleMove(data) {
  const { room, board, turnPlayer, moveCnt } = data;
  const currPlayer = turnPlayer === 1 ? 2 : 1;

  // Update the room's board and turn
  rooms[room].board = board;
  rooms[room].turnPlayer = currPlayer;
  rooms[room].moveCnt = moveCnt+1;
  // Check for a winner
  let winner = checkWin(board, turnPlayer);
  let gameOver = winner || moveCnt +1 === 9;  // Game over if winner or board is full

  const newMoveCnt=moveCnt +1
  // Broadcast the appropriate message
  const message = gameOver
    ? { type: 'gameOver', winner: winner ? turnPlayer : 0, board,newMoveCnt }
    : { type: 'update', board, turnPlayer: currPlayer ,newMoveCnt};

  broadcast(room, message);
}

// Utility function to check win conditions
function checkWin(board, player) {
  for (let i = 0; i < 3; i++) {
    if ((board[i][0] === player && board[i][1] === player && board[i][2] === player) ||
        (board[0][i] === player && board[1][i] === player && board[2][i] === player)) {
      return true;
    }
  }
  if ((board[0][0] === player && board[1][1] === player && board[2][2] === player) ||
      (board[0][2] === player && board[1][1] === player && board[2][0] === player)) {
    return true;
  }
  return false;
}

// Handle player chat messages
function handleMessage(room, text) {
  broadcast(room, { type: 'message', text });
}

// Handle play again logic
function handlePlayAgain(room, playerId) {
  rooms[room].readyToPlayAgain[playerId] = true;
  
  // If both players want to play again, reset the board
  if (rooms[room].readyToPlayAgain[rooms[room].player1] &&
      rooms[room].readyToPlayAgain[rooms[room].player2]) {
    rooms[room].board = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    rooms[room].turnPlayer = 1;
    rooms[room].moveCnt = 0;
    rooms[room].readyToPlayAgain = {};  // Reset play again status
    broadcast(room, { type: 'reset' });
  }
}

// Sync the game state when requested by a player
function handleSyncState(ws, room) {
  const currentRoom = rooms[room];

  let winner = false
  let winnerPlayer=0

  

  if (checkWin(room.board, 1)){
    winner=true
    winnerPlayer=1
  } else if (checkWin(room.board, 2)){
    winner=true
    winnerPlayer=2
  }

  let gameOver = winner || currentRoom.moveCnt === 9; 

  if (currentRoom) {
    ws.send(JSON.stringify({
      type: 'syncState',
      board: currentRoom.board,
      turnPlayer: currentRoom.turnPlayer,
      moves:currentRoom.moveCnt,
      winnerPlayer:winnerPlayer,
      gameOver:gameOver,
      player1: currentRoom.player1,
      player2: currentRoom.player2,
      readyToPlayAgain: currentRoom.readyToPlayAgain,
      connections: Object.keys(currentRoom.connections).length
    }));
  }
}

function handleDisconnect(ws) {
  let disconnectedPlayerId = null;

  // Find the player that matches the disconnected WebSocket
  for (let roomId in rooms) {
    const room = rooms[roomId];
    for (let playerId in room.connections) {
      if (room.connections[playerId] === ws) {
        disconnectedPlayerId = playerId;
        delete room.connections[playerId];
        break;
      }
    }

    if (disconnectedPlayerId) {
      if (room.player1 === disconnectedPlayerId) {
        room.player1 = null;
      } else if (room.player2 === disconnectedPlayerId) {
        room.player2 = null;
      }

      // If no players remain in the room, delete the room
      if (!room.player1 && !room.player2) {
        delete rooms[roomId];
      }
      break;
    }
  }
}

function handleSwitchRequest(room, playerId) {
  if (!rooms[room].switchRequests) {
    rooms[room].switchRequests = {};
  }

  rooms[room].switchRequests[playerId] = true;

  // Check if both players have requested the switch
  if (rooms[room].switchRequests[rooms[room].player1] &&
      rooms[room].switchRequests[rooms[room].player2]) {
    // Swap player1 and player2
    const roomData = rooms[room];
    const temp = roomData.player1;
    roomData.player1 = roomData.player2;
    roomData.player2 = temp;

    // Notify both players about the switch
    roomData.connections[roomData.player1].send(JSON.stringify({
      type: 'playerNumber',
      playerNumber: 1,
      playerId: roomData.player1
    }));

    roomData.connections[roomData.player2].send(JSON.stringify({
      type: 'playerNumber',
      playerNumber: 2,
      playerId: roomData.player2
    }));

    // Clear switch requests for the room
    delete rooms[room].switchRequests;

    // Notify about the switch
    broadcast(room, { type: 'message', text: 'Player numbers have been switched!' });
  }
}

// Broadcast a message to all players in the room
function broadcast(room, message) {
  const roomData = rooms[room];
  Object.values(roomData.connections).forEach(connection => {
    connection.send(JSON.stringify(message));
  });
}

console.log('WebSocket server running on ws://localhost:8080');
