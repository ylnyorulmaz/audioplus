import { getTargetTab } from './target-tab.js';

const sourceName = document.querySelector('#sourceName');
const sourceMeta = document.querySelector('#sourceMeta');
const sourceStateDot = document.querySelector('#sourceStateDot');
const audibleTabsBadge = document.querySelector('#audibleTabsBadge');
const sessionsBadge = document.querySelector('#sessionsBadge');
const focusSourceButton = document.querySelector('#focusSourceButton');
const sourceHint = document.querySelector('#sourceHint');

let targetTab = null;
let timer = null;

function fallbackName(tab) {
  if (tab?.title) return tab.title;
  try { return new URL(tab?.url ?? '').hostname.replace(/^www\./, '') || 'Selected browser tab'; }
  catch { return 'Selected browser tab'; }
}

function plural(count, singular, pluralForm = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}

async function readOverview() {
  if (!targetTab?.id) return null;
  const response = await chrome.runtime.sendMessage({ type: 'GET_AUDIO_OVERVIEW', tabId: targetTab.id });
  if (!response?.ok) throw new Error(response?.error ?? 'Could not read audio tab overview.');
  return response.overview;
}

function render(overview) {
  if (!overview || !sourceName) return;
  const label = overview.label ?? {};
  sourceName.textContent = label.title || label.host || fallbackName(targetTab);

  const host = label.host || (() => {
    try { return new URL(targetTab?.url ?? '').hostname.replace(/^www\./, ''); }
    catch { return ''; }
  })();
  const targetAudio = overview.targetAudible ? 'playing audio' : 'selected';
  if (sourceMeta) sourceMeta.textContent = host ? `${host} · ${targetAudio}` : targetAudio;
  if (sourceStateDot) sourceStateDot.dataset.audible = String(Boolean(overview.targetAudible));

  if (audibleTabsBadge) audibleTabsBadge.textContent = overview.otherAudibleCount > 0
    ? `${plural(overview.otherAudibleCount, 'other tab')} playing`
    : 'No other audio tabs';
  if (audibleTabsBadge) audibleTabsBadge.dataset.active = String(overview.otherAudibleCount > 0);

  if (sessionsBadge) sessionsBadge.textContent = overview.otherEnabledCount > 0
    ? `Audio+ on ${plural(overview.enabledCount, 'tab')}`
    : overview.enabledCount === 1
      ? 'Only this Audio+ session'
      : 'No active Audio+ session';
  if (sessionsBadge) sessionsBadge.dataset.active = String(overview.otherEnabledCount > 0);

  if (!sourceHint) return;
  if (overview.otherAudibleCount > 0 || overview.otherEnabledCount > 0) {
    sourceHint.textContent = 'Audio+ controls this selected tab only. To switch, open another browser tab and click the Audio+ extension icon there.';
  } else {
    sourceHint.textContent = 'Audio+ controls only this tab. Other browser tabs keep their normal audio.';
  }
}

async function refresh() {
  try { render(await readOverview()); }
  catch (error) { if (sourceHint) sourceHint.textContent = error?.message ?? String(error); }
}

focusSourceButton?.addEventListener('click', async () => {
  if (!targetTab?.id) return;
  try {
    await chrome.tabs.update(targetTab.id, { active: true });
    if (Number.isInteger(targetTab.windowId)) await chrome.windows.update(targetTab.windowId, { focused: true });
  } catch (error) {
    if (sourceHint) sourceHint.textContent = error?.message ?? String(error);
  }
});

(async () => {
  if (!sourceName) return;
  targetTab = await getTargetTab();
  if (!targetTab?.id) throw new Error('No browser tab is bound to this Audio+ window.');
  await refresh();
  timer = setInterval(() => {
    if (document.visibilityState === 'visible') refresh();
  }, 900);
})().catch((error) => { if (sourceHint) sourceHint.textContent = error?.message ?? String(error); });

window.addEventListener('pagehide', () => clearInterval(timer));