import { resolveTargetTab } from './target-tab.js';

const target = await resolveTargetTab();
const originalQuery = chrome.tabs.query.bind(chrome.tabs);

if (target?.id) {
  chrome.tabs.query = function patchedQuery(queryInfo, callback) {
    const useTarget = Boolean(queryInfo?.active && queryInfo?.currentWindow);
    if (!useTarget) return originalQuery(queryInfo, callback);

    const promise = chrome.tabs.get(target.id).then((tab) => [tab]).catch(() => []);
    if (typeof callback === 'function') {
      promise.then(callback);
      return undefined;
    }
    return promise;
  };
}
