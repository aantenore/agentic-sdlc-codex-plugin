const SUPPORTED_LOCALES = new Set(["en", "it"]);
const LEVELS = new Set(["supervised", "checkpointed", "bounded-autonomous"]);

const CATALOG = Object.freeze({
  en: Object.freeze({
    "level.supervised": "step-by-step control",
    "level.checkpointed": "independent work between agreed checkpoints",
    "level.bounded-autonomous": "independent completion inside the exact approved boundary",
    "level.unknown": "the safest restricted mode",
    "level.impact.supervised": "The agent pauses before material work and waits for an explicit decision.",
    "level.impact.checkpointed": "The agent may continue through the agreed phases, but it pauses at sensitive or release checkpoints.",
    "level.impact.bounded-autonomous": "The agent may complete the delivery without routine pauses, but only inside the displayed scope, paths, tools, budget, and target.",
    "authority.audit": "The approval is recorded, but it does not have a verifiable digital signature from the system running the plugin.",
    "authority.verified": "The system running the plugin has verified a signed approval for this exact decision.",
    "authority.required": "A signed approval verified by the system running the plugin is required before greater independence can take effect.",
    "authority.invalid": "The available authority evidence is not sufficient, so the safest restrictions remain in force.",
    "requirement.result": "This requirement allows a later delivery to choose at most {level}.",
    "requirement.impact": "A later pull request or local release may ask for up to {level}, but its actual level is decided separately and may be lower.",
    "requirement.impact.narrowed": "With the current approval method, a request for the highest level would operate only with {level}. {authority}",
    "requirement.next.approved": "Choose the level for the next individual delivery. This ceiling does not authorize a pull request or local release by itself.",
    "requirement.next.review": "Review and approve the requirement boundary before creating a delivery profile.",
    "delivery.pull_request": "one pull request",
    "delivery.local_release": "one local release",
    "delivery.unknown": "one delivery",
    "delivery.scope.pr": "This choice applies only to the identified pull request and ends when it is merged, closed, or cancelled; it cannot be reused for another pull request.",
    "delivery.scope.local": "This choice applies only to the identified local release and ends when it is released, rolled back, or cancelled; it cannot be reused for another release.",
    "delivery.scope.generic": "This choice applies only to the identified delivery and cannot be reused for another delivery.",
    "delivery.merge.outside": "Merge remains outside this profile and has not been performed.",
    "delivery.merge.separate": "Merge is permitted only as its own exact, separately checked action; approving this profile has not performed it.",
    "delivery.merge.done": "The recorded merge action is complete.",
    "delivery.proposal.result": "The autonomy choice for {delivery} is ready for review.",
    "delivery.proposal.impact.narrowed": "The requested level is {requested}, but the agent can currently use only {effective}. {authority} {scope} {merge}",
    "delivery.proposal.impact.normal": "The agent can use {effective}. {authority} {scope} {merge}",
    "delivery.proposal.next": "Before approving, check the exact repository or local folder, destination, permitted changes, pause points, expiry, and one-delivery limit.",
    "delivery.approval.result": "The autonomy choice is approved and active for {delivery}.",
    "delivery.approval.impact": "Work may proceed with {effective}. {authority} {scope} {merge}",
    "delivery.approval.next.checkpoint": "Start the delivery inside the approved boundary and request confirmation when the next checkpoint is reached.",
    "delivery.approval.next.autonomous": "Start the delivery and complete it inside the exact approved boundary; stop if scope, target, risk, or required authority changes.",
    "delivery.approval.next.supervised": "Request explicit confirmation before starting material work.",
    "delivery.status.proposed": "The autonomy choice has been proposed but is not active yet.",
    "delivery.status.active": "The autonomy choice is active for {delivery}.",
    "delivery.status.terminal": "This autonomy choice is closed and cannot be reused.",
    "delivery.status.invalid": "This autonomy choice needs repair and cannot be used now.",
    "delivery.status.other": "This autonomy choice cannot currently be used.",
    "delivery.status.impact": "The agent can actually work with {effective}. {authority} {scope} {merge}",
    "delivery.status.impact.invalid": "The approved boundary could not be validated, so execution is stopped at {effective}. {scope} {merge}",
    "delivery.status.next.proposed": "Review and approve the exact delivery boundary before work starts.",
    "delivery.status.next.active": "Continue only with actions allowed by this delivery profile and observe every required checkpoint.",
    "delivery.status.next.terminal": "Create a new profile and obtain a new decision for any further delivery.",
    "delivery.status.next.invalid": "Repair and reapprove the exact repository, branch, paths, actions, or evidence before continuing.",
    "action.repository.write": "change files inside the approved write set",
    "action.test.run": "run the approved tests",
    "action.git.commit": "create the exact reviewed commit",
    "action.git.push": "push the approved commit range",
    "action.pull_request.create": "create the identified pull request",
    "action.pull_request.update": "update the identified pull request",
    "action.pull_request.merge": "merge the identified pull request",
    "action.build.local": "build the approved local release",
    "action.release.local": "complete the approved local release",
    "action.unknown": "perform the requested operation",
    "checkpoint.result.required": "The operation to {action} is paused before execution.",
    "checkpoint.result.authorized": "The operation to {action} is authorized, but it has not been executed by this decision.",
    "checkpoint.impact.audit": "An explicit confirmation can be recorded, but the tool cannot independently verify the approver. The operation remains limited to the exact displayed target.",
    "checkpoint.impact.verified": "The checkpoint requires trusted host or CI proof bound to this exact operation and target.",
    "checkpoint.impact.audit.authorized": "The authorization is recorded for this exact target, but it does not have an independently verified signature. The operation itself has not run.",
    "checkpoint.impact.verified.authorized": "A signed approval has been verified for this exact operation and target. The operation itself has not run.",
    "checkpoint.next.audit": "Confirm the displayed operation explicitly, then let the external tool execute it and record immutable completion evidence.",
    "checkpoint.next.verified": "Provide the trusted proof for this exact operation, then let the external tool execute it and record immutable completion evidence.",
    "checkpoint.next.authorized": "Run only the exact displayed operation, then record immutable completion evidence.",
    "checkpoint.merge.pending": "No merge has been performed.",
    "gate.result.passed": "The checks completed without a blocking issue.",
    "gate.result.failed": "The checks found {count} blocking issue(s), so work cannot continue yet.",
    "gate.impact.passed": "The recorded scope and evidence are consistent enough for the next separately authorized step. The check itself did not change, release, deploy, or merge anything.",
    "gate.impact.failed": "At least one required boundary or piece of evidence is missing, stale, invalid, or inconsistent. No protected action was performed.",
    "gate.next.passed": "Continue with the next action only if it is covered by the current delivery profile and its required checkpoint or authorization.",
    "gate.next.failed": "Resolve the reported blockers, preserve the evidence, and run the check again before continuing.",
  }),
  it: Object.freeze({
    "level.supervised": "controllo passo per passo",
    "level.checkpointed": "lavoro autonomo tra checkpoint concordati",
    "level.bounded-autonomous": "completamento autonomo entro il perimetro esatto approvato",
    "level.unknown": "la modalità più prudente e limitata",
    "level.impact.supervised": "L’agente si ferma prima del lavoro materiale e attende una decisione esplicita.",
    "level.impact.checkpointed": "L’agente può proseguire nelle fasi concordate, ma si ferma nei passaggi sensibili o di rilascio.",
    "level.impact.bounded-autonomous": "L’agente può completare la consegna senza pause ordinarie, ma soltanto entro ambito, percorsi, strumenti, budget e destinazione mostrati.",
    "authority.audit": "L’approvazione viene registrata, ma non ha una firma digitale verificabile dal sistema che esegue il plugin.",
    "authority.verified": "Il sistema che esegue il plugin ha verificato un’approvazione firmata per questa decisione esatta.",
    "authority.required": "Prima di rendere effettiva una maggiore indipendenza serve un’approvazione firmata e verificata dal sistema che esegue il plugin.",
    "authority.invalid": "Le prove di autorità disponibili non sono sufficienti, quindi restano attive le restrizioni più prudenti.",
    "requirement.result": "Questo requisito permette a una consegna successiva di scegliere al massimo: {level}.",
    "requirement.impact": "Una pull request o un rilascio locale successivo potrà chiedere fino a {level}, ma il livello reale verrà deciso separatamente e potrà essere più basso.",
    "requirement.impact.narrowed": "Con il metodo di approvazione attuale, una richiesta del livello massimo funzionerebbe soltanto con {level}. {authority}",
    "requirement.next.approved": "Scegli il livello per la prossima singola consegna. Questo tetto, da solo, non autorizza una pull request o un rilascio locale.",
    "requirement.next.review": "Rivedi e approva il perimetro del requisito prima di creare un profilo di consegna.",
    "delivery.pull_request": "una sola pull request",
    "delivery.local_release": "un solo rilascio locale",
    "delivery.unknown": "una sola consegna",
    "delivery.scope.pr": "Questa scelta vale soltanto per la pull request identificata e termina quando viene unita, chiusa o annullata; non può essere riutilizzata per un’altra pull request.",
    "delivery.scope.local": "Questa scelta vale soltanto per il rilascio locale identificato e termina quando viene rilasciato, ripristinato o annullato; non può essere riutilizzata per un altro rilascio.",
    "delivery.scope.generic": "Questa scelta vale soltanto per la consegna identificata e non può essere riutilizzata per un’altra consegna.",
    "delivery.merge.outside": "Il merge resta fuori da questo profilo e non è stato eseguito.",
    "delivery.merge.separate": "Il merge è consentito soltanto come azione esatta e verificata separatamente; l’approvazione del profilo non lo ha eseguito.",
    "delivery.merge.done": "L’azione di merge registrata è completata.",
    "delivery.proposal.result": "La scelta di autonomia per {delivery} è pronta per la revisione.",
    "delivery.proposal.impact.narrowed": "Il livello richiesto è {requested}, ma l’agente può usare adesso soltanto {effective}. {authority} {scope} {merge}",
    "delivery.proposal.impact.normal": "L’agente può usare {effective}. {authority} {scope} {merge}",
    "delivery.proposal.next": "Prima di approvare verifica repository o cartella locale, destinazione, modifiche consentite, punti di pausa, scadenza e limite a una sola consegna.",
    "delivery.approval.result": "La scelta di autonomia è approvata e attiva per {delivery}.",
    "delivery.approval.impact": "Il lavoro può procedere con {effective}. {authority} {scope} {merge}",
    "delivery.approval.next.checkpoint": "Avvia la consegna entro il perimetro approvato e richiedi conferma quando raggiungi il prossimo checkpoint.",
    "delivery.approval.next.autonomous": "Avvia e completa la consegna entro il perimetro esatto approvato; fermati se cambiano ambito, destinazione, rischio o autorità richiesta.",
    "delivery.approval.next.supervised": "Richiedi una conferma esplicita prima di iniziare il lavoro materiale.",
    "delivery.status.proposed": "La scelta di autonomia è stata proposta ma non è ancora attiva.",
    "delivery.status.active": "La scelta di autonomia è attiva per {delivery}.",
    "delivery.status.terminal": "Questa scelta di autonomia è chiusa e non può essere riutilizzata.",
    "delivery.status.invalid": "Questa scelta di autonomia deve essere corretta e non può essere usata adesso.",
    "delivery.status.other": "Questa scelta di autonomia non può essere usata adesso.",
    "delivery.status.impact": "L’agente può lavorare realmente con {effective}. {authority} {scope} {merge}",
    "delivery.status.impact.invalid": "Non è stato possibile convalidare il perimetro approvato; l’esecuzione è quindi ferma a {effective}. {scope} {merge}",
    "delivery.status.next.proposed": "Rivedi e approva il perimetro esatto della consegna prima di iniziare il lavoro.",
    "delivery.status.next.active": "Continua soltanto con le azioni consentite dal profilo e rispetta ogni checkpoint richiesto.",
    "delivery.status.next.terminal": "Per qualsiasi altra consegna crea un nuovo profilo e ottieni una nuova decisione.",
    "delivery.status.next.invalid": "Correggi e fai riapprovare repository, branch, percorsi, azioni o prove esatte prima di continuare.",
    "action.repository.write": "modificare file entro i percorsi di scrittura approvati",
    "action.test.run": "eseguire i test approvati",
    "action.git.commit": "creare l’esatto commit revisionato",
    "action.git.push": "pubblicare l’intervallo di commit approvato",
    "action.pull_request.create": "creare la pull request identificata",
    "action.pull_request.update": "aggiornare la pull request identificata",
    "action.pull_request.merge": "unire la pull request identificata",
    "action.build.local": "costruire il rilascio locale approvato",
    "action.release.local": "completare il rilascio locale approvato",
    "action.unknown": "eseguire l’operazione richiesta",
    "checkpoint.result.required": "L’operazione per {action} è sospesa prima dell’esecuzione.",
    "checkpoint.result.authorized": "L’operazione per {action} è autorizzata, ma questa decisione non l’ha eseguita.",
    "checkpoint.impact.audit": "È possibile registrare una conferma esplicita, ma il tool non può verificare autonomamente chi approva. L’operazione resta limitata alla destinazione esatta mostrata.",
    "checkpoint.impact.verified": "Il checkpoint richiede una prova attendibile dell’host o della CI, vincolata a questa esatta operazione e destinazione.",
    "checkpoint.impact.audit.authorized": "L’autorizzazione è registrata per questa destinazione esatta, ma non ha una firma verificata in modo indipendente. L’operazione non è ancora stata eseguita.",
    "checkpoint.impact.verified.authorized": "È stata verificata un’approvazione firmata per questa esatta operazione e destinazione. L’operazione non è ancora stata eseguita.",
    "checkpoint.next.audit": "Conferma esplicitamente l’operazione mostrata, poi lascia che lo strumento esterno la esegua e registra prove immutabili del completamento.",
    "checkpoint.next.verified": "Fornisci la prova attendibile per questa esatta operazione, poi lascia che lo strumento esterno la esegua e registra prove immutabili del completamento.",
    "checkpoint.next.authorized": "Esegui soltanto l’operazione esatta mostrata, poi registra prove immutabili del completamento.",
    "checkpoint.merge.pending": "Nessun merge è stato eseguito.",
    "gate.result.passed": "I controlli sono terminati senza blocchi.",
    "gate.result.failed": "I controlli hanno trovato {count} blocco/i; il lavoro non può ancora proseguire.",
    "gate.impact.passed": "Ambito e prove registrate sono coerenti per il prossimo passo, che resta da autorizzare separatamente. Il controllo non ha modificato, rilasciato, distribuito né unito nulla.",
    "gate.impact.failed": "Manca almeno un confine o una prova richiesta, oppure è obsoleta, non valida o incoerente. Nessuna azione protetta è stata eseguita.",
    "gate.next.passed": "Continua con il prossimo passo soltanto se è coperto dal profilo corrente e dal checkpoint o dall’autorizzazione richiesta.",
    "gate.next.failed": "Risolvi i blocchi segnalati, conserva le prove e ripeti il controllo prima di proseguire.",
  }),
});

export function createHumanGuidance({ locale = "en", messages = {} } = {}) {
  const normalizedLocale = normalizeLocale(locale);
  if (!isPlainObject(messages)) throw new TypeError("Human guidance messages must be an object");
  const t = (key, values = {}) => renderTemplate(messages[key] ?? CATALOG[normalizedLocale][key], values, key);
  const levelLabel = (level) => t(LEVELS.has(level) ? `level.${level}` : "level.unknown");

  const requirementAutonomyCeiling = (input = {}) => {
    const requested = input.autonomy_ceiling ?? input.requested_level ?? "supervised";
    const authority = authorityMode(input);
    const authorityVerified = isAuthorityVerified(input);
    const { effective, inferred } = effectiveLevel(input, requested, authority);
    const narrowed = levelRank(effective) < levelRank(requested);
    const requirementImpact = t("requirement.impact", { level: levelLabel(requested) });
    return block({
      result: t("requirement.result", { level: levelLabel(requested) }),
      impact: narrowed
        ? `${requirementImpact} ${t("requirement.impact.narrowed", {
            level: levelLabel(effective),
            authority: authorityText(t, authority, authorityVerified),
          })}`
        : `${requirementImpact} ${authorityText(t, authority, authorityVerified)}`,
      next_action: t(["approved", "active"].includes(input.status) || input.active === true
        ? "requirement.next.approved"
        : "requirement.next.review"),
      details: commonDetails("requirement_autonomy_ceiling", input, {
        autonomy_ceiling: requested,
        effective_level: effective,
        effective_level_inferred: inferred,
        authority_mode: authority,
        authority_verified: authorityVerified,
        narrowed,
      }),
    });
  };

  const deliveryAutonomyProposal = (input = {}) => {
    const context = deliveryContext(input, t, levelLabel);
    return block({
      result: t("delivery.proposal.result", { delivery: context.deliveryLabel }),
      impact: context.narrowed
        ? t("delivery.proposal.impact.narrowed", context.templateValues)
        : t("delivery.proposal.impact.normal", context.templateValues),
      next_action: t("delivery.proposal.next"),
      details: deliveryDetails("delivery_autonomy_proposal", input, context),
    });
  };

  const deliveryAutonomyApproval = (input = {}) => {
    const context = deliveryContext({ ...input, status: input.status ?? "active" }, t, levelLabel);
    const nextKey = context.effective === "bounded-autonomous"
      ? "delivery.approval.next.autonomous"
      : context.effective === "checkpointed"
        ? "delivery.approval.next.checkpoint"
        : "delivery.approval.next.supervised";
    return block({
      result: t("delivery.approval.result", { delivery: context.deliveryLabel }),
      impact: t("delivery.approval.impact", context.templateValues),
      next_action: `${t(nextKey)}${context.mergePending ? ` ${context.mergeText}` : ""}`,
      details: deliveryDetails("delivery_autonomy_approval", input, context),
    });
  };

  const deliveryAutonomyStatus = (input = {}) => {
    const context = deliveryContext(input, t, levelLabel);
    const statusGroup = deliveryStatusGroup(input.status);
    return block({
      result: t(`delivery.status.${statusGroup}`, { delivery: context.deliveryLabel }),
      impact: t(statusGroup === "invalid" ? "delivery.status.impact.invalid" : "delivery.status.impact", context.templateValues),
      next_action: t(`delivery.status.next.${["other", "terminal"].includes(statusGroup) ? "terminal" : statusGroup}`),
      details: deliveryDetails("delivery_autonomy_status", input, context),
    });
  };

  const actionCheckpoint = (input = {}) => {
    const authority = authorityMode(input);
    const action = String(input.action ?? "unknown");
    const actionLabel = t(CATALOG[normalizedLocale][`action.${action}`] ? `action.${action}` : "action.unknown");
    const authorized = input.status === "authorized";
    const mergePending = action === "pull_request.merge" && input.merge_executed !== true;
    return block({
      result: t(authorized ? "checkpoint.result.authorized" : "checkpoint.result.required", {
        action: actionLabel,
      }),
      impact: t(authorized
        ? authority === "host_verified" ? "checkpoint.impact.verified.authorized" : "checkpoint.impact.audit.authorized"
        : authority === "host_verified" ? "checkpoint.impact.verified" : "checkpoint.impact.audit"),
      next_action: `${t(authorized
        ? "checkpoint.next.authorized"
        : authority === "host_verified" ? "checkpoint.next.verified" : "checkpoint.next.audit")}${
        mergePending ? ` ${t("checkpoint.merge.pending")}` : ""
      }`,
      details: commonDetails("action_checkpoint", input, {
        action,
        authority_mode: authority,
        authority_verified: isAuthorityVerified(input),
        host_receipt_required: Boolean(input.host_receipt_required ?? authority === "host_verified"),
        execution_performed: Boolean(input.execution_performed),
        merge_executed: Boolean(input.merge_executed),
      }),
    });
  };

  const gate = (input = {}) => {
    const passed = input.status === "passed" || input.passed === true;
    const errors = stringList(input.errors ?? input.blocking_reasons);
    const warnings = stringList(input.warnings);
    const count = errors.length || (passed ? 0 : Number(input.blocking_count ?? 1));
    return block({
      result: t(passed ? "gate.result.passed" : "gate.result.failed", { count }),
      impact: t(passed ? "gate.impact.passed" : "gate.impact.failed"),
      next_action: t(passed ? "gate.next.passed" : "gate.next.failed"),
      details: commonDetails("gate", input, {
        gate_status: passed ? "passed" : "failed",
        blocking_count: count,
        human_blockers: stringList(input.human_blockers),
        errors,
        warnings,
        merge_executed: Boolean(input.merge_executed),
      }),
    });
  };

  return Object.freeze({
    locale: normalizedLocale,
    requirementAutonomyCeiling,
    deliveryAutonomyStatus,
    deliveryAutonomyProposal,
    deliveryAutonomyApproval,
    actionCheckpoint,
    gate,
  });
}

export function requirementAutonomyCeilingGuidance(input, options = {}) {
  return createHumanGuidance(options).requirementAutonomyCeiling(input);
}

export function deliveryAutonomyStatusGuidance(input, options = {}) {
  return createHumanGuidance(options).deliveryAutonomyStatus(input);
}

export function deliveryAutonomyProposalGuidance(input, options = {}) {
  return createHumanGuidance(options).deliveryAutonomyProposal(input);
}

export function deliveryAutonomyApprovalGuidance(input, options = {}) {
  return createHumanGuidance(options).deliveryAutonomyApproval(input);
}

export function actionCheckpointGuidance(input, options = {}) {
  return createHumanGuidance(options).actionCheckpoint(input);
}

export function gateGuidance(input, options = {}) {
  return createHumanGuidance(options).gate(input);
}

function deliveryContext(input, t, levelLabel) {
  const requested = input.requested_level ?? input.autonomy_level ?? "supervised";
  const authority = authorityMode(input);
  const authorityVerified = isAuthorityVerified(input);
  const { effective, inferred } = effectiveLevel(input, requested, authority);
  const deliveryKind = input.delivery_kind ?? input.kind ?? "pull_request";
  const mergeExecuted = Boolean(input.merge_executed);
  const mergeAllowed = Boolean(input.merge_allowed ?? input.pull_request_target?.merge_allowed);
  const mergeText = mergeExecuted
    ? t("delivery.merge.done")
    : mergeAllowed
      ? t("delivery.merge.separate")
      : t("delivery.merge.outside");
  const scope = t(deliveryKind === "pull_request"
    ? "delivery.scope.pr"
    : deliveryKind === "local_release"
      ? "delivery.scope.local"
      : "delivery.scope.generic");
  const deliveryLabel = t(deliveryKind === "pull_request"
    ? "delivery.pull_request"
    : deliveryKind === "local_release"
      ? "delivery.local_release"
      : "delivery.unknown");
  return {
    requested,
    effective,
    effectiveInferred: inferred,
    authority,
    authorityVerified,
    deliveryKind,
    deliveryLabel,
    mergeAllowed,
    mergeExecuted,
    mergePending: deliveryKind === "pull_request" && !mergeExecuted,
    mergeText,
    scope,
    narrowed: levelRank(effective) < levelRank(requested),
    templateValues: {
      requested: levelLabel(requested),
      effective: levelLabel(effective),
      authority: authorityText(t, authority, authorityVerified),
      scope,
      merge: mergeText,
    },
  };
}

function deliveryDetails(kind, input, context) {
  return commonDetails(kind, input, {
    delivery_kind: context.deliveryKind,
    requested_level: context.requested,
    effective_level: context.effective,
    effective_level_inferred: context.effectiveInferred,
    authority_mode: context.authority,
    authority_verified: context.authorityVerified,
    narrowed: context.narrowed,
    single_delivery: true,
    reusable_for_another_delivery: false,
    merge_allowed: context.mergeAllowed,
    merge_executed: context.mergeExecuted,
  });
}

function commonDetails(kind, input, extra) {
  return {
    guidance_kind: kind,
    status: input.status ?? null,
    requirement_id: input.requirement_id ?? input.requirement_ref?.id ?? null,
    profile_id: input.profile_id ?? input.id ?? null,
    delivery_id: input.delivery_id ?? input.delivery?.id ?? null,
    pull_request_url: input.pr_url ?? input.pull_request_target?.pr_url ?? null,
    reason_codes: stringList(input.reason_codes),
    next_command: input.next_command ?? null,
    ...cloneValue(extra),
  };
}

function authorityMode(input) {
  return input.authority_mode ?? input.authority_assurance?.mode ?? "audit_only";
}

function authorityText(t, mode, verified = false) {
  if (mode === "host_verified") return t(verified ? "authority.verified" : "authority.required");
  if (mode === "audit_only") return t("authority.audit");
  return t("authority.invalid");
}

function isAuthorityVerified(input) {
  return input.authority_verified === true
    || input.authority_assurance?.verified === true
    || input.receipt_verified === true;
}

function effectiveLevel(input, requested, authority) {
  if (authority === "host_verified" && !isAuthorityVerified(input)) {
    return { effective: "supervised", inferred: true };
  }
  if (input.effective_level) return { effective: input.effective_level, inferred: false };
  if (authority === "audit_only" && requested === "bounded-autonomous") {
    return { effective: "checkpointed", inferred: true };
  }
  if (!LEVELS.has(requested)) return { effective: "supervised", inferred: true };
  return { effective: requested, inferred: false };
}

function levelRank(level) {
  return level === "bounded-autonomous" ? 2 : level === "checkpointed" ? 1 : 0;
}

function deliveryStatusGroup(status) {
  if (["active", "approved", "started", "running"].includes(status)) return "active";
  if (["proposed", "draft", "pending_approval"].includes(status)) return "proposed";
  if (["invalid", "needs_repair", "blocked"].includes(status)) return "invalid";
  if (["closed", "merged", "released", "revoked", "expired", "cancelled", "rolled_back", "superseded", "terminal"].includes(status)) {
    return "terminal";
  }
  return "other";
}

function normalizeLocale(locale) {
  const normalized = String(locale).trim().toLowerCase().split(/[-_]/)[0];
  if (!SUPPORTED_LOCALES.has(normalized)) {
    throw new RangeError(`Unsupported human guidance locale: ${locale}`);
  }
  return normalized;
}

function renderTemplate(template, values, key) {
  if (typeof template !== "string") throw new Error(`Missing human guidance message: ${key}`);
  return template.replace(/\{([a-z_]+)\}/gi, (_, name) => String(values[name] ?? ""));
}

function block(value) {
  return deepFreeze(cloneValue(value));
}

function stringList(value) {
  if (!Array.isArray(value)) return value === undefined || value === null ? [] : [String(value)];
  return value.map((item) => String(item));
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneValue(item)]));
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
