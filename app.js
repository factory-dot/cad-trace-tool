(() => {
  "use strict";

  // ---------- DOM ----------
  const stage = document.getElementById("stage");
  const bgCanvas = document.getElementById("bgCanvas");
  const drawCanvas = document.getElementById("drawCanvas");
  const bgCtx = bgCanvas.getContext("2d");
  const ctx = drawCanvas.getContext("2d");

  const imageInput = document.getElementById("imageInput");
  const showBgChk = document.getElementById("showBg");
  const bgOpacity = document.getElementById("bgOpacity");
  const toolGroup = document.getElementById("toolGroup");
  const angleSnapChk = document.getElementById("angleSnap");
  const angleStepSel = document.getElementById("angleStep");
  const gridSnapChk = document.getElementById("gridSnap");
  const gridSizeInput = document.getElementById("gridSize");
  const strokeColorInput = document.getElementById("strokeColor");
  const undoBtn = document.getElementById("undoBtn");
  const redoBtn = document.getElementById("redoBtn");
  const clearBtn = document.getElementById("clearBtn");
  const saveProjBtn = document.getElementById("saveProjBtn");
  const loadProjInput = document.getElementById("loadProjInput");
  const includeBgInExport = document.getElementById("includeBgInExport");
  const exportPdfBtn = document.getElementById("exportPdfBtn");
  const hint = document.getElementById("hint");

  // ---------- State ----------
  const DEFAULT_W = 1123; // A4 landscape @96dpi
  const DEFAULT_H = 794;
  const MAX_SIDE = 1800;
  const VERTEX_SNAP_TOL = 10;

  let elements = [];
  let selectedIndex = -1;
  let draft = null; // in-progress shape
  let currentTool = "select";
  let bgImage = null; // HTMLImageElement
  let bgImageDataURL = null;

  let historyStack = [];
  let historyIndex = -1;

  // ---------- Canvas sizing ----------
  function setCanvasSize(w, h) {
    [bgCanvas, drawCanvas].forEach(c => {
      c.width = w;
      c.height = h;
    });
    stage.style.width = w + "px";
    stage.style.height = h + "px";
  }
  setCanvasSize(DEFAULT_W, DEFAULT_H);

  // ---------- History ----------
  function pushHistory() {
    historyStack = historyStack.slice(0, historyIndex + 1);
    historyStack.push(JSON.stringify(elements));
    if (historyStack.length > 200) historyStack.shift();
    historyIndex = historyStack.length - 1;
    autosave();
  }
  function restoreFromHistory() {
    elements = JSON.parse(historyStack[historyIndex]);
    selectedIndex = -1;
    render();
    autosave();
  }
  function undo() {
    if (historyIndex <= 0) {
      if (historyIndex === 0) { historyIndex = -1; elements = []; render(); autosave(); }
      return;
    }
    historyIndex--;
    restoreFromHistory();
  }
  function redo() {
    if (historyIndex >= historyStack.length - 1) return;
    historyIndex++;
    restoreFromHistory();
  }
  // initialize with empty state
  historyStack = [JSON.stringify([])];
  historyIndex = 0;

  // ---------- Autosave ----------
  const AUTOSAVE_KEY = "cadTraceProject.v1";
  function autosave() {
    try {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
        elements, width: drawCanvas.width, height: drawCanvas.height, bgImageDataURL
      }));
    } catch (e) { /* storage full or unavailable - ignore */ }
  }
  function tryRestoreAutosave() {
    let raw;
    try { raw = localStorage.getItem(AUTOSAVE_KEY); } catch (e) { return; }
    if (!raw) return;
    let data;
    try { data = JSON.parse(raw); } catch (e) { return; }
    if (!data || !data.elements || data.elements.length === 0) return;
    if (!confirm("前回の作業内容が見つかりました。復元しますか？")) return;
    loadProjectData(data);
  }

  function loadProjectData(data) {
    setCanvasSize(data.width || DEFAULT_W, data.height || DEFAULT_H);
    elements = data.elements || [];
    if (data.bgImageDataURL) {
      const img = new Image();
      img.onload = () => { bgImage = img; bgImageDataURL = data.bgImageDataURL; redrawBackground(); };
      img.src = data.bgImageDataURL;
    } else {
      bgImage = null; bgImageDataURL = null;
      redrawBackground();
    }
    historyStack = [JSON.stringify(elements)];
    historyIndex = 0;
    selectedIndex = -1;
    render();
  }

  // ---------- Image loading ----------
  imageInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth, h = img.naturalHeight;
        const longest = Math.max(w, h);
        if (longest > MAX_SIDE) {
          const scale = MAX_SIDE / longest;
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        setCanvasSize(w, h);
        bgImage = img;
        // re-encode at working resolution so autosave/export stays consistent
        const tmp = document.createElement("canvas");
        tmp.width = w; tmp.height = h;
        tmp.getContext("2d").drawImage(img, 0, 0, w, h);
        bgImageDataURL = tmp.toDataURL("image/png");
        redrawBackground();
        autosave();
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
    imageInput.value = "";
  });

  showBgChk.addEventListener("change", redrawBackground);
  bgOpacity.addEventListener("input", redrawBackground);
  gridSnapChk.addEventListener("change", redrawBackground);
  gridSizeInput.addEventListener("change", redrawBackground);

  function redrawBackground() {
    bgCtx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
    bgCtx.fillStyle = "#ffffff";
    bgCtx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);
    if (bgImage && showBgChk.checked) {
      bgCtx.globalAlpha = bgOpacity.value / 100;
      bgCtx.drawImage(bgImage, 0, 0, bgCanvas.width, bgCanvas.height);
      bgCtx.globalAlpha = 1;
    }
    if (gridSnapChk.checked) drawGrid(bgCtx, bgCanvas.width, bgCanvas.height);
  }

  function drawGrid(c, w, h) {
    const size = Math.max(4, parseInt(gridSizeInput.value, 10) || 20);
    c.save();
    c.strokeStyle = "rgba(37, 99, 235, 0.18)";
    c.lineWidth = 1;
    c.beginPath();
    for (let x = 0; x <= w; x += size) { c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, h); }
    for (let y = 0; y <= h; y += size) { c.moveTo(0, y + 0.5); c.lineTo(w, y + 0.5); }
    c.stroke();
    c.restore();
  }

  // ---------- Tool selection ----------
  toolGroup.addEventListener("click", (e) => {
    const btn = e.target.closest(".tool");
    if (!btn) return;
    setTool(btn.dataset.tool);
  });

  function setTool(tool) {
    cancelDraft();
    currentTool = tool;
    selectedIndex = -1;
    [...toolGroup.querySelectorAll(".tool")].forEach(b => b.classList.toggle("active", b.dataset.tool === tool));
    const hints = {
      select: "クリックして要素を選択。Deleteキーで削除。",
      line: "直線ツール: クリックで開始点、以後クリックで連結。Escで確定終了。",
      rect: "四角形ツール: ドラッグして対角に配置。",
      circle: "円ツール: 中心からドラッグして半径を決定。",
      dimension: "寸法線ツール: 1点目・2点目をクリックし、位置を決めて3回目のクリックで確定。",
      text: "文字ツール: クリックした位置にテキストを配置します。",
    };
    hint.textContent = hints[tool] || "";
    render();
  }

  function cancelDraft() {
    draft = null;
    render();
  }

  // ---------- Geometry helpers ----------
  function getMousePos(e) {
    const rect = drawCanvas.getBoundingClientRect();
    const scaleX = drawCanvas.width / rect.width;
    const scaleY = drawCanvas.height / rect.height;
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  }

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  function allVertices() {
    const pts = [];
    for (const el of elements) {
      if (el.type === "line") pts.push(...el.points);
      else if (el.type === "rect") pts.push(el.start, el.end,
        { x: el.start.x, y: el.end.y }, { x: el.end.x, y: el.start.y });
      else if (el.type === "circle") pts.push(el.center);
      else if (el.type === "dimension") pts.push(el.p1, el.p2);
    }
    return pts;
  }

  function findNearbyVertex(pt) {
    let best = null, bestD = VERTEX_SNAP_TOL;
    for (const v of allVertices()) {
      const d = dist(v, pt);
      if (d < bestD) { bestD = d; best = v; }
    }
    return best ? { x: best.x, y: best.y } : null;
  }

  function snapAngleFrom(prev, pt) {
    const step = (parseInt(angleStepSel.value, 10) || 15) * Math.PI / 180;
    const dx = pt.x - prev.x, dy = pt.y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return { x: pt.x, y: pt.y };
    let ang = Math.atan2(dy, dx);
    ang = Math.round(ang / step) * step;
    return { x: prev.x + Math.cos(ang) * len, y: prev.y + Math.sin(ang) * len };
  }

  function snapToGrid(pt) {
    const size = Math.max(4, parseInt(gridSizeInput.value, 10) || 20);
    return { x: Math.round(pt.x / size) * size, y: Math.round(pt.y / size) * size };
  }

  // Generic snap used for standalone points (rect corners, circle center, dimension anchor points)
  function snapPoint(pt, prev) {
    const v = findNearbyVertex(pt);
    if (v) return v;
    let p = { x: pt.x, y: pt.y };
    if (prev && angleSnapChk.checked) p = snapAngleFrom(prev, p);
    if (gridSnapChk.checked) p = snapToGrid(p);
    return p;
  }

  function clampToCanvas(pt) {
    return {
      x: Math.min(Math.max(pt.x, 0), drawCanvas.width),
      y: Math.min(Math.max(pt.y, 0), drawCanvas.height)
    };
  }

  // ---------- Drawing ----------
  function render() {
    ctx.clearRect(0, 0, drawCanvas.width, drawCanvas.height);
    elements.forEach((el, i) => drawElement(ctx, el, i === selectedIndex));
    if (draft) drawDraft(ctx, draft);
  }

  function drawElement(c, el, selected) {
    c.save();
    c.lineCap = "round";
    c.lineJoin = "round";
    if (selected) { c.shadowColor = "#2563eb"; c.shadowBlur = 6; }
    switch (el.type) {
      case "line": drawLine(c, el, selected); break;
      case "rect": drawRect(c, el, selected); break;
      case "circle": drawCircle(c, el, selected); break;
      case "dimension": drawDimension(c, el, selected); break;
      case "text": drawText(c, el, selected); break;
    }
    c.restore();
  }

  function drawLine(c, el, selected) {
    if (el.points.length < 2) return;
    c.strokeStyle = selected ? "#2563eb" : el.color || "#111111";
    c.lineWidth = 2.2;
    c.beginPath();
    c.moveTo(el.points[0].x, el.points[0].y);
    for (let i = 1; i < el.points.length; i++) c.lineTo(el.points[i].x, el.points[i].y);
    c.stroke();
  }

  function drawRect(c, el, selected) {
    c.strokeStyle = selected ? "#2563eb" : el.color || "#111111";
    c.lineWidth = 2.2;
    const x = Math.min(el.start.x, el.end.x);
    const y = Math.min(el.start.y, el.end.y);
    const w = Math.abs(el.end.x - el.start.x);
    const h = Math.abs(el.end.y - el.start.y);
    c.strokeRect(x, y, w, h);
  }

  function drawCircle(c, el, selected) {
    c.strokeStyle = selected ? "#2563eb" : el.color || "#111111";
    c.lineWidth = 2.2;
    c.beginPath();
    c.arc(el.center.x, el.center.y, el.radius, 0, Math.PI * 2);
    c.stroke();
  }

  function drawText(c, el, selected) {
    c.fillStyle = selected ? "#2563eb" : "#111111";
    c.font = "16px 'Segoe UI', sans-serif";
    c.textBaseline = "top";
    c.fillText(el.text, el.point.x, el.point.y);
  }

  function computeDimensionGeometry(p1, p2, offset) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const dirX = dx / len, dirY = dy / len;
    const nx = -dirY, ny = dirX;
    const a2 = { x: p1.x + nx * offset, y: p1.y + ny * offset };
    const b2 = { x: p2.x + nx * offset, y: p2.y + ny * offset };
    return { dirX, dirY, nx, ny, a2, b2, len };
  }

  function drawArrowhead(c, tip, dirX, dirY, size, color) {
    const spread = 0.35;
    const backX = tip.x - dirX * size, backY = tip.y - dirY * size;
    const perpX = -dirY, perpY = dirX;
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(tip.x, tip.y);
    c.lineTo(backX + perpX * size * spread * 2, backY + perpY * size * spread * 2);
    c.lineTo(backX - perpX * size * spread * 2, backY - perpY * size * spread * 2);
    c.closePath();
    c.fill();
  }

  function drawDimension(c, el, selected) {
    const color = selected ? "#2563eb" : "#111111";
    const { dirX, dirY, a2, b2 } = computeDimensionGeometry(el.p1, el.p2, el.offset);
    const overshoot = 4;

    c.strokeStyle = color;
    c.lineWidth = 0.9;
    // extension lines (from measured point out past the dimension line)
    [[el.p1, a2], [el.p2, b2]].forEach(([from, to]) => {
      const ex = to.x + (to.x - from.x === 0 ? 0 : (to.x - from.x) / Math.hypot(to.x - from.x, to.y - from.y) * overshoot);
      const ey = to.y + (to.y - from.y === 0 ? 0 : (to.y - from.y) / Math.hypot(to.x - from.x, to.y - from.y) * overshoot);
      c.beginPath();
      c.moveTo(from.x, from.y);
      c.lineTo(isFinite(ex) ? ex : to.x, isFinite(ey) ? ey : to.y);
      c.stroke();
    });

    // label + background
    const mid = { x: (a2.x + b2.x) / 2, y: (a2.y + b2.y) / 2 };
    const label = el.label || "";
    c.font = "13px 'Segoe UI', sans-serif";
    const textW = c.measureText(label).width;
    const gap = textW / 2 + 6;

    // dimension line, split around the label
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(a2.x, a2.y);
    c.lineTo(mid.x - dirX * gap, mid.y - dirY * gap);
    c.moveTo(mid.x + dirX * gap, mid.y + dirY * gap);
    c.lineTo(b2.x, b2.y);
    c.stroke();

    drawArrowhead(c, a2, -dirX, -dirY, 9, color);
    drawArrowhead(c, b2, dirX, dirY, 9, color);

    if (label) {
      c.save();
      c.translate(mid.x, mid.y);
      let angle = Math.atan2(dirY, dirX);
      if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
      c.rotate(angle);
      c.fillStyle = "#ffffff";
      c.fillRect(-textW / 2 - 3, -9, textW + 6, 18);
      c.fillStyle = color;
      c.textAlign = "center";
      c.textBaseline = "middle";
      c.fillText(label, 0, 0);
      c.restore();
    }
  }

  function drawDraft(c, d) {
    c.save();
    c.setLineDash([6, 4]);
    c.strokeStyle = "#2563eb";
    c.lineWidth = 1.6;
    if (d.type === "line") {
      const pts = d.points.concat(d.preview ? [d.preview] : []);
      if (pts.length >= 2) {
        c.beginPath();
        c.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) c.lineTo(pts[i].x, pts[i].y);
        c.stroke();
      }
      pts.forEach(p => dotMarker(c, p));
    } else if (d.type === "rect" && d.start && d.preview) {
      const x = Math.min(d.start.x, d.preview.x), y = Math.min(d.start.y, d.preview.y);
      const w = Math.abs(d.preview.x - d.start.x), h = Math.abs(d.preview.y - d.start.y);
      c.strokeRect(x, y, w, h);
    } else if (d.type === "circle" && d.center && d.preview) {
      const r = dist(d.center, d.preview);
      c.beginPath();
      c.arc(d.center.x, d.center.y, r, 0, Math.PI * 2);
      c.stroke();
    } else if (d.type === "dimension") {
      if (d.p1 && !d.p2 && d.preview) {
        c.beginPath(); c.moveTo(d.p1.x, d.p1.y); c.lineTo(d.preview.x, d.preview.y); c.stroke();
        dotMarker(c, d.p1);
      } else if (d.p1 && d.p2) {
        const offset = d.preview ? computeOffsetFromMouse(d.p1, d.p2, d.preview) : 0;
        c.setLineDash([]);
        drawDimension(c, { p1: d.p1, p2: d.p2, offset, label: "" }, true);
        dotMarker(c, d.p1); dotMarker(c, d.p2);
      }
    } else if (d.type === "text" && d.point) {
      dotMarker(c, d.point);
    }
    c.restore();
  }

  function dotMarker(c, p) {
    c.save();
    c.setLineDash([]);
    c.fillStyle = "#2563eb";
    c.beginPath();
    c.arc(p.x, p.y, 3, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }

  function computeOffsetFromMouse(p1, p2, mouse) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    return (mouse.x - p1.x) * nx + (mouse.y - p1.y) * ny;
  }

  // ---------- Hit testing (for select tool) ----------
  function distToSegment(p, a, b) {
    const l2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2;
    if (l2 === 0) return dist(p, a);
    let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return dist(p, { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
  }

  function hitTest(pt) {
    const TOL = 8;
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (el.type === "line") {
        for (let j = 0; j < el.points.length - 1; j++) {
          if (distToSegment(pt, el.points[j], el.points[j + 1]) <= TOL) return i;
        }
      } else if (el.type === "rect") {
        const corners = [el.start, { x: el.end.x, y: el.start.y }, el.end, { x: el.start.x, y: el.end.y }, el.start];
        for (let j = 0; j < corners.length - 1; j++) {
          if (distToSegment(pt, corners[j], corners[j + 1]) <= TOL) return i;
        }
      } else if (el.type === "circle") {
        if (Math.abs(dist(pt, el.center) - el.radius) <= TOL) return i;
      } else if (el.type === "dimension") {
        const { a2, b2 } = computeDimensionGeometry(el.p1, el.p2, el.offset);
        if (distToSegment(pt, a2, b2) <= TOL || distToSegment(pt, el.p1, a2) <= TOL || distToSegment(pt, el.p2, b2) <= TOL) return i;
      } else if (el.type === "text") {
        ctx.font = "16px 'Segoe UI', sans-serif";
        const w = ctx.measureText(el.text).width;
        if (pt.x >= el.point.x - 2 && pt.x <= el.point.x + w + 2 && pt.y >= el.point.y - 2 && pt.y <= el.point.y + 20) return i;
      }
    }
    return -1;
  }

  // ---------- Pointer interaction ----------
  let isDown = false;

  drawCanvas.addEventListener("pointerdown", (e) => {
    drawCanvas.setPointerCapture(e.pointerId);
    const raw = clampToCanvas(getMousePos(e));
    isDown = true;

    if (currentTool === "select") {
      selectedIndex = hitTest(raw);
      render();
      return;
    }

    if (currentTool === "line") {
      if (!draft) {
        const p = snapPoint(raw, null);
        draft = { type: "line", points: [p] };
      } else {
        const prev = draft.points[draft.points.length - 1];
        const p = snapPoint(raw, prev);
        draft.points.push(p);
      }
      render();
      return;
    }

    if (currentTool === "rect") {
      const p = snapPoint(raw, null);
      draft = { type: "rect", start: p, preview: p };
      return;
    }

    if (currentTool === "circle") {
      const p = snapPoint(raw, null);
      draft = { type: "circle", center: p, preview: p };
      return;
    }

    if (currentTool === "dimension") {
      if (!draft) {
        const p = snapPoint(raw, null);
        draft = { type: "dimension", p1: p };
      } else if (!draft.p2) {
        const p = snapPoint(raw, draft.p1);
        draft.p2 = p;
      } else {
        const offset = computeOffsetFromMouse(draft.p1, draft.p2, raw);
        const px = Math.round(dist(draft.p1, draft.p2));
        const label = prompt("寸法値を入力してください（実寸に合わせて自由に編集可）", String(px));
        if (label !== null) {
          elements.push({ type: "dimension", p1: draft.p1, p2: draft.p2, offset, label });
          pushHistory();
        }
        draft = null;
      }
      render();
      return;
    }

    if (currentTool === "text") {
      const p = snapPoint(raw, null);
      const text = prompt("テキストを入力してください", "");
      if (text) {
        elements.push({ type: "text", point: p, text });
        pushHistory();
      }
      draft = null;
      render();
      return;
    }
  });

  drawCanvas.addEventListener("pointermove", (e) => {
    const raw = clampToCanvas(getMousePos(e));

    if (currentTool === "line" && draft) {
      const prev = draft.points[draft.points.length - 1];
      draft.preview = snapPoint(raw, prev);
      render();
    } else if (currentTool === "rect" && draft && isDown) {
      draft.preview = snapPoint(raw, null);
      render();
    } else if (currentTool === "circle" && draft && isDown) {
      draft.preview = snapPoint(raw, null);
      render();
    } else if (currentTool === "dimension" && draft) {
      draft.preview = draft.p2 ? raw : snapPoint(raw, draft.p1);
      render();
    }
  });

  drawCanvas.addEventListener("pointerup", (e) => {
    isDown = false;
    if (currentTool === "rect" && draft && draft.start) {
      const p = snapPoint(clampToCanvas(getMousePos(e)), null);
      if (dist(draft.start, p) > 2) {
        elements.push({ type: "rect", start: draft.start, end: p, color: strokeColorInput.value });
        pushHistory();
      }
      draft = null;
      render();
    } else if (currentTool === "circle" && draft && draft.center) {
      const p = snapPoint(clampToCanvas(getMousePos(e)), null);
      const r = dist(draft.center, p);
      if (r > 2) {
        elements.push({ type: "circle", center: draft.center, radius: r, color: strokeColorInput.value });
        pushHistory();
      }
      draft = null;
      render();
    }
  });

  drawCanvas.addEventListener("dblclick", () => {
    if (currentTool === "line" && draft && draft.points.length >= 2) {
      finishLineDraft();
    }
  });

  drawCanvas.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (currentTool === "line" && draft) finishLineDraft();
  });

  function finishLineDraft() {
    if (draft && draft.type === "line" && draft.points.length >= 2) {
      elements.push({ type: "line", points: draft.points, color: strokeColorInput.value });
      pushHistory();
    }
    draft = null;
    render();
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (currentTool === "line" && draft) finishLineDraft();
      else { draft = null; selectedIndex = -1; render(); }
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (currentTool === "select" && selectedIndex >= 0 && document.activeElement === document.body) {
        elements.splice(selectedIndex, 1);
        selectedIndex = -1;
        pushHistory();
        render();
      }
    } else if (e.ctrlKey && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    } else if (e.ctrlKey && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    }
  });

  // ---------- Toolbar buttons ----------
  undoBtn.addEventListener("click", undo);
  redoBtn.addEventListener("click", redo);
  clearBtn.addEventListener("click", () => {
    if (elements.length === 0) return;
    if (!confirm("描画した図形をすべて消去します。よろしいですか？")) return;
    elements = [];
    selectedIndex = -1;
    draft = null;
    pushHistory();
    render();
  });

  // ---------- Project save/load ----------
  saveProjBtn.addEventListener("click", () => {
    const data = { elements, width: drawCanvas.width, height: drawCanvas.height, bgImageDataURL };
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cad-project.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  loadProjInput.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        loadProjectData(data);
      } catch (err) {
        alert("プロジェクトファイルの読み込みに失敗しました。");
      }
    };
    reader.readAsText(file);
    loadProjInput.value = "";
  });

  // ---------- PDF export ----------
  exportPdfBtn.addEventListener("click", async () => {
    const w = drawCanvas.width, h = drawCanvas.height;
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = w; exportCanvas.height = h;
    const ex = exportCanvas.getContext("2d");
    ex.fillStyle = "#ffffff";
    ex.fillRect(0, 0, w, h);
    if (includeBgInExport.checked && bgImage) {
      ex.drawImage(bgImage, 0, 0, w, h);
    }
    elements.forEach(el => drawElement(ex, el, false));

    const dataUrl = exportCanvas.toDataURL("image/png");
    const { jsPDF } = window.jspdf;
    const mmW = w * 25.4 / 96;
    const mmH = h * 25.4 / 96;
    const pdf = new jsPDF({
      orientation: mmW >= mmH ? "landscape" : "portrait",
      unit: "mm",
      format: [mmW, mmH]
    });
    pdf.addImage(dataUrl, "PNG", 0, 0, mmW, mmH);
    pdf.save("cad-drawing.pdf");
  });

  // ---------- Init ----------
  redrawBackground();
  render();
  tryRestoreAutosave();
})();
