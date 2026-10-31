/* ============================================================
   Always On Generators – Field Hub
   Battery Saver  |  battery-saver.js  |  v1.1.0

   ONE JOB: stop the decorative motion that drains a phone in the field —
   the hub's animated background, holiday particles, glowing / pulsing
   effects and the ambient background sounds — while every tool keeps
   working exactly the same.

   NO BUTTON — it follows the phone. It turns itself on when:
     - the phone's "Reduce Motion" setting is on (iPhone: Settings →
       Accessibility → Motion; Android: "Remove animations"), or
     - the battery is at 20% or less and not charging (Android / Chrome /
       computers report this; iPhones don't share battery level with web apps).
   Web apps can't read the phone's own Battery Saver / Low Power Mode
   switch, so those two signals are what it goes by.

   HOW TO USE: add this ONE line to the <head> of every page, before
   sounds.js. It must NOT be deferred (it has to be set before animations
   start):   <script src="../battery-saver.js"></script>

   Animated code asks:  window.AOGSaver.on   (true / false)
   and can re-check when it changes:  AOGSaver.onChange(fn)
   ============================================================ */
(function () {
  'use strict';
  if (window.AOGSaver) return; // loaded twice — keep the first

  var LOW = 0.20;
  var battery = null, reduced = false, on = false, reason = '', fns = [];
  try {
    var mq = matchMedia('(prefers-reduced-motion: reduce)');
    reduced = mq.matches;
    var onMq = function (e) { reduced = e.matches; update(); };
    if (mq.addEventListener) mq.addEventListener('change', onMq); else if (mq.addListener) mq.addListener(onMq);
  } catch (e) {}

  // Finish every CSS animation immediately (end state) instead of looping. Loading spinners keep turning,
  // so a PDF that's still being built never looks frozen.
  var css = document.createElement('style');
  css.id = 'aog-saver-style';
  css.textContent =
    'html.aog-saver *:not([style*="spin"]):not(.rspin),html.aog-saver *::before,html.aog-saver *::after{' +
    'animation-duration:.001ms!important;animation-iteration-count:1!important;animation-delay:0s!important}';
  (document.head || document.documentElement).appendChild(css);

  function lowBattery() { return !!battery && !battery.charging && battery.level <= LOW; }
  function update() {
    var was = on;
    if (lowBattery()) { on = true; reason = 'low battery (' + Math.round(battery.level * 100) + '%)'; }
    else if (reduced) { on = true; reason = 'Reduce Motion is on'; }
    else { on = false; reason = ''; }
    document.documentElement.classList.toggle('aog-saver', on);
    if (on !== was) fns.slice().forEach(function (f) { try { f(on); } catch (e) {} });
    try { document.dispatchEvent(new CustomEvent('aog-saver', { detail: { on: on, reason: reason } })); } catch (e) {}
  }

  try {
    if (navigator.getBattery) navigator.getBattery().then(function (b) {
      battery = b;
      b.addEventListener('levelchange', update);
      b.addEventListener('chargingchange', update);
      update();
    }).catch(function () {});
  } catch (e) {}

  window.AOGSaver = {
    get on() { return on; },
    get reason() { return reason; },
    get batteryKnown() { return !!battery; },
    onChange: function (f) { if (typeof f === 'function') fns.push(f); }
  };
  update();
})();
