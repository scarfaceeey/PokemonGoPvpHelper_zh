// Tests for js/engine.js. Unit tests use inline fixtures; integration tests run against the PvPoke
// snapshot when data/*.js is loaded (tests.html and scripts/run-tests.js both load it).
(function () {
  var E = window.Engine;
  var results = [];
  window.EngineTests = { results: results };

  function test(name, fn) {
    try {
      fn();
    } catch (e) {
      results.push({ name: name, pass: false, detail: 'threw: ' + (e && e.message) });
    }
  }

  function ok(name, cond, detail) {
    results.push({ name: name, pass: !!cond, detail: detail || '' });
  }

  function close(name, actual, expected, tol) {
    tol = tol === undefined ? 1e-9 : tol;
    ok(name, Math.abs(actual - expected) <= tol, 'got ' + actual + ', expected ' + expected);
  }

  function eq(name, actual, expected) {
    var a = JSON.stringify(actual), b = JSON.stringify(expected);
    ok(name, a === b, 'got ' + a + ', expected ' + b);
  }

  function throws(name, fn) {
    try { fn(); ok(name, false, 'did not throw'); } catch (e) { ok(name, true, e.message); }
  }

  // ---- Fixtures ----

  var MOVES = {
    TACKLE: { moveId: 'TACKLE', name: 'Tackle', type: 'normal', power: 5, energy: 0, energyGain: 5, turns: 1 },
    BLAST: { moveId: 'BLAST', name: 'Blast', type: 'normal', power: 90, energy: 50, energyGain: 0, turns: 1 },
    WEAK_BLAST: { moveId: 'WEAK_BLAST', name: 'Weak Blast', type: 'normal', power: 45, energy: 50, energyGain: 0, turns: 1 },
    POWER_UP: { moveId: 'POWER_UP', name: 'Power Up', type: 'normal', power: 45, energy: 50, energyGain: 0, turns: 1,
      buffs: [2, 0], buffTarget: 'self', buffApplyChance: '1' },
    LUCKY_UP: { moveId: 'LUCKY_UP', name: 'Lucky Up', type: 'normal', power: 45, energy: 50, energyGain: 0, turns: 1,
      buffs: [2, 0], buffTarget: 'self', buffApplyChance: '.1' }
  };

  function mon(id, types, stats, extra) {
    var p = { id: id, name: id, dex: id.length, types: types, stats: stats, fast: [], charged: [] };
    for (var k in extra || {}) p[k] = extra[k];
    return p;
  }

  function battler(p, moveset) { return E.makeBattler(p, moveset, 'great', MOVES); }

  // ---- Type chart ----

  test('type chart', function () {
    close('fighting vs normal is super effective', E.effectiveness('fighting', ['normal']), 1.60000002384185791015625);
    close('ghost vs normal is double resisted', E.effectiveness('ghost', ['normal']), 0.390625);
    close('electric vs water/flying stacks', E.effectiveness('electric', ['water', 'flying']), Math.pow(1.60000002384185791015625, 2));
    close('super effective and resisted cancel', E.effectiveness('fire', ['grass', 'water']), 1.60000002384185791015625 * 0.625);
    close('dragon vs fairy is double resisted', E.effectiveness('dragon', ['fairy']), 0.390625);
    eq('steel weaknesses', E.weaknesses(['steel']), ['fighting', 'ground', 'fire']);
    eq('water/ground has one weakness', E.weaknesses(['water', 'ground']), ['grass']);
    ok('super effective times resisted is neutral', !E.isSuperEffective('water', ['water', 'ground']));
  });

  // ---- CP and IVs ----

  test('CP formula matches known in-game values', function () {
    var mewtwo = [300, 182, 214];
    eq('Mewtwo 15/15/15 level 40', E.cpFor(mewtwo, [15, 15, 15], E.cpmAt(40)), 4178);
    eq('Mewtwo 15/15/15 level 50', E.cpFor(mewtwo, [15, 15, 15], E.cpmAt(50)), 4724);
    eq('CP never drops below 10', E.cpFor([10, 10, 10], [0, 0, 0], E.cpmAt(1)), 10);
  });

  test('IV floors', function () {
    eq('ordinary Pokémon', E.ivFloor(mon('a', ['normal'], [1, 1, 1])), 0);
    eq('traded legendary', E.ivFloor(mon('a', ['normal'], [1, 1, 1], { tags: ['legendary'] })), 1);
    eq('wild-catchable legendary', E.ivFloor(mon('a', ['normal'], [1, 1, 1], { tags: ['legendary', 'wildlegendary'] })), 0);
    eq('shadow legendary', E.ivFloor(mon('a', ['normal'], [1, 1, 1], { tags: ['legendary', 'shadow'] })), 6);
    eq('untradeable', E.ivFloor(mon('a', ['normal'], [1, 1, 1], { tags: ['mythical', 'untradeable'] })), 10);
  });

  test('IV ranking', function () {
    var altaria = mon('altaria', ['dragon', 'flying'], [141, 201, 181]);
    var ranking = E.ivRanking(altaria, 1500);
    var r1 = ranking[0];
    eq('Altaria Great League rank 1 is 0/14/15 at level 29', [r1.ivs, r1.level], [[0, 14, 15], 29]);
    ok('every spread fits under the cap', ranking.every(function (r) { return r.cp <= 1500; }));
    ok('sorted by stat product', ranking.every(function (r, i) { return i === 0 || ranking[i - 1].statProduct >= r.statProduct; }));
    eq('all 4096 spreads ranked', ranking.length, 4096);

    var legendary = mon('leg', ['psychic'], [200, 200, 200], { tags: ['legendary'] });
    ok('floor excludes 0 IVs', E.ivRanking(legendary, 1500).every(function (r) { return Math.min.apply(null, r.ivs) >= 1; }));

    var master = E.rankOne(mon('mewtwo', ['psychic'], [300, 182, 214]), 'master');
    eq('Master League rank 1 is hundo at level 50', [master.ivs, master.level, master.cp], [[15, 15, 15], 50, 4724]);

    var check = E.ivCheck(altaria, 'great', [0, 14, 15]);
    eq('IV check: rank 1 spread', [check.rank, check.of, Math.round(check.percent * 100) / 100, check.level], [1, 4096, 100, 29]);
    var hundo = E.ivCheck(altaria, 'great', [15, 15, 15]);
    ok('IV check: 15/15/15 ranks below rank 1', hundo.rank > 1 && hundo.percent < 100 && hundo.cp <= 1500, JSON.stringify(hundo));
    eq('IV check: rank matches the full ranking', hundo.rank,
      1 + ranking.filter(function (r) { return r.statProduct > ranking[hundo.rank - 1].statProduct + 1e-9; }).length);
    var below = E.ivCheck(legendary, 'great', [0, 0, 0]);
    ok('IV check: a spread below the IV floor is still rated', below && below.rank >= 1 && below.of === 15 * 15 * 15, JSON.stringify(below));
    eq('IV check: Master League ranks at level 50', E.ivCheck(mon('mewtwo', ['psychic'], [300, 182, 214]), 'master', [15, 15, 15]).rank, 1);
    throws('IV check: rejects out-of-range IVs', function () { E.ivCheck(altaria, 'great', [16, 0, 0]); });
    throws('IV check: rejects fractional IVs', function () { E.ivCheck(altaria, 'great', [1.5, 0, 0]); });

    var tooBig = mon('big', ['normal'], [500, 500, 500], { levelFloor: 20 });
    eq('Pokémon that cannot fit the cap has no rank 1', E.rankOne(tooBig, 'great'), null);
  });

  // ---- Battle ----

  test('damage formula', function () {
    var a = { types: ['normal'], atk: 100, def: 100 };
    var b = { types: ['fire'], atk: 100, def: 100 };
    // floor(10 * 1.2 STAB * 1 * 0.5 * 1.3) + 1 = floor(7.8) + 1
    eq('STAB neutral hit', E.damage(a, b, { type: 'normal', power: 10 }), 8);
    // floor(10 * 1 * 1.6 * 0.5 * 1.3) + 1 = floor(10.4) + 1
    eq('super-effective non-STAB hit', E.damage(a, b, { type: 'water', power: 10 }), 11);
    eq('minimum damage is 1', E.damage(a, { types: ['ghost'], def: 100 }, { type: 'normal', power: 1 }), 1);
  });

  test('simulator', function () {
    var strong = battler(mon('strong', ['normal'], [220, 180, 180]), ['TACKLE', 'BLAST']);
    var weak = battler(mon('weak', ['normal'], [90, 90, 90]), ['TACKLE', 'BLAST']);
    ok('stronger Pokémon wins', E.simulate(strong, weak, 1, 1) > 500, E.simulate(strong, weak, 1, 1));
    ok('weaker Pokémon loses', E.simulate(weak, strong, 1, 1) < 500, E.simulate(weak, strong, 1, 1));
    var r = E.simulate(strong, weak, 0, 0);
    ok('rating stays within 0-1000', r >= 0 && r <= 1000, r);
    ok('extra shields never hurt', E.simulate(weak, strong, 2, 0) >= E.simulate(weak, strong, 0, 0),
      E.simulate(weak, strong, 2, 0) + ' vs ' + E.simulate(weak, strong, 0, 0));
    var mirror = E.simulate(strong, strong, 1, 1);
    ok('mirror match is close to even', mirror > 350 && mirror < 650, mirror);
    close('matchup averages the three shield scenarios', E.matchup(strong, weak),
      Math.round((E.simulate(strong, weak, 0, 0) + E.simulate(strong, weak, 1, 1) + E.simulate(strong, weak, 2, 2)) / 3), 0);

    var foe = battler(mon('foe', ['normal'], [160, 160, 160]), ['TACKLE', 'BLAST']);
    var hero = mon('hero', ['normal'], [160, 160, 160]);
    var plain = E.simulate(battler(hero, ['TACKLE', 'WEAK_BLAST']), foe, 0, 0);
    var buffed = E.simulate(battler(hero, ['TACKLE', 'POWER_UP']), foe, 0, 0);
    var chance = E.simulate(battler(hero, ['TACKLE', 'LUCKY_UP']), foe, 0, 0);
    ok('guaranteed self buff helps', buffed > plain, buffed + ' vs ' + plain);
    eq('chance-based buffs are ignored', chance, plain);

    var disguised = mon('mimic', ['normal'], [160, 160, 160],
      { formChange: { trigger: 'charged_move_damage', effect: 'protect', alternativeStatBuffs: [0, -1] } });
    var withDisguise = E.simulate(battler(disguised, ['TACKLE', 'BLAST']), foe, 0, 0);
    var without = E.simulate(battler(hero, ['TACKLE', 'BLAST']), foe, 0, 0);
    ok('Disguise blocks a charged move', withDisguise > without, withDisguise + ' vs ' + without);
  });

  // ---- Teams ----

  function entry(id, types, roles) {
    return { id: id, pokemon: mon(id, types, [1, 1, 1]), ranking: { roles: roles, score: 90 } };
  }

  test('team styles and roles', function () {
    var water = entry('water', ['water'], [90, 50, 50]);
    var water2 = entry('water2', ['water', 'ice'], [50, 90, 50]);
    var grass = entry('grass', ['grass'], [50, 50, 90]);
    var fire = entry('fire', ['fire'], [50, 90, 50]);

    var abc = E.assignRoles([water, grass, fire], 'abc');
    eq('ABC puts each Pokémon in its best role', abc.map(function (e) { return e.id; }), ['water', 'grass', 'fire']);
    eq('ABC rejects a shared type', E.assignRoles([water, water2, grass], 'abc'), null);

    var aba = E.assignRoles([water, water2, grass], 'aba');
    ok('ABA: lead and closer share a type', aba && aba[0].pokemon.types[0] === 'water' && aba[2].pokemon.types[0] === 'water');
    eq('ABA: safe swap is the odd one out', aba && aba[1].id, 'grass');

    var abb = E.assignRoles([water, water2, grass], 'abb');
    eq('ABB: lead is the odd one out', abb && abb[0].id, 'grass');
    eq('ABB needs a shared type', E.assignRoles([water, grass, fire], 'abb'), null);
    ok('Any accepts anything', E.assignRoles([water, water2, grass], 'any') !== null);

    var pair = E.assignRoles([water, water2, grass], 'pair');
    ok('Shared type accepts an ABB or ABA order', pair && ['ABB', 'ABA'].indexOf(E.layoutOf(pair)) !== -1, pair && E.layoutOf(pair));
    var best = ['abb', 'aba'].map(function (st) { return E.assignRoles([water, water2, grass], st); })
      .sort(function (x, y) {
        function roleScore(t) { return t[0].ranking.roles[0] + t[1].ranking.roles[2] + t[2].ranking.roles[1]; }
        return roleScore(y) - roleScore(x);
      })[0];
    eq('Shared type keeps the better of the two orders', pair.map(function (e) { return e.id; }), best.map(function (e) { return e.id; }));
    eq('Shared type rejects three distinct typings', E.assignRoles([water, grass, fire], 'pair'), null);
    eq('Shared type rejects a type shared by all three', E.assignRoles([water, water2, entry('water3', ['water'], [1, 1, 1])], 'pair'), null);
    eq('layout ABC', E.layoutOf([water, grass, fire]), 'ABC');
    eq('layout ABA', E.layoutOf([water, grass, water2]), 'ABA');
    eq('layout ABB', E.layoutOf([grass, water, water2]), 'ABB');
    eq('layout AAB', E.layoutOf([water, water2, grass]), 'AAB');
  });

  test('shared weaknesses', function () {
    var list = [mon('a', ['steel'], [1, 1, 1]), mon('b', ['steel', 'ice'], [1, 1, 1]), mon('c', ['rock'], [1, 1, 1])];
    var shared = E.sharedWeaknesses(list);
    eq('fighting hits all three', shared[0], { type: 'fighting', count: 3 });
    eq('types hitting two or more', shared.map(function (s) { return s.type; }).sort(),
      ['fighting', 'fire', 'ground', 'steel', 'water'].filter(function (t) {
        return list.filter(function (p) { return E.isSuperEffective(t, p.types); }).length >= 2;
      }).sort());
  });

  // ---- Integration with the PvPoke snapshot ----

  var raw = window.PvpData && window.PvpData.raw;
  if (!raw || !raw.gamemaster) {
    ok('integration tests skipped: data/*.js not loaded', true);
    return;
  }

  function index(list, key) {
    var map = {};
    list.forEach(function (x) { map[x[key]] = x; });
    return map;
  }
  var gm = { pokemonById: index(raw.gamemaster.pokemon, 'id'), movesById: index(raw.gamemaster.moves, 'moveId') };

  ['great', 'ultra', 'master', 'fantasy'].forEach(function (league) {
    test(league + ' league with real data', function () {
      var ctx = E.createContext(gm, raw['rankings-' + league], league);
      var cap = E.LEAGUES[league];
      eq(league + ': 100 threats', ctx.threats.length, 100);

      var pick = ctx.ranked[0].id;
      var teams = E.suggest(ctx, [pick], 'abc', 5);
      eq(league + ': five suggestions', teams.length, 5);
      ok(league + ': every team includes the pick', teams.every(function (t) {
        return t.members.some(function (m) { return m.id === pick; });
      }));
      ok(league + ': no duplicate species', teams.every(function (t) {
        var dex = t.members.map(function (m) { return m.pokemon.dex; });
        return dex[0] !== dex[1] && dex[0] !== dex[2] && dex[1] !== dex[2];
      }));
      ok(league + ': teams fit ABC', teams.every(function (t) { return E.assignRoles(t.members, 'abc') !== null; }));
      var paired = E.suggest(ctx, [pick], 'pair', 5);
      ok(league + ': shared-type teams are ABB or ABA', paired.length > 0 && paired.every(function (t) {
        return ['ABB', 'ABA'].indexOf(E.describeTeam(ctx, t).layout) !== -1;
      }), paired.map(function (t) { return E.layoutOf(t.members); }).join(' '));
      ok(league + ': best first', teams.every(function (t, i) { return i === 0 || teams[i - 1].score >= t.score; }));

      var two = E.suggest(ctx, [teams[0].members[0].id, teams[0].members[1].id], 'any', 3);
      ok(league + ': suggest-1 keeps both picks', two.length > 0 && two.every(function (t) {
        var ids = t.members.map(function (m) { return m.id; });
        return ids.indexOf(teams[0].members[0].id) !== -1 && ids.indexOf(teams[0].members[1].id) !== -1;
      }));

      var d = E.describeTeam(ctx, teams[0]);
      eq(league + ': roles', d.members.map(function (m) { return m.role; }), ['lead', 'swap', 'closer']);
      ok(league + ': members carry their PvPoke rank', d.members.every(function (m) {
        return ctx.ranked[m.rank - 1].id === m.id && m.rankedCount === ctx.ranked.length;
      }));
      ok(league + ': IVs fit the cap', d.members.every(function (m) { return m.ivs.cp <= cap; }));
      ok(league + ': every member has a fast and a charged move', d.members.every(function (m) { return m.moves.length >= 2; }));
      eq(league + ': three strengths and three weaknesses', [d.strengths.length, d.weaknesses.length], [3, 3]);
      ok(league + ': strengths rate higher than weaknesses', d.strengths[2].rating >= d.weaknesses[2].rating);
      ok(league + ': display score is 0-100', d.displayScore >= 0 && d.displayScore <= 100, d.displayScore);
      ok(league + ': beats counts winning answers among the 100 threats', d.threatCount === 100 &&
        d.beats <= 100 && (d.weaknesses[0].rating > 500 || d.beats < 100), d.beats + '/' + d.threatCount);
    });
  });

  test('fantasy cup only ranks Dragon, Steel and Fairy types', function () {
    var bad = raw['rankings-fantasy'].filter(function (r) {
      return !gm.pokemonById[r.id].types.some(function (t) { return ['dragon', 'steel', 'fairy'].indexOf(t) !== -1; });
    });
    eq('every ranked Pokémon is eligible', bad.map(function (r) { return r.id; }), []);
  });

  test('suggest rejects bad input', function () {
    var ctx = E.createContext(gm, raw['rankings-great'], 'great');
    throws('unknown Pokémon', function () { E.suggest(ctx, ['not_a_pokemon'], 'abc'); });
    throws('two of the same species', function () { E.suggest(ctx, ['altaria', 'altaria_shadow'], 'abc'); });
    throws('no picks', function () { E.suggest(ctx, [], 'abc'); });
  });
})();
