#!/usr/bin/env node
// Runs js/engine.test.js headless, loading the same files as tests.html. No dependencies.
//   node scripts/run-tests.js
// Exits non-zero if any test fails. tests.html remains the source of truth.
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var root = path.join(__dirname, '..');
globalThis.window = globalThis;

['data/gamemaster.js', 'data/rankings-great.js', 'data/rankings-ultra.js', 'data/rankings-master.js', 'data/rankings-fantasy.js',
  'js/engine.js', 'js/engine.test.js'].forEach(function (file) {
  vm.runInThisContext(fs.readFileSync(path.join(root, file), 'utf8'), { filename: file });
});

var results = window.EngineTests.results;

// Image checks (Node only: they look at files on disk). Images come from scripts/update_images.py.
(function () {
  var file = path.join(root, 'data/images.js');
  if (!fs.existsSync(file)) {
    results.push({ name: 'images: data/images.js exists', pass: false, detail: 'run scripts/update_images.py' });
    return;
  }
  vm.runInThisContext(fs.readFileSync(file, 'utf8'), { filename: 'data/images.js' });
  var map = window.PvpData.raw.images.map;
  // Only the top 100 must have icons: a brand-new Pokémon lower down without an icon yet should not
  // block the weekly data refresh (it just shows without an image), but it is listed.
  ['great', 'ultra', 'master', 'fantasy'].forEach(function (league) {
    var unmapped = window.PvpData.raw['rankings-' + league].map(function (r, i) { return { id: r.id, rank: i + 1 }; })
      .filter(function (r) { return !map[r.id]; });
    var top = unmapped.filter(function (r) { return r.rank <= 100; });
    results.push({ name: 'images: every top-100 ' + league + ' league Pokémon has an icon', pass: !top.length,
      detail: unmapped.length ? 'without icon: ' + unmapped.slice(0, 10).map(function (r) { return r.id + ' #' + r.rank; }).join(', ') : '' });
  });
  var stems = Object.keys(map).map(function (id) { return map[id]; });
  var absent = stems.filter(function (stem, i) {
    return stems.indexOf(stem) === i && !fs.existsSync(path.join(root, 'img/pokemon', stem + '.webp'));
  });
  results.push({ name: 'images: every mapped icon file exists', pass: !absent.length, detail: absent.slice(0, 10).join(', ') });
})();
var failed = results.filter(function (r) { return !r.pass; });
results.forEach(function (r) {
  if (!r.pass || process.argv.indexOf('--verbose') !== -1) {
    console.log((r.pass ? 'PASS  ' : 'FAIL  ') + r.name + (r.detail ? '  (' + r.detail + ')' : ''));
  }
});
console.log((results.length - failed.length) + ' passed, ' + failed.length + ' failed');
process.exit(failed.length ? 1 : 0);
