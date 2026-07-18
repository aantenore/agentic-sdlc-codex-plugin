import { ObservatoryApi, accessTokenFromHash } from "./api.js";
import {
  phaseSelectionId,
  phaseSelectionItem,
  renderDiagnostics,
  renderFatalError,
  renderInspector,
  renderPrimary,
  renderProjectControls,
  renderSummary,
} from "./components.js";
import { rawTargetFor, recordSelectionKey } from "./model.js";
import {
  applyDocumentLocale,
  localeFromLocation,
  localizedErrorGuidance,
  setLocale,
  t,
} from "./i18n.js";

const locale = setLocale(localeFromLocation(window.location));
applyDocumentLocale(document, locale);

const VALID_VIEWS = new Set([
  "overview",
  "timeline",
  "contracts",
  "decisions",
  "changes",
  "intent-evidence",
  "verification",
]);

const elements = {
  app: document.querySelector("#app"),
  navigation: document.querySelector("#primary-navigation"),
  navToggle: document.querySelector('[data-action="toggle-navigation"]'),
  summary: document.querySelector("#summary-region"),
  diagnostics: document.querySelector("#diagnostics-region"),
  primary: document.querySelector("#primary-view"),
  inspector: document.querySelector("#inspector"),
  apiStatus: document.querySelector("#api-status"),
  rawDrawer: document.querySelector("#raw-drawer"),
  rawToggle: document.querySelector('[data-action="toggle-raw"]'),
  rawContent: document.querySelector("#raw-content"),
  rawCode: document.querySelector("#raw-code"),
  rawPath: document.querySelector("#raw-path"),
};

const endpoint =
  document.querySelector('meta[name="change-observatory-api"]')?.getAttribute("content") || undefined;
const fragmentToken = accessTokenFromHash(window.location.hash);
if (fragmentToken) {
  window.sessionStorage.setItem("change-observatory-access-token", fragmentToken);
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}
const accessToken = fragmentToken
  || window.sessionStorage.getItem("change-observatory-access-token");
const api = new ObservatoryApi({
  ...(endpoint ? { endpoint } : {}),
  accessToken,
});

const state = {
  model: null,
  view: viewFromHash(),
  filters: { iteration: "", phase: "" },
  selectedIterationId: null,
  selectedId: null,
  selectedItem: null,
  records: new Map(),
  loadController: null,
  rawController: null,
  rawExpanded: false,
};

function viewFromHash() {
  const requested = window.location.hash.replace(/^#/, "");
  return VALID_VIEWS.has(requested) ? requested : "overview";
}

function setApiStatus(label, status) {
  elements.apiStatus.textContent = t(label);
  elements.apiStatus.dataset.status = status;
}

function indexRecords(model) {
  const records = new Map();
  const collections = [
    model.summary.asked,
    model.summary.changed,
    model.summary.decided,
    model.iterations,
    model.contracts,
    model.decisions,
    model.changes,
    model.semanticObservations,
    model.unlinkedLineage,
    model.verification,
  ];
  collections.flat().forEach((item) => {
    const key = recordSelectionKey(item);
    if (key) records.set(key, item);
  });
  for (const iteration of model.iterations) {
    for (const phase of iteration.phases) {
      const item = phaseSelectionItem(iteration, phase);
      records.set(recordSelectionKey(item), item);
    }
    if (iteration.dossier) {
      for (const lane of Object.values(iteration.dossier.lanes)) {
        for (const item of lane.items) {
          const key = recordSelectionKey(item);
          if (key) records.set(key, item);
        }
      }
    }
  }
  state.records = records;
}

function preferredIterationId(model, previousId = null) {
  if (previousId && model.iterations.some((iteration) => iteration.id === previousId)) {
    return previousId;
  }
  return model.iterations.find((iteration) =>
    iteration.currentPhase && iteration.dossier?.status === "partial")?.id
    || model.iterations.find((iteration) => iteration.currentPhase && iteration.dossier)?.id
    || model.iterations.find((iteration) => iteration.dossier)?.id
    || model.iterations[0]?.id
    || null;
}

function preferredSelection(model) {
  let selected = null;
  for (const iteration of model.iterations) {
    for (const phase of iteration.phases) {
      if (phase.status === "inProgress") selected = phaseSelectionItem(iteration, phase);
    }
  }
  return (
    model.summary.changed[0] ||
    selected ||
    model.summary.decided[0] ||
    model.summary.asked[0] ||
    model.contracts[0] ||
    null
  );
}

function updateNavigation() {
  document.querySelectorAll("[data-view]").forEach((button) => {
    const active = button.dataset.view === state.view;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function render() {
  if (!state.model) return;
  updateNavigation();
  renderPrimary(elements.primary, state.model, state);
  renderInspector(elements.inspector, state.selectedItem);
}

async function loadModel({ preserveSelection = false } = {}) {
  state.loadController?.abort();
  const controller = new AbortController();
  state.loadController = controller;
  elements.app.setAttribute("aria-busy", "true");
  setApiStatus("Connecting", "loading");

  try {
    const model = await api.load({ signal: controller.signal });
    if (controller.signal.aborted) return;
    state.model = model;
    indexRecords(model);
    state.selectedIterationId = preferredIterationId(
      model,
      preserveSelection ? state.selectedIterationId : null,
    );

    if (preserveSelection && state.selectedId && state.records.has(state.selectedId)) {
      state.selectedItem = state.records.get(state.selectedId);
    } else {
      state.selectedItem = preferredSelection(model);
      state.selectedId = state.selectedItem ? recordSelectionKey(state.selectedItem) : null;
    }

    renderProjectControls(model);
    renderSummary(elements.summary, model);
    renderDiagnostics(elements.diagnostics, model.diagnostics);
    render();
    setApiStatus("Read-only · ready", "ready");
    document.title = `${model.project.name} · Change Observatory`;
  } catch (error) {
    if (error?.name === "AbortError") return;
    state.model = null;
    state.selectedItem = null;
    state.selectedId = null;
    state.selectedIterationId = null;
    renderFatalError(elements.primary, error);
    renderInspector(elements.inspector, null);
    elements.diagnostics.hidden = true;
    setApiStatus("Unavailable", "error");
  } finally {
    if (!controller.signal.aborted) elements.app.setAttribute("aria-busy", "false");
  }
}

function setView(view) {
  if (!VALID_VIEWS.has(view)) return;
  state.view = view;
  if (window.location.hash !== `#${view}`) window.history.pushState(null, "", `#${view}`);
  if (window.matchMedia("(max-width: 720px)").matches) setNavigationOpen(false);
  render();
  elements.primary.focus({ preventScroll: true });
}

function selectRecord(id) {
  const item = state.records.get(id);
  if (!item) return;
  state.selectedId = id;
  state.selectedItem = item;
  render();
}

function selectIteration(iterationId) {
  if (!state.model?.iterations.some((iteration) => iteration.id === iterationId)) return;
  state.selectedIterationId = iterationId;
  render();
}

function selectPhase(iterationId, phase) {
  state.selectedIterationId = iterationId;
  selectRecord(recordSelectionKey({
    id: phaseSelectionId(iterationId, phase),
    type: "phase-state",
    sourceRefs: [],
  }));
}

function setNavigationOpen(open) {
  elements.navigation.classList.toggle("is-open", open);
  elements.navToggle.setAttribute("aria-expanded", String(open));
}

function setRawExpanded(expanded) {
  state.rawExpanded = expanded;
  elements.rawDrawer.dataset.expanded = String(expanded);
  elements.rawToggle.setAttribute("aria-expanded", String(expanded));
  elements.rawContent.hidden = !expanded;
}

async function openRaw(href, path) {
  if (!href) return;
  state.rawController?.abort();
  const controller = new AbortController();
  state.rawController = controller;
  elements.rawPath.textContent = path || t("Canonical source");
  elements.rawCode.textContent = t("Loading canonical source…");
  setRawExpanded(true);

  try {
    elements.rawCode.textContent = await api.loadRaw(href, { signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") return;
    elements.rawCode.textContent = rawSourceErrorText(error);
  }
}

function rawSourceErrorText(error) {
  const guidance = localizedErrorGuidance(error);
  return [
    t("Raw source unavailable"),
    "",
    `${t("Outcome")}: ${guidance.outcome}`,
    `${t("Impact")}: ${guidance.impact}`,
    `${t("Decision")}: ${guidance.decision}`,
    `${t("Protection")}: ${guidance.protection}`,
    `${t("Next action")}: ${guidance.nextAction}`,
    "",
    `${t("Technical details (optional)")}:`,
    guidance.technical,
  ].join("\n");
}

function openFirstRaw() {
  const selectedTarget = rawTargetFor(state.selectedItem);
  if (selectedTarget) {
    openRaw(selectedTarget.href, selectedTarget.path);
    return;
  }
  const record = state.model?.records.find((candidate) => candidate.rawHref);
  if (record) openRaw(record.rawHref, record.path);
}

function handleClick(event) {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    setView(viewButton.dataset.view);
    return;
  }

  const actionElement = event.target.closest("[data-action]");
  if (!actionElement) return;
  switch (actionElement.dataset.action) {
    case "refresh":
      loadModel({ preserveSelection: true });
      break;
    case "toggle-navigation":
      setNavigationOpen(!elements.navigation.classList.contains("is-open"));
      break;
    case "select-record":
      if (actionElement.dataset.iterationId) {
        state.selectedIterationId = actionElement.dataset.iterationId;
      }
      selectRecord(actionElement.dataset.selectId);
      break;
    case "select-iteration":
      selectIteration(actionElement.dataset.iterationId);
      break;
    case "select-phase":
      selectPhase(actionElement.dataset.iterationId, actionElement.dataset.phase);
      break;
    case "open-raw":
      openRaw(actionElement.dataset.rawHref, actionElement.dataset.rawPath);
      break;
    case "open-first-raw":
      openFirstRaw();
      break;
    case "toggle-raw":
      setRawExpanded(!state.rawExpanded);
      break;
    case "close-raw":
      setRawExpanded(false);
      break;
  }
}

function handleChange(event) {
  const filter = event.target.dataset.filter;
  if (filter === "dossier") {
    selectIteration(event.target.value);
    return;
  }
  if (!filter || !Object.hasOwn(state.filters, filter)) return;
  state.filters[filter] = event.target.value;
  if (filter === "iteration" && event.target.value) {
    state.selectedIterationId = event.target.value;
  }
  render();
}

function handleNavigationKeydown(event) {
  if (!["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
  const buttons = [...elements.navigation.querySelectorAll("[data-view]")];
  const current = buttons.indexOf(document.activeElement);
  if (current < 0) return;

  event.preventDefault();
  let next = current;
  if (["ArrowDown", "ArrowRight"].includes(event.key)) next = (current + 1) % buttons.length;
  if (["ArrowUp", "ArrowLeft"].includes(event.key)) next = (current - 1 + buttons.length) % buttons.length;
  if (event.key === "Home") next = 0;
  if (event.key === "End") next = buttons.length - 1;
  buttons[next].focus();
}

document.addEventListener("click", handleClick);
document.addEventListener("change", handleChange);
elements.navigation.addEventListener("keydown", handleNavigationKeydown);
window.addEventListener("hashchange", () => {
  state.view = viewFromHash();
  render();
});

loadModel();
