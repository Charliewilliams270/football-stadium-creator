
// 3D Stadium Creator (three.js)
// Keep this single-file starter simple and self-contained.

(() => {
  // UI elements
  const canvasHolder = document.getElementById('canvasHolder');
  const gridSizeInput = document.getElementById('gridSize');
  const cellPxInput = document.getElementById('cellPx');
  const resizeBtn = document.getElementById('resizeGrid');
  const tools = document.querySelectorAll('.tool');
  const undoBtn = document.getElementById('undo');
  const clearBtn = document.getElementById('clear');
  const exportJsonBtn = document.getElementById('exportJson');
  const exportGLBBtn = document.getElementById('exportGLB');
  const stadiumNameInput = document.getElementById('stadiumName');

  // three.js essentials
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x071427);

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(canvasHolder.clientWidth, canvasHolder.clientHeight);
  canvasHolder.appendChild(renderer.domElement);

  const camera = new THREE.PerspectiveCamera(45, canvasHolder.clientWidth / canvasHolder.clientHeight, 0.1, 1000);
  camera.position.set(0, 30, 40);

  const controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;

  // lighting
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.9);
  hemi.position.set(0, 50, 0);
  scene.add(hemi);

  const dir = new THREE.DirectionalLight(0xffffff, 0.6);
  dir.position.set(10, 30, 20);
  scene.add(dir);

  // grid / placement plane
  let gridSize = parseInt(gridSizeInput.value,10) || 24;
  let cellSize = parseFloat(cellPxInput.value) || 2; // world units per cell

  const placementGroup = new THREE.Group();
  scene.add(placementGroup); // all placed objects go here

  let gridHelper = null;
  let placementPlane = null;

  function makeGrid(n, cell) {
    // remove old
    if(gridHelper) scene.remove(gridHelper);
    if(placementPlane) scene.remove(placementPlane);

    const fullSize = n * cell;
    // grid helper: subtle lines
    const grid = new THREE.GridHelper(fullSize, n, 0x0f3e2a, 0x072b1f);
    grid.rotation.x = Math.PI / 2; // rotate so lines align on XZ plane
    grid.position.set(fullSize/2 - cell/2, 0, fullSize/2 - cell/2);
    grid.material.opacity = 0.45;
    grid.material.transparent = true;
    gridHelper = grid;
    scene.add(gridHelper);

    // invisible plane used for raycasting placements
    const geo = new THREE.PlaneGeometry(fullSize, fullSize);
    const mat = new THREE.MeshBasicMaterial({ visible: false });
    const plane = new THREE.Mesh(geo, mat);
    plane.rotation.x = -Math.PI/2;
    plane.position.set(fullSize/2 - cell/2, 0, fullSize/2 - cell/2);
    placementPlane = plane;
    scene.add(placementPlane);
  }

  // Initially create grid
  makeGrid(gridSize, cellSize);

  // model (simple array of placed items)
  let model = { n: gridSize, cell: cellSize, items: [] };
  let history = [];

  function saveHistory() {
    history.push(JSON.stringify(model));
    if(history.length>200) history.shift();
  }

  // Tools & placement
  let currentTool = 'pitch';
  tools.forEach(btn => {
    btn.addEventListener('click', () => {
      tools.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentTool = btn.dataset.tool;
    });
  });

  // Geometry factories for performance (reused materials)
  const materials = {
    pitch: new THREE.MeshStandardMaterial({ color: 0x1f8a5f, roughness: 0.8 }),
    stand: new THREE.MeshStandardMaterial({ color: 0x7a5b3b, roughness: 0.6 }),
    dugout: new THREE.MeshStandardMaterial({ color: 0x2f3b45, roughness: 0.6 }),
    flagPole: new THREE.MeshStandardMaterial({ color: 0x222222 }),
    flagCloth: new THREE.MeshStandardMaterial({ color: 0xe01b24, metalness:0.1 }),
    helper: new THREE.MeshBasicMaterial({ color: 0xffff00 })
  };

  function createPitchTile() {
    const geo = new THREE.BoxGeometry(cellSize, 0.1, cellSize);
    const mesh = new THREE.Mesh(geo, materials.pitch);
    return mesh;
  }
  function createStandTile() {
    const geo = new THREE.BoxGeometry(cellSize, cellSize*0.6, cellSize);
    const mesh = new THREE.Mesh(geo, materials.stand);
    mesh.position.y = (cellSize*0.6)/2;
    return mesh;
  }
  function createDugoutTile() {
    const geo = new THREE.BoxGeometry(cellSize, cellSize*0.35, cellSize*0.6);
    const mesh = new THREE.Mesh(geo, materials.dugout);
    mesh.position.y = (cellSize*0.35)/2;
    return mesh;
  }
  function createFlagTile() {
    const group = new THREE.Group();
    const poleGeo = new THREE.CylinderGeometry(0.05 * cellSize, 0.05*cellSize, cellSize*1.1, 8);
    const pole = new THREE.Mesh(poleGeo, materials.flagPole);
    pole.position.y = cellSize*0.55;
    group.add(pole);
    const clothGeo = new THREE.BoxGeometry(cellSize*0.4, cellSize*0.22, cellSize*0.02);
    const cloth = new THREE.Mesh(clothGeo, materials.flagCloth);
    cloth.position.set(cellSize*0.18, cellSize*0.75, 0);
    group.add(cloth);
    return group;
  }

  // Raycaster & pointer handling
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function getGridCoordsFromIntersection(point) {
    // Point is in world space; grid origin is at (0,0,0) with offset
    const fullSize = model.n * model.cell;
    const x = Math.floor((point.x) / model.cell + 0.00001);
    const z = Math.floor((point.z) / model.cell + 0.00001);
    // clamp
    const ix = Math.max(0, Math.min(model.n-1, x));
    const iz = Math.max(0, Math.min(model.n-1, z));
    return { ix, iz };
  }

  function worldPositionFromGrid(ix, iz) {
    const x = ix * model.cell;
    const z = iz * model.cell;
    return { x: x + model.cell/2, z: z + model.cell/2 };
  }

  function addItem(type, ix, iz) {
    saveHistory();
    // prevent duplicate exact same item at same cell (unless allowed)
    // we'll allow pitch and stand to coexist? no, keep one item per cell
    model.items = model.items.filter(it => !(it.ix === ix && it.iz === iz));
    const pos = worldPositionFromGrid(ix, iz);
    let mesh;
    if(type === 'pitch') mesh = createPitchTile();
    if(type === 'stand') mesh = createStandTile();
    if(type === 'dugout') mesh = createDugoutTile();
    if(type === 'flag') mesh = createFlagTile();
    mesh.position.set(pos.x - (model.n*model.cell)/2 + model.cell/2, 0, pos.z - (model.n*model.cell)/2 + model.cell/2);
    mesh.userData = { type, ix, iz };
    placementGroup.add(mesh);
    model.items.push({ type, ix, iz });
  }

  function removeItemAt(ix, iz) {
    saveHistory();
    // remove from model and from scene
    model.items = model.items.filter(it => !(it.ix === ix && it.iz === iz));
    // remove meshes in group matching position
    const toRemove = [];
    placementGroup.children.forEach(child => {
      const d = child.userData;
      if(d && d.ix === ix && d.iz === iz) toRemove.push(child);
    });
    toRemove.forEach(m => placementGroup.remove(m));
  }

  // Helper to re-render model (clear and re-add)
  function rebuildPlacementGroup() {
    while(placementGroup.children.length) placementGroup.remove(placementGroup.children[0]);
    model.items.forEach(it => addItemFromModel(it));
  }
  function addItemFromModel(it) {
    const { type, ix, iz } = it;
    const pos = worldPositionFromGrid(ix, iz);
    let mesh;
    if(type === 'pitch') mesh = createPitchTile();
    if(type === 'stand') mesh = createStandTile();
    if(type === 'dugout') mesh = createDugoutTile();
    if(type === 'flag') mesh = createFlagTile();
    mesh.position.set(pos.x - (model.n*model.cell)/2 + model.cell/2, 0, pos.z - (model.n*model.cell)/2 + model.cell/2);
    mesh.userData = { type, ix, iz };
    placementGroup.add(mesh);
  }

  // on pointer down: place/remove/select
  let isPointerDown = false;
  renderer.domElement.addEventListener('pointerdown', (ev) => {
    isPointerDown = true;
    handlePointerEvent(ev);
  });
  renderer.domElement.addEventListener('pointerup', () => { isPointerDown = false; });
  renderer.domElement.addEventListener('pointermove', (ev) => {
    if(isPointerDown && (currentTool !== 'select')) {
      // allow drag placing (optional)
      handlePointerEvent(ev, true);
    }
  });

  function handlePointerEvent(ev, continuous=false) {
    // compute pointer normalized
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = - ((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const intersects = raycaster.intersectObject(placementPlane);
    if(intersects.length === 0) return;
    const p = intersects[0].point;
    const { ix, iz } = getGridCoordsFromIntersection(
      // convert point to grid coords relative to plane (plane positioned so world coordinates match)
      { x: p.x + (model.n*model.cell)/2 - model.cell/2, z: p.z + (model.n*model.cell)/2 - model.cell/2 }
    );
    if(currentTool === 'erase') {
      removeItemAt(ix, iz);
    } else if(currentTool === 'select') {
      // simple: pick object at that grid and highlight (temporarily)
      // find placed mesh
      const found = placementGroup.children.find(c => c.userData && c.userData.ix === ix && c.userData.iz === iz);
      if(found) {
        // toggle highlight: scale up briefly
        found.scale.set(1.05,1.05,1.05);
        setTimeout(()=>found.scale.set(1,1,1), 140);
      }
    } else {
      addItem(currentTool, ix, iz);
    }
  }

  // resize grid
  resizeBtn.addEventListener('click', () => {
    const n = Math.max(8, Math.min(128, parseInt(gridSizeInput.value,10) || 24));
    const cell = Math.max(0.5, Math.min(8, parseFloat(cellPxInput.value) || 2));
    gridSize = n; cellSize = cell;
    model = { n: gridSize, cell: cellSize, items: [] };
    history = [];
    makeGrid(gridSize, cellSize);
    // reset camera position a bit
    camera.position.set(0, Math.max(20, gridSize/1.4 * cell), gridSize*cell/1.8);
    controls.update();
    rebuildPlacementGroup();
  });

  // undo, clear
  undoBtn.addEventListener('click', () => {
    if(history.length === 0) return;
    const prev = history.pop();
    model = JSON.parse(prev);
    // rebuild scene
    makeGrid(model.n, model.cell);
    rebuildPlacementGroup();
  });

  clearBtn.addEventListener('click', () => {
    saveHistory();
    model.items = [];
    while(placementGroup.children.length) placementGroup.remove(placementGroup.children[0]);
  });

  // export model JSON
  exportJsonBtn.addEventListener('click', () => {
    const payload = {
      meta: { name: stadiumNameInput.value || 'My 3D Stadium', created: new Date().toISOString() },
      n: model.n,
      cell: model.cell,
      items: model.items
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (stadiumNameInput.value || 'stadium') + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // export glTF (GLB binary) using GLTFExporter
  exportGLBBtn.addEventListener('click', () => {
    const exporter = new THREE.GLTFExporter();
    // clone placementGroup into a fresh group to avoid exporting grid/plane
    const exportGroup = placementGroup.clone(true);
    // make a temporary scene for exporter with lights removed (export only geometry)
    const exportScene = new THREE.Scene();
    exportScene.add(exportGroup);
    exporter.parse(exportScene, function(result) {
      if(result instanceof ArrayBuffer) {
        const blob = new Blob([result], { type: 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (stadiumNameInput.value || 'stadium') + '.glb';
        a.click();
        URL.revokeObjectURL(a.href);
      } else {
        // JSON glTF (not used often)
        const output = JSON.stringify(result, null, 2);
        const blob = new Blob([output], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = (stadiumNameInput.value || 'stadium') + '.gltf';
        a.click();
        URL.revokeObjectURL(a.href);
      }
    }, { binary: true });
  });

  // handle window resize
  window.addEventListener('resize', onWindowResize);
  function onWindowResize() {
    renderer.setSize(canvasHolder.clientWidth, canvasHolder.clientHeight);
    camera.aspect = canvasHolder.clientWidth / canvasHolder.clientHeight;
    camera.updateProjectionMatrix();
  }

  // animation loop
  function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  // init view: center grid around origin. We'll offset placement positions to keep grid centered.
  // reset model to initial
  model = { n: gridSize, cell: cellSize, items: [] };
  makeGrid(gridSize, cellSize);

  // helpful instructions printed in console
  console.log('3D Stadium Creator ready — click to place objects. Use Orbit to rotate/zoom.');

})();
