/* Stadium Creator - basic grid editor */
(() => {
  const gridContainer = document.getElementById('gridContainer');
  const gridSizeInput = document.getElementById('gridSize');
  const cellPxInput = document.getElementById('cellPx');
  const resizeBtn = document.getElementById('resizeGrid');
  const tools = document.querySelectorAll('.tool');
  const undoBtn = document.getElementById('undo');
  const clearBtn = document.getElementById('clear');
  const exportJsonBtn = document.getElementById('exportJson');
  const exportImageBtn = document.getElementById('exportImage');
  const stadiumNameInput = document.getElementById('stadiumName');

  let gridSize = parseInt(gridSizeInput.value, 10) || 24;
  let cellPx = parseInt(cellPxInput.value, 10) || 18;
  let currentTool = 'pitch';
  let model = createEmptyModel(gridSize);
  let history = [];

  function createEmptyModel(n){
    const cells = Array.from({length:n*n}, () => ({type: 'empty'}));
    return {n, cells};
  }

  function saveHistory(){
    history.push(JSON.stringify(model));
    if(history.length>100) history.shift();
  }

  function applyGridStyles(){
    gridContainer.innerHTML = '';
    const grid = document.createElement('div');
    grid.className = 'grid';
    grid.style.setProperty('--cell-size', cellPx + 'px');
    grid.style.gridTemplateColumns = `repeat(${gridSize}, ${cellPx}px)`;
    grid.style.gridTemplateRows = `repeat(${gridSize}, ${cellPx}px)`;
    gridContainer.appendChild(grid);

    // render cells
    for(let i=0;i<gridSize*gridSize;i++){
      const c = document.createElement('div');
      c.className = 'cell';
      c.dataset.idx = i;
      const item = model.cells[i];
      if(item.type !== 'empty'){
        c.classList.add(item.type);
      }
      c.addEventListener('pointerdown', onPointerDown);
      c.addEventListener('pointerenter', onPointerEnter);
      grid.appendChild(c);
    }
  }

  let isPointerDown = false;
  let pointerTool = null;

  function onPointerDown(e){
    isPointerDown = true;
    pointerTool = currentTool;
    handleCellAction(e.currentTarget);
    window.addEventListener('pointerup', onPointerUp);
  }
  function onPointerEnter(e){
    if(isPointerDown && pointerTool === currentTool){
      handleCellAction(e.currentTarget);
    }
  }
  function onPointerUp(){
    isPointerDown = false;
    pointerTool = null;
    window.removeEventListener('pointerup', onPointerUp);
  }

  function handleCellAction(cellEl){
    const idx = parseInt(cellEl.dataset.idx,10);
    saveHistory();
    if(currentTool === 'erase'){
      model.cells[idx] = {type:'empty'};
    } else if(currentTool === 'select'){
      // move not implemented yet - simple selection toggle
      const t = model.cells[idx].type==='selected' ? model.cells[idx].prevType || {type:'empty'} : {type:'selected', prevType: model.cells[idx].type};
      model.cells[idx] = t;
    } else {
      model.cells[idx] = {type: currentTool};
    }
    applyGridStyles();
  }

  // tool buttons
  tools.forEach(btn => {
    btn.addEventListener('click', () => {
      tools.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = btn.dataset.tool;
    });
  });

  resizeBtn.addEventListener('click', () => {
    const n = Math.max(8, Math.min(64, parseInt(gridSizeInput.value,10)||24));
    const px = Math.max(8, Math.min(64, parseInt(cellPxInput.value,10)||18));
    gridSize = n; cellPx = px;
    model = createEmptyModel(gridSize);
    history = [];
    applyGridStyles();
  });

  undoBtn.addEventListener('click', () => {
    if(history.length === 0) return;
    const prev = history.pop();
    model = JSON.parse(prev);
    applyGridStyles();
  });

  clearBtn.addEventListener('click', () => {
    saveHistory();
    model = createEmptyModel(gridSize);
    applyGridStyles();
  });

  exportJsonBtn.addEventListener('click', () => {
    const payload = {
      meta:{name: stadiumNameInput.value || 'My Stadium', created: new Date().toISOString()},
      n: model.n,
      cells: model.cells
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {type: 'application/json'});
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (stadiumNameInput.value || 'stadium') + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  exportImageBtn.addEventListener('click', () => {
    // render the grid to canvas
    const canvas = document.createElement('canvas');
    canvas.width = gridSize * cellPx;
    canvas.height = gridSize * cellPx;
    const ctx = canvas.getContext('2d');

    // background
    ctx.fillStyle = '#07311f';
    ctx.fillRect(0,0,canvas.width,canvas.height);

    for(let y=0;y<gridSize;y++){
      for(let x=0;x<gridSize;x++){
        const idx = y*gridSize + x;
        const item = model.cells[idx];
        const px = x*cellPx, py = y*cellPx;
        if(item.type === 'pitch'){
          // green pitch
          ctx.fillStyle = '#10784a';
          ctx.fillRect(px,py,cellPx,cellPx);
        } else if(item.type === 'stand'){
          ctx.fillStyle = '#7a5b3b';
          ctx.fillRect(px,py,cellPx,cellPx);
        } else if(item.type === 'dugout'){
          ctx.fillStyle = '#304050';
          ctx.fillRect(px,py,cellPx,cellPx);
        } else if(item.type === 'flag'){
          ctx.fillStyle = '#f4d03f';
          ctx.fillRect(px,py,cellPx,cellPx);
          // small flag marker
          ctx.fillStyle = '#e01b24';
          ctx.fillRect(px+cellPx*0.35, py+cellPx*0.15, cellPx*0.3, cellPx*0.3);
        } else {
          // empty cell
          ctx.fillStyle = '#07211a';
          ctx.fillRect(px,py,cellPx,cellPx);
        }
        // grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.03)';
        ctx.strokeRect(px,py,cellPx,cellPx);
      }
    }

    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = (stadiumNameInput.value || 'stadium') + '.png';
    a.click();
  });

  // keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    if(e.key === 'z' && (e.ctrlKey || e.metaKey)){
      undoBtn.click();
    } else if(e.key === 'e'){
      selectTool('erase');
    } else if(e.key === 'p'){
      selectTool('pitch');
    } else if(e.key === 's'){
      selectTool('stand');
    }
  });

  function selectTool(name){
    currentTool = name;
    tools.forEach(b => b.classList.toggle('active', b.dataset.tool === name));
  }

  // init
  applyGridStyles();

})();
