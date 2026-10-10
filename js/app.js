// Owns state, form wiring and rendering. Team math lives in js/engine.js, data loading in js/data.js.
(function () {
  var KEY = 'pvphelper-state-v1';
  var IV_KEY = 'pvphelper-ivs-v1';   // { speciesId: [atk, def, hp] } the viewer entered
  var LEAGUES = ['great', 'ultra', 'master'];
  var STYLES = ['abc', 'pair', 'any'];
  // Styles that were merged into another; old saved state and shared links still work.
  var STYLE_ALIASES = { abb: 'pair', aba: 'pair' };
  var LEAGUE_NAMES = { great: '超級聯盟', ultra: '高級聯盟', master: '大師聯盟' };
  // The 'any' value is kept (saved state and shared links use it); only the label changed.
  var STYLE_NAMES = { abc: 'ABC', pair: 'Shared type', any: 'Best score' };
  var STYLE_HINTS = { abc: 'ABC style', pair: 'shared type style (ABB / ABA)', any: 'best score (no typing rule)' };
  // What each typing layout (lead / swap / closer) means, for the team detail.
  var LAYOUT_NOTES = {
    ABC: 'no two members share a type',
    ABB: 'the safe swap and closer share a type',
    ABA: 'the lead and closer share a type',
    AAB: 'the lead and safe swap share a type',
    AAA: 'all three share a type'
  };
  var ROLE_NAMES = { lead: 'Lead', swap: 'Safe swap', closer: 'Closer' };
  var LEAGUE_CP = { great: 1500, ultra: 2500, master: 10000 };
  var MAX_MATCHES = 8;
  var QUICK_PICKS = 6;
  var PICK_ID = /^[a-z0-9_]{1,64}$/;   // shape of a PvPoke species id

  var state = load();
  var contexts = {};   // league -> Engine context, built once per league
  var images = {};     // species id -> image stem (data/images.js)
  var teams = [];      // current suggestions (engine teams)
  var described = [];  // Engine.describeTeam() of each, for the detail view
  var runId = 0;       // ignores results from a superseded search
  var revealResults = false;  // set by a user pick: scroll new results into view if off-screen

  // ---- Persistence: localStorage remembers the last view; the URL hash makes it shareable ----
  // Hash format: #l=great&s=abc&p=medicham,azumarill&t=2 (t is the 1-based selected team).

  // Copies the recognised fields of `saved` onto `s`. Pick ids are only checked for shape here;
  // whether they are ranked in the league is checked once rankings load (see validatePicks).
  function applySaved(s, saved) {
    if (LEAGUES.indexOf(saved.league) !== -1) s.league = saved.league;
    var style = STYLE_ALIASES[saved.style] || saved.style;
    if (STYLES.indexOf(style) !== -1) s.style = style;
    if (Array.isArray(saved.picks)) {
      s.picks = [0, 1].map(function (i) {
        var id = saved.picks[i];
        return typeof id === 'string' && PICK_ID.test(id) ? id : null;
      });
      if (!s.picks[0] && s.picks[1]) s.picks = [s.picks[1], null];
    }
    if (typeof saved.selected === 'number' && saved.selected >= 0 && saved.selected < 5) s.selected = Math.floor(saved.selected);
    return s;
  }

  function readHash() {
    var params = new URLSearchParams(location.hash.replace(/^#/, ''));
    if (!params.get('p') && !params.get('l')) return null;
    return {
      league: params.get('l'),
      style: params.get('s'),
      picks: (params.get('p') || '').split(',').filter(Boolean),
      selected: Number(params.get('t')) - 1
    };
  }

  function hashFor(st) {
    var picks = st.picks.filter(Boolean);
    if (!picks.length) return '';
    return '#l=' + st.league + '&s=' + st.style + '&p=' + picks.map(encodeURIComponent).join(',') +
      (st.selected ? '&t=' + (st.selected + 1) : '');
  }

  function load() {
    var s = { league: 'great', style: 'abc', picks: [null, null], selected: 0 };
    try {
      applySaved(s, JSON.parse(localStorage.getItem(KEY) || '{}'));
    } catch (e) { /* private mode or bad JSON: keep defaults */ }
    var shared = readHash();
    // A shared link replaces the remembered view entirely, including empty slots.
    if (shared) applySaved(s, { league: shared.league, style: shared.style, picks: shared.picks.concat([null, null]), selected: shared.selected });
    return s;
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ league: state.league, style: state.style, picks: state.picks, selected: state.selected }));
    } catch (e) { /* private mode */ }
    var hash = hashFor(state);
    if (hash !== location.hash) {
      history.replaceState(null, '', hash || location.pathname + location.search);
    }
  }

  // IVs the viewer typed into "Check your IVs", remembered per species on this device only.
  function loadIvs() {
    try {
      var saved = JSON.parse(localStorage.getItem(IV_KEY) || '{}');
      return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    } catch (e) { return {}; }
  }

  function saveIvs(id, ivs) {
    var all = loadIvs();
    if (ivs) all[id] = ivs; else delete all[id];
    try { localStorage.setItem(IV_KEY, JSON.stringify(all)); } catch (e) { /* private mode */ }
  }

  function savedIvs(id) {
    var v = loadIvs()[id];
    var valid = Array.isArray(v) && v.length === 3 && v.every(function (n) {
      return typeof n === 'number' && n === Math.floor(n) && n >= 0 && n <= 15;
    });
    return valid ? v : null;
  }

  // ---- Helpers ----

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

    function normalize(s) {
      return String(s).toLowerCase().normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\u3400-\u4dbf\u4e00-\u9fff]+/g, ' ')
        .trim();
    }

  // Pokémon GO icon for a species id, or '' when there is none. Decorative: the name is always
  // next to it, so alt is empty. Shadow forms share the normal icon and get a purple glow.
  function icon(id, size) {
    var stem = images[id];
    if (!stem) return '';
    var shadow = /_shadow$/.test(id) ? ' shadow' : '';
    return '<img class="poke' + shadow + '" src="img/pokemon/' + encodeURIComponent(stem) + '.webp" alt="" width="' + size +
      '" height="' + size + '" loading="lazy" decoding="async">';
  }

  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  function typeChips(types) {
    return types.map(function (t) {
      return '<span class="type" data-type="' + escapeHtml(t) + '">' + escapeHtml(capitalize(t)) + '</span>';
    }).join('');
  }

  // Plain-language reading of a battle rating (500 = even).
  function verdict(rating) {
    if (rating >= 700) return 'strong win';
    if (rating > 550) return 'win';
    if (rating >= 450) return 'toss-up';
    if (rating >= 300) return 'loss';
    return 'hard loss';
  }

  function contextFor(league) {
    return Promise.all([window.PvpData.gamemaster(), window.PvpData.rankings(league), window.PvpData.images()]).then(function (data) {
      images = data[2];
      if (!contexts[league]) contexts[league] = window.Engine.createContext(data[0], data[1], league);
      return contexts[league];
    });
  }

  function currentPicks() {
    return state.picks.filter(Boolean);
  }

  // ---- Pokémon search (combobox) ----

  function setupCombo(combo) {
    var slot = Number(combo.dataset.slot);
    var input = combo.querySelector('input');
    var list = combo.querySelector('.combo-list');
    var clear = combo.querySelector('.clear');
    var matches = [];
    var active = -1;

    function selectedName() {
      var id = state.picks[slot];
      var ctx = contexts[state.league];
      return id && ctx && ctx.byId[id] ? ctx.byId[id].pokemon.name : '';
    }

    function close() {
      list.hidden = true;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-activedescendant');
      active = -1;
    }

      function search(query) {
        var ctx = contexts[state.league];
        var q = normalize(query);
        if (!ctx || !q) return [];
        var other = state.picks[1 - slot];
        var otherDex = other && ctx.byId[other] ? ctx.byId[other].pokemon.dex : null;
        var starts = [], contains = [];
        ctx.ranked.forEach(function (e) {
          if (e.pokemon.dex === otherDex) return;
          var name = normalize(e.pokemon.name);   // 中文名，如 "泥巴鱼 伽勒尔"
          var eng  = normalize(e.id);             // 英文 id，如 "stunfisk galarian"
          var nick = (e.pokemon.nicknames || []).some(function (n) {
            return normalize(n).indexOf(q) === 0;
          });
          if (name.indexOf(q) === 0 || eng.indexOf(q) === 0 || nick) starts.push(e);
          else if (name.indexOf(q) !== -1 || eng.indexOf(q) !== -1) contains.push(e);
        });
        return starts.concat(contains).slice(0, MAX_MATCHES);
      }

    function renderList() {
      if (!matches.length) {
        list.innerHTML = '<li class="empty" role="option" aria-disabled="true">No ranked Pokémon matches</li>';
      } else {
        var ctx = contexts[state.league];
        list.innerHTML = matches.map(function (e, i) {
          return '<li role="option" id="pick-' + slot + '-opt-' + i + '" data-index="' + i + '"' +
            (i === active ? ' aria-selected="true" class="active"' : '') + '>' +
            '<span class="opt-name">' + icon(e.id, 28) + escapeHtml(e.pokemon.name) + '</span>' +
            '<span class="opt-meta">' + typeChips(e.pokemon.types) +
            ' <small>#' + (ctx.ranked.indexOf(e) + 1) + '</small></span></li>';
        }).join('');
      }
      list.hidden = false;
      input.setAttribute('aria-expanded', 'true');
      if (active >= 0) input.setAttribute('aria-activedescendant', 'pick-' + slot + '-opt-' + active);
      else input.removeAttribute('aria-activedescendant');
    }

    function choose(entry) {
      input.value = entry.pokemon.name;
      close();
      setPick(slot, entry.id);
    }

    input.addEventListener('input', function () {
      matches = search(input.value);
      active = matches.length ? 0 : -1;
      if (input.value.trim()) renderList(); else close();
    });

    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        if (list.hidden) { matches = search(input.value); active = -1; }
        if (!matches.length) return;
        ev.preventDefault();
        var step = ev.key === 'ArrowDown' ? 1 : -1;
        active = (active + step + matches.length) % matches.length;
        renderList();
      } else if (ev.key === 'Enter') {
        if (!list.hidden && active >= 0 && matches[active]) {
          ev.preventDefault();
          choose(matches[active]);
        }
      } else if (ev.key === 'Escape') {
        if (!list.hidden) { ev.preventDefault(); close(); input.value = selectedName(); }
      }
    });

    // mousedown, not click: it fires before the input's blur, which would close the list first.
    list.addEventListener('mousedown', function (ev) {
      var li = ev.target.closest('li[data-index]');
      if (!li) return;
      ev.preventDefault();
      choose(matches[Number(li.dataset.index)]);
    });

    input.addEventListener('blur', function () {
      close();
      // Typing without choosing leaves the previous pick in place.
      input.value = selectedName();
    });

    clear.addEventListener('click', function () {
      input.value = '';
      setPick(slot, null);
      input.focus();
    });

    return {
      sync: function () {
        if (document.activeElement !== input) input.value = selectedName();
        clear.hidden = !state.picks[slot];
      }
    };
  }

  var combos = Array.prototype.map.call(document.querySelectorAll('.combo'), setupCombo);

  function syncCombos() {
    combos.forEach(function (c) { c.sync(); });
  }

  function setPick(slot, id) {
    state.picks[slot] = id;
    // Keep the filled slot first, so "one pick" always means slot 0.
    if (!state.picks[0] && state.picks[1]) state.picks = [state.picks[1], null];
    state.selected = 0;
    save();
    syncCombos();
    renderQuickPicks();
    revealResults = !!id;
    runSearch();
  }

  // Drops saved picks that are not ranked in the current league.
  function validatePicks(ctx) {
    var dropped = state.picks.filter(function (id) { return id && !ctx.byId[id]; });
    state.picks = state.picks.filter(function (id) { return id && ctx.byId[id]; });
    while (state.picks.length < 2) state.picks.push(null);
    if (dropped.length) save();
    return dropped;
  }

  function renderQuickPicks() {
    var el = document.getElementById('quick-picks');
    var ctx = contexts[state.league];
    if (!ctx || currentPicks().length === 2) { el.innerHTML = ''; return; }
    var taken = currentPicks().map(function (id) { return ctx.byId[id].pokemon.dex; });
    var top = ctx.ranked.filter(function (e) { return taken.indexOf(e.pokemon.dex) === -1; }).slice(0, QUICK_PICKS);
    el.innerHTML = '<span class="quick-label">hot in ' + LEAGUE_NAMES[state.league] + ':</span> ' +
      top.map(function (e) {
        return '<button type="button" class="chip" data-id="' + escapeHtml(e.id) + '">' + escapeHtml(e.pokemon.name) + '</button>';
      }).join('');
  }

  document.getElementById('quick-picks').addEventListener('click', function (ev) {
    var btn = ev.target.closest('button[data-id]');
    if (!btn) return;
    setPick(state.picks[0] ? 1 : 0, btn.dataset.id);
  });

  // ---- Results ----

  function resultsEl() { return document.getElementById('results'); }

  function showMessage(html, cls) {
    resultsEl().innerHTML = '<p class="' + (cls || 'placeholder') + '">' + html + '</p>';
  }

  function runSearch(notice) {
    var id = ++runId;
    var league = state.league;
    contextFor(league).then(function (ctx) {
      if (id !== runId) return;
      var dropped = validatePicks(ctx);
      syncCombos();
      renderQuickPicks();
      if (dropped.length) {
        notice = dropped.length === 1 ? 'Your previous pick isn’t ranked in ' + LEAGUE_NAMES[league] + ', so it was removed.'
          : 'Your previous picks aren’t ranked in ' + LEAGUE_NAMES[league] + ', so they were removed.';
      }
      var picks = currentPicks();
      if (!picks.length) {
        teams = [];
        described = [];
        showMessage((notice ? escapeHtml(notice) + ' ' : '') +
          '選擇寶可夢，即可獲得組隊建議 /  ' + LEAGUE_NAMES[league] + '.');
        return;
      }
      showMessage('Finding the best teams…');
      // Let the message paint before the search blocks the main thread (up to about a second).
      setTimeout(function () {
        if (id !== runId) return;
        try {
          teams = window.Engine.suggest(ctx, picks, state.style, 5);
        } catch (err) {
          showMessage(escapeHtml(err.message), 'error');
          return;
        }
        if (!teams.length) {
          showMessage('No ' + STYLE_NAMES[state.style] + ' team fits ' + (picks.length === 1 ? 'this pick' : 'these picks') +
            '. Try another team style.');
          return;
        }
        state.selected = Math.min(state.selected, teams.length - 1);
        renderTeams(ctx, notice);
      }, 30);
    }).catch(function (err) {
      if (id !== runId) return;
      showMessage('Could not load Pokémon data (' + escapeHtml(err.message) + '). Try reloading the page.', 'error');
    });
  }

  function renderTeams(ctx, notice) {
    described = teams.map(function (t) { return window.Engine.describeTeam(ctx, t); });
    var picks = currentPicks();
    var heading = picks.length === 1 ? '最佳搭檔 for ' + escapeHtml(ctx.byId[picks[0]].pokemon.name)
      : 'Best third for ' + escapeHtml(ctx.byId[picks[0]].pokemon.name) + ' and ' + escapeHtml(ctx.byId[picks[1]].pokemon.name);

    var list = described.map(function (d, i) {
      return '<li><button type="button" class="team-option" data-team="' + i + '" aria-pressed="' + (i === state.selected) + '">' +
        '<span class="team-rank">' + (i + 1) + '</span>' +
        '<span class="team-icons">' + d.members.map(function (m) { return icon(m.id, 32); }).join('') + '</span>' +
        '<span class="team-names">' + d.members.map(function (m) { return escapeHtml(m.name); }).join(' · ') + '</span>' +
        '<span class="layout" title="Typing layout (lead / safe swap / closer)">' + d.layout + '</span>' +
        '<span class="team-score" title="Team score out of 100">' + d.displayScore + '</span></button></li>';
    }).join('');

    resultsEl().innerHTML =
      (notice ? '<p class="notice">' + escapeHtml(notice) + '</p>' : '') +
      '<div class="results-head"><h2>' + heading + '</h2>' +
      '<button type="button" class="chip" data-action="share">Copy link</button></div>' +
      '<p class="hint">' + LEAGUE_NAMES[state.league] + ', ' + STYLE_HINTS[state.style] +
      '. Team score (out of 100) rates how well the team covers the league’s top 100 Pokémon.</p>' +
      '<ol class="team-list">' + list + '</ol>' +
      '<div id="team-detail">' + renderDetail(described[state.selected]) + '</div>';
    // On a phone the results start below the fold; after a pick, bring them into view.
    if (revealResults) {
      revealResults = false;
      var top = resultsEl().getBoundingClientRect().top;
      if (top > window.innerHeight * 0.6) resultsEl().scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function ivChecker(m) {
    var saved = savedIvs(m.id);
    var labels = ['Attack', 'Defense', 'HP'];
    var inputs = labels.map(function (label, i) {
      return '<label><span>' + label.slice(0, 3) + '</span><input type="number" inputmode="numeric" min="0" max="15" step="1" ' +
        'data-iv="' + i + '" aria-label="' + label + ' IV" value="' + (saved ? saved[i] : '') + '"></label>';
    }).join('');
    return '<details class="ivcheck" data-id="' + escapeHtml(m.id) + '"' + (saved ? ' open' : '') + '>' +
      '<summary>Check your IVs</summary>' +
      '<div class="iv-inputs">' + inputs + '</div>' +
      '<p class="iv-result" aria-live="polite">' + ivResult(m.id, saved) + '</p></details>';
  }

  // Text for the IV checker, or a prompt when the spread is incomplete.
  function ivResult(id, ivs) {
    if (!ivs) return 'Enter Attack, Defense and HP (0–15).';
    var ctx = contexts[state.league];
    var r = window.Engine.ivCheck(ctx.byId[id].pokemon, state.league, ivs);
    if (!r) return 'These IVs can’t get under the ' + LEAGUE_NAMES[state.league] + ' CP cap.';
    return '<strong>Rank ' + r.rank + '</strong> of ' + r.of + ' · ' + r.percent.toFixed(1) + '% of rank 1' +
      '<br><small>Level ' + r.level + ' · CP ' + r.cp + '</small>';
  }

  function renderDetail(d) {
    var members = d.members.map(function (m) {
      var fast = m.moves[0], charged = m.moves.slice(1);
      function move(mv) {
        return '<li>' + (mv.type ? '<span class="type dot" data-type="' + escapeHtml(mv.type) + '" title="' + escapeHtml(capitalize(mv.type)) + '"></span>' : '') +
          escapeHtml(mv.name) + (mv.elite ? ' <abbr class="elite" title="Needs an Elite TM or a Community Day">Elite</abbr>' : '') + '</li>';
      }
      return '<article class="member">' +
        '<div class="member-head">' + icon(m.id, 64) + '<div>' +
        '<p class="role">' + ROLE_NAMES[m.role] + '</p>' +
        '<h3>' + escapeHtml(m.name) + '</h3>' +
        '<p class="types">' + typeChips(m.types) + '</p>' +
        '<p class="pvp-rank"><a href="https://pvpoketw.com/rankings/all/' + LEAGUE_CP[state.league] + '/overall/' +
        encodeURIComponent(m.id) + '/" target="_blank" rel="noopener" title="Open in PvPoke">PvPoke #' + m.rank + '</a>' +
        ' <small>of ' + m.rankedCount + ' · score ' + m.rankScore.toFixed(1) + '</small></p>' +
        '</div></div>' +
        '<dl>' +
        '<dt>Fast move</dt><dd><ul class="moves">' + move(fast) + '</ul></dd>' +
        '<dt>Charged moves</dt><dd><ul class="moves">' + charged.map(move).join('') + '</ul></dd>' +
        '<dt>Rank 1 IVs</dt><dd><span class="ivs" title="Attack / Defense / HP">' + m.ivs.atk + ' / ' + m.ivs.def + ' / ' + m.ivs.hp +
        '</span><br><small>Level ' + m.ivs.level + ' · CP ' + m.ivs.cp + '</small></dd>' +
        '</dl>' + ivChecker(m) + '</article>';
    }).join('');

    function threatList(items, strong) {
      return '<ol class="threats">' + items.map(function (t) {
        return '<li>' + icon(t.id, 32) + '<div><span class="threat-name">' + escapeHtml(t.name) + '</span> ' + typeChips(t.types) +
          '<br><small>' + (strong ? escapeHtml(t.answer) + ': ' : 'Best answer ' + escapeHtml(t.answer) + ': ') +
          '<span class="verdict" title="Battle rating ' + t.rating + ' (500 is even)">' + verdict(t.rating) + '</span></small></div></li>';
      }).join('') + '</ol>';
    }

    var shared = d.sharedWeaknesses.length
      ? '<p class="shared">提防雙剋: ' + d.sharedWeaknesses.map(function (w) {
          return typeChips([w.type]) + ' <small>hits ' + w.count + '</small>';
        }).join(' ') + '</p>'
      : '<p class="shared">沒有屬性能對兩名成員產生超強壓制. </p>';

    var layoutNote = LAYOUT_NOTES[d.layout] ? ' Layout <strong>' + d.layout + '</strong>: ' + LAYOUT_NOTES[d.layout] + '.' : '';
    return '<p class="coverage">Has a winning answer to <strong>' + d.beats + ' of the top ' + d.threatCount +
      '</strong> Pokémon in the league.' + layoutNote + '</p>' +
      '<div class="members">' + members + '</div>' +
      '<div class="report">' +
      '<section><h3>全面剋制</h3><p class="hint">Top-30 meta threats this team beats most easily.</p>' + threatList(d.strengths, true) + '</section>' +
      '<section><h3>頭部威脅</h3><p class="hint">Top-30 meta threats with the team’s closest matchups, even if it still wins them.</p>' + threatList(d.weaknesses, false) + shared + '</section>' +
      '</div>';
  }

  function copyLink(btn) {
    save();
    var url = location.href;
    function done(text) {
      btn.textContent = text;
      setTimeout(function () { btn.textContent = 'Copy link'; }, 2000);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(function () { done('Link copied'); }, function () { window.prompt('Copy this link:', url); });
    } else {
      window.prompt('Copy this link:', url);
    }
  }

  resultsEl().addEventListener('click', function (ev) {
    var share = ev.target.closest('button[data-action="share"]');
    if (share) { copyLink(share); return; }
    var btn = ev.target.closest('button[data-team]');
    if (!btn || !described[Number(btn.dataset.team)]) return;
    state.selected = Number(btn.dataset.team);
    save();
    Array.prototype.forEach.call(resultsEl().querySelectorAll('.team-option'), function (b) {
      b.setAttribute('aria-pressed', String(b === btn));
    });
    document.getElementById('team-detail').innerHTML = renderDetail(described[state.selected]);
  });

  resultsEl().addEventListener('input', function (ev) {
    var input = ev.target.closest('input[data-iv]');
    if (!input) return;
    var box = input.closest('.ivcheck');
    var values = Array.prototype.map.call(box.querySelectorAll('input[data-iv]'), function (el) {
      return el.value === '' ? NaN : Number(el.value);
    });
    var valid = values.every(function (n) { return n === Math.floor(n) && n >= 0 && n <= 15; });
    if (valid) saveIvs(box.dataset.id, values);
    else if (values.every(isNaN)) saveIvs(box.dataset.id, null);
    // Only the result line is rewritten, so the input keeps focus and caret.
    box.querySelector('.iv-result').innerHTML = valid ? ivResult(box.dataset.id, values)
      : values.some(function (n) { return !isNaN(n) && (n !== Math.floor(n) || n < 0 || n > 15); })
        ? 'Each IV is a whole number from 0 to 15.' : ivResult(box.dataset.id, null);
  });

  // ---- Form wiring ----

  function renderDataDate() {
    window.PvpData.gamemaster().then(function (gm) {
      document.getElementById('data-date').textContent = ', game data of ' + gm.timestamp.slice(0, 10);
    }).catch(function () { /* the results panel reports load errors */ });
  }

  function syncRadios() {
    ['league', 'style'].forEach(function (field) {
      Array.prototype.forEach.call(document.querySelectorAll('input[name="' + field + '"]'), function (input) {
        input.checked = input.value === state[field];
      });
    });
  }

  // A shared link pasted into an already open tab.
  window.addEventListener('hashchange', function () {
    var shared = readHash();
    if (!shared || location.hash === hashFor(state)) return;
    applySaved(state, { league: shared.league, style: shared.style, picks: shared.picks.concat([null, null]), selected: shared.selected });
    save();
    syncRadios();
    syncCombos();
    renderQuickPicks();
    runSearch();
  });

  function bindRadios(name, field, onChange) {
    var inputs = document.querySelectorAll('input[name="' + name + '"]');
    Array.prototype.forEach.call(inputs, function (input) {
      input.checked = input.value === state[field];
      input.addEventListener('change', function () {
        if (!input.checked) return;
        state[field] = input.value;
        state.selected = 0;
        save();
        if (onChange) onChange();
      });
    });
  }

  function bindTheme() {
    var select = document.getElementById('theme');
    select.value = window.Theme.get();
    select.addEventListener('change', function () { window.Theme.set(select.value); });
  }

  bindRadios('league', 'league', function () { syncCombos(); renderQuickPicks(); runSearch(); });
  bindRadios('style', 'style', function () { runSearch(); });
  bindTheme();
  renderDataDate();
  // Rewrite an old or non-canonical shared link (e.g. a merged style like s=abb) to its current form.
  if (location.hash && hashFor(state) && location.hash !== hashFor(state)) {
    history.replaceState(null, '', hashFor(state));
  }
  runSearch();
})();
