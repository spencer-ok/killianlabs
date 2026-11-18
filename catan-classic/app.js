/* The Settlers of Catan Classic — scorecard logic (v2)
   Per-hole / per-round team scoring + tournament-wide personal stats.
   State lives in localStorage. One scorekeeper per team, per device. */

(function () {
  "use strict";

  var STORAGE_KEY = "catanClassic.v2";

  var HOLES = 12;
  var PAR4_HOLE = 4;              // Hole 4 is the only par 4
  var RESOURCES_PER_VP = 3;       // 3 resources -> 1 Victory Point
  var CHECKPOINT_EVERY = 4;       // convert after holes 4, 8, 12

  // Seed roster (8 players). Teams are formed by handicap on game day,
  // so the scorekeeper just taps the players on their team.
  var ROSTER = [
    "Kent Paulson",
    "Spencer Killian",
    "John Egbert",
    "Chad Groneman",
    "Jeff Day",
    "Jeremy Johnson",
    "Chad Josephson (CJ)",
    "Keith McQueen"
  ];

  // Per-player stats. Wheat is split into made/missed.
  var STATS = [
    { key: "wood", name: "Wood", desc: "Trees hit", icon: "i-wood", cls: "stat-wood" },
    { key: "brick", name: "Brick", desc: "Roads hit", icon: "i-brick", cls: "stat-brick" },
    { key: "ore", name: "Ore", desc: "Out of bounds", icon: "i-ore", cls: "stat-ore" },
    { key: "sheep", name: "Sheep", desc: "Fairway hits", icon: "i-sheep", cls: "stat-sheep" },
    { key: "made", name: "Wheat", desc: "Putts made", icon: "i-wheat", cls: "stat-made" },
    { key: "missed", name: "Wheat", desc: "Putts missed", icon: "i-wheat", cls: "stat-missed" }
  ];

  // Par for a given 1-based hole number.
  function parForHole(hole) { return hole === PAR4_HOLE ? 4 : 3; }

  // Total par for a round.
  var ROUND_PAR = (function () {
    var p = 0;
    for (var h = 1; h <= HOLES; h++) p += parForHole(h);
    return p; // 37
  })();

  // Multiplier by PLAY POSITION (1-based): 1st-4th played x1, 5th-8th x2, 9th-12th x3.
  // This keeps the economy fair regardless of which hole a team starts on.
  function multiplierForPosition(pos) {
    if (pos <= 4) return 1;
    if (pos <= 8) return 2;
    return 3;
  }

  // Order of hole numbers as actually played, given the shotgun start hole.
  // e.g. startHole 5 -> [5,6,7,8,9,10,11,12,1,2,3,4]
  function playOrder() {
    var start = state.startHole || 1;
    var order = [];
    for (var i = 0; i < HOLES; i++) {
      order.push(((start - 1 + i) % HOLES) + 1);
    }
    return order;
  }

  // Base resources for a dice total (before multiplier). 7 = Robber (special).
  function baseResourcesFor(total) {
    if (total === 7) return "ROBBER";
    if (total === 6 || total === 8) return 3;
    if (total === 5 || total === 9) return 2;
    return 1; // 2,3,4,10,11,12
  }

  // ---------- State ----------

  function newHole() {
    return { strokes: 0, roll: null }; // roll: { d1,d2,total,base,mult,gained }
  }

  function newRound() {
    var holes = [];
    for (var i = 0; i < HOLES; i++) holes.push(newHole());
    return { holes: holes };
  }

  function defaultState() {
    return {
      teamName: "",
      startHole: 1,           // shotgun start (1-12)
      players: [],
      rounds: [newRound()],   // Round 1 exists by default
      stats: {}               // stats[playerName][statKey]
    };
  }

  var state = load();

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultState();
      var parsed = JSON.parse(raw);
      var base = defaultState();
      for (var k in parsed) { if (parsed.hasOwnProperty(k)) base[k] = parsed[k]; }
      if (!Array.isArray(base.rounds) || !base.rounds.length) base.rounds = [newRound()];
      return base;
    } catch (e) {
      console.warn("Failed to load state, starting fresh.", e);
      return defaultState();
    }
  }

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      alert("Could not save to this browser. Export a backup to be safe.");
    }
  }

  function clampFloor(n) { return n < 0 ? 0 : n; }

  // ---------- Round economy: replay holes in PLAY ORDER to derive resources / VP ----------
  // Walk holes in the order they're played (from the shotgun start hole),
  // add gained resources = base x play-position multiplier, apply Robber
  // (lose half unbanked, rounded up), and at each 4-holes-played checkpoint
  // convert 3 resources -> 1 VP (banked, safe), carrying the remainder.
  // Returns notes/mult keyed by hole ARRAY INDEX (0..11) for easy lookup.
  // startUnbanked lets leftover resources carry in from the previous round.
  function computeRoundEconomy(round, startUnbanked) {
    var unbanked = startUnbanked || 0;
    var vp = 0;
    var notes = {};   // notes[holeIndex]
    var mults = {};   // mults[holeIndex] = multiplier used
    var order = playOrder();

    // Only process up to the last hole that has actually been rolled (in play
    // order), so checkpoints fire only when reached — not before.
    var lastRolledPos = 0;
    for (var p = 1; p <= HOLES; p++) {
      if (round.holes[order[p - 1] - 1].roll) lastRolledPos = p;
    }

    for (var pos = 1; pos <= HOLES; pos++) {
      var holeNum = order[pos - 1];
      var hIdx = holeNum - 1;
      var h = round.holes[hIdx];
      var mult = multiplierForPosition(pos);
      mults[hIdx] = mult;
      if (pos > lastRolledPos) continue; // not reached yet
      var note = null;
      if (h.roll) {
        if (h.roll.base === "ROBBER") {
          var lost = Math.ceil(unbanked / 2);
          unbanked -= lost;
          note = { type: "robber", lost: lost };
        } else {
          var gained = h.roll.base * mult;
          unbanked += gained;
          note = { type: "gain", gained: gained };
        }
      }
      // Checkpoint after every 4 holes PLAYED — only once that hole is reached
      if (pos % CHECKPOINT_EVERY === 0) {
        var converted = Math.floor(unbanked / RESOURCES_PER_VP);
        if (converted > 0) {
          vp += converted;
          unbanked -= converted * RESOURCES_PER_VP;
        }
        note = note || {};
        note.checkpoint = { converted: converted, carry: unbanked };
      }
      notes[hIdx] = note;
    }
    return { unbanked: unbanked, vp: vp, notes: notes, mults: mults };
  }

  function roundStrokes(round) {
    var s = 0;
    for (var i = 0; i < HOLES; i++) s += round.holes[i].strokes;
    return s;
  }

  function grandTotals() {
    var strokes = 0, vp = 0, carry = 0;
    state.rounds.forEach(function (r) {
      var econ = computeRoundEconomy(r, carry);
      strokes += roundStrokes(r);
      vp += econ.vp;
      carry = econ.unbanked; // leftover carries into the next round
    });
    // "resources" = the single continuous pool currently held (end of last round)
    return { strokes: strokes, vp: vp, resources: carry, adjusted: strokes - vp };
  }

  // Resources carried INTO the given round index (sum-through of prior rounds).
  function startUnbankedFor(rIdx) {
    var carry = 0;
    for (var i = 0; i < rIdx; i++) {
      carry = computeRoundEconomy(state.rounds[i], carry).unbanked;
    }
    return carry;
  }

  // Starter rotates by PLAY POSITION (0-based): 1st played -> players[0], etc.
  function starterForPosition(posIdx) {
    if (!state.players.length) return null;
    return state.players[posIdx % state.players.length];
  }

  // ---------- Rendering ----------

  function renderRoster() {
    var picker = document.getElementById("roster-picker");
    picker.innerHTML = "";
    ROSTER.forEach(function (name) {
      picker.appendChild(rosterChip(name));
    });
    // Guests: selected players not on the seeded roster
    state.players.forEach(function (name) {
      if (ROSTER.indexOf(name) === -1) {
        var chip = rosterChip(name);
        chip.classList.add("guest-chip");
        picker.appendChild(chip);
      }
    });
  }

  function rosterChip(name) {
    var chip = document.createElement("button");
    chip.type = "button";
    var pos = state.players.indexOf(name);
    chip.className = "roster-chip" + (pos !== -1 ? " selected" : "");
    chip.textContent = (pos !== -1 ? (pos + 1) + ". " : "") + name;
    chip.addEventListener("click", function () { togglePlayer(name); });
    return chip;
  }

  function addGuest() {
    var input = document.getElementById("guest-name");
    var name = (input.value || "").trim();
    if (!name) return;
    if (state.players.indexOf(name) !== -1 || ROSTER.indexOf(name) !== -1) {
      // Already present (roster or selected) — just ensure selected, then clear
      if (state.players.indexOf(name) === -1) state.players.push(name);
    } else {
      state.players.push(name);
    }
    input.value = "";
    save();
    renderRoster();
    renderPlayers();
    renderRounds();
  }

  function togglePlayer(name) {
    var idx = state.players.indexOf(name);
    if (idx === -1) state.players.push(name);
    else state.players.splice(idx, 1);
    save();
    renderRoster();
    renderPlayers();
    renderRounds(); // starter labels depend on players
  }

  function faceFor(n) { return ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"][n] || "▢"; }

  function cardWord(n) { return Math.abs(n) === 1 ? "Card" : "Cards"; }

  function iconButton(cls, iconId, label, onClick) {
    var b = document.createElement("button");
    b.className = cls;
    b.setAttribute("aria-label", label);
    b.innerHTML = "<svg class='btn-ico' aria-hidden='true'><use href='#" + iconId + "'></use></svg>";
    b.addEventListener("click", onClick);
    return b;
  }

  function renderRounds() {
    var container = document.getElementById("rounds");
    container.innerHTML = "";
    state.rounds.forEach(function (round, rIdx) {
      container.appendChild(renderRound(round, rIdx));
    });
    renderGrand();
  }

  function renderRound(round, rIdx) {
    var econ = computeRoundEconomy(round, startUnbankedFor(rIdx));
    var strokes = roundStrokes(round);

    var card = document.createElement("section");
    card.className = "card round-card";

    var head = document.createElement("div");
    head.className = "round-head";
    var title = document.createElement("h2");
    title.textContent = "Round " + (rIdx + 1);
    head.appendChild(title);
    if (rIdx > 0) {
      var rm = document.createElement("button");
      rm.className = "btn-remove-round";
      rm.textContent = "✕ Remove";
      rm.addEventListener("click", function () { removeRound(rIdx); });
      head.appendChild(rm);
    }
    card.appendChild(head);

    // Round summary stat strip (matches grand-total style)
    var summary = document.createElement("div");
    summary.className = "round-summary grand-grid";
    summary.innerHTML =
      "<div><span class='grand-label'>Strokes</span><strong>" + strokes + "</strong></div>" +
      "<div><span class='grand-label'>Resources</span><strong>" + econ.unbanked + "</strong></div>" +
      "<div><span class='grand-label'>VP</span><strong>" + econ.vp + "</strong></div>" +
      "<div class='grand-adj'><span class='grand-label'>Adjusted</span><strong>" + (strokes - econ.vp) + "</strong></div>";
    card.appendChild(summary);

    var resLine = document.createElement("p");
    resLine.className = "res-line";
    resLine.textContent = "Every " + RESOURCES_PER_VP + " resources become 1 Victory Point at each checkpoint.";
    card.appendChild(resLine);

    // Holes — rendered in the order they're played (from the shotgun start)
    var order = playOrder();
    for (var p = 0; p < HOLES; p++) {
      var holeNum = order[p];
      var hIdx = holeNum - 1;
      // Locked until the previous played hole has been rolled (first hole always open)
      var locked = p > 0 && !round.holes[order[p - 1] - 1].roll;
      card.appendChild(renderHole(round, rIdx, hIdx, p, econ, locked));
    }
    return card;
  }
  function renderHole(round, rIdx, hIdx, posIdx, econ, locked) {
    var hole = hIdx + 1;
    var h = round.holes[hIdx];
    var par = parForHole(hole);
    var mult = econ.mults[hIdx];
    var note = econ.notes[hIdx];
    var starter = starterForPosition(posIdx);
    var isCheckpoint = ((posIdx + 1) % CHECKPOINT_EVERY === 0);

    var wrap = document.createElement("div");
    wrap.className = "hole-row" + (isCheckpoint ? " checkpoint" : "") + (locked ? " locked" : "");

    // ----- Golf zone: hole/par/start (left) + score stepper (right) -----
    var golf = document.createElement("div");
    golf.className = "hole-golf";

    var meta = document.createElement("div");
    meta.className = "hole-meta";
    meta.innerHTML =
      "<span class='hole-title'><span class='hole-num'>Hole " + hole + "</span>" +
      "<span class='hole-par'>Par " + par + "</span></span>" +
      (starter ? "<span class='hole-starter'>Start: " + starter + "</span>" : "");
    golf.appendChild(meta);

    var strokeCtl = document.createElement("div");
    strokeCtl.className = "hole-strokes";
    var minus = iconButton("btn-minus", "i-minus", "decrease strokes hole " + hole,
      function () { bumpHole(rIdx, hIdx, -1); });
    var val = document.createElement("span");
    val.className = "counter-value";
    val.textContent = h.strokes;
    var plus = iconButton("btn-plus", "i-plus", "increase strokes hole " + hole,
      function () { bumpHole(rIdx, hIdx, 1); });
    if (locked) { minus.disabled = true; plus.disabled = true; }
    strokeCtl.appendChild(minus);
    strokeCtl.appendChild(val);
    strokeCtl.appendChild(plus);
    golf.appendChild(strokeCtl);
    wrap.appendChild(golf);

    // ----- Catan zone: roll + multiplier -> dice + resource cards -----
    var catan = document.createElement("div");
    catan.className = "hole-catan";
    if (locked) {
      catan.innerHTML = "<span class='locked-hint'>Roll the previous hole to unlock</span>";
    } else if (h.roll) {
      if (h.roll.base === "ROBBER") {
        var lostTxt = (note && note.type === "robber") ? note.lost : 0;
        var robberMsg = lostTxt > 0
          ? "Robber!<br>" + lostTxt + " " + cardWord(lostTxt) + " Stolen"
          : "Robber!<br>Nothing to steal";
        catan.innerHTML =
          "<span class='dice-faces'>" + faceFor(h.roll.d1) + faceFor(h.roll.d2) + "</span>" +
          "<span class='dice-res robber'>" + robberMsg + "</span>";
      } else {
        var gained = h.roll.base * mult;
        catan.innerHTML =
          "<span class='dice-faces'>" + faceFor(h.roll.d1) + faceFor(h.roll.d2) + "</span>" +
          "<span class='dice-res good'>+" + gained + "<br>Resource " + cardWord(gained) + "</span>";
      }
    } else {
      var rollBtn = document.createElement("button");
      rollBtn.className = "btn-roll-hole";
      rollBtn.innerHTML = "<svg class='btn-ico' aria-hidden='true'><use href='#i-dice'></use></svg>Roll";
      rollBtn.addEventListener("click", function () { rollHole(rIdx, hIdx); });
      catan.appendChild(rollBtn);
      var mtag = document.createElement("span");
      mtag.className = "mult-tag";
      mtag.textContent = "×" + mult + " multiplier";
      catan.appendChild(mtag);
    }
    wrap.appendChild(catan);

    // Checkpoint banner (three rows)
    if (note && note.checkpoint) {
      var cp = document.createElement("div");
      cp.className = "cp-banner";
      cp.innerHTML =
        "<span class='cp-title'>CHECKPOINT</span>" +
        "<span class='cp-row'>Converted " + note.checkpoint.converted + " VP</span>" +
        "<span class='cp-row'>" + note.checkpoint.carry + " Resource Card(s) Carry On</span>";
      wrap.appendChild(cp);
    }
    return wrap;
  }

  function bumpHole(rIdx, hIdx, delta) {
    var h = state.rounds[rIdx].holes[hIdx];
    h.strokes = clampFloor(h.strokes + delta);
    save();
    renderRounds();
  }

  function rollHole(rIdx, hIdx) {
    var h = state.rounds[rIdx].holes[hIdx];
    if (h.roll) return; // locked
    var d1 = 1 + Math.floor(Math.random() * 6);
    var d2 = 1 + Math.floor(Math.random() * 6);
    var total = d1 + d2;
    var base = baseResourcesFor(total);
    // Multiplier/gained are derived by computeRoundEconomy from play position,
    // so a later change to the starting hole recalculates correctly.
    h.roll = { d1: d1, d2: d2, total: total, base: base };
    save();
    renderRounds();
  }

  function addRound() {
    state.rounds.push(newRound());
    save();
    renderRounds();
  }

  function removeRound(rIdx) {
    if (rIdx === 0) return; // never remove Round 1
    if (!confirm("Remove Round " + (rIdx + 1) + "? Its scores and rolls are lost.")) return;
    state.rounds.splice(rIdx, 1);
    save();
    renderRounds();
  }

  function renderGrand() {
    var g = grandTotals();
    document.getElementById("grand-strokes").textContent = g.strokes;
    document.getElementById("grand-vp").textContent = g.vp;
    document.getElementById("grand-adjusted").textContent = g.adjusted;

    // Per-round mini stat strips in the sticky bar (match the round-card style)
    var chips = document.getElementById("grand-rounds");
    chips.innerHTML = "";
    state.rounds.forEach(function (round, rIdx) {
      var econ = computeRoundEconomy(round, startUnbankedFor(rIdx));
      var strokes = roundStrokes(round);
      var mini = document.createElement("div");
      mini.className = "round-mini";
      mini.innerHTML =
        "<span class='round-mini-label'>R" + (rIdx + 1) + "</span>" +
        "<div class='grand-grid'>" +
          "<div><span class='grand-label'>Strokes</span><strong>" + strokes + "</strong></div>" +
          "<div><span class='grand-label'>Resources</span><strong>" + econ.unbanked + "</strong></div>" +
          "<div><span class='grand-label'>VP</span><strong>" + econ.vp + "</strong></div>" +
          "<div class='grand-adj'><span class='grand-label'>Adjusted</span><strong>" + (strokes - econ.vp) + "</strong></div>" +
        "</div>";
      chips.appendChild(mini);
    });

    // Collapsed team-setup summary: just the team name (or a fallback label)
    var teamSummary = document.getElementById("summary-team");
    if (teamSummary) {
      teamSummary.textContent = state.teamName ? state.teamName : "Team Setup";
      teamSummary.classList.toggle("placeholder", !state.teamName);
    }
  }

  // ---------- Personal stats ----------

  function statFor(player, key) {
    if (!state.stats[player]) state.stats[player] = {};
    if (typeof state.stats[player][key] !== "number") state.stats[player][key] = 0;
    return state.stats[player][key];
  }

  function renderPlayers() {
    var container = document.getElementById("players");
    container.innerHTML = "";
    if (!state.players.length) {
      var empty = document.createElement("p");
      empty.className = "hint";
      empty.textContent = "Add players above to track personal stats.";
      container.appendChild(empty);
      return;
    }
    state.players.forEach(function (name) {
      var card = document.createElement("section");
      card.className = "card player-card";
      var h = document.createElement("h3");
      h.textContent = name;
      card.appendChild(h);
      STATS.forEach(function (stat) { card.appendChild(statRow(name, stat)); });
      container.appendChild(card);
    });
  }

  function statRow(player, stat) {
    var row = document.createElement("div");
    row.className = "counter-row " + stat.cls;
    var label = document.createElement("span");
    label.className = "counter-label";
    label.innerHTML = (stat.icon ? "<svg class='stat-ico' aria-hidden='true'><use href='#" + stat.icon + "'></use></svg>" : "") +
      "<span class='stat-text'><span class='stat-name'>" + stat.name + "</span>" +
      "<span class='stat-desc'>" + stat.desc + "</span></span>";
    row.appendChild(label);
    var controls = document.createElement("div");
    controls.className = "counter-controls";
    var aria = stat.name + " " + stat.desc;
    var minus = document.createElement("button");
    minus.className = "btn-minus";
    minus.innerHTML = "<svg class='btn-ico' aria-hidden='true'><use href='#i-minus'></use></svg>";
    minus.setAttribute("aria-label", "decrease " + aria);
    minus.addEventListener("click", function () { bumpStat(player, stat.key, -1); });
    var val = document.createElement("span");
    val.className = "counter-value";
    val.textContent = statFor(player, stat.key);
    var plus = document.createElement("button");
    plus.className = "btn-plus";
    plus.innerHTML = "<svg class='btn-ico' aria-hidden='true'><use href='#i-plus'></use></svg>";
    plus.setAttribute("aria-label", "increase " + aria);
    plus.addEventListener("click", function () { bumpStat(player, stat.key, 1); });
    controls.appendChild(minus);
    controls.appendChild(val);
    controls.appendChild(plus);
    row.appendChild(controls);
    return row;
  }

  function bumpStat(player, key, delta) {
    if (!state.stats[player]) state.stats[player] = {};
    state.stats[player][key] = clampFloor(statFor(player, key) + delta);
    save();
    renderPlayers();
  }

  // ---------- Data management ----------

  function exportJSON() {
    var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    var stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    var teamPart = (state.teamName || "team").replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    a.href = url;
    a.download = "catan-classic-" + teamPart + "-" + stamp + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function importJSON(file) {
    var reader = new FileReader();
    reader.onload = function (e) {
      try {
        var parsed = JSON.parse(e.target.result);
        var base = defaultState();
        for (var k in parsed) { if (parsed.hasOwnProperty(k)) base[k] = parsed[k]; }
        if (!Array.isArray(base.rounds) || !base.rounds.length) base.rounds = [newRound()];
        state = base;
        save();
        renderAll();
        alert("Import successful.");
      } catch (err) {
        alert("That file could not be read as valid scorecard JSON.");
      }
    };
    reader.readAsText(file);
  }

  function resetAll() {
    if (!confirm("Reset ALL data on this phone? Export a backup first if unsure.")) return;
    state = defaultState();
    save();
    renderAll();
  }

  function renderAll() {
    var input = document.getElementById("team-name");
    if (input.value !== state.teamName) input.value = state.teamName;
    renderStartHole();
    renderRoster();
    renderRounds();
    renderPlayers();
  }

  function renderStartHole() {
    var sel = document.getElementById("start-hole");
    if (!sel) return;
    if (!sel.options.length) {
      for (var n = 1; n <= HOLES; n++) {
        var opt = document.createElement("option");
        opt.value = String(n);
        opt.textContent = "Hole " + n + (n === PAR4_HOLE ? " (Par 4)" : "");
        sel.appendChild(opt);
      }
    }
    sel.value = String(state.startHole || 1);
  }

  // ---------- Wire up ----------

  function init() {
    document.getElementById("team-name").addEventListener("input", function (e) {
      state.teamName = e.target.value;
      save();
      renderGrand(); // keep the collapsed team summary in sync
    });
    document.getElementById("btn-add-round").addEventListener("click", addRound);
    document.getElementById("start-hole").addEventListener("change", function (e) {
      state.startHole = parseInt(e.target.value, 10) || 1;
      save();
      renderRounds(); // reorder holes, recompute multipliers/starters
    });
    document.getElementById("btn-add-guest").addEventListener("click", addGuest);
    document.getElementById("guest-name").addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); addGuest(); }
    });
    document.getElementById("btn-export").addEventListener("click", exportJSON);
    document.getElementById("btn-import").addEventListener("click", function () {
      document.getElementById("import-file").click();
    });
    document.getElementById("import-file").addEventListener("change", function (e) {
      if (e.target.files && e.target.files[0]) importJSON(e.target.files[0]);
      e.target.value = "";
    });
    document.getElementById("btn-reset").addEventListener("click", resetAll);

    // Compact the merged sticky panel on scroll; reveal its title row
    // only once the big hero header has scrolled off (avoids duplicate title).
    var panel = document.getElementById("sticky-panel");
    var hero = document.querySelector(".app-header");
    var onScroll = function () {
      panel.classList.toggle("compact", window.scrollY > 60);
      var heroBottom = hero ? hero.offsetTop + hero.offsetHeight : 0;
      panel.classList.toggle("show-title", window.scrollY > heroBottom - 8);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    renderAll();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
