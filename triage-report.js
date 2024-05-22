import {State} from "./signal.js";
import {Sections, Control, CheckboxControl, SelectControl, OutputControl} from "./ui.js";

function getOptionsData() {
  return {
    platforms: getCategoryValues("platform", "input"),
    configuration: getCategoryValues("configuration", "option"),
    impact: getCategoryValues("impact", "option"),
    affects: getCategoryValues("affects", "option"),
  };
}

function getCategoryValues(prefix, elemType) {
  return Array.from(document.querySelectorAll(`#${prefix} ${elemType}`)).map(elem => {
    const [gotPrefix, ...rest] = elem.id.split("-");
    if (gotPrefix != prefix) {
      console.warn("Unexpected element", elem);
      return null;
    }
    return rest.join("-");
  }).filter(x => x);
}

function getSeverity(controls, rank) {
  const impactScore = parseInt(controls.impact.value);

  const configurationModifier = parseFloat(controls.configuration.value);

  const affectsModifier = parseFloat(controls.affects.value);

  const platformModifier = Array.from(Object.values(controls.platforms))
        .reduce((prev, current) => parseFloat(current.value) + prev, 0);

  const severityScore = Math.round(impactScore * configurationModifier * affectsModifier * platformModifier);
  let severity = "S4";
  if (severityScore >= 100) {
    if (rank && rank <= 100) {
      severity = "S1";
    } else {
      severity = "S2";
    }
  } else if (severityScore > 50) {
    severity = "S2";
  } else if (severityScore > 25) {
    severity = "S3";
  } else {
    severity = "S4";
  }
  return {
    severity,
    severityScore
  };
}

function getPriority(rank, severity, regression) {
  const severityRank = parseInt(severity.severity[1]);
  let priority;
  let priorityScore;
  if (regression) {
    priority = "P1";
    priorityScore = 10;
  } else if (rank === null || rank > 100000) {
    priority = "P3";
    priorityScore = 1;
  } else if (rank > 10000) {
    priorityScore = 2;
    if (severityRank >= 3) {
      priority = "P3";
    } else {
      priority = "P2";
    }
  } else if (rank > 1000) {
    priorityScore = 5;
    if (severityRank === 4) {
      priority = "P3";
    } else if (severityRank === 3) {
      priority = "P2";
    } else {
      priority = "P1";
    }
  } else {
    priorityScore = 10;
    if (severityRank >= 3) {
      priority = "P2";
    } else {
      priority = "P1";
    }
  }
  return {priority, priorityScore};
}

function computeScore(severity, priority) {
  return severity.severityScore * priority.priorityScore;
}

function* parseUserStory(userStory) {
  const lines = userStory.split(/\r?\n|\r|\n/g);
  for (const line of lines) {
    const [prefix, ...rest] = line.split(":");
    const data = rest.length > 0 ? rest.join(":").trim() : null;
    yield [prefix, data];
  }
}

function extractUserStoryData(optionsData, userStory) {
  const rv = {};
  for (const [prefix, data] of parseUserStory(userStory)) {
    if (data === null) {
      continue;
    }
    if (prefix === "platform") {
      const foundPlatforms = [];
      const [...dataPlatforms] = data.split(",");
      for (let platform of dataPlatforms) {
        platform = platform.trim();
        if (optionsData.platforms.includes(platform)) {
          foundPlatforms.push(platform);
        }
      }
      if (foundPlatforms.length) {
        rv.platforms = foundPlatforms;
      }
    } else if (prefix === "impact") {
      if (optionsData.impact.includes(data)) {
        rv.impact = data;
      }
    } else if (prefix === "configuration") {
      if (optionsData.configuration.includes(data)) {
        rv.configuration = data;
      }
    } else if (prefix === "affects") {
        if (optionsData.affects.includes(data)) {
          rv.affects = data;
        }
    }
  }
  return rv;
}

function getUserStory(userStory, controls) {
  const data = {
    platform: Array.from(Object.entries(controls.platforms))
      .filter(([_, control]) => control.state)
      .map(([name, _]) => name).join(","),
    impact: controls.impact.state.split("-").slice(1).join("-"),
    configuration: controls.configuration.state.split("-").slice(1).join("-"),
    affects: controls.affects.state.split("-").slice(1).join("-")
  };
  const rv = [];
  for (let [prefix, value] of parseUserStory(userStory)) {
    if (!prefix) {
        continue;
    }
    if (prefix in data) {
      value = data[prefix];
      delete data[prefix];
    }
    if (value !== null) {
      rv.push(`${prefix}:${value}`);
    } else {
      rv.push(prefix);
    }
  }
  for (let [prefix, value] of Object.entries(data)) {
    rv.push(`${prefix}:${value}`);
  }
  return rv.join("\n");
}

function getKeywords(keywords, controls) {
  const newKeywords = [];
  const wantKeywords = new Set();
  for (const control of [controls.status, controls.sitepatch, controls.outreach, controls.regression]) {
    const value = control.value;
    if (value) {
      wantKeywords.add(value);
    }
  }

  for (const keyword of keywords) {
    if (keyword.startsWith("webcompat:") || keyword === "regression") {
      if (wantKeywords.has(keyword)) {
        newKeywords.push(keyword);
        wantKeywords.delete(keyword);
      }
    } else {
      newKeywords.push(keyword);
    }
  }

  for (const keyword of wantKeywords) {
    newKeywords.push(keyword);
  }

  return newKeywords.join(", ");
}

async function getRank(url) {
  const urlRank = await browser.runtime.sendMessage({
    type: "get-tranco-rank",
    url,
  });
  return urlRank;
}

function selectStateFromKeywords(prefix, keywords, bugKeywords, defaultFn) {
  for (let keyword of keywords) {
    if (bugKeywords.has(keyword)) {
      return `${prefix}-${keyword}`;
    }
  }
  return defaultFn();
}

async function populateTriageForm(section, bugData) {
  const controls = section.controls;
  const optionsData = getOptionsData();
  const userStoryData = extractUserStoryData(optionsData, bugData.cf_user_story);

  controls.url.state = bugData.url;

  section.controls.initialPriority.state = bugData.priority;
  section.controls.initialSeverity.state = bugData.severity;

  let platforms;
  if (userStoryData.platforms) {
    for (const [platform, control] of Object.entries(controls.platforms)) {
      control.state = userStoryData.platforms.includes(platform);
    };
  }
  if (userStoryData.impact) {
     controls.impact.state = `impact-${userStoryData.impact}`;
  } else {
    controls.impact.state = `impact-impact-site-broken`;
  }
  if (userStoryData.configuration) {
    controls.configuration.state = `configuration-${userStoryData.configuration}`;
  } else {
     controls.configuration.state = `configuration-general`;
  }
  if (userStoryData.affects) {
    controls.affects.state = `affects-${userStoryData.affects}`;
  } else {
    controls.affects.state = `affects-all`;
  }

  const keywordPrefix = "webcompat:";
  const webcompatKeywords = new Set(bugData.keywords
                                    .filter(keyword => keyword.startsWith(keywordPrefix))
                                    .map(keyword => {console.log(keyword, keyword.slice(keywordPrefix.length)); return keyword.slice(keywordPrefix.length);}));

  controls.outreach.state = selectStateFromKeywords("outreach", ["needs-contact", "contact-ready", "sitewait"],
                                                   webcompatKeywords, () => "outreach-none");

  controls.status.state = selectStateFromKeywords("status", ["needs-diagnosis", "platform-bug"], webcompatKeywords,
                                                  () => {
                                                    if (controls.outreach.state != "outreach-none") {
                                                      return "status-sitebug";
                                                    }
                                                    return "status-needs-diagnosis";
                                                  });

  console.log(selectStateFromKeywords("sitepatch", ["needs-sitepatch", "sitepatch-applied"],
                                                     webcompatKeywords, () => "sitepatch-none"));
  controls.sitepatch.state = selectStateFromKeywords("sitepatch", ["needs-sitepatch", "sitepatch-applied"],
                                                     webcompatKeywords, () => "sitepatch-none");

  controls.regression.state = bugData.keywords.includes("regression");
}

async function createTriageForm(sections, state, tab, bugData) {
  const section  = sections.get("triage-form");
  const controls = section.controls;

  Object.assign(controls, {
    url: new Control(state, "url"),
    platforms: {
      windows: new CheckboxControl(state, "platform-windows"),
      mac: new CheckboxControl(state, "platform-mac"),
      linux: new CheckboxControl(state, "platform-linux"),
      android: new CheckboxControl(state, "platform-android"),
    },
    impact: new SelectControl(state, "impact"),
    configuration: new SelectControl(state, "configuration"),
    affects: new SelectControl(state, "affects"),
    status: new SelectControl(state, "status"),
    outreach: new SelectControl(state, "outreach"),
    regression: new CheckboxControl(state, "regression", { defaultValue: "" }),
    sitepatch: new SelectControl(state, "sitepatch"),
    initialSeverity: new Control(state, "severity-initial"),
    initialPriority: new Control(state, "priority-initial"),
  });

  const initialRank = await getRank(controls.url.value);
  const rank = state.signal(initialRank);
  state.effect(async () => {
    rank.value = await getRank(controls.url.value);
  });

  const severity = state.computed(() => getSeverity(controls, rank.value));
  const priority = state.computed(() => getPriority(rank.value, severity.value, controls.regression.value));
  const score = state.computed(() => computeScore(severity.value, priority.value));

  state.effect(() => {
    // Weird mix of .value and .state is so this only depends on controls.status
    if (controls.status.value === "" && controls.outreach.state === "outreach-none") {
      controls.outreach.state = "outreach-needs-contact";
    }
  });

  controls.rank = new OutputControl(state, "rank", () => rank.value ? rank.value.rank : "null");
  controls.rankDomain = new OutputControl(state, "rank-domain", (control) => {
    if (rank.value) {
      control.show();
      return `(${rank.value.rankedDomain})`;
    }
    control.hide();
    return "";
  });
  controls.severity = new OutputControl(state, "severity", () => severity.value.severity);
  controls.priority = new OutputControl(state, "priority", () => priority.value.priority);
  controls.score = new OutputControl(state, "score", () => score.value);

  const updateButton = document.getElementById("update-bug");
  updateButton.addEventListener("click", async () => {
    updateButton.disabled = true;
    const data = {
      priority: controls.priority.value,
      severity: controls.severity.value,
      url: controls.url.value,
      keywords: getKeywords(bugData.keywords, controls),
      userStory: getUserStory(bugData.cf_user_story, controls)
    };
    try {
      await browser.tabs.sendMessage(tab.id, {type: "set-bug-data", ...data});
      sections.serializeOnClose = false;
    } finally {
      window.close();
    }
  });

  const resetButton = document.getElementById("reset-triage-form");
  resetButton.addEventListener("click", () => populateTriageForm(section, bugData));
}

async function init() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  const url = new URL(tab.url);
  const params = new URLSearchParams(url.search);

  const sections = new Sections(`${url.pathname}?id=${params.get("id")}`);
  sections.add("triage-initial");
  sections.add("triage-form");
  sections.add("error", {persist: false});

  const state = new State();

  try {
    const bugData = await browser.tabs.sendMessage(tab.id, {type: "read-bug-data"});

    if (bugData === null) {
      throw new Error("Unable to fetch bug data. Are you logged in?");
    }
    await createTriageForm(sections, state, tab, bugData);

    if (!await sections.load()) {
      const section = sections.get("triage-form");
      populateTriageForm(section, bugData);
      sections.show(section.id);
    }
  } catch(e) {
    document.getElementById("error-message").textContent = e.message;
    sections.show("error");
    throw e;
  }
}

addEventListener("DOMContentLoaded", init);
