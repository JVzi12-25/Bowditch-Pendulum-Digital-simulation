(() => {
  "use strict";

  const G = 9.81;
  const DURATION = 40;
  const DT = 0.01;
  const IDS = ["span", "left", "right", "lower", "ampX", "ampY", "phase", "damping"];
  const sliders = Object.fromEntries(IDS.map(id => [id, document.getElementById(id)]));
  const canvases = {
    apparatus: document.getElementById("apparatusCanvas"),
    trace: document.getElementById("traceCanvas"),
    signal: document.getElementById("signalCanvas")
  };
  const colors = { cyan: "#58d6da", violet: "#ad96ff", orange: "#ffb45c", grid: "#254356", muted: "#87a6b7" };
  const state = { params: null, geometry: null, samples: [], index: 0, time: 0, playing: true, speed: 1, lastFrame: 0 };
  const defaults = { span: 30, left: 76.5, right: 76.5, lower: 25, ampX: 13, ampY: 9, phase: 45, damping: 0.006 };

  const $ = id => document.getElementById(id);
  const rad = deg => deg * Math.PI / 180;
  const fmt = (n, digits = 2) => Number(n).toFixed(digits);
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const values = () => Object.fromEntries(IDS.map(id => [id, Number(sliders[id].value)]));

  function computeGeometry(p) {
    const d = p.span / 100, l1 = p.left / 100, l2 = p.right / 100, l3 = p.lower / 100;
    if (l1 + l2 <= d || Math.abs(l1 - l2) >= d) {
      return { error: "两根支线无法在支点下方相交。请增大支线长度或缩小支点间距。" };
    }
    const x0 = (l1 * l1 - l2 * l2) / (2 * d);
    const h2 = l1 * l1 - (x0 + d / 2) ** 2;
    if (h2 <= 0.000025) return { error: "汇合点过于接近支点连线；请增大支线长度。" };
    const h = Math.sqrt(h2), Lx = l3, Ly = h + l3;
    return { d, l1, l2, l3, x0, h, Lx, Ly, wx: Math.sqrt(G / Lx), wy: Math.sqrt(G / Ly), ratio: Math.sqrt(Ly / Lx) };
  }

  function derivative(s, length, beta) {
    return [s[1], -(G / length) * Math.sin(s[0]) - 2 * beta * s[1]];
  }

  function integrateStep(s, length, beta, dt) {
    const k1 = derivative(s, length, beta);
    const k2 = derivative([s[0] + k1[0] * dt / 2, s[1] + k1[1] * dt / 2], length, beta);
    const k3 = derivative([s[0] + k2[0] * dt / 2, s[1] + k2[1] * dt / 2], length, beta);
    const k4 = derivative([s[0] + k3[0] * dt, s[1] + k3[1] * dt], length, beta);
    return [s[0] + dt * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]) / 6,
            s[1] + dt * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]) / 6];
  }

  function generateSamples(p, geo) {
    const phi = rad(p.phase), beta = p.damping;
    let sx = [rad(p.ampX), 0];
    let sy = [rad(p.ampY) * Math.cos(phi), -geo.wy * rad(p.ampY) * Math.sin(phi)];
    const series = [];
    for (let i = 0; i <= DURATION / DT; i++) {
      const tx = sx[0], ty = sy[0];
      const j = { x: geo.x0, y: geo.h * Math.sin(ty), z: -geo.h * Math.cos(ty) };
      const b = {
        x: geo.x0 + geo.l3 * Math.sin(tx),
        y: (geo.h + geo.l3 * Math.cos(tx)) * Math.sin(ty),
        z: -(geo.h + geo.l3 * Math.cos(tx)) * Math.cos(ty)
      };
      series.push({ t: i * DT, x: b.x - geo.x0, y: b.y, junction: j, bob: b });
      sx = integrateStep(sx, geo.Lx, beta, DT);
      sy = integrateStep(sy, geo.Ly, beta, DT);
    }
    return series;
  }

  function updateLabels(p) {
    for (const id of ["span", "left", "right", "lower"]) $(id + "Value").textContent = `${fmt(p[id], p[id] % 1 ? 1 : 0)} cm`;
    for (const id of ["ampX", "ampY", "phase"]) $(id + "Value").textContent = `${p[id]}°`;
    $("dampingValue").textContent = `${fmt(p.damping, 3)} s⁻¹`;
  }

  function updateMetrics(geo) {
    $("freqX").textContent = geo ? `${fmt(geo.wx / (2 * Math.PI), 3)} Hz` : "—";
    $("freqY").textContent = geo ? `${fmt(geo.wy / (2 * Math.PI), 3)} Hz` : "—";
    $("ratio").textContent = geo ? `${fmt(geo.ratio, 3)} : 1` : "—";
    $("height").textContent = geo ? `${fmt(geo.h * 100, 1)} cm` : "—";
    if (geo) {
      const targets = [[1, 1], [3, 2], [2, 1], [5, 2], [3, 1]];
      const nearest = targets.reduce((a, b) => Math.abs(b[0] / b[1] - geo.ratio) < Math.abs(a[0] / a[1] - geo.ratio) ? b : a);
      $("ratioHint").textContent = Math.abs(nearest[0] / nearest[1] - geo.ratio) < 0.035 ? `接近 ${nearest[0]}:${nearest[1]}，轨迹可能近似闭合` : "非低阶整数比，轨迹逐渐漂移";
    }
  }

  function syncParameters(resetTime = true) {
    const p = values(), geo = computeGeometry(p), error = $("geometryError");
    state.params = p;
    updateLabels(p);
    if (geo.error) {
      state.geometry = null; state.samples = []; state.playing = false;
      error.textContent = geo.error; error.hidden = false;
      $("playButton").textContent = "▶"; $("playButton").setAttribute("aria-label", "播放仿真");
      updateMetrics(null); drawAll();
      return false;
    }
    error.hidden = true;
    state.geometry = geo;
    state.samples = generateSamples(p, geo);
    if (resetTime) { state.time = 0; state.index = 0; }
    else { state.index = Math.min(state.samples.length - 1, Math.round(state.time / DT)); }
    updateMetrics(geo); updateTimeDisplay(); drawAll();
    return true;
  }

  function canvasContext(canvas) {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, rect.width), h = Math.max(1, rect.height);
    const pxW = Math.round(w * dpr), pxH = Math.round(h * dpr);
    if (canvas.width !== pxW || canvas.height !== pxH) { canvas.width = pxW; canvas.height = pxH; }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx, w, h };
  }

  function drawGrid(ctx, w, h, x0 = 0, y0 = 0, spacing = 32) {
    ctx.strokeStyle = "#183748"; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = x0 % spacing; x < w; x += spacing) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = y0 % spacing; y < h; y += spacing) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
  }

  function line(ctx, a, b, color, width) {
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  }

  function dot(ctx, x, y, radius, fill, glow = false) {
    ctx.save();
    if (glow) { ctx.shadowColor = fill; ctx.shadowBlur = 20; }
    ctx.fillStyle = fill; ctx.beginPath(); ctx.arc(x, y, radius, 0, 2 * Math.PI); ctx.fill();
    ctx.restore();
  }

  function emptyMessage(ctx, w, h) {
    ctx.fillStyle = "#adbec8"; ctx.textAlign = "center"; ctx.font = "14px Microsoft YaHei, sans-serif";
    ctx.fillText("调整几何参数以恢复装置", w / 2, h / 2);
  }

  function drawApparatus() {
    const { ctx, w, h } = canvasContext(canvases.apparatus);
    drawGrid(ctx, w, h);
    if (!state.geometry) return emptyMessage(ctx, w, h);
    const g = state.geometry, s = state.samples[state.index];
    const reach = Math.max(g.d * 1.55, g.h + g.l3, 0.55);
    const scale = Math.min(w * 0.68 / reach, h * 0.67 / (g.h + g.l3));
    const project = p => ({ x: w * 0.50 + (p.x + p.y * 0.37) * scale, y: h * 0.19 - p.z * scale + p.y * scale * 0.10 });
    const a = project({ x: -g.d / 2, y: 0, z: 0 });
    const b = project({ x: g.d / 2, y: 0, z: 0 });
    const j = project(s.junction), bob = project(s.bob);
    const jRest = project({ x: g.x0, y: 0, z: -g.h });
    ctx.setLineDash([4, 6]); line(ctx, jRest, project({ x: g.x0, y: 0, z: -(g.h + g.l3) }), "#4c697c", 1); ctx.setLineDash([]);
    line(ctx, { x: a.x - 20, y: a.y - 13 }, { x: b.x + 20, y: b.y - 13 }, "#587488", 8);
    line(ctx, a, j, "#8fb6c4", 2.3); line(ctx, b, j, "#8fb6c4", 2.3); line(ctx, j, bob, "#c8dce3", 2.8);
    dot(ctx, a.x, a.y, 5, "#93aebd"); dot(ctx, b.x, b.y, 5, "#93aebd");
    dot(ctx, j.x, j.y, 7, colors.violet, true); dot(ctx, bob.x, bob.y, 11, colors.orange, true);
    ctx.font = "12px Microsoft YaHei, sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = colors.muted;
    ctx.fillText("A", a.x, a.y - 19); ctx.fillText("B", b.x, b.y - 19);
    ctx.fillStyle = "#b7cdd7"; ctx.textAlign = "left"; ctx.fillText("节点", j.x + 12, j.y - 8); ctx.fillText("摆球", bob.x + 15, bob.y + 4);
    ctx.fillStyle = "#9ab4c3"; ctx.fillText(`l₁ ${fmt(g.l1 * 100, 0)} cm`, 15, h - 30); ctx.fillText(`l₂ ${fmt(g.l2 * 100, 0)} cm`, 15, h - 12);
  }

  function traceCoordinates(w, h) {
    const s = state.samples;
    const maxX = Math.max(0.03, ...s.filter((_, i) => i % 10 === 0).map(v => Math.abs(v.x)));
    const maxY = Math.max(0.03, ...s.filter((_, i) => i % 10 === 0).map(v => Math.abs(v.y)));
    const scale = Math.min((w - 64) / (2 * maxX), (h - 48) / (2 * maxY));
    return v => ({ x: w / 2 + v.x * scale, y: h / 2 - v.y * scale });
  }

  function drawTrace() {
    const { ctx, w, h } = canvasContext(canvases.trace);
    drawGrid(ctx, w, h);
    if (!state.geometry) return emptyMessage(ctx, w, h);
    line(ctx, { x: 16, y: h / 2 }, { x: w - 16, y: h / 2 }, "#496b7a", 1);
    line(ctx, { x: w / 2, y: 12 }, { x: w / 2, y: h - 12 }, "#496b7a", 1);
    ctx.font = "italic 14px Georgia"; ctx.fillStyle = "#8eacb9"; ctx.fillText("x", w - 22, h / 2 - 7); ctx.fillText("y", w / 2 + 8, 20);
    const pos = traceCoordinates(w, h), samples = state.samples;
    ctx.beginPath();
    for (let i = 0; i <= Math.min(samples.length - 1, 1000); i += 3) {
      const q = pos(samples[i]); if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
    }
    ctx.strokeStyle = "#4c7e8a"; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.beginPath();
    const stride = Math.max(1, Math.floor(state.index / 2500));
    for (let i = 0; i <= state.index; i += stride) {
      const q = pos(samples[i]); if (i === 0) ctx.moveTo(q.x, q.y); else ctx.lineTo(q.x, q.y);
    }
    const last = pos(samples[state.index]); ctx.lineTo(last.x, last.y);
    ctx.strokeStyle = colors.cyan; ctx.lineWidth = 2.2; ctx.shadowColor = "#58d6da88"; ctx.shadowBlur = 9; ctx.stroke(); ctx.shadowBlur = 0;
    dot(ctx, last.x, last.y, 6, colors.orange, true);
    ctx.font = "12px Microsoft YaHei, sans-serif"; ctx.textAlign = "left"; ctx.fillStyle = "#7fa6b6";
    ctx.fillText(`x ${fmt(samples[state.index].x * 100, 1)} cm`, 14, h - 26);
    ctx.fillText(`y ${fmt(samples[state.index].y * 100, 1)} cm`, 14, h - 10);
  }

  function drawSignals() {
    const { ctx, w, h } = canvasContext(canvases.signal);
    drawGrid(ctx, w, h, 0, 0, 40);
    if (!state.geometry) return emptyMessage(ctx, w, h);
    const left = 36, right = w - 12, top = 10, bottom = h - 24;
    const minT = Math.max(0, state.time - 10), maxT = Math.max(10, state.time);
    const step = Math.max(1, Math.floor((maxT - minT) / DT / Math.max(100, w / 2)));
    const maxA = Math.max(state.geometry.l3 * Math.sin(rad(state.params.ampX)),
      state.geometry.Ly * Math.sin(rad(state.params.ampY)), 0.01) * 1.12;
    const yPos = v => (top + bottom) / 2 - v / maxA * (bottom - top) / 2;
    const xPos = t => left + (t - minT) / (maxT - minT) * (right - left);
    line(ctx, { x: left, y: (top + bottom) / 2 }, { x: right, y: (top + bottom) / 2 }, "#567487", 1);
    for (const [key, color] of [["x", colors.cyan], ["y", colors.violet]]) {
      ctx.beginPath(); let began = false;
      for (let i = Math.round(minT / DT); i <= Math.round(maxT / DT); i += step) {
        const q = state.samples[Math.min(i, state.samples.length - 1)];
        if (!q) continue;
        if (!began) { ctx.moveTo(xPos(q.t), yPos(q[key])); began = true; }
        else ctx.lineTo(xPos(q.t), yPos(q[key]));
      }
      ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.font = "11px Microsoft YaHei, sans-serif"; ctx.fillStyle = "#89aabb";
    ctx.textAlign = "right"; ctx.fillText(`${fmt(maxA * 100, 0)} cm`, left - 5, top + 7);
    ctx.fillText("0", left - 5, (top + bottom) / 2 + 4);
    ctx.fillText(`${fmt(-maxA * 100, 0)} cm`, left - 5, bottom);
    ctx.textAlign = "left"; ctx.fillText(`${fmt(minT, 0)} s`, left, h - 5); ctx.textAlign = "right"; ctx.fillText(`${fmt(maxT, 0)} s`, right, h - 5);
  }

  function drawAll() { drawApparatus(); drawTrace(); drawSignals(); }

  function updateTimeDisplay() {
    $("timeValue").textContent = `${fmt(state.time, 1)} s`;
    $("timeSlider").value = String(state.time);
  }

  function animate(timestamp) {
    if (state.playing && state.geometry && state.lastFrame) {
      state.time = Math.min(DURATION, state.time + Math.min(0.1, (timestamp - state.lastFrame) / 1000) * state.speed);
      state.index = Math.min(state.samples.length - 1, Math.round(state.time / DT));
      updateTimeDisplay(); drawAll();
      if (state.time >= DURATION) togglePlay(false);
    }
    state.lastFrame = timestamp;
    requestAnimationFrame(animate);
  }

  function togglePlay(force) {
    state.playing = typeof force === "boolean" ? force : !state.playing;
    if (state.playing && state.time >= DURATION) { state.time = 0; state.index = 0; }
    $("playButton").textContent = state.playing ? "❚❚" : "▶";
    $("playButton").setAttribute("aria-label", state.playing ? "暂停仿真" : "播放仿真");
    state.lastFrame = 0;
    updateTimeDisplay(); drawAll();
  }

  function setPreset(name) {
    let ratio, phase, ax = 13, ay = 9, beta = 0.006;
    if (name === "near11") { ratio = 1.06; phase = 70; ax = 13; ay = 13; }
    else if (name === "three2") { ratio = 1.5; phase = 45; }
    else if (name === "detuned") { ratio = 1.37; phase = 20; beta = 0.004; }
    else { ratio = 2; phase = 45; }
    const span = 30, lower = 25, h = (ratio * ratio - 1) * lower;
    const upper = Math.sqrt(h * h + (span / 2) ** 2);
    const config = { span, left: upper, right: upper, lower, ampX: ax, ampY: ay, phase, damping: beta };
    for (const [key, value] of Object.entries(config)) sliders[key].value = String(value);
    document.querySelectorAll("[data-preset]").forEach(button => button.classList.toggle("selected", button.dataset.preset === name));
    syncParameters(true);
    togglePlay(true);
  }

  function exportCsv() {
    if (!state.geometry) return;
    const rows = ["time_s,x_cm,y_cm,junction_y_cm,bob_z_cm"];
    for (let i = 0; i < state.samples.length; i += 2) {
      const q = state.samples[i];
      rows.push([q.t.toFixed(2), (q.x * 100).toFixed(4), (q.y * 100).toFixed(4),
        (q.junction.y * 100).toFixed(4), (q.bob.z * 100).toFixed(4)].join(","));
    }
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "bowditch-pendulum-simulation.csv";
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function registerWebMcp() {
    if (!document.modelContext?.registerTool) return;
    const schema = { type: "object", properties: {
      span: { type: "number", minimum: 10, maximum: 80 },
      left: { type: "number", minimum: 16, maximum: 140 },
      right: { type: "number", minimum: 16, maximum: 140 },
      lower: { type: "number", minimum: 15, maximum: 80 },
      ampX: { type: "number", minimum: 1, maximum: 25 },
      ampY: { type: "number", minimum: 1, maximum: 25 },
      phase: { type: "number", minimum: -180, maximum: 180 },
      damping: { type: "number", minimum: 0, maximum: 0.12 }
    }, additionalProperties: false };
    try {
      Promise.resolve(document.modelContext.registerTool({
        name: "configure_pendulum", title: "设置 Y 形摆参数",
        description: "设置支点间距、三段绳长、初始振幅、相位差或阻尼，并更新可见仿真。长度单位 cm，角度单位 °，阻尼单位 s⁻¹。",
        inputSchema: schema, annotations: { readOnlyHint: false, untrustedContentHint: false },
        execute(input) {
          if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("参数必须是对象");
          const current = values();
          for (const [key, value] of Object.entries(input)) {
            const rule = schema.properties[key];
            if (!rule || typeof value !== "number" || !Number.isFinite(value) || value < rule.minimum || value > rule.maximum) throw new Error(`无效参数：${key}`);
            current[key] = value;
          }
          const geometry = computeGeometry(current);
          if (geometry.error) throw new Error(geometry.error);
          for (const [key, value] of Object.entries(input)) sliders[key].value = String(value);
          document.querySelectorAll("[data-preset]").forEach(button => button.classList.remove("selected"));
          syncParameters(true);
          return { frequencyRatio: Number(state.geometry.ratio.toFixed(4)),
            frequencyXHz: Number((state.geometry.wx / (2 * Math.PI)).toFixed(4)),
            frequencyYHz: Number((state.geometry.wy / (2 * Math.PI)).toFixed(4)) };
        }
      })).catch(() => {});
    } catch (_) { /* WebMCP is optional in unsupported browsers. */ }
  }

  for (const id of IDS) sliders[id].addEventListener("input", () => {
    document.querySelectorAll("[data-preset]").forEach(button => button.classList.remove("selected"));
    syncParameters(true);
  });
  document.querySelectorAll("[data-preset]").forEach(button => button.addEventListener("click", () => setPreset(button.dataset.preset)));
  $("resetButton").addEventListener("click", () => { for (const [key, value] of Object.entries(defaults)) sliders[key].value = String(value); document.querySelectorAll("[data-preset]").forEach(b => b.classList.toggle("selected", b.dataset.preset === "two1")); syncParameters(true); togglePlay(true); });
  $("playButton").addEventListener("click", () => togglePlay());
  $("restartButton").addEventListener("click", () => { state.time = 0; state.index = 0; togglePlay(true); });
  $("timeSlider").addEventListener("input", event => { state.time = Number(event.target.value); state.index = Math.min(state.samples.length - 1, Math.round(state.time / DT)); updateTimeDisplay(); drawAll(); });
  $("speedSelect").addEventListener("change", event => { state.speed = Number(event.target.value); });
  $("exportButton").addEventListener("click", exportCsv);
  $("aboutButton").addEventListener("click", () => { const panel = $("aboutPanel"); panel.hidden = !panel.hidden; $("aboutButton").setAttribute("aria-expanded", String(!panel.hidden)); });
  $("closeAbout").addEventListener("click", () => { $("aboutPanel").hidden = true; $("aboutButton").setAttribute("aria-expanded", "false"); });
  new ResizeObserver(drawAll).observe(canvases.apparatus);
  new ResizeObserver(drawAll).observe(canvases.trace);
  new ResizeObserver(drawAll).observe(canvases.signal);
  setPreset("two1");
  registerWebMcp();
  requestAnimationFrame(animate);
})();
