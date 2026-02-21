// --- CONFIGURATION ---
var board = null;
var premove = null; // Lưu trữ nước đi trước {from: ..., to: ...}
var game = new Chess();
var $status = $('#gameStatus');
var $moveLog = $('#moveLogText');
var $whiteTimer = $('#whiteTimer');
var $blackTimer = $('#blackTimer');
var playerSide = 'w';

// Engine
var stockfish = null;
var isEngineReady = false;

// Game State
var timerInterval = null;
var whiteTime = 600;
var blackTime = 600;
var increment = 5;
var gameActive = false;
var currentMode = 'computer'; // 'computer' or 'human'
var redoStack = []; // Lưu trữ các nước đi để Redo (Tiến lên)

// Selection State
var selectedSquare = null;

// Audio
const sounds = {
    move: new Audio('sounds/move.mp3'),
    capture: new Audio('sounds/capture.mov'),
    notify: new Audio('sounds/Time out.mp3'),
    // Âm thanh riêng biệt cho UI
    btnClick: new Audio('sounds/button.wav'), // Âm thanh cho nút bấm
    labelClick: new Audio('sounds/piece-click.mp3.mov'),  // Âm thanh cho các nhãn (Label)
    check: new Audio('sounds/check.mp3'),   
    castle: new Audio('sounds/move.mp3'),
    illegal: new Audio('sounds/illegal.wav')   
};

function playSound(audio) {
    if (!audio) return;
    audio.currentTime = 0; // Reset thời gian về 0 để phát ngay lập tức kể cả khi click nhanh
    audio.play().catch(() => {});
}


// --- 1. ENGINE SETUP ---
async function initEngine() {
    // Sử dụng Blob để tránh lỗi cross-origin nếu chạy local
    const stockfishUrl = 'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.0/stockfish.js';
    try {
        const response = await fetch(stockfishUrl);
        if (!response.ok) throw new Error("Connection failed");
        const scriptContent = await response.text();
        const blob = new Blob([scriptContent], { type: 'application/javascript' });
        stockfish = new Worker(URL.createObjectURL(blob));

        stockfish.onmessage = function(event) {
            // SỬA: Máy sẽ đi nếu ĐANG LÀ MÁY (Vs Computer) và KHÔNG PHẢI lượt người chơi
            if (event.data.startsWith('bestmove') && gameActive && currentMode === 'computer' && game.turn() !== playerSide) {
                var bestMove = event.data.split(' ')[1];
                makeEngineMove(bestMove);
            }
        };
        stockfish.postMessage('uci');
        isEngineReady = true;
        console.log("Engine loaded via Blob");
    } catch (e) {
        console.error("Engine failed to load:", e);
    }
}

function askEngine() {
        // CHỈ cho phép máy tính toán nếu game ĐANG CHẠY và đang ở nước đi mới nhất
    // Nếu redoStack có quân (nghĩa là đang tua lại xem quá khứ), máy không được đi.
    if (!gameActive || !isEngineReady || currentMode !== 'computer' || redoStack.length > 0) return;
    
    // Lấy level từ input (1-20)
    var level = parseInt($('#engineLevel').val()) || 10;
    // Giới hạn level trong khoảng 0-20 (Stockfish Skill Level)
    var skill = Math.max(0, Math.min(20, level)); 
    
    stockfish.postMessage('position fen ' + game.fen());
    stockfish.postMessage('setoption name Skill Level value ' + skill);
    
    // Tính toán depth dựa trên level để phản hồi nhanh hơn ở level thấp
    // Level 1 -> depth 1, Level 20 -> depth 15+
    var depth = Math.max(1, Math.floor(skill * 0.8) + 1);
    
    stockfish.postMessage('go depth ' + depth); 
}

function makeEngineMove(bestMoveString) {
    if (!gameActive) return;
    var from = bestMoveString.substring(0, 2);
    var to = bestMoveString.substring(2, 4);
    var promotion = bestMoveString.length > 4 ? bestMoveString.substring(4, 5) : 'q';

    var move = game.move({ from: from, to: to, promotion: promotion });
    if (move) {
        board.position(game.fen());
        handleMoveMade(move);
    }
}

// --- 2. VISUALS (Chấm gợi ý) ---
function removeHighlights() {
    $('.square-55d63').removeClass('highlight-square');
    $('.hint-dot').remove();
}

function showDots(square) {
    // Chỉ không hiện gợi ý nếu đấu máy và ĐANG LÀ LƯỢT CỦA MÁY
    if (currentMode === 'computer' && game.turn() !== playerSide) return;

    var moves = game.moves({ square: square, verbose: true });
    if (moves.length === 0) return;

    // Đánh dấu ô đang được chọn
    $('.square-' + square).addClass('highlight-square');

    // SỬ DỤNG forEach ĐỂ TRÁNH LỖI HỆ THỐNG XÓA KÝ TỰ
    moves.forEach(function(move) {
        var dotClass = 'hint-dot';
        
        // Nếu ô đó có thể ăn quân địch
        if (move.captured) {
            dotClass += ' hint-capture'; 
        }
        
        var $square = $('.square-' + move.to);
        if ($square.length > 0) {
            $square.append('<div class="' + dotClass + '"></div>'); // Gắn chấm tròn vào ô
        }
    });
}

// --- 3. INTERACTION LOGIC ---

function onDragStart(source, piece) {
    if (game.game_over()) return false;

    // CHẾ ĐỘ 2 NGƯỜI CHƠI (Human)
    if (currentMode === 'human') {
        // Chỉ cho phép đi quân đúng lượt (Trắng đi lượt w, Đen đi lượt b)
        if ((game.turn() === 'w' && piece.search(/^b/) !== -1) ||
            (game.turn() === 'b' && piece.search(/^w/) !== -1)) {
            return false;
        }
    } 
    // CHẾ ĐỘ ĐẤU VỚI MÁY (Computer)
    else {
        // Chỉ cho phép cầm quân của playerSide và phải đúng lượt
        if (piece.search(new RegExp('^' + (playerSide === 'w' ? 'b' : 'w'))) !== -1 || 
            game.turn() !== playerSide) {
            return false;
        }
    }

    removeHighlights();
    selectedSquare = source;
    showDots(selectedSquare);
    return true;
}

function onDrop(source, target) {
    if (source === target) return;

    // Thử thực hiện nước đi
    var move = game.move({
        from: source,
        to: target,
        promotion: 'q'
    });

    // 1. NẾU NƯỚC ĐI HỢP LỆ
    if (move !== null) {
        removeHighlights();
        premove = null; // Xóa Premove nếu có
        $('.square-55d63').removeClass('premove-highlight');
        handleMoveMade(move);
    } 
    // 2. NẾU NƯỚC ĐI KHÔNG HỢP LỆ
    else {
        // Chỉ cho phép Premove nếu đang đấu với MÁY và chưa tới lượt mình
        if (currentMode === 'computer' && game.turn() !== playerSide) {
            premove = { from: source, to: target };
            removeHighlights();
            $('.square-' + source).addClass('premove-highlight');
            $('.square-' + target).addClass('premove-highlight');
        }
        return 'snapback';
    }
}

// Click to Move
$(document).on('click', '.square-55d63', function() {
    var targetSquare = $(this).attr('data-square');
    var piece = game.get(targetSquare);

    if (!selectedSquare) {
        // Kiểm tra xem quân bấm vào có đúng lượt không
        var isTurn = piece && piece.color === game.turn();
        
        // Nếu là đấu máy, chỉ cho chọn quân của mình
        if (currentMode === 'computer' && playerSide !== game.turn()) isTurn = false;

        if (isTurn) {
            selectedSquare = targetSquare;
            showDots(targetSquare);
        }
        return;
    }

    // Nếu đã chọn 1 quân trước đó, thực hiện đi hoặc đổi quân
    var move = game.move({ from: selectedSquare, to: targetSquare, promotion: 'q' });

    if (move) {
        board.position(game.fen());
        removeHighlights();
        selectedSquare = null;
        handleMoveMade(move);
    } else {
        // Đổi quân chọn nếu bấm vào quân khác cùng màu và đúng lượt
        var isTurn = piece && piece.color === game.turn();
        if (currentMode === 'computer' && playerSide !== game.turn()) isTurn = false;

        if (isTurn) {
            removeHighlights();
            selectedSquare = targetSquare;
            showDots(targetSquare);
        } else {
            removeHighlights();
            selectedSquare = null;
        }
    }
});

// --- 4. GAME UTILS ---
function handleMoveMade(move) {
    var soundToPlay = sounds.move; // Mặc định là tiếng đi thường

    // 1. Ưu tiên cao nhất: Kiểm tra chiếu (Check)
    if (game.in_check()) {
        soundToPlay = sounds.check;
    } 
    // 2. Kiểm tra Nhập thành (Castling)
    // Trong chess.js, nước đi có ký hiệu SAN chứa "O-O" là nhập thành
    else if (move.san.includes("O-O")) { 
        soundToPlay = sounds.castle;
    }
    // 3. Kiểm tra Ăn quân
    else if (move.captured) {
        soundToPlay = sounds.capture;
    }

    // Phát âm thanh đã chọn
    playSound(soundToPlay);

    // Mỗi lần đi mới, xóa lịch sử Redo vì nhánh thời gian đã thay đổi
    redoStack = []; 

    if (!timerInterval && gameActive) startTimer();

    if (typeof updateMaterial === "function") updateMaterial();
    
    // Cộng giờ (Increment)
    if (increment > 0) {
        if (game.turn() === 'w') blackTime += increment; 
        else whiteTime += increment;
    }

    updateTimers();
    updateStatus();
    updateMoveLog();

     if (currentMode === 'computer' && game.turn() !== playerSide && !game.game_over()) {
        // Delay một chút cho tự nhiên
        setTimeout(askEngine, 600);
    }
    
   // Gọi máy nếu chơi với máy và KHÔNG PHẢI lượt của người chơi
    if (currentMode === 'computer' && game.turn() !== playerSide && !game.game_over()) {
        setTimeout(askEngine, 600);
    }
 // --- THÊM ĐOẠN NÀY VÀO CUỐI HÀM ---
    if (game.turn() === playerSide && premove) {
        var pMove = premove;
        premove = null; // Xóa ngay để tránh lặp
        
        // Thử thực hiện nước đi đã lưu
        var result = game.move({
            from: pMove.from,
            to: pMove.to,
            promotion: 'q'
        });

        if (result) {
            // Nếu nước đi hợp lệ tại thời điểm này
            setTimeout(function() {
                board.position(game.fen());
                $('.square-55d63').removeClass('premove-highlight');
                handleMoveMade(result);
            }, 100); // Delay cực nhỏ để tạo cảm giác mượt
        } else {
            // Nếu nước đi không còn hợp lệ (ví dụ ô đó bị đối thủ chiếm mất)
            $('.square-55d63').removeClass('premove-highlight');
        }
    }
}

// --- UNDO / REDO FUNCTIONS ---

function undoMove() {
    if (!gameActive && !game.game_over()) return; // Chỉ undo khi đang chơi hoặc vừa hết cờ
    
    // Logic cho chế độ Máy: Undo 2 nước (để quay lại lượt người chơi)
    if (currentMode === 'computer') {
        // Nếu đang lượt trắng (tức máy vừa đi xong), undo 2 phát
        // Nếu đang lượt đen (máy đang nghĩ), undo 1 phát
        var move1 = game.undo();
        if (move1) {
            redoStack.push(move1); // Lưu vào stack để Redo
            board.position(game.fen());
            
            // Nếu undo xong mà đến lượt đen (máy), undo tiếp phát nữa để về lượt mình
            if (game.turn() === 'b') {
                var move2 = game.undo();
                if (move2) {
                    redoStack.push(move2);
                    board.position(game.fen());
                }
            }
        }
    } 
    // Logic cho chế độ 2 người: Undo 1 nước
    else {
        var move = game.undo();
        if (move) {
            redoStack.push(move);
            board.position(game.fen());
        }
    }
    
    updateMoveLog();
    updateStatus();
    removeHighlights();
    updateMaterial(); 
    // Dừng âm thanh engine nếu cần thiết
}

function redoMove() {
    if (!gameActive && !game.game_over()) return;
    if (redoStack.length === 0) return;

    // Lấy nước đi gần nhất từ stack
    var moveObj = redoStack.pop(); 
    
    // Thực hiện lại nước đi
    var move = game.move({
        from: moveObj.from,
        to: moveObj.to,
        promotion: moveObj.promotion
    });

    if (move) {
        board.position(game.fen());
        
        // Nếu đấu máy, cần redo 2 nước (nước mình và nước máy)
        if (currentMode === 'computer' && redoStack.length > 0 && game.turn() === 'b') {
             var move2Obj = redoStack.pop();
             game.move(move2Obj);
             board.position(game.fen());
        }

        updateMoveLog();
        updateStatus();
        playSound(sounds.move);
        updateMaterial();
    }
    
}

function updateStatus() {
    if (game.in_checkmate()) {
        $status.text("Checkmate! " + (game.turn() === 'w' ? "Black" : "White") + " wins.");
        endGame();
    } else if (game.in_draw()) {
        $status.text("Draw!");
        endGame();
    } else {
        let status = (game.turn() === 'w' ? "White" : "Black") + " to move";
        if (game.in_check()) status += " (CHECK!)";
        $status.text(status);
    }
}

function updateMoveLog() {
    const currentHistory = game.history(); 
    const futureMoves = redoStack.slice().reverse().map(m => m.san);
    const fullHistory = currentHistory.concat(futureMoves);

    let html = '';
    
    for (let i = 0; i < fullHistory.length; i += 2) {
        let moveNum = (i / 2) + 1;

        // Xử lý nước đi của Trắng
        let wIndex = i;
        let wClass = (wIndex === currentHistory.length - 1) ? 'current-move' : 'move-link';
        
        // Đã thay ngoặc vuông thành <> theo yêu cầu của bạn:
        let wMove = `<span class="${wClass}" data-index="${wIndex}">${fullHistory[wIndex]}</span>`;

        // Xử lý nước đi của Đen
        let bMove = ''; // Chú ý: Chỗ này là 2 dấu nháy đơn (chuỗi rỗng), đừng để là mảng nhé
        let bIndex = i + 1;
        if (bIndex < fullHistory.length) {
            let bClass = (bIndex === currentHistory.length - 1) ? 'current-move' : 'move-link';
            
            // Đã thay ngoặc vuông thành <> theo yêu cầu của bạn:
            bMove = `<span class="${bClass}" data-index="${bIndex}">${fullHistory[bIndex]}</span>`;
        }

        html += `<span class="move-num">${moveNum}.</span> ${wMove} ${bMove} `;
    }

    $moveLog.html(html || '<span class="move-link">1. Ready...</span>');

    if (redoStack.length === 0) {
        $('.log-area').scrollTop(9999);
    }
}

// --- LƯỚT XEM LỊCH SỬ THẾ TRẬN ---
function goToMove(targetIndex) {
    if (game.history().length === 0 && redoStack.length === 0) return; 

    let currentIndex = game.history().length - 1;
    if (targetIndex === currentIndex) return;

    removeHighlights();


    if (targetIndex < currentIndex) {
        // Tua về quá khứ
        let steps = currentIndex - targetIndex;
        for (let i = 0; i < steps; i++) {
            let move = game.undo();
            if (move) redoStack.push(move);
        }
    } else {
        // Tua tới tương lai
        let steps = targetIndex - currentIndex;
        for (let i = 0; i < steps; i++) {
            if (redoStack.length > 0) {
                let moveObj = redoStack.pop();
                game.move(moveObj);
            }
        }
    }

    // Cập nhật giao diện sau khi tua
    board.position(game.fen());
    updateMoveLog();
    updateStatus();
    playSound(sounds.move);
    if (typeof updateMaterial === 'function') updateMaterial();
}

function stepBackward() {
    let currentIndex = game.history().length - 1;
    if (currentIndex >= 0) goToMove(currentIndex - 1);
}

function stepForward() {
    let currentIndex = game.history().length - 1;
    let fullLength = game.history().length + redoStack.length;
    if (currentIndex < fullLength - 1) goToMove(currentIndex + 1);
}

function startTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(() => {
        if (!gameActive) return;
        
        // Xác định lượt thật sự ở thì hiện tại (tính cả khi đang lùi lại để xem lịch sử)
        let totalMoves = game.history().length + redoStack.length;
        let realTurn = (totalMoves % 2 === 0) ? 'w' : 'b';

        if (realTurn === 'w') { 
            whiteTime--; 
            if(whiteTime <= 0) endGame('white'); 
        } else { 
            blackTime--; 
            if(blackTime <= 0) endGame('black'); 
        }
        updateTimers();
    }, 1000);
}

function updateTimers() {
    // Hàm hỗ trợ định dạng thời gian mm:ss
    function fmt(t) { 
        if (t < 0) t = 0;
        return Math.floor(t/60) + ':' + (t%60 < 10 ? '0' : '') + t%60; 
    }
    
    $whiteTimer.text(fmt(whiteTime));
    $blackTimer.text(fmt(blackTime));
    
    // Xác định lượt thật sự ở thì hiện tại
    let totalMoves = game.history().length + redoStack.length;
    let realTurn = (totalMoves % 2 === 0) ? 'w' : 'b';

    // 1. Quản lý trạng thái đang chạy (Active)
    $whiteTimer.toggleClass('active', realTurn === 'w' && gameActive);
    $blackTimer.toggleClass('active', realTurn === 'b' && gameActive);
    
    // 2. Trạng thái sắp hết giờ (Dưới 30 giây)
    $whiteTimer.toggleClass('low-time', whiteTime > 0 && whiteTime <= 30);
    $blackTimer.toggleClass('low-time', blackTime > 0 && blackTime <= 30);
    
    // 3. Trạng thái HẾT GIỜ (Bằng 0)
    $whiteTimer.toggleClass('out-of-time', whiteTime <= 0);
    $blackTimer.toggleClass('out-of-time', blackTime <= 0);
}
function endGame(loser) {
    gameActive = false;
    clearInterval(timerInterval);
    
    // Không khóa board hoàn toàn để người dùng vẫn có thể click vào ô cờ xem gợi ý (nếu muốn)
    // Nhưng onDragStart sẽ chặn việc di chuyển quân cờ mới
    
    $status.html("<span style='color: #ff4d4d;'>TRẬN ĐẤU KẾT THÚC!</span> Đang ở chế độ xem lại.");
    
    $('#middleBtn')
        .attr('title', 'Chơi ván mới')
        .html('<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>');
    
    playSound(sounds.notify);
}

// --- 5. INITIALIZATION ---
function resizeBoard() {
    var $wrapper = $('.board-wrapper');
    if ($wrapper.length === 0 || !board) return;
    $('#myBoard').css('width', '100%');
    var w = $wrapper.width();
    var h = $wrapper.height();
    var size = ($(window).width() > 1024 && h > 100) ? Math.min(w, h) : w;
    $('#myBoard').css('width', size + 'px');
    board.resize();
    if (selectedSquare) { removeHighlights(); showDots(selectedSquare); }
}

function resetGame() {
    game.reset();
    gameActive = true;
    selectedSquare = null;
    redoStack = [];
    removeHighlights();
    // Vừa đổi Tooltip thành "Đi lại", vừa đổi icon thành mũi tên lùi
    $('#middleBtn')
        .attr('title', 'Đi lại')
        .html('<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12.5 8c-2.65 0-5.05.99-6.9 2.6L2 7v9h9l-3.62-3.62c1.39-1.16 3.16-1.88 5.12-1.88 3.54 0 6.55 2.31 7.6 5.5l2.37-.78C21.08 11.03 17.15 8 12.5 8z"/></svg>'); 
    
    // 1. Lấy cài đặt
    var base = parseInt($('#timeBase').val()) || 10;
    whiteTime = blackTime = base * 60;
    
    var incValue = parseInt($('#timeIncrement').val());
    increment = isNaN(incValue) ? 0 : incValue;
    
    currentMode = $('#gameMode').val();
    
    // 2. Xử lý chọn quân (Play As)
    playerSide = $('#playerSide').val();
    if (playerSide === 'random') {
        playerSide = Math.random() > 0.5 ? 'w' : 'b';
    }

   // 3. Xử lý hiển thị Tên, Level, Đồng hồ và Quân ăn được
    var rawLevel = $('#engineLevel option:selected').text();
    var levelText = rawLevel.split(' - '); // Cắt chuỗi lấy phần đầu, VD: "Lvl 10"
    
    // Đã sửa: Truyền levelText vào botRating, humanRating cho mặc định là 100
    var botRating = `(${levelText})`; 
    var humanRating = '(100)'; // Bạn có thể đổi số này tùy ý

    var topName, bottomName, topTimer, bottomTimer, topCaptured, bottomCaptured;

    // Logic: Người chơi Luôn ở Bottom, Đối thủ Luôn ở Top
    if (currentMode === 'computer') {
        // Đã tiêm biến botRating và humanRating vào trong thẻ span
        topName = `Thế Anh <span class="rating">${botRating}</span>`;
        bottomName = `YOU SUCKER <span class="rating">${humanRating}</span>`;
        
        if (playerSide === 'w') {
            topTimer = 'blackTimer'; bottomTimer = 'whiteTimer';
            topCaptured = 'black-captured'; bottomCaptured = 'white-captured';
        } else {
            topTimer = 'whiteTimer'; bottomTimer = 'blackTimer';
            topCaptured = 'white-captured'; bottomCaptured = 'black-captured';
        }
    } else { // Chế độ 2 người chơi
        if (playerSide === 'w') {
            topName = `Black Player <span class="rating">(Guest)</span>`;
            bottomName = `White Player <span class="rating">(You)</span>`;
            topTimer = 'blackTimer'; bottomTimer = 'whiteTimer';
            // ... (các dòng dưới giữ nguyên)
        } else {
            topName = `White Player <span class="rating">(Guest)</span>`;
            bottomName = `Black Player <span class="rating">(You)</span>`;
            topTimer = 'whiteTimer'; bottomTimer = 'blackTimer';
            // ... (các dòng dưới giữ nguyên)
        }
    }

    // Tiêm dữ liệu vào giao diện TOP (Đối thủ)
    $('.player-info.top .name').html(topName);
    $('.player-info.top .digital-clock').attr('id', topTimer);
    $('.player-info.top .captured-list').attr('id', topCaptured);

    // Tiêm dữ liệu vào giao diện BOTTOM (Bạn)
    $('.player-info.bottom .name').html(bottomName);
    $('.player-info.bottom .digital-clock').attr('id', bottomTimer);
    $('.player-info.bottom .captured-list').attr('id', bottomCaptured);

    // BẮT BUỘC: Cập nhật lại biến jQuery sau khi đổi ID để đồng hồ chạy đúng
    $whiteTimer = $('#whiteTimer');
    $blackTimer = $('#blackTimer');

    // Dọn dẹp thời gian cũ
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    
    updateTimers();
    updateMoveLog();
    if (typeof updateMaterial === 'function') updateMaterial();
    $status.text("White to move");

    // 4. Khởi tạo bàn cờ với hướng (Orientation) đúng
    if (board) board.destroy();
    board = Chessboard('myBoard', {
        draggable: true,
        position: 'start',
        orientation: playerSide === 'w' ? 'white' : 'black', // Xoay bàn cờ
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: function() { board.position(game.fen()); }
    });
    
    resizeBoard();

    // 5. Nếu chơi quân Đen với máy, máy (Trắng) sẽ đi trước
    if (currentMode === 'computer' && playerSide === 'b') {
        setTimeout(askEngine, 1000);
    }

    // Tiêm dữ liệu vào giao diện TOP (Đối thủ)
    $('.player-info.top .name').html(topName);
    $('.player-info.top .digital-clock').attr('id', topTimer);
    $('.player-info.top .captured-list').attr('id', topCaptured);

    // Tiêm dữ liệu vào giao diện BOTTOM (Bạn)
    $('.player-info.bottom .name').html(bottomName);
    $('.player-info.bottom .digital-clock').attr('id', bottomTimer);
    $('.player-info.bottom .captured-list').attr('id', bottomCaptured);

    // BẮT BUỘC: Cập nhật lại biến jQuery sau khi đổi ID để đồng hồ chạy đúng
    $whiteTimer = $('#whiteTimer');
    $blackTimer = $('#blackTimer');

    // Dọn dẹp thời gian cũ
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    
    updateTimers();
    updateMoveLog();
    if (typeof updateMaterial === 'function') updateMaterial();
    $status.text("White to move");

    // 4. Khởi tạo bàn cờ với hướng (Orientation) đúng
    if (board) board.destroy();
    board = Chessboard('myBoard', {
        draggable: true,
        position: 'start',
        orientation: playerSide === 'w' ? 'white' : 'black', // Xoay bàn cờ
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png',
        onDragStart: onDragStart,
        onDrop: onDrop,
        onSnapEnd: function() { board.position(game.fen()); }
    });
    
    resizeBoard();

    // 5. Nếu chơi quân Đen với máy, máy (Trắng) sẽ đi trước
    if (currentMode === 'computer' && playerSide === 'b') {
        setTimeout(askEngine, 1000);
    }
}



function updateMaterial() {
    const history = game.history({ verbose: true });
    let whiteCaptures = [];
    let blackCaptures = [];
    let whiteScore = 0;
    let blackScore = 0;

    const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

    history.forEach(move => {
        if (move.captured) {
            // Nếu màu đi là trắng (w) ăn quân, thì quân bị ăn là của đen
            if (move.color === 'w') {
                whiteCaptures.push('b' + move.captured.toUpperCase());
                whiteScore += values[move.captured];
            } else {
                blackCaptures.push('w' + move.captured.toUpperCase());
                blackScore += values[move.captured];
            }
        }
    });

    // Sắp xếp quân theo giá trị để hiển thị đẹp (Tốt -> Hậu)
    const sortOrder = { P: 1, N: 2, B: 3, R: 4, Q: 5 };
    const sortFn = (a, b) => sortOrder[a[1]] - sortOrder[b[1]];
    whiteCaptures.sort(sortFn);
    blackCaptures.sort(sortFn);

    // Hiển thị ra HTML
    renderCaptured('white-captured', whiteCaptures, whiteScore - blackScore);
    renderCaptured('black-captured', blackCaptures, blackScore - whiteScore);
}

function renderCaptured(elementId, pieces, diff) {
    const $container = $('#' + elementId);
    if (pieces.length === 0 && diff <= 0) {
        $container.css('opacity', '0'); // Ẩn nếu chưa có quân nào bị ăn
        return;
    }
    
    $container.css('opacity', '1');
    let html = '';
    
    pieces.forEach(p => {
        // p có dạng 'wP', 'bP'...
        const pieceName = p; 
        html += `<img src="https://chessboardjs.com/img/chesspieces/wikipedia/${pieceName}.png">`;
    });

    if (diff > 0) {
        html += `<span class="score-tag">+${diff}</span>`;
    }
    
    $container.html(html);
}

// --- 6. KHỞI TẠO GAME & GẮN SỰ KIỆN ---

$(document).ready(function() {
    console.log("Game Initializing...");

    // 1. Khởi động Engine
    initEngine();

   // --- MỚI: HÀM XỬ LÝ MODAL ---
    const $modal = $('#confirmModal');
    let currentModalAction = ''; // Lưu trạng thái xem đang bấm nút nào
    
    function showConfirmation(action) {
        currentModalAction = action;
        
        if (action === 'undo') {
            if (game.history().length === 0) return; // Chưa đi nước nào thì không hỏi
            $('#modalTitle').text('XIN ĐI LẠI ?');
            $('#modalDesc').text('Bạn có xin quay lại với nyc không ?');
        } else if (action === 'playagain') {
            $('#modalTitle').text('CHƠI LẠI ?');
            $('#modalDesc').text('Thứ duy nhất bạn hơn tôi là sự kiên nhẫn nên tôi sẽ luôn ở đây đợi bạn phục thù !');
        } else {
            // Được gọi từ nút NEW GAME trên Top bar
            if (game.history().length === 0) {
                resetGame();
                return;
            }
            $('#modalTitle').text('BẠN SỢ À?');
            $('#modalDesc').text('Tôi biết bạn sẽ từ bỏ nhưng tôi không ngờ điều đó lại đến sớm vậy.');
        }

        $modal.addClass('active');
        sounds.notify.play().catch(() => {}); 
    }

    function hideConfirmation() {
        $modal.removeClass('active');
    }

    // Gắn sự kiện cho các nút trong Modal
    $('#modalCancel').on('click', function() {
        hideConfirmation();
        sounds.btnClick.cloneNode().play().catch(() => {});
    });

    $('#modalConfirm').on('click', function() {
        hideConfirmation();
        
        if (currentModalAction === 'undo') {
            undoMove(); // Gọi hàm lùi cờ của bạn
            
            // SỬA Ở ĐÂY: Xóa sạch nhánh tương lai để khẳng định đây là "Takeback" thật sự
            redoStack =[]; 
            
            // Cập nhật lại giao diện đồng hồ ngay lập tức
            updateTimers(); 
            
            sounds.move.play().catch(() => {}); 
        } else {
            resetGame(); // Dùng chung cho cả 'Chơi lại' và 'New game'
            sounds.move.play().catch(() => {}); 
        }
    });

    // Đóng modal khi click ra ngoài vùng trắng
    $modal.on('click', function(e) {
        if ($(e.target).is('.modal-overlay')) {
            hideConfirmation();
        }
    });
    // ----------------------------

    // 2. Âm thanh nút bấm chung
    $('button, .big-btn, .modal-btn').on('click', function() {
        if(this.id !== 'modalConfirm' && this.id !== 'modalCancel') {
             sounds.btnClick.cloneNode().play().catch(() => {});
        }
    });
    
    $('select, input').on('change click', function() {
        sounds.btnClick.cloneNode().play().catch(() => {});
    });

    // 3. Gắn sự kiện cho các nút
    $('#applySettingsBtn').on('click', function() { 
        showConfirmation('newgame'); 
    });
    
    // NÚT GIỮA: Tự động đổi chức năng dựa vào việc game đã kết thúc chưa
    $('#middleBtn').on('click', function() {
        if (gameActive && !game.game_over()) {
            showConfirmation('undo');
        } else {
            showConfirmation('playagain');
        }
    });
    
    // Gắn sự kiện cho nút (<) và (>)
    $('#prevBtn').on('click', stepBackward);
    $('#nextBtn').on('click', stepForward);

    // Gắn sự kiện khi Click thẳng vào một nước cờ trên dòng log bên phải
    $(document).on('click', '.move-link', function() {
        let targetIndex = parseInt($(this).attr('data-index'));
        goToMove(targetIndex);
    });

    // Bắt sự kiện bàn phím (Mũi tên Trái / Phải)
    $(document).on('keydown', function(e) {
    if ($(e.target).is('input, select')) return;

    if (e.key === 'ArrowLeft') {
        stepBackward(); // Tua về nước trước
    } else if (e.key === 'ArrowRight') {
        stepForward();  // Tua đến nước sau
    } else if (e.key === 'Home') {
        goToMove(-1);   // Về tận cùng lúc bắt đầu
    } else if (e.key === 'End') {
        // Tua đến nước cuối cùng đã đi
        while(redoStack.length > 0) stepForward();
    }
    });

    // 4. Resize & Start
    $(window).on('resize', resizeBoard);
    
    // Fix lỗi cuộn trên mobile
    var boardEl = document.getElementById('myBoard');
    if (boardEl) {
        boardEl.addEventListener('touchmove', function(e) { e.preventDefault(); }, { passive: false });
    }

    setTimeout(resetGame, 200);
});

// 1. Chống chuột phải
document.addEventListener('contextmenu', event => event.preventDefault());

// 2. Chống phím tắt F12, Ctrl+Shift+I (Mở bộ công cụ nhà phát triển)
document.onkeydown = function(e) {
    if (e.keyCode == 123 || 
        (e.ctrlKey && e.shiftKey && e.keyCode == 'I'.charCodeAt(0)) ||
        (e.ctrlKey && e.shiftKey && e.keyCode == 'C'.charCodeAt(0)) ||
        (e.ctrlKey && e.shiftKey && e.keyCode == 'J'.charCodeAt(0)) ||
        (e.ctrlKey && e.keyCode == 'U'.charCodeAt(0))) {
        return false;
    }
}