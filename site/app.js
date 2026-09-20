/* Static project presentation. No inference or business actions are performed here. */
"use strict";

const $ = (selector) => document.querySelector(selector);
const all = (selector) => [...document.querySelectorAll(selector)];
const categoryOrder = ["Workflows", "Games", "Control", "Reasoning", "Extraction", "Recipes", "Community"];
const state = { items: [], overview: null, category: "All", search: "", visible: 9, selected: null, returnFocus: null, transcriptController: null };
const modal = $("#demo-modal");
const video = $("#demo-video");
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("icon");
  svg.setAttribute("aria-hidden", "true");
  const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
  use.setAttribute("href", `#i-${name}`);
  svg.append(use);
  return svg;
}

function localAsset(path) {
  if (typeof path !== "string" || !/^(?:media|latency-media)\/[a-zA-Z0-9_.-]+$/.test(path)) return null;
  return new URL(path, document.baseURI).href;
}

function sourceURL(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch { return null; }
}

function readable(value) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function evidenceName(item) {
  if (item.id.endsWith("-overview")) return item.evidence_label || "Evidence overview · mixed demo types";
  return item.evidence_kind === "model_replay" ? "Model replay" : "Interface walkthrough";
}

function badge(item) {
  return element("span", `evidence-badge${item.evidence_kind === "model_replay" ? "" : " walkthrough"}`, evidenceName(item));
}

function card(item) {
  const button = element("button", "demo-card");
  button.type = "button";
  button.setAttribute("aria-label", `Watch ${item.title}. ${evidenceName(item)}. ${item.model_label || "No trained result"}.`);
  const poster = element("span", "poster-wrap");
  const fallback = element("span", "poster-fallback", "[J]");
  fallback.setAttribute("aria-hidden", "true");
  poster.append(fallback);
  const posterURL = localAsset(item.poster);
  if (posterURL) {
    const image = element("img");
    image.src = posterURL;
    image.alt = "";
    image.loading = "lazy";
    image.decoding = "async";
    image.width = 1280;
    image.height = 720;
    image.addEventListener("error", () => image.remove(), { once: true });
    poster.append(image);
  }
  const play = element("span", "card-play");
  play.append(icon("play"));
  poster.append(play);
  const content = element("span", "card-content");
  content.append(element("span", "card-category", item.category), element("span", "card-title", item.title), element("span", "card-description", item.description || ""));
  const footer = element("span", "card-evidence-row");
  footer.append(badge(item), element("span", "card-model", item.model_label || "No trained result"));
  content.append(footer);
  button.append(poster, content);
  button.addEventListener("click", () => openDemo(item, button));
  return button;
}

function filteredItems() {
  const query = state.search.trim().toLocaleLowerCase();
  return state.items.filter((item) => (state.category === "All" || item.category === state.category) &&
    (!query || [item.title, item.description, item.category, item.model_label, item.evidence_label, item.id].filter(Boolean).join(" ").toLocaleLowerCase().includes(query)));
}

function renderGallery() {
  const items = filteredItems();
  const visible = items.slice(0, state.visible);
  $("#demo-grid").replaceChildren(...visible.map(card));
  $("#gallery-empty").hidden = items.length !== 0;
  $("#load-more").hidden = visible.length >= items.length;
  const scope = state.category === "All" ? "all categories" : state.category;
  $("#filter-status").textContent = `${visible.length} of ${items.length} demos · ${scope}${state.search ? ` · “${state.search.trim()}”` : ""}`;
  all(".filter").forEach((button) => {
    const selected = button.dataset.category === state.category;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
}

function renderCategories() {
  const available = [...new Set(state.items.map((item) => item.category))];
  const categories = ["All", ...categoryOrder.filter((category) => available.includes(category)), ...available.filter((category) => !categoryOrder.includes(category))];
  $("#category-filters").replaceChildren(...categories.map((category) => {
    const button = element("button", "filter", category === "All" ? "All demos" : category);
    button.type = "button";
    button.dataset.category = category;
    button.setAttribute("aria-pressed", String(category === "All"));
    const count = category === "All" ? state.items.length : state.items.filter((item) => item.category === category).length;
    button.append(element("span", "filter-count", count));
    button.addEventListener("click", () => {
      state.category = category;
      state.visible = 9;
      renderGallery();
    });
    return button;
  }));
  $("#catalog-count").textContent = state.items.length;
  $("#domain-count").textContent = available.length;
  const replays = state.items.filter((item) => item.evidence_kind === "model_replay").length;
  $("#evidence-count").textContent = `${replays} model replays · ${state.items.length - replays} interface walkthroughs`;
}

function renderUncovered(uncovered) {
  if (!Array.isArray(uncovered) || !uncovered.length) return;
  $("#coverage-details").hidden = false;
  $("#coverage-count").textContent = `(${uncovered.length})`;
  $("#uncovered-list").replaceChildren(...uncovered.map((item) => {
    const li = element("li");
    if (typeof item === "string") { li.textContent = item; return li; }
    const title = item.title || item.id || "Pending coverage";
    li.append(element("strong", "", title));
    if (item.reason) li.append(document.createTextNode(` — ${item.reason}`));
    return li;
  }));
}

async function loadCatalog() {
  try {
    const response = await fetch("./catalog.json");
    if (!response.ok) throw new Error(`Catalog HTTP ${response.status}`);
    const catalog = await response.json();
    if (!Array.isArray(catalog.items) || !catalog.items.length) throw new Error("Empty catalog");
    state.items = [...catalog.items].sort((a, b) => categoryOrder.indexOf(a.category) - categoryOrder.indexOf(b.category));
    state.overview = catalog.overview || null;
    $("#watch-overview").disabled = !state.overview;
    $("#full-games").hidden = !["doom", "trex"].every((id) => state.items.some((item) => item.id === id && item.presentation === "continuous_gameplay"));
    renderCategories();
    renderUncovered(catalog.uncovered);
    renderGallery();
  } catch {
    $("#filter-status").textContent = "The demo catalog is currently unavailable.";
    const message = element("p", "catalog-error", "The videos and evidence are still being prepared. ");
    const link = element("a", "", "Reload the page to try again.");
    link.href = "./";
    message.append(link);
    $("#demo-grid").replaceChildren(message);
  }
}

async function loadTranscript(item) {
  if (state.transcriptController) state.transcriptController.abort();
  const controller = new AbortController();
  state.transcriptController = controller;
  $("#demo-transcript").textContent = "Loading transcript…";
  const transcriptPath = item.transcript || item.video?.replace(/\.mp4$/, ".txt");
  const url = localAsset(transcriptPath);
  if (!url) { $("#demo-transcript").textContent = "A transcript is not available for this clip."; return; }
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error("Transcript unavailable");
    const transcript = await response.text();
    if (state.selected?.id === item.id) $("#demo-transcript").textContent = transcript;
  } catch (error) {
    if (error.name !== "AbortError" && state.selected?.id === item.id) {
      $("#demo-transcript").textContent = "Transcript could not be loaded. English captions remain available in the video controls.";
    }
  }
}

function openDemo(item, trigger) {
  state.selected = item;
  state.returnFocus = trigger || document.activeElement;
  $("#demo-title").textContent = item.title;
  $("#demo-description").textContent = item.description || "";
  $("#modal-category").textContent = item.category || "Overview";
  const evidence = $("#modal-evidence");
  evidence.textContent = evidenceName(item);
  evidence.className = `evidence-badge${item.evidence_kind === "model_replay" ? "" : " walkthrough"}`;
  const revision = item.provenance?.checkpoint?.revision || item.provenance?.service_identity?.base_revision;
  $("#demo-model").textContent = `${item.model_label || "No trained result"}${revision ? ` · revision ${revision.slice(0, 8)}` : ""}`;
  $("#demo-model").title = revision || "";
  $("#demo-summary").textContent = readable(item.result_summary);
  $("#demo-request").textContent = item.request == null ? "This overview links to the individual task requests in the demo catalog." : JSON.stringify(item.request, null, 2);
  $("#demo-answer").textContent = item.answer == null ? "No trained result. This interface walkthrough demonstrates a task contract; it does not supply a model prediction." : JSON.stringify(item.answer, null, 2);
  if (item.id.endsWith("-overview")) $("#demo-answer").textContent = "Inspect the individual demos for their saved model responses and complete source evidence. This video retains each episode's goal and outcome.";
  const provenance = { source_path: item.source_path || null, source_sha256: item.source_sha256 || null, selector: item.selector || null, ...(item.provenance || {}) };
  $("#demo-provenance").textContent = readable(provenance);
  $("#demo-provenance").style.whiteSpace = "pre-wrap";
  const source = sourceURL(item.source_url);
  $("#demo-source").hidden = !source;
  if (source) { $("#demo-source").href = source; $("#demo-source").title = "Repository access may be required"; }
  const limits = Array.isArray(item.limitations) ? item.limitations : [item.limitations || "This clip is a bounded example, not a general task-success result."];
  $("#demo-limitations").replaceChildren(...limits.map((limit) => element("li", "", readable(limit))));
  all("#demo-modal details").forEach((details) => { details.open = false; });
  $("#video-error").hidden = true;
  video.replaceChildren();
  const movie = localAsset(item.video);
  if (movie) video.src = movie;
  else video.removeAttribute("src");
  const poster = localAsset(item.poster);
  if (poster) video.poster = poster;
  else video.removeAttribute("poster");
  video.preload = "metadata";
  video.setAttribute("aria-label", `${item.title} — ${evidenceName(item)}`);
  const captions = localAsset(item.captions);
  if (captions) {
    const track = document.createElement("track");
    track.kind = "captions";
    track.label = "English";
    track.srclang = "en";
    track.src = captions;
    track.default = true;
    video.append(track);
  }
  const movieDownload = $("#video-download");
  movieDownload.hidden = !movie;
  if (movie) { movieDownload.href = movie; movieDownload.download = `${item.id}.mp4`; }
  const transcript = localAsset(item.transcript || item.video?.replace(/\.mp4$/, ".txt"));
  $("#transcript-download").hidden = !transcript;
  if (transcript) { $("#transcript-download").href = transcript; $("#transcript-download").download = `${item.id}.txt`; }
  document.body.classList.add("modal-open");
  modal.showModal();
  modal.scrollTop = 0;
  $("#close-modal").focus({ preventScroll: true });
  loadTranscript(item);
}

function closeDemo() { modal.close(); }
$("#close-modal").addEventListener("click", closeDemo);
modal.addEventListener("click", (event) => {
  if (event.target !== modal) return;
  const bounds = modal.getBoundingClientRect();
  if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDemo();
});
modal.addEventListener("close", () => {
  video.pause();
  video.removeAttribute("src");
  video.replaceChildren();
  video.preload = "none";
  video.load();
  if (state.transcriptController) state.transcriptController.abort();
  document.body.classList.remove("modal-open");
  state.selected = null;
  if (state.returnFocus?.isConnected) state.returnFocus.focus({ preventScroll: true });
});
video.addEventListener("error", () => { if (state.selected && video.getAttribute("src")) $("#video-error").hidden = false; });
$("#evidence-download").addEventListener("click", () => {
  if (!state.selected) return;
  const content = JSON.stringify({ ...state.selected, presentation_note: "Downloaded from the static Open-Jev site. A replay is one recorded output; a walkthrough is not a trained result." }, null, 2) + "\n";
  const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
  const link = element("a");
  link.href = url;
  link.download = `${state.selected.id.replace(/[^a-zA-Z0-9_-]/g, "_")}-evidence.json`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

all("[data-game-id]").forEach((button) => button.addEventListener("click", () => {
  const item = state.items.find((demo) => demo.id === button.dataset.gameId);
  if (item) openDemo(item, button);
}));

$("#watch-overview").addEventListener("click", (event) => {
  if (state.overview) openDemo(state.overview, event.currentTarget);
});

$("#demo-search").addEventListener("input", (event) => { state.search = event.target.value; state.visible = 9; renderGallery(); });
$("#clear-filters").addEventListener("click", () => { state.category = "All"; state.search = ""; state.visible = 9; $("#demo-search").value = ""; renderGallery(); $("#demo-search").focus(); });
$("#load-more").addEventListener("click", () => {
  const previous = state.visible;
  state.visible += 9;
  renderGallery();
  const next = all(".demo-card")[previous];
  if (next) next.focus({ preventScroll: true });
});
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !modal.open && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && !document.activeElement.isContentEditable) {
    event.preventDefault(); $("#demo-search").focus();
  }
});

const primitives = {
  choice: { question: { type: "choice", instructions: "Which team should handle this?", criteria: { billing: "Refunds and charges", engineering: "Software defects" } }, key: "route", chip: "Choice", description: "The candidates are yours. The model assigns probabilities; your application decides what to do next." },
  noul: { question: { type: "noul", instructions: "Is a refund explicitly requested?" }, key: "refund_requested", chip: "Noul", description: "A finite probability between zero and one. Keep uncertainty visible, and choose a threshold for your application." },
  score: { question: { type: "score", instructions: "Rate expressed frustration.", criteria: ["Calm", "Frustrated but civil", "Very angry"] }, key: "frustration", chip: "Score", description: "Provide an ordered rubric. The model returns a score over those criteria, with the underlying probability distribution." }
};
function selectPrimitive(name, focus = false) {
  const primitive = primitives[name];
  all(".primitive-tab").forEach((tab) => {
    const active = tab.dataset.primitive === name;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active && focus) tab.focus();
  });
  $("#primitive-panel").setAttribute("aria-labelledby", `tab-${name}`);
  $("#primitive-request").textContent = JSON.stringify({ state: "My order arrived damaged. Please refund it.", questions: { [primitive.key]: primitive.question } }, null, 2);
  $("#primitive-chip").textContent = primitive.chip;
  $("#primitive-description").textContent = primitive.description;
}
all(".primitive-tab").forEach((tab) => {
  tab.addEventListener("click", () => selectPrimitive(tab.dataset.primitive));
  tab.addEventListener("keydown", (event) => {
    const names = Object.keys(primitives);
    const current = names.indexOf(tab.dataset.primitive);
    let next;
    if (["ArrowRight", "ArrowDown"].includes(event.key)) next = (current + 1) % names.length;
    if (["ArrowLeft", "ArrowUp"].includes(event.key)) next = (current + names.length - 1) % names.length;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = names.length - 1;
    if (next !== undefined) { event.preventDefault(); selectPrimitive(names[next], true); }
  });
});

const scenes = [
  { context: "“My order arrived damaged.\nCan I get a refund?”", question: "Which team should handle this?", names: ["Billing", "Engineering", "Sales"], probabilities: [94, 4, 2], output: "billing" },
  { context: "“The next tile is blocked.\nOpen space is on the left.”", question: "Which action fits the visible state?", names: ["Turn left", "Go forward", "Turn right"], probabilities: [88, 3, 9], output: "turn_left" },
  { context: "“The passage names Paris\nas the destination.”", question: "Which candidate is supported?", names: ["Paris", "Rome", "Berlin"], probabilities: [96, 2, 2], output: "paris" }
];
let sceneIndex = 0;
let heroTimer = null;
let motionPaused = reducedMotion.matches;
function animateHero() {
  sceneIndex = (sceneIndex + 1) % scenes.length;
  const scene = scenes[sceneIndex];
  $("#hero-context").replaceChildren(...scene.context.split("\n").flatMap((line, index) => index ? [document.createElement("br"), document.createTextNode(line)] : [document.createTextNode(line)]));
  $(".decision-divider > span").textContent = scene.question;
  all(".choice-row").forEach((row, index) => {
    row.querySelector(".choice-name").textContent = scene.names[index];
    row.querySelector(".choice-probability").textContent = (scene.probabilities[index] / 100).toFixed(2);
    row.querySelector(".choice-meter i").style.setProperty("--probability", `${scene.probabilities[index]}%`);
  });
  $("#hero-output").textContent = `"${scene.output}"`;
}
function updateMotion() {
  clearInterval(heroTimer);
  if (!motionPaused && !document.hidden) heroTimer = setInterval(animateHero, 5800);
  $("#hero-motion").textContent = motionPaused ? "Play animation" : "Pause animation";
  $("#hero-motion").setAttribute("aria-pressed", String(motionPaused));
}
$("#hero-motion").addEventListener("click", () => { motionPaused = !motionPaused; updateMotion(); });
reducedMotion.addEventListener("change", (event) => { motionPaused = event.matches; updateMotion(); });
document.addEventListener("visibilitychange", updateMotion);
updateMotion();
loadCatalog();

async function loadLatency() {
  try {
    const response = await fetch("./latency.json");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const report = await response.json();
    if (report.schema_version !== 1 || !report.summaries.length) throw new Error("No completed measurements");
    const milliseconds = (value) => Number.isFinite(value) ? value.toFixed(1) : "—";
    const render = () => {
      const transport = $("#latency-transport").value;
      $("#latency-boundary").textContent = report.scope[transport];
      $("#latency-rows").replaceChildren(...report.workloads.map((workload) => {
        const rows = report.summaries.filter((row) => row.request_id === workload.id && row.transport === transport);
        const pair = report.cache_comparisons.find((row) => row.request_id === workload.id && row.transport === transport);
        const tr = element("tr");
        const name = element("th", null, workload.label);
        name.scope = "row";
        name.append(element("small", null, `${workload.question_count} question${workload.question_count === 1 ? "" : "s"}`));
        const tokens = element("td", null, workload.state_tokens);
        tokens.append(element("small", null, `max ${Math.max(...workload.candidate_input_tokens)} / input`));
        tr.append(name, tokens, element("td", null, workload.candidate_sequences));
        for (const mode of ["uncached", "cached"]) {
          const row = rows.find((item) => item.mode === mode);
          const cell = element("td", "latency-numbers", row ? `${milliseconds(row.p50_ms)} / ${milliseconds(row.p95_ms)}` : "Not measured");
          if (row) cell.append(element("small", null, `${row.successes}/${row.attempts} successful`));
          tr.append(cell);
        }
        const validation = element("td", "latency-validation", pair?.parity_passed ? "Cache parity passed" : "Cache parity failed");
        if (pair) validation.append(element("small", pair.parity_passed ? null : "latency-error", `max |Δp| ${pair.max_probability_error.toExponential(1)}`));
        const errors = rows.reduce((sum, row) => sum + row.errors, 0);
        if (errors) validation.append(element("small", "latency-error", `${errors} failed attempts; retained in raw log`));
        tr.append(validation);
        return tr;
      }));
    };
    $("#latency-status").textContent = `Measured ${report.measured_at.slice(0, 10)} · released 2B LoRA + decision head · ${report.measured_attempts} timed local requests · ${report.runtime.gpu}`;
    $("#latency-runtime").textContent = `${report.runtime.gpu} · ${report.dtype} · candidate batch ${report.configuration.batch_size}`;
    $("#latency-sampling").textContent = `${report.configuration.warmup} warmups + ${report.configuration.repetitions} timed attempts per workload and path. P50/P95 use successful timed attempts, with linear interpolation. ${report.errors_including_warmup} errors including warmup; all attempts retained. Candidate counts are compiled model input sequences; Noul uses one sequence per question. ${report.scope.cache}.`;
    $("#latency-cache-note").textContent = report.cache_note;
    $("#latency-jev").textContent = report.jev.status_text;
    const providers = [
      {model: "Open-Jev-2B", boundary: "Loopback HTTP · cache off", summaries: report.summaries.filter((row) => row.transport === "http_loopback" && row.mode === "uncached"), raw_report_url: report.raw_report_url},
      {...report.jev, model: report.jev.model || "Jev API", boundary: "Fresh HTTPS"},
      ...(report.openai || []).map((provider) => ({...provider, boundary: `Fresh HTTPS · reasoning ${provider.reasoning_effort}`}))
    ];
    const workloadHeader = element("th", null, "Workload");
    $("#latency-provider-table").style.setProperty("--provider-columns", providers.length);
    workloadHeader.scope = "col";
    $("#latency-provider-head").replaceChildren(workloadHeader, ...providers.map((provider) => {
      const th = element("th", null, provider.model); th.scope = "col";
      th.append(element("small", null, provider.boundary));
      return th;
    }));
    $("#latency-provider-rows").replaceChildren(...report.workloads.map((workload) => {
      const tr = element("tr");
      const title = element("th", null, workload.label); title.scope = "row";
      title.append(element("small", null, `${workload.state_tokens} state tokens · ${workload.question_count} question${workload.question_count === 1 ? "" : "s"}`));
      tr.append(title, ...providers.map((provider) => {
        const row = provider.summaries.find((entry) => entry.request_id === workload.id);
        const td = element("td", "latency-numbers", row?.successes ? `${milliseconds(row.p50_ms)} / ${milliseconds(row.p95_ms)}` : "Not measured");
        if (row) td.append(element("small", null, `${row.successes}/${row.attempts} valid responses`));
        return td;
      }));
      return tr;
    }));
    $("#latency-provider-links").replaceChildren(...providers.filter((provider) => provider.raw_report_url).map((provider) => {
      const a = element("a", "text-link", `${provider.model} raw attempts ↗`);
      a.href = sourceURL(provider.raw_report_url);
      return a;
    }));
    if (report.openai?.length) {
      $("#latency-openai").textContent = `OpenAI produces categorical decisions as structured text; Open-Jev and Jev return typed probabilities. Full response times include generation, not just time to first token. Remote server-side caching is controlled by each provider. ${report.openai.map((provider) => provider.status_text).join(" ")}`;
      $("#latency-openai").hidden = false;
    }
    $("#latency-raw").href = sourceURL(report.raw_report_url);
    if (report.example) $("#latency-example").textContent = JSON.stringify(report.example, null, 2);
    if (report.video) {
      const player = $("#latency-video");
      player.src = localAsset(report.video.path);
      player.poster = localAsset(report.video.poster);
      const track = element("track");
      track.kind = "captions"; track.label = "English"; track.srclang = "en"; track.src = localAsset(report.video.captions); track.default = true;
      player.append(track);
      $("#latency-video-caption").textContent = report.video.caption;
      $("#latency-video-wrap").hidden = false;
    }
    $("#latency-transport").addEventListener("change", render);
    render();
    $("#latency-content").hidden = false;
  } catch (error) {
    $("#latency-status").textContent = "The latency summary could not be loaded. See the measurement report on GitHub.";
  }
}
loadLatency();
