/**
 * HEIRLOOM — boot.
 *
 * Wires the three layers together once the DOM is mounted: the renderer's
 * `hooks` get the UI's click handlers, the UI's `actions.ui` gets the DOM
 * feedback functions, and the first `/api/state` fills the render cache.
 *
 * The prototype's `boot()` also seeded a starter strain and a first commission.
 * Both now happen server-side when the player row is created, which is why
 * there is nothing here that invents game state.
 */

import * as api from './api';
import { G, hydrate, setTutorialDone, tutorialDone } from './store.js';
import { Audio_ } from './audio.js';
import { hooks, mountRenderer } from './world.js';
import { actions, startPolling } from './actions.js';
import {
  $,
  closePanel,
  closePicker,
  closePlate,
  coachTick,
  onPlotClick,
  onStructureClick,
  openPanel,
  renderPanel,
  showPlate,
  startCoach,
  toast,
  updateHUD,
  updateTutorial,
} from './ui.js';

/**
 * Mounts the game into an already-rendered DOM. Returns a teardown so React can
 * unmount cleanly — in development it mounts every component twice.
 */
export async function bootGame(canvas) {
  /* The renderer reports events; the UI decides what they mean. */
  hooks.onPlotClick = onPlotClick;
  hooks.onStructureClick = onStructureClick;
  /* Escape should close what is actually in front of the player: the specimen
     plate sits above the seed picker, which sits above the panel. */
  hooks.dismiss = () => {
    if (G.plate) closePlate();
    else if (document.querySelector('#picker')?.classList.contains('is-open')) closePicker();
    else if (G.panel) closePanel();
  };
  hooks.harvestAll = () => void actions.harvestAll();

  /* Actions report outcomes; the DOM layer shows them. */
  actions.ui.toast = toast;
  actions.ui.updateHUD = updateHUD;
  actions.ui.renderPanel = () => {
    if (G.panel) renderPanel();
  };
  actions.ui.updateTutorial = updateTutorial;
  actions.ui.showPlate = showPlate;
  actions.ui.closePlate = closePlate;
  actions.ui.levelBanner = (level) => {
    const banner = $('#levelBanner');
    if (!banner) return;
    $('#levelBannerN').textContent = level;
    banner.classList.add('is-on');
    setTimeout(() => banner.classList.remove('is-on'), 2400);
  };

  // A returning player should not be walked through the tutorial again.
  G.tutorial.done = tutorialDone();

  const stopRenderer = mountRenderer(canvas);

  // Nothing is drawn from invented state: the first paint waits for the server.
  hydrate(await api.fetchState());
  updateHUD();

  bindChrome();

  const stopPolling = startPolling();
  const hudTimer = setInterval(updateHUD, 500);
  const coachTimer = setInterval(coachTick, 60);

  if (process.env.NODE_ENV !== 'production') installDebugBridge();

  return () => {
    clearInterval(hudTimer);
    clearInterval(coachTimer);
    stopPolling();
    stopRenderer();
  };
}

function bindChrome() {
  document.querySelectorAll('.dock__btn').forEach((b) => {
    b.onclick = () => (G.panel === b.dataset.panel ? closePanel() : openPanel(b.dataset.panel));
  });

  $('#panelClose').onclick = closePanel;
  $('#pickerClose').onclick = closePicker;
  $('#picker').onclick = (e) => {
    if (e.target.id === 'picker') closePicker();
  };
  $('#plateClose').onclick = closePlate;
  $('#plate').onclick = (e) => {
    if (e.target.id === 'plate') closePlate();
  };
  $('#harvestAll').onclick = () => void actions.harvestAll();
  $('#plantAll').onclick = () => void actions.plantAll();
  $('#btnHelp').onclick = () => openPanel('help');
  $('#btnMute').onclick = (e) => {
    Audio_.on = !Audio_.on;
    e.currentTarget.classList.toggle('is-off', !Audio_.on);
    e.currentTarget.title = Audio_.on ? 'Sound on' : 'Sound off';
  };

  const title = $('#title');
  $('#start').onclick = () => {
    Audio_.init();
    title.classList.add('is-gone');
    setTimeout(() => {
      title.style.display = 'none';
    }, 900);
    if (!G.tutorial.done) setTimeout(() => startCoach(true), 700);
  };
  $('#skipTut').onclick = () => {
    setTutorialDone(true);
    title.classList.add('is-gone');
    setTimeout(() => {
      title.style.display = 'none';
    }, 900);
    toast('Tutorial skipped. You can replay it from the ? menu.');
  };
}

/**
 * Development only, and stripped from production builds.
 *
 * In the prototype this bridge exposed `makeStrain`, `breed` and `vaultAdd`,
 * which meant anyone with devtools could mint a vault full of legendaries. The
 * economy is the strains, so that was the whole economy. What is left here is
 * read-only: state to inspect and panels to open. There is deliberately no way
 * to create a strain from this console, because there is no longer any code
 * path in the browser that can.
 */
function installDebugBridge() {
  window.HEIRLOOM = {
    G,
    api,
    openPanel,
    closePanel,
    closePicker,
    showPlate,
    closePlate,
    startCoach,
    resync: async () => {
      hydrate(await api.fetchState());
      updateHUD();
    },
    version: '0.1.0',
  };
}
