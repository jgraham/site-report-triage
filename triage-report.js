import {State} from "./signal.js";
import {Sections, Control, SelectControl, OutputControl} from "./ui.js";

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

  const platformModifier = Array.from(Object.values(controls.platforms)).reduce((prev, current) => parseFloat(current.value) + prev, 0);

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

function getPriority(rank, severity) {
  const severityRank = parseInt(severity.severity[1]);
  let priority;
  let priorityScore;
  if (rank === null || rank > 100000) {
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

function getSelectedId(selectElem) {
  const optionId = selectElem.selectedOptions[0].id;
  const [prefix, ...value] = optionId.split("-");
  return value.join("-");
}

function resetOutput() {
  document.getElementById("output").hidden = true;
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

function getUserStory(userStory, data) {
  const rv = [];
  for (let [prefix, value] of parseUserStory(userStory)) {
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

async function getRank(url) {
  const urlRank = await browser.runtime.sendMessage({
    type: "get-tranco-rank",
    url,
  });
  return urlRank;
}

async function setInitialData(tab, controls) {
  const bugData = await browser.tabs.sendMessage(tab.id, {type: "read-bug-data"});

  if (bugData === null) {
    throw new Error("Unable to fetch bug data. Are you logged in?");
  }

  const optionsData = getOptionsData();
  const userStoryData = extractUserStoryData(optionsData, bugData.cf_user_story);

  controls.url.value = bugData.url;

  let platforms;
  if (userStoryData.platforms) {
    for (const [platform, control] of Object.entries(controls.platforms)) {
      control.elem.checked = userStoryData.platforms.includes(platform);
    };
  }
  if (userStoryData.impact) {
     controls.impact.selectedId = `impact-${userStoryData.impact}`;
  }
  if (userStoryData.configuration) {
    controls.configuration.selectedId = `configuration-${userStoryData.configuration}`;
  }
  if (userStoryData.affects) {
    controls.affects.selectedId = `affects-${userStoryData.affects}`;
  }

  controls.initialPriority.value = bugData.priority;
  controls.initialSeverity.value = bugData.severity;

  return {
    keywords: bugData.keywords,
    userStory: bugData.cf_user_story
  };

}

async function populateForm(tab, sections) {
  const state = new State();
  const controls = {
    url: new Control(state, "url"),
    platforms: {
      windows: new Control(state, "platform-windows"),
      mac: new Control(state, "platform-mac"),
      linux: new Control(state, "platform-linux"),
      android: new Control(state, "platform-android"),
    },
    impact: new SelectControl(state, "impact"),
    configuration: new SelectControl(state, "configuration"),
    affects: new SelectControl(state, "affects"),
    initialSeverity: new Control(state, "severity-initial"),
    initialPriority: new Control(state, "priority-initial")
  };

  let initialData;
  try {
    initialData = await setInitialData(tab, controls);
  } catch(e) {
    document.getElementById("error-message").textContent = e.message;
    sections.show("error");
    throw e;
  }

  const initialRank = await getRank(controls.url.value);
  const rank = state.signal(initialRank);
  state.effect(async () => {
    rank.value = await getRank(controls.url.value);
  });

  const severity = state.computed(() => getSeverity(controls, rank.value));
  const priority = state.computed(() => getPriority(rank.value, severity.value));
  const score = state.computed(() => computeScore(severity.value, priority.value));

  controls.rank = new OutputControl(state, "rank", () => rank.value ? rank.value.rank : "null");
  controls.rankDomain = new OutputControl(state, "rank-domain", () => rank.value ? rank.value.rankDomain: "");
  controls.severity = new OutputControl(state, "severity", () => severity.value.severity);
  controls.priority = new OutputControl(state, "priority", () => priority.value.priority);
  controls.score = new OutputControl(state, "score", () => score.value);

  const moveButton = document.getElementById("update-bug");
  moveButton.addEventListener("click", async () => {
    moveButton.disabled = true;
    const data = {
      priority: controls.priority.value,
      severity: controls.severity.value,
      url: controls.url.value,
      keywords: initialData.keywords,
      userStory: getUserStory(initialData.userStory, {
        platform: Array.from(Object.entries(controls.platforms)).filter(([_, control]) => control.elem.checked).map(([name, _]) => name).join(","),
        impact: controls.impact.selectedId.split("-").slice(1).join("-"),
        configuration: controls.configuration.selectedId.split("-").slice(1).join("-"),
        affects: controls.affects.selectedId.split("-").slice(1).join("-")
      })
    };
    try {
      await browser.tabs.sendMessage(tab.id, {type: "set-bug-data", ...data});
    } finally {
      window.close();
    }
  });

  sections.show("triage-form");
}

async function render() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  const url = new URL(tab.url);

  const sections = new Sections();
  sections.add("triage-initial");
  sections.add("triage-form");
  sections.add("error");

  populateForm(tab, sections, url.pathname);
}

addEventListener("DOMContentLoaded", render);
