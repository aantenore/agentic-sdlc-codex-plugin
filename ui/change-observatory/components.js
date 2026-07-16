import {
  PHASES,
  filterIterations,
  firstSummaryItem,
  formatTimestamp,
  groupChangesByIntent,
  narrativeFor,
  rawHrefForPath,
  rawTargetFor,
  readable,
  sentenceCase,
} from "./model.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function node(tag, options = {}, children = []) {
  const element = document.createElement(tag);
  if (options.className) element.className = options.className;
  if (options.text !== undefined) element.textContent = options.text;
  for (const [name, value] of Object.entries(options.attrs ?? {})) {
    if (value !== null && value !== undefined) element.setAttribute(name, String(value));
  }
  for (const [name, value] of Object.entries(options.dataset ?? {})) {
    if (value !== null && value !== undefined) element.dataset[name] = String(value);
  }
  element.append(...children.filter(Boolean));
  return element;
}

function icon(name, className = "") {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  if (className) svg.setAttribute("class", className);
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS(SVG_NAMESPACE, "use");
  use.setAttribute("href", `#icon-${name}`);
  svg.append(use);
  return svg;
}

function provenanceBadge(provenance) {
  return node("span", {
    className: "provenance",
    text: sentenceCase(provenance),
    dataset: { provenance },
  });
}

function sourceButtonFor(item, label = "Source records") {
  const target = rawTargetFor(item);
  if (!target) return null;
  return node(
    "button",
    {
      className: "source-button",
      attrs: { type: "button" },
      dataset: { action: "open-raw", rawHref: target.href, rawPath: target.path },
    },
    [icon("source"), node("span", { text: label })],
  );
}

function emptyInline(message) {
  return node("p", { className: "empty-inline", text: message });
}

function statusKey(status) {
  return readable(status, "missing").replace(/[^a-z]/gi, "").toLowerCase();
}

function statusText(status) {
  return node("span", {
    className: "status-text",
    text: sentenceCase(status),
    dataset: { state: statusKey(status) },
  });
}

function sectionHeading(title, description, actions = []) {
  const copy = node("div", {}, [
    node("h2", { text: title }),
    description ? node("p", { text: description }) : null,
  ]);
  return node("header", { className: "section-heading" }, [
    copy,
    actions.length ? node("div", { className: "section-heading-actions" }, actions) : null,
  ]);
}

function selectControl(label, name, values, selectedValue) {
  const select = node("select", {
    className: "compact-select",
    attrs: { "aria-label": label },
    dataset: { filter: name },
  });
  select.append(node("option", { text: `${label}: All`, attrs: { value: "" } }));
  for (const value of values) {
    const option = node("option", {
      text: sentenceCase(value.label ?? value),
      attrs: { value: value.value ?? value },
    });
    if ((value.value ?? value) === selectedValue) option.selected = true;
    select.append(option);
  }
  return select;
}

export function renderProjectControls(model) {
  const projectSelect = document.querySelector("#project-select");
  const snapshotSelect = document.querySelector("#snapshot-select");
  projectSelect.replaceChildren(
    node("option", { text: model.project.name, attrs: { value: model.project.id } }),
  );
  snapshotSelect.replaceChildren(
    node("option", {
      text: model.project.branch || model.project.snapshot || "Current evidence",
      attrs: { value: "current" },
    }),
  );
}

function renderSummaryAnswer(question, items) {
  const item = firstSummaryItem(items);
  const article = node("article", { className: "summary-answer" }, [
    node("h2", { text: question }),
  ]);
  if (!item) {
    article.append(node("p", { text: "No canonical evidence was recorded for this answer." }));
    article.append(
      node("div", { className: "summary-meta" }, [provenanceBadge("missing")]),
    );
    return article;
  }
  const meta = node("div", { className: "summary-meta" }, [
    node("span", { text: item.id }),
    sourceButtonFor(item),
    provenanceBadge(item.provenance),
  ]);
  article.append(node("p", { text: item.summary }), meta);
  return article;
}

export function renderSummary(container, model) {
  container.replaceChildren(
    renderSummaryAnswer("What was asked?", model.summary.asked),
    renderSummaryAnswer("What changed?", model.summary.changed),
    renderSummaryAnswer("Why was it decided?", model.summary.decided),
  );
}

export function renderDiagnostics(container, diagnostics) {
  if (!diagnostics.length) {
    container.hidden = true;
    container.replaceChildren();
    return;
  }
  container.hidden = false;
  const occurrenceTotal = diagnostics.reduce(
    (total, diagnostic) => total + diagnostic.occurrences,
    0,
  );
  const disclosure = node("details", {
    className: "diagnostics-disclosure",
    attrs: { open: diagnostics.some((diagnostic) => diagnostic.severity === "error") ? "" : null },
  });
  disclosure.append(
    node("summary", {}, [
      icon("alert"),
      node("strong", { text: "Evidence diagnostics" }),
      node("span", {
        text: `${diagnostics.length} ${diagnostics.length === 1 ? "category" : "categories"} · ${occurrenceTotal} ${occurrenceTotal === 1 ? "record" : "records"}`,
      }),
    ]),
    node("div", { className: "diagnostics-list" }, diagnostics.map((diagnostic) =>
      node(
        "div",
        {
          className: "diagnostic",
          attrs: { role: diagnostic.severity === "error" ? "alert" : "status" },
          dataset: { severity: diagnostic.severity },
        },
        [
          icon("alert"),
          node("div", { className: "diagnostic-copy" }, [
            node("strong", { text: `${diagnostic.code}: ` }),
            document.createTextNode(diagnostic.message),
            diagnostic.occurrences > 1
              ? node("span", {
                className: "diagnostic-count",
                text: `${diagnostic.occurrences} records`,
                attrs: { title: "Equivalent diagnostics grouped" },
              })
              : null,
          ]),
        ],
      ),
    )),
  );
  container.replaceChildren(disclosure);
}

function phaseStateIcon(status) {
  const iconName = {
    complete: "check",
    inProgress: "clock",
    blocked: "blocked",
    missing: "minus",
  }[status] ?? "minus";
  return node("span", { className: "state-icon", dataset: { state: status } }, [icon(iconName)]);
}

export function phaseSelectionId(iterationId, phase) {
  return `phase:${iterationId}:${phase}`;
}

export function phaseSelectionItem(iteration, phaseState) {
  return {
    id: phaseSelectionId(iteration.id, phaseState.phase),
    type: "phase-state",
    title: `${iteration.title} · ${sentenceCase(phaseState.phase)}`,
    summary: `${sentenceCase(phaseState.phase)} is ${sentenceCase(phaseState.status).toLowerCase()} for ${iteration.title}.`,
    status: phaseState.status,
    phase: phaseState.phase,
    timestamp: iteration.timestamp,
    provenance: phaseState.provenance,
    sourceRefs: phaseState.sourceRefs,
    rawHref: phaseState.sourceRefs[0] ? rawHrefForPath(phaseState.sourceRefs[0].path) : null,
    narrative: {
      inputSummary: null,
      outputSummary: null,
      rationale: null,
      generatedExplanation: null,
      explanationSource: null,
      alternatives: [],
      evidence: [],
      chainOfThoughtIncluded: false,
    },
    explanation: {},
    inputs: [],
    outputs: [],
    alternatives: [],
    evidence: [],
  };
}

function lineagePanel(model, state) {
  const iterationValues = model.iterations.map((iteration) => ({
    value: iteration.id,
    label: iteration.title,
  }));
  const actions = [
    selectControl("Iteration", "iteration", iterationValues, state.filters.iteration),
    selectControl("Phase", "phase", PHASES, state.filters.phase),
  ];
  const panel = node("section", { className: "section-panel", attrs: { "aria-labelledby": "lineage-heading" } }, [
    sectionHeading(
      "Project lineage",
      "Iteration-by-phase reconstruction from canonical evidence",
      actions,
    ),
  ]);
  panel.querySelector("h2").id = "lineage-heading";

  const iterations = filterIterations(model.iterations, state.filters);
  if (!iterations.length) {
    panel.append(emptyInline("No recorded iterations match the selected filters."));
    return panel;
  }

  const table = node("table", { className: "lineage-table" });
  const headRow = node("tr", {}, [node("th", { text: "Iteration", attrs: { scope: "col" } })]);
  PHASES.forEach((phase, index) => {
    headRow.append(
      node("th", { attrs: { scope: "col" } }, [
        node("span", { className: "phase-heading" }, [
          node("span", { className: "phase-number", text: String(index + 1) }),
          node("span", { text: sentenceCase(phase) }),
        ]),
      ]),
    );
  });
  table.append(node("thead", {}, [headRow]));

  const body = node("tbody");
  for (const iteration of iterations) {
    const row = node("tr", { dataset: { current: Boolean(iteration.currentPhase) } });
    row.append(
      node("th", { className: "iteration-heading", attrs: { scope: "row" } }, [
        document.createTextNode(iteration.title),
        node("span", { text: iteration.timestamp ? formatTimestamp(iteration.timestamp) : iteration.id }),
      ]),
    );
    for (const phase of iteration.phases) {
      const selectionId = phaseSelectionId(iteration.id, phase.phase);
      const associatedSelection =
        state.selectedItem?.phase === phase.phase && iteration.currentPhase === phase.phase;
      row.append(
        node("td", {}, [
          node(
            "button",
            {
              className: "cell-button",
              attrs: {
                type: "button",
                "aria-pressed": String(state.selectedId === selectionId || associatedSelection),
                "aria-label": `${iteration.title}, ${sentenceCase(phase.phase)}: ${sentenceCase(phase.status)}, ${sentenceCase(phase.provenance)}`,
              },
              dataset: {
                action: "select-phase",
                iterationId: iteration.id,
                phase: phase.phase,
              },
            },
            [
              phaseStateIcon(phase.status),
              node("span", { className: "state-label", text: sentenceCase(phase.status) }),
              provenanceBadge(phase.provenance),
            ],
          ),
        ]),
      );
    }
    body.append(row);
  }
  table.append(body);
  panel.append(
    node("div", { className: "lineage-scroll", attrs: { tabindex: "0", "aria-label": "Scrollable lineage matrix" } }, [table]),
    node("footer", { className: "lineage-legend", attrs: { "aria-label": "Lineage status legend" } }, [
      ...[
        ["complete", "Complete"],
        ["inProgress", "In progress"],
        ["blocked", "Blocked"],
        ["missing", "Missing"],
      ].map(([status, label]) =>
        node("span", { className: "legend-item" }, [
          node("span", { className: "legend-dot", dataset: { state: status } }),
          document.createTextNode(label),
        ]),
      ),
      node("span", { className: "legend-item" }, [provenanceBadge("recorded")]),
      node("span", { className: "legend-item" }, [provenanceBadge("inferred")]),
    ]),
  );
  return panel;
}

function recordRow(item, selectedId) {
  return node(
    "button",
    {
      className: "list-row",
      attrs: {
        type: "button",
        "aria-pressed": String(selectedId === item.id),
      },
      dataset: { action: "select-record", selectId: item.id },
    },
    [
      node("span", { className: "record-main" }, [
        node("span", { className: "record-title", text: item.title }),
        node("span", { className: "record-summary", text: item.summary }),
      ]),
      node("span", { className: "record-meta" }, [
        statusText(item.status),
        provenanceBadge(item.provenance),
      ]),
    ],
  );
}

function recordsPanel(title, description, items, state, options = {}) {
  const panel = node("section", { className: "section-panel" }, [sectionHeading(title, description)]);
  if (!items.length) {
    panel.append(emptyInline(options.emptyMessage ?? `No ${title.toLowerCase()} were recorded.`));
    return panel;
  }
  const list = node("div", { className: "record-list", attrs: { role: "list" } });
  const visibleItems = options.limit ? items.slice(0, options.limit) : items;
  visibleItems.forEach((item) => {
    const row = recordRow(item, state.selectedId);
    list.append(node("div", { attrs: { role: "listitem" } }, [row]));
  });
  panel.append(list);
  if (visibleItems.length < items.length) {
    panel.append(node("footer", {
      className: "panel-note",
      text: `Showing ${visibleItems.length} of ${items.length}. Open the dedicated view for the complete history.`,
    }));
  }
  return panel;
}

function changesPanel(model, state, options = {}) {
  const visibleChanges = options.limit ? model.changes.slice(0, options.limit) : model.changes;
  const groups = groupChangesByIntent(visibleChanges);
  const panel = node("section", { className: "section-panel" }, [
    sectionHeading("Recorded changes", "Implementation and sync evidence grouped by recorded intent"),
  ]);
  if (!groups.length) {
    panel.append(emptyInline("No change records were found."));
    return panel;
  }
  const list = node("div", { className: "group-list" });
  for (const group of groups) {
    list.append(
      node("div", { className: "group-heading" }, [
        node("span", { text: sentenceCase(group.intent) }),
        node("span", { className: "group-count", text: String(group.items.length) }),
      ]),
    );
    group.items.forEach((item) => list.append(recordRow(item, state.selectedId)));
  }
  panel.append(list);
  if (visibleChanges.length < model.changes.length) {
    panel.append(node("footer", {
      className: "panel-note",
      text: `Showing ${visibleChanges.length} of ${model.changes.length}. Open Changes for the complete history.`,
    }));
  }
  return panel;
}

function verificationPanel(model, state, options = {}) {
  const panel = node("section", { className: "section-panel" }, [
    sectionHeading("Verification evidence", "Tests, gates, and validation outcomes"),
  ]);
  if (!model.verification.length) {
    panel.append(emptyInline("No verification evidence was recorded."));
    return panel;
  }
  const list = node("div", { className: "record-list", attrs: { role: "list" } });
  const visibleItems = options.limit
    ? model.verification.slice(0, options.limit)
    : model.verification;
  for (const item of visibleItems) {
    list.append(
      node("div", { className: "verification-row", attrs: { role: "listitem" } }, [
        recordRow(item, state.selectedId),
        statusText(item.status),
      ]),
    );
  }
  panel.append(list);
  if (visibleItems.length < model.verification.length) {
    panel.append(node("footer", {
      className: "panel-note",
      text: `Showing ${visibleItems.length} of ${model.verification.length}. Open Verification for the complete history.`,
    }));
  }
  return panel;
}

function overview(model, state) {
  return node("div", { className: "view-stack" }, [
    lineagePanel(model, state),
    node("div", { className: "overview-grid" }, [
      recordsPanel("Contract evolution", "Versions, approvals, and status", model.contracts, state, { limit: 6 }),
      changesPanel(model, state, { limit: 6 }),
      verificationPanel(model, state, { limit: 6 }),
    ]),
  ]);
}

export function renderPrimary(container, model, state) {
  let content;
  switch (state.view) {
    case "timeline":
      content = lineagePanel(model, state);
      break;
    case "contracts":
      content = recordsPanel(
        "Contract evolution",
        "Approved boundaries, versions, and source evidence",
        model.contracts,
        state,
      );
      break;
    case "decisions":
      content = recordsPanel(
        "Decisions",
        "Recorded rationale and alternatives across delivery",
        model.decisions,
        state,
      );
      break;
    case "changes":
      content = changesPanel(model, state);
      break;
    case "verification":
      content = verificationPanel(model, state);
      break;
    default:
      content = overview(model, state);
  }
  container.replaceChildren(content);
}

function inspectorTextSection(title, text, tone = null, meta = null) {
  return node(
    "section",
    {
      className: "inspector-section",
      dataset: { tone },
    },
    [
      node("div", { className: "section-label-row" }, [
        node("h3", { text: title }),
        meta ? node("span", { className: "explanation-label", text: meta }) : null,
      ]),
      node("p", { text }),
    ],
  );
}

function inspectorEntriesSection(title, entries, tone = null) {
  const section = node("section", {
    className: "inspector-section",
    dataset: { tone: entries.length ? tone : "missing" },
  });
  section.append(node("h3", { text: title }));
  if (!entries.length) {
    section.append(node("p", { text: "Not recorded for this evidence item." }));
    return section;
  }
  section.append(
    node(
      "ul",
      { className: "inspector-list" },
      entries.map((entry) =>
        node("li", {}, [
          document.createTextNode(entry.title),
          entry.summary ? node("span", { text: ` — ${entry.summary}` }) : null,
        ]),
      ),
    ),
  );
  return section;
}

function evidenceSection(item, narrative) {
  const entries = [
    ...narrative.evidence,
    ...item.sourceRefs.map((source) => ({
      title: source.path,
      summary: source.pointer,
      sourceRefs: [source],
    })),
  ];
  const unique = [...new Map(entries.map((entry) => [entry.title, entry])).values()];
  const section = node("section", {
    className: "inspector-section",
    dataset: { tone: unique.length ? null : "missing" },
  });
  section.append(node("h3", { text: "Evidence" }));
  if (!unique.length) {
    section.append(node("p", { text: "No source evidence was linked to this item." }));
    return section;
  }
  unique.forEach((entry) => {
    const source = entry.sourceRefs?.find((candidate) => candidate.path?.startsWith(".sdlc/"));
    const href = source ? rawHrefForPath(source.path) : null;
    section.append(
      node("div", { className: "source-row" }, [
        node("span", { className: "source-path", text: entry.title }),
        href
          ? node(
              "button",
              {
                className: "source-button",
                attrs: { type: "button" },
                dataset: { action: "open-raw", rawHref: href, rawPath: source.path },
              },
              [icon("source"), node("span", { text: "Open" })],
            )
          : null,
      ]),
    );
  });
  return section;
}

export function renderInspector(container, item) {
  if (!item) {
    container.replaceChildren(
      node("header", { className: "inspector-header" }, [
        node("h2", { text: "Inspector" }),
        node("span", { text: "No record selected" }),
      ]),
      node("div", { className: "inspector-empty" }, [
        icon("source"),
        node("p", {
          text: "Select a lineage state or evidence record to inspect its recorded inputs, outputs, rationale, alternatives, and sources.",
        }),
      ]),
    );
    return;
  }

  const narrative = narrativeFor(item);
  const generatedTone = narrative.generatedExplanation ? "generated" : "missing";
  const generatedText =
    narrative.generatedExplanation || "No plain-language explanation was recorded for this evidence item.";
  const rationale = narrative.rationale || "No rationale was recorded for this evidence item.";

  const sections = [
    node("header", { className: "inspector-header" }, [
      node("h2", { text: "Inspector" }),
      node("span", { text: `${sentenceCase(item.phase || item.type)} · ${item.id}` }),
    ]),
    inspectorTextSection("Request / record", `${item.title}\n${item.summary}`),
    inspectorTextSection("Decision rationale", rationale, narrative.rationale ? null : "missing"),
    inspectorEntriesSection("Inputs", narrative.inputs),
    inspectorEntriesSection("Outputs", narrative.outputs),
    inspectorTextSection(
      "Plain-language explanation",
      generatedText,
      generatedTone,
      narrative.generatedExplanation
        ? sentenceCase(narrative.explanationLabel || "generated")
        : "not recorded",
    ),
    narrative.chainOfThoughtIncluded
      ? inspectorTextSection(
          "Private reasoning",
          "Hidden by design. Change Observatory never renders private chain-of-thought.",
          "missing",
          "not displayed",
        )
      : null,
    inspectorEntriesSection("Alternatives rejected", narrative.alternatives, "alternatives"),
    evidenceSection(item, narrative),
  ].filter(Boolean);
  container.replaceChildren(...sections);
}

export function renderFatalError(container, error) {
  container.replaceChildren(
    node("div", { className: "error-state", attrs: { role: "alert" } }, [
      icon("alert"),
      node("div", {}, [
        node("strong", { text: "Project lineage could not be loaded" }),
        node("p", { text: error.message }),
      ]),
    ]),
  );
}
