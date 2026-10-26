// Pure team-building logic: type chart, CP/IV math, a simplified battle simulator, and team
// scoring. No DOM and no app state, so tests.html (and Node) can load it standalone.
// Inputs are the objects js/data.js produces: a gamemaster ({ pokemonById, movesById }) and a
// league's rankings list.
(function () {
  // ---- Constants (values match PvPoke's DamageCalculator.js and Pokemon.js) ----

  var BONUS = 1.2999999523162841796875;          // PvP damage multiplier
  var SUPER_EFFECTIVE = 1.60000002384185791015625;
  var RESISTED = 0.625;
  var DOUBLE_RESISTED = 0.390625;                 // "immune" in the main series
  var STAB = 1.2;
  var SHADOW_ATK = 1.2;
  var SHADOW_DEF = 0.83333331;
  var MAX_ENERGY = 100;
  var LEVEL_CAP = 50;

  // Format id -> CP cap. Cups (fantasy) are formats too: same math, their own rankings.
  var LEAGUES = { great: 1500, ultra: 2500, master: 10000, fantasy: 1500 };

  // CP multiplier per half level, starting at level 1 (index = (level - 1) * 2).
  var CPM = [0.0939999967813491, 0.135137430784308, 0.166397869586944, 0.192650914456886, 0.215732470154762, 0.236572655026622, 0.255720049142837, 0.273530381100769, 0.290249884128570, 0.306057381335773, 0.321087598800659, 0.335445032295077, 0.349212676286697, 0.362457748778790, 0.375235587358474, 0.387592411085168, 0.399567276239395, 0.411193549517250, 0.422500014305114, 0.432926413410414, 0.443107545375824, 0.453059953871985, 0.462798386812210, 0.472336077786704, 0.481684952974319, 0.490855810259008, 0.499858438968658, 0.508701756943992, 0.517393946647644, 0.525942508771329, 0.534354329109191, 0.542635762230353, 0.550792694091796, 0.558830599438087, 0.566754519939422, 0.574569148039264, 0.582278907299041, 0.589887911977272, 0.597400009632110, 0.604823657502073, 0.612157285213470, 0.619404110566050, 0.626567125320434, 0.633649181622743, 0.640652954578399, 0.647580963301656, 0.654435634613037, 0.661219263506722, 0.667934000492096, 0.674581899290818, 0.681164920330047, 0.687684905887771, 0.694143652915954, 0.700542893277978, 0.706884205341339, 0.713169102333341, 0.719399094581604, 0.725575616972598, 0.731700003147125, 0.734741011137376, 0.737769484519958, 0.740785574597326, 0.743789434432983, 0.746781208702482, 0.749761044979095, 0.752729105305821, 0.755685508251190, 0.758630366519684, 0.761563837528228, 0.764486065255226, 0.767397165298461, 0.770297273971590, 0.773186504840850, 0.776064945942412, 0.778932750225067, 0.781790064808426, 0.784636974334716, 0.787473583646825, 0.790300011634826, 0.792803950958807, 0.795300006866455, 0.797803921486970, 0.800300002098083, 0.802803892322847, 0.805299997329711, 0.807803863460723, 0.810299992561340, 0.812803834895026, 0.815299987792968, 0.817803806620319, 0.820299983024597, 0.822803778631297, 0.825299978256225, 0.827803750922782, 0.830299973487854, 0.832803753381377, 0.835300028324127, 0.837803755931569, 0.840300023555755, 0.842803729034748, 0.845300018787384, 0.847803702398935, 0.850300014019012, 0.852803676019539, 0.855300009250640, 0.857803649892077, 0.860300004482269, 0.862803624012168, 0.865299999713897];

  // ---- Type chart ----

  var TYPES = ['normal', 'fighting', 'flying', 'poison', 'ground', 'rock', 'bug', 'ghost', 'steel',
    'fire', 'water', 'grass', 'electric', 'psychic', 'ice', 'dragon', 'dark', 'fairy'];

  // attacking type -> { strong: [...], weak: [...], none: [...] } against defending types.
  var CHART = {
    normal: { weak: ['rock', 'steel'], none: ['ghost'] },
    fighting: { strong: ['normal', 'rock', 'steel', 'ice', 'dark'], weak: ['flying', 'poison', 'bug', 'psychic', 'fairy'], none: ['ghost'] },
    flying: { strong: ['fighting', 'bug', 'grass'], weak: ['rock', 'steel', 'electric'] },
    poison: { strong: ['grass', 'fairy'], weak: ['poison', 'ground', 'rock', 'ghost'], none: ['steel'] },
    ground: { strong: ['poison', 'rock', 'steel', 'fire', 'electric'], weak: ['bug', 'grass'], none: ['flying'] },
    rock: { strong: ['flying', 'bug', 'fire', 'ice'], weak: ['fighting', 'ground', 'steel'] },
    bug: { strong: ['grass', 'psychic', 'dark'], weak: ['fighting', 'flying', 'poison', 'ghost', 'steel', 'fire', 'fairy'] },
    ghost: { strong: ['ghost', 'psychic'], weak: ['dark'], none: ['normal'] },
    steel: { strong: ['rock', 'ice', 'fairy'], weak: ['steel', 'fire', 'water', 'electric'] },
    fire: { strong: ['bug', 'steel', 'grass', 'ice'], weak: ['rock', 'fire', 'water', 'dragon'] },
    water: { strong: ['ground', 'rock', 'fire'], weak: ['water', 'grass', 'dragon'] },
    grass: { strong: ['ground', 'rock', 'water'], weak: ['flying', 'poison', 'bug', 'steel', 'fire', 'grass', 'dragon'] },
    electric: { strong: ['flying', 'water'], weak: ['grass', 'electric', 'dragon'], none: ['ground'] },
    psychic: { strong: ['fighting', 'poison'], weak: ['steel', 'psychic'], none: ['dark'] },
    ice: { strong: ['flying', 'ground', 'grass', 'dragon'], weak: ['steel', 'fire', 'water', 'ice'] },
    dragon: { strong: ['dragon'], weak: ['steel'], none: ['fairy'] },
    dark: { strong: ['ghost', 'psychic'], weak: ['fighting', 'dark', 'fairy'] },
    fairy: { strong: ['fighting', 'dragon', 'dark'], weak: ['poison', 'steel', 'fire'] }
  };

  function single(attackType, defenseType) {
    var row = CHART[attackType];
    if (!row) return 1;
    if (row.strong && row.strong.indexOf(defenseType) !== -1) return SUPER_EFFECTIVE;
    if (row.weak && row.weak.indexOf(defenseType) !== -1) return RESISTED;
    if (row.none && row.none.indexOf(defenseType) !== -1) return DOUBLE_RESISTED;
    return 1;
  }

  // Multiplier for an attack of attackType against a Pokémon with defenseTypes (1 or 2 types).
  function effectiveness(attackType, defenseTypes) {
    var m = 1;
    for (var i = 0; i < defenseTypes.length; i++) m *= single(attackType, defenseTypes[i]);
    return m;
  }

  // Net multiplier above neutral. The tolerance matters: the game's super-effective constant is
  // 1.60000002..., so super-effective times resisted is 1.0000000149, which is neutral.
  function isSuperEffective(attackType, defenseTypes) {
    return effectiveness(attackType, defenseTypes) > 1.0001;
  }

  // Attacking types that hit this typing super-effectively.
  function weaknesses(defenseTypes) {
    return TYPES.filter(function (t) { return isSuperEffective(t, defenseTypes); });
  }

  // ---- CP and IVs ----

  function cpmAt(level) { return CPM[Math.round((level - 1) * 2)]; }

  function cpFor(baseStats, ivs, cpm) {
    var cp = Math.floor((baseStats[0] + ivs[0]) * Math.sqrt(baseStats[1] + ivs[1]) *
      Math.sqrt(baseStats[2] + ivs[2]) * cpm * cpm / 10);
    return Math.max(cp, 10);
  }

  function isShadow(pokemon) {
    return !!(pokemon.tags && pokemon.tags.indexOf('shadow') !== -1);
  }

  function hasTag(pokemon, tag) {
    return !!(pokemon.tags && pokemon.tags.indexOf(tag) !== -1);
  }

  // Lowest IV obtainable, following PvPoke: traded legendaries floor at 1, shadow legendaries at
  // 6, untradeable Pokémon (raid or research only) at 10.
  function ivFloor(pokemon) {
    if (hasTag(pokemon, 'untradeable')) return 10;
    var legendary = hasTag(pokemon, 'legendary') || hasTag(pokemon, 'ultrabeast');
    if (legendary && isShadow(pokemon)) return 6;
    if (legendary && !hasTag(pokemon, 'wildlegendary')) return 1;
    return 0;
  }

  // Highest level at or below LEVEL_CAP whose CP fits under cap, or -1 if even the floor level
  // does not fit. Binary search over the CPM table (CP rises monotonically with level).
  function maxLevelIndex(baseStats, ivs, cap, minIndex) {
    var lo = minIndex, hi = (LEVEL_CAP - 1) * 2;
    if (cpFor(baseStats, ivs, CPM[lo]) > cap) return -1;
    while (lo < hi) {
      var mid = (lo + hi + 1) >> 1;
      if (cpFor(baseStats, ivs, CPM[mid]) <= cap) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  // Battle stats at the given IVs and CPM, before shadow multipliers.
  function statsAt(baseStats, ivs, cpm) {
    return {
      atk: cpm * (baseStats[0] + ivs[0]),
      def: cpm * (baseStats[1] + ivs[1]),
      hp: Math.max(Math.floor(cpm * (baseStats[2] + ivs[2])), 10)
    };
  }

  // Every IV spread's best level under the CP cap, sorted by stat product (rank 1 first).
  // Ties break toward higher attack, then the spread with lower CP, like PvPoke.
  function ivRanking(pokemon, cap) {
    var floor = ivFloor(pokemon);
    var minIndex = pokemon.levelFloor ? Math.round((pokemon.levelFloor - 1) * 2) : 0;
    var base = pokemon.stats;
    var out = [];
    for (var a = floor; a <= 15; a++) {
      for (var d = floor; d <= 15; d++) {
        for (var h = floor; h <= 15; h++) {
          var ivs = [a, d, h];
          var idx = maxLevelIndex(base, ivs, cap, minIndex);
          if (idx < 0) continue;
          var cpm = CPM[idx];
          var s = statsAt(base, ivs, cpm);
          out.push({
            ivs: ivs, level: idx / 2 + 1, cp: cpFor(base, ivs, cpm),
            atk: s.atk, def: s.def, hp: s.hp, statProduct: s.atk * s.def * s.hp
          });
        }
      }
    }
    out.sort(function (x, y) {
      return (y.statProduct - x.statProduct) || (y.atk - x.atk) || (x.cp - y.cp);
    });
    return out;
  }

  var rankingCache = {};

  // How a specific IV spread compares in a league: its rank among every obtainable spread (1 is
  // best), its stat product as a percentage of rank 1's, and the level and CP it reaches under
  // the cap. Spreads below the Pokémon's IV floor are still rated, ranked against the obtainable
  // ones. Returns null if this spread cannot get under the cap at all.
  function ivCheck(pokemon, league, ivs) {
    if (!Array.isArray(ivs) || ivs.length !== 3 || ivs.some(function (v) {
      return typeof v !== 'number' || v !== Math.floor(v) || v < 0 || v > 15;
    })) {
      throw new Error('IVs must be three whole numbers from 0 to 15');
    }
    var key = pokemon.id + '@' + league;
    if (!rankingCache[key]) rankingCache[key] = ivRanking(pokemon, LEAGUES[league]);
    var ranking = rankingCache[key];
    var minIndex = pokemon.levelFloor ? Math.round((pokemon.levelFloor - 1) * 2) : 0;
    var idx = maxLevelIndex(pokemon.stats, ivs, LEAGUES[league], minIndex);
    if (idx < 0 || !ranking.length) return null;
    var cpm = CPM[idx];
    var st = statsAt(pokemon.stats, ivs, cpm);
    var product = st.atk * st.def * st.hp;
    var better = 0;
    while (better < ranking.length && ranking[better].statProduct > product + 1e-9) better++;
    return {
      rank: better + 1,
      of: ranking.length,
      percent: product / ranking[0].statProduct * 100,
      level: idx / 2 + 1,
      cp: cpFor(pokemon.stats, ivs, cpm)
    };
  }

  var rankOneCache = {};

  // The rank-1 spread for this Pokémon in a league, or null if it cannot fit under the cap.
  function rankOne(pokemon, league) {
    var key = pokemon.id + '@' + league;
    if (!(key in rankOneCache)) {
      var cap = LEAGUES[league];
      if (league === 'master') {
        // No cap: max IVs at the level cap is always rank 1.
        var ivs = [15, 15, 15];
        var cpm = cpmAt(LEVEL_CAP);
        var s = statsAt(pokemon.stats, ivs, cpm);
        rankOneCache[key] = { ivs: ivs, level: LEVEL_CAP, cp: cpFor(pokemon.stats, ivs, cpm),
          atk: s.atk, def: s.def, hp: s.hp, statProduct: s.atk * s.def * s.hp };
      } else {
        rankOneCache[key] = ivRanking(pokemon, cap)[0] || null;
      }
    }
    return rankOneCache[key];
  }

  // ---- Battle simulation ----

  // A Pokémon ready to battle: rank-1 stats for the league, shadow multipliers applied, and its
  // moveset resolved to move objects. Returns null if it cannot enter the league.
  function makeBattler(pokemon, moveset, league, movesById) {
    var r1 = rankOne(pokemon, league);
    if (!r1 || !moveset || !moveset.length) return null;
    var shadow = isShadow(pokemon);
    var fast = movesById[moveset[0]];
    var charged = moveset.slice(1).map(function (id) { return movesById[id]; }).filter(Boolean);
    if (!fast || !charged.length) return null;
    return {
      id: pokemon.id,
      types: pokemon.types,
      atk: r1.atk * (shadow ? SHADOW_ATK : 1),
      def: r1.def * (shadow ? SHADOW_DEF : 1),
      hp: r1.hp,
      fast: fast,
      charged: charged,
      stages: pokemon.nativeStatBuffs || [0, 0],
      ability: abilityOf(pokemon, movesById)
    };
  }

  // The form-change abilities the simulator models; anything else (Aegislash, Morpeko) is ignored.
  //   disguise (Mimikyu): the first charged move that would hit it is blocked, then its stats
  //     change to the busted form's.
  //   gulp (Cramorant): after one of its trigger moves it holds a Gulp Missile, Arrokuda above
  //     half HP and Pikachu otherwise, which fires at the next opponent that throws a charged
  //     move at it: damage as a share of that opponent's max HP, plus a debuff.
  function abilityOf(pokemon, movesById) {
    var fc = pokemon.formChange;
    if (!fc) return null;
    if (fc.trigger === 'charged_move_damage' && fc.effect === 'protect') {
      return { kind: 'disguise', after: fc.alternativeStatBuffs || [0, 0] };
    }
    if (fc.trigger === 'charged_move' && fc.alternativeFormId === 'variable' && fc.moveIDs &&
        movesById.GULP_MISSILE_ARROKUDA && movesById.GULP_MISSILE_PIKACHU) {
      return { kind: 'gulp', moves: fc.moveIDs, high: movesById.GULP_MISSILE_ARROKUDA, low: movesById.GULP_MISSILE_PIKACHU };
    }
    return null;
  }

  function damage(attacker, defender, move) {
    return Math.floor(damageCoefficient(attacker, defender, move)) + 1;
  }

  // Damage before the floor and +1, so buff stages can be applied on top at battle time.
  function damageCoefficient(attacker, defender, move) {
    var stab = attacker.types.indexOf(move.type) !== -1 ? STAB : 1;
    return move.power * stab * (attacker.atk / defender.def) *
      effectiveness(move.type, defender.types) * 0.5 * BONUS;
  }

  // Stat stage multiplier (stages run -4..+4), as in the game and PvPoke.
  function stageMultiplier(stage) {
    return stage >= 0 ? (4 + stage) / 4 : 4 / (4 - stage);
  }

  // Guaranteed stat changes of a charged move as { self: [atk, def], opponent: [atk, def] }, or
  // null. Chance-based buffs are ignored so the simulation stays deterministic.
  function guaranteedBuffs(move) {
    if (!move.buffs || parseFloat(move.buffApplyChance) < 1) return null;
    if (move.buffTarget === 'both') return { self: move.buffsSelf, opponent: move.buffsOpponent };
    if (move.buffTarget === 'self') return { self: move.buffs, opponent: null };
    return { self: null, opponent: move.buffs };
  }

  function clampStage(n) { return Math.max(-4, Math.min(4, n)); }

  function applyStages(side, change) {
    if (!change) return;
    side.atkStage = clampStage(side.atkStage + change[0]);
    side.defStage = clampStage(side.defStage + change[1]);
  }

  // Precomputes what one side needs against a specific opponent.
  function sidePlan(self, opp) {
    var charged = self.charged.map(function (m) {
      return { id: m.moveId, energy: m.energy, coef: damageCoefficient(self, opp, m), buffs: guaranteedBuffs(m) };
    });
    var cheapest = charged.reduce(function (a, b) { return b.energy < a.energy ? b : a; });
    var best = charged.reduce(function (a, b) { return b.coef / b.energy > a.coef / a.energy ? b : a; });
    return {
      fastCoef: damageCoefficient(self, opp, self.fast),
      fastEnergy: self.fast.energyGain,
      fastTurns: Math.max(self.fast.turns || 1, 1),
      charged: charged, cheapest: cheapest, best: best
    };
  }

  // Damage a hit with this coefficient does right now, given both sides' stat stages.
  function hit(coef, attacker, defender) {
    return Math.floor(coef * stageMultiplier(attacker.atkStage) / stageMultiplier(defender.defStage)) + 1;
  }

  // Charged move this side throws now, or null to keep using fast moves. Policy:
  //   - opponent has shields: bait with the cheapest move
  //   - otherwise wait for the best damage-per-energy move, unless a cheaper affordable move
  //     already knocks the opponent out, or this side is about to faint, or energy is capped.
  function chooseCharged(me, opp) {
    var plan = me.plan;
    var affordable = plan.charged.filter(function (c) { return c.energy <= me.energy; });
    if (!affordable.length) return null;
    if (opp.shields > 0) return me.energy >= plan.cheapest.energy ? plan.cheapest : null;
    if (me.energy >= plan.best.energy) return plan.best;
    var strongest = affordable.reduce(function (a, b) { return b.coef > a.coef ? b : a; });
    for (var i = 0; i < affordable.length; i++) {
      if (hit(affordable[i].coef, me, opp) >= opp.hp) return affordable[i];
    }
    var aboutToFaint = me.hp <= hit(opp.plan.fastCoef, opp, me) * 2 ||
      opp.plan.charged.some(function (c) { return c.energy <= opp.energy && hit(c.coef, opp, me) >= me.hp; });
    if (aboutToFaint || me.energy >= MAX_ENERGY) return strongest;
    return null;
  }

  var MAX_TURNS = 1000;

  function newSide(battler, opp, shields) {
    return {
      b: battler, plan: sidePlan(battler, opp), hp: battler.hp, energy: 0, shields: shields, busy: 0,
      atkStage: battler.stages[0], defStage: battler.stages[1],
      disguise: !!(battler.ability && battler.ability.kind === 'disguise'), missile: null
    };
  }

  // Simulates a 1v1 with the given shield counts and returns a PvPoke-style battle rating from
  // a's point of view: 500 * (share of b's HP removed) + 500 * (share of a's HP left).
  // 1000 is a flawless win, 500 an even trade, 0 a flawless loss.
  // Simplifications: only guaranteed buffs, defenders always shield, no switching.
  function simulate(a, b, shieldsA, shieldsB) {
    var sides = [newSide(a, b, shieldsA), newSide(b, a, shieldsB)];

    for (var turn = 0; turn < MAX_TURNS && sides[0].hp > 0 && sides[1].hp > 0; turn++) {
      // Decide: sides not mid-fast-move either throw a charged move or start a fast move.
      var throws = [];
      for (var i = 0; i < 2; i++) {
        var me = sides[i], opp = sides[1 - i];
        if (me.busy > 0) continue;
        var c = chooseCharged(me, opp);
        if (c) throws.push({ side: i, choice: c });
        else me.busy = me.plan.fastTurns;
      }

      // Charged moves resolve first, higher attack first (charged move priority). Stat changes
      // apply whether or not the move was shielded.
      throws.sort(function (x, y) { return sides[y.side].b.atk - sides[x.side].b.atk; });
      throws.forEach(function (t) {
        var me = sides[t.side], opp = sides[1 - t.side];
        if (me.hp <= 0) return;
        me.energy -= t.choice.energy;
        if (opp.disguise) {
          opp.disguise = false;
          opp.hp -= 1;
          applyStages(opp, opp.b.ability.after);
        } else if (opp.shields > 0) {
          opp.shields--;
          opp.hp -= 1;
        } else {
          opp.hp -= hit(t.choice.coef, me, opp);
        }
        if (t.choice.buffs) { applyStages(me, t.choice.buffs.self); applyStages(opp, t.choice.buffs.opponent); }
        // A loaded Gulp Missile fires back even if Cramorant fainted to this move.
        if (opp.missile) {
          me.hp -= Math.floor(opp.missile.power / 100 * me.b.hp) + 1;
          applyStages(me, opp.missile.buffs);
          opp.missile = null;
        }
        var ab = me.b.ability;
        if (ab && ab.kind === 'gulp' && ab.moves.indexOf(t.choice.id) !== -1 && me.hp > 0) {
          me.missile = me.hp > me.b.hp / 2 ? ab.high : ab.low;
        }
      });

      // Fast moves land on their last turn; simultaneous fast moves both land.
      var landing = [];
      for (var j = 0; j < 2; j++) {
        var s = sides[j];
        if (s.busy > 0 && --s.busy === 0 && s.hp > 0) landing.push({ me: s, opp: sides[1 - j] });
      }
      landing = landing.map(function (l) { return { l: l, dmg: hit(l.me.plan.fastCoef, l.me, l.opp) }; });
      landing.forEach(function (x) {
        x.l.opp.hp -= x.dmg;
        x.l.me.energy = Math.min(MAX_ENERGY, x.l.me.energy + x.l.me.plan.fastEnergy);
      });
    }

    var dealt = Math.min(1, (b.hp - Math.max(sides[1].hp, 0)) / b.hp);
    var kept = Math.max(sides[0].hp, 0) / a.hp;
    return Math.round(500 * dealt + 500 * kept);
  }

  // Shield scenarios averaged into one matchup rating.
  var SCENARIOS = [[0, 0], [1, 1], [2, 2]];

  function matchup(a, b) {
    var total = 0;
    SCENARIOS.forEach(function (s) { total += simulate(a, b, s[0], s[1]); });
    return Math.round(total / SCENARIOS.length);
  }

  // ---- Teams ----

  var THREAT_COUNT = 100;     // meta size the team is scored against
  var CANDIDATE_COUNT = 150;  // partners considered
  var REPORT_THREATS = 30;    // strengths and weaknesses are picked from the top of the meta

  // Builds everything the search needs for one league: the ranked Pokémon, the threat list with
  // weights, and a lazily filled matchup matrix. Battlers (rank-1 IV search) are built on first
  // use, since only the top of the rankings and the user's picks are ever simulated.
  function createContext(gamemaster, rankings, league) {
    var byId = {};
    var ranked = [];
    rankings.forEach(function (r) {
      var pokemon = gamemaster.pokemonById[r.id];
      if (!pokemon || !r.moveset.length) return;
      // rank: 1-based position in PvPoke's overall rankings for the league.
      var entry = { id: r.id, rank: ranked.length + 1, pokemon: pokemon, ranking: r, battler: undefined };
      byId[r.id] = entry;
      ranked.push(entry);
    });
    var ctx = {
      league: league, gamemaster: gamemaster, byId: byId, ranked: ranked, threats: [],
      totalWeight: 0, rows: {}
    };
    for (var i = 0; i < ranked.length && ctx.threats.length < THREAT_COUNT; i++) {
      if (!battlerOf(ctx, ranked[i])) continue;
      // Rank-based weight: #1 counts 1, #25 counts 0.5, #100 counts 0.2.
      var weight = 1 / (1 + ctx.threats.length / 25);
      ctx.threats.push({ entry: ranked[i], weight: weight });
      ctx.totalWeight += weight;
    }
    return ctx;
  }

  function battlerOf(ctx, entry) {
    if (entry.battler === undefined) {
      entry.battler = makeBattler(entry.pokemon, entry.ranking.moveset, ctx.league, ctx.gamemaster.movesById);
    }
    return entry.battler;
  }

  // Matchup ratings of one ranked Pokémon against every threat, cached per context.
  function row(ctx, id) {
    if (!ctx.rows[id]) {
      var me = battlerOf(ctx, ctx.byId[id]);
      ctx.rows[id] = ctx.threats.map(function (t) { return matchup(me, t.entry.battler); });
    }
    return ctx.rows[id];
  }

  function sharesType(x, y) {
    return x.types.some(function (t) { return y.types.indexOf(t) !== -1; });
  }

  // Team styles, read over [lead, safe swap, closer].
  //   abc:  no two members share a type
  //   pair: exactly two share a type, placed as ABB (swap + closer) or ABA (lead + closer); which
  //         one is decided by role fit. abb/aba alone are kept for layoutOf and direct callers.
  //   any:  no typing rule ("Best score" in the UI)
  function isAbb(l, s, c) { return sharesType(s, c) && !sharesType(l, s) && !sharesType(l, c); }
  function isAba(l, s, c) { return sharesType(l, c) && !sharesType(l, s) && !sharesType(s, c); }
  var STYLES = {
    abc: function (l, s, c) { return !sharesType(l, s) && !sharesType(l, c) && !sharesType(s, c); },
    pair: function (l, s, c) { return isAbb(l, s, c) || isAba(l, s, c); },
    abb: isAbb,
    aba: isAba,
    any: function () { return true; }
  };

  // Typing layout of a team in [lead, swap, closer] order, e.g. "ABC", "ABB", "ABA", "AAB". Each
  // member gets the letter of the first earlier member it shares a type with, else a new letter.
  function layoutOf(members) {
    var letters = [];
    members.forEach(function (m, i) {
      var p = m.pokemon || m;
      var same = -1;
      for (var j = 0; j < i && same < 0; j++) if (sharesType(p, members[j].pokemon || members[j])) same = j;
      letters.push(same >= 0 ? letters[same] : 'ABC'.charAt(new Set(letters).size));
    });
    return letters.join('');
  }

  var ORDERS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];

  // Best [lead, swap, closer] order for the style by PvPoke role scores, or null if no order of
  // these three fits the style. roles: [lead, closer, switch, ...].
  function assignRoles(entries, style) {
    var fits = STYLES[style] || STYLES.any;
    var best = null, bestScore = -Infinity;
    ORDERS.forEach(function (o) {
      var l = entries[o[0]], s = entries[o[1]], c = entries[o[2]];
      if (!fits(l.pokemon, s.pokemon, c.pokemon)) return;
      var score = l.ranking.roles[0] + s.ranking.roles[2] + c.ranking.roles[1];
      if (score > bestScore) { bestScore = score; best = [l, s, c]; }
    });
    return best;
  }

  // Smooth "does this matchup win" curve: 0.5 at an even 500, ~0.84 at 600, ~0.16 at 400.
  function winChance(rating) { return 1 / (1 + Math.exp(-(rating - 500) / 60)); }

  // Higher is better. Coverage of the weighted meta by the team's best answer to each threat,
  // a smaller reward for a second answer, a penalty for types that hit several members
  // super-effectively, and a small bonus for members' own ranking scores.
  function scoreTeam(ctx, entries) {
    var rows = entries.map(function (e) { return row(ctx, e.id); });
    var cover = 0, backup = 0;
    ctx.threats.forEach(function (t, i) {
      var r = rows.map(function (rw) { return rw[i]; }).sort(function (x, y) { return y - x; });
      cover += t.weight * winChance(r[0]);
      backup += t.weight * winChance(r[1]);
    });
    var shared = sharedWeaknesses(entries.map(function (e) { return e.pokemon; }));
    var penalty = shared.reduce(function (s, w) { return s + 0.02 * (w.count - 1); }, 0);
    var quality = entries.reduce(function (s, e) { return s + e.ranking.score; }, 0) / (entries.length * 100);
    return cover / ctx.totalWeight + 0.2 * backup / ctx.totalWeight - penalty + 0.1 * quality;
  }

  // scoreTeam's best possible value (full coverage, full backup, no penalty, perfect members).
  var MAX_TEAM_SCORE = 1.3;

  // A team score on a 0-100 scale for display; same order as scoreTeam.
  function displayScore(score) {
    return Math.max(0, Math.round(score / MAX_TEAM_SCORE * 100));
  }

  // Attacking types that are super-effective against two or more of the given Pokémon.
  function sharedWeaknesses(pokemonList) {
    var out = [];
    TYPES.forEach(function (t) {
      var count = pokemonList.filter(function (p) { return isSuperEffective(t, p.types); }).length;
      if (count >= 2) out.push({ type: t, count: count });
    });
    return out.sort(function (x, y) { return y.count - x.count; });
  }

  // Ranked Pokémon that may join a team with these picks: GO Battle League allows one of each
  // species, so anything sharing a Pokédex number with a pick is out (shadow forms included).
  function candidates(ctx, picks) {
    var dex = picks.map(function (e) { return e.pokemon.dex; });
    return ctx.ranked.slice(0, CANDIDATE_COUNT).filter(function (e) {
      return dex.indexOf(e.pokemon.dex) === -1 && battlerOf(ctx, e);
    });
  }

  // Suggests teams that complete the given picks (1 or 2 Pokémon ids, all ranked in the league).
  // Returns up to `limit` teams, best first: { members: [lead, swap, closer] entries, score }.
  // With one pick, no partner appears in more than two suggestions, so the list shows variety.
  function suggest(ctx, pickIds, style, limit) {
    limit = limit || 5;
    var picks = pickIds.map(function (id) { return ctx.byId[id]; });
    if (picks.some(function (p) { return !p || !battlerOf(ctx, p); })) {
      throw new Error('Pick is not ranked in this league');
    }
    if (picks.length === 2 && picks[0].pokemon.dex === picks[1].pokemon.dex) {
      throw new Error('A team cannot have two of the same species');
    }
    var pool = candidates(ctx, picks);
    var teams = [];

    function consider(members) {
      var ordered = assignRoles(members, style);
      if (ordered) teams.push({ members: ordered, score: scoreTeam(ctx, members) });
    }

    if (picks.length === 2) {
      pool.forEach(function (c) { consider([picks[0], picks[1], c]); });
    } else if (picks.length === 1) {
      for (var i = 0; i < pool.length; i++) {
        for (var j = i + 1; j < pool.length; j++) {
          if (pool[i].pokemon.dex === pool[j].pokemon.dex) continue;
          consider([picks[0], pool[i], pool[j]]);
        }
      }
    } else {
      throw new Error('Pick one or two Pokémon');
    }

    teams.sort(function (x, y) { return y.score - x.score; });
    if (picks.length === 2) return teams.slice(0, limit);

    var seen = {}, out = [];
    for (var k = 0; k < teams.length && out.length < limit; k++) {
      var partners = teams[k].members.filter(function (m) { return m !== picks[0]; });
      if (partners.some(function (p) { return (seen[p.id] || 0) >= 2; })) continue;
      partners.forEach(function (p) { seen[p.id] = (seen[p.id] || 0) + 1; });
      out.push(teams[k]);
    }
    return out;
  }

  var ROLE_NAMES = ['lead', 'swap', 'closer'];

  // Everything the results view shows for a team whose members are already in role order.
  function describeTeam(ctx, team) {
    var gm = ctx.gamemaster;
    var members = team.members.map(function (e, i) {
      var r1 = rankOne(e.pokemon, ctx.league);
      return {
        id: e.id, name: e.pokemon.name, types: e.pokemon.types, role: ROLE_NAMES[i],
        rankScore: e.ranking.score,
        rank: e.rank,
        rankedCount: ctx.ranked.length,
        moves: e.ranking.moveset.map(function (id) {
          var m = gm.movesById[id];
          return { id: id, name: m ? m.name : id, type: m ? m.type : null, elite: !!(e.pokemon.elite && e.pokemon.elite.indexOf(id) !== -1) };
        }),
        ivs: { atk: r1.ivs[0], def: r1.ivs[1], hp: r1.ivs[2], level: r1.level, cp: r1.cp }
      };
    });

    var rows = team.members.map(function (e) { return row(ctx, e.id); });
    var beats = ctx.threats.filter(function (t, i) {
      return rows.some(function (rw) { return rw[i] > 500; });
    }).length;
    var report = ctx.threats.slice(0, REPORT_THREATS).map(function (t, i) {
      var bestIdx = 0;
      rows.forEach(function (rw, k) { if (rw[i] > rows[bestIdx][i]) bestIdx = k; });
      return {
        id: t.entry.id, name: t.entry.pokemon.name, types: t.entry.pokemon.types,
        rating: rows[bestIdx][i], answer: team.members[bestIdx].pokemon.name
      };
    });
    var strengths = report.slice().sort(function (x, y) { return y.rating - x.rating; }).slice(0, 3);
    var weaknesses = report.slice().sort(function (x, y) { return x.rating - y.rating; }).slice(0, 3);

    return {
      score: team.score,
      displayScore: displayScore(team.score),
      layout: layoutOf(team.members),
      // How many of the league's top threats (all THREAT_COUNT) the team has a winning answer to.
      beats: beats,
      threatCount: ctx.threats.length,
      members: members,
      strengths: strengths,
      weaknesses: weaknesses,
      sharedWeaknesses: sharedWeaknesses(team.members.map(function (e) { return e.pokemon; }))
    };
  }

  window.Engine = {
    LEAGUES: LEAGUES,
    TYPES: TYPES,
    effectiveness: effectiveness,
    isSuperEffective: isSuperEffective,
    weaknesses: weaknesses,
    cpmAt: cpmAt,
    cpFor: cpFor,
    ivFloor: ivFloor,
    ivRanking: ivRanking,
    rankOne: rankOne,
    ivCheck: ivCheck,
    makeBattler: makeBattler,
    damage: damage,
    simulate: simulate,
    matchup: matchup,
    createContext: createContext,
    assignRoles: assignRoles,
    layoutOf: layoutOf,
    sharedWeaknesses: sharedWeaknesses,
    scoreTeam: scoreTeam,
    suggest: suggest,
    describeTeam: describeTeam
  };
})();
