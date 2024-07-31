import {State} from "./signal.js";
import {Section, ReadOnlySection, Sections, Button, Control, CheckboxControl, SelectControl, OutputControl} from "./ui.js";

function isDateValue(data) {
  return /\d{4}-\d{2}-\d{2}/.test(data);
}

function todayString() {
    let date = new Date();
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, 0)}-${date.getDate().toString().padStart(2, 0)}`;

}

function getOptionsData() {
  return {
    platforms: getCategoryValues("platform", "input"),
    configuration: getCategoryValues("configuration", "option"),
    impact: getCategoryValues("impact", "option"),
    affects: getCategoryValues("affects", "option"),
    branch: getCategoryValues("branch", "option"),
    diagnosisTeam: getCategoryValues("diagnosisTeam", "option"),
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

function getSeverity(controls, rankData) {
  const rank = rankData ? rankData.rank : null;

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

function getPriority(rankData, severity, regression) {
  const rank = rankData ? rankData.rank : null;

  const severityRank = parseInt(severity.severity[1]);
  let priority;
  let priorityScore;
  if (regression) {
    priority = "P1";
    priorityScore = 10;
  } else if (rank === null || rank > 100_000) {
    priority = "P3";
    priorityScore = 1;
  } else if (rank > 10_000) {
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
    } else if (prefix === "branch") {
        if (optionsData.branch.includes(data)) {
          rv.branch = data;
        }
    } else if (prefix === "diagnosis-team") {
        if (optionsData.diagnosisTeam.includes(data)) {
          rv.diagnosisTeam = data;
        }
    } else if (prefix === "outreach-assignee") {
      rv.outreachAssignee = data;
    } else if (prefix === "outreach-contact-date") {
      if (isDateValue(data)) {
        rv.outreachContactDate = data;
      }
    } else if (prefix === "outreach-response-date") {
      if (isDateValue(data)) {
        rv.outreachResponseDate = data;
      }
    } else if (prefix === "outreach-reference") {
      rv.outreachReference = data;
    }
  }
  return rv;
}

function getUserStory(userStory, data) {
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

function getEtpType(dependsOn) {
  const entries = dependsOn.split(",").map(item => item.trim());
  if (entries.includes("1101005")) {
    return "strict";
  }
  if (entries.includes("1480137")) {
    return "standard";
  }
  return "none";
}

function getKeywords(keywords, controlsList) {
  const newKeywords = [];
  const wantKeywords = new Set();

  wantKeywords.add("webcompat:site-report");

  for (const control of controlsList) {
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

function getDependsOn(dependsOn, controls) {
  let addBug = null;
  if (controls.impact.state === "impact-blocked") {
    addBug = "1886128";
  } else if (controls.impact.state === "impact-unsupported-warning") {
    addBug = "1886129";
  }

  if (addBug === null) {
    return dependsOn;
  }

  const entries = dependsOn.split(",").map(item => item.trim());
  if (!entries.includes(addBug)) {
    entries.push(addBug);
  }
  return entries.join(",");
}

async function getRank(url) {
  const urlRank = await browser.runtime.sendMessage({
    type: "get-tranco-rank",
    url,
  });
  return urlRank;
}

function getWebcompatKeywords(keywords) {
  const keywordPrefix = "webcompat:";
  return new Set(keywords
                 .filter(keyword => keyword.startsWith(keywordPrefix))
                 .map(keyword => keyword.slice(keywordPrefix.length)));
}

function selectStateFromKeywords(prefix, keywords, bugKeywords, defaultFn) {
  for (let keyword of keywords) {
    if (bugKeywords.has(keyword)) {
      return `${prefix}-${keyword}`;
    }
  }
  return defaultFn();
}

function parseUserName(user) {
  const match = /^.* \[:([^\]]+)\]$/.exec(user);
  if (match && match[1]) {
    return match[1];
  }
  return user;
}

function getDefaultSection(sections, bugData) {
  const hasImpact = /impact:/g.test(bugData.cf_user_story);
  const outreachKeywords = new Set(["webcompat:needs-contact", "webcompat:contact-ready", "webcompat:contact-in-progress", "webcontact:contact-complete", "webcompat:sitewait"]);
  let needsOutreach = false;
  for (const keyword of bugData.keywords) {
    if (outreachKeywords.has(keyword)) {
      needsOutreach = true;
      break;
    }
  }
  let id = "triage-form";
  if (needsOutreach && hasImpact && bugData.severity !== "--") {
    id = "outreach-form";
  }
  return sections.get(id);
}

class TriageSection extends Section {
  async create(state, {sections, tab, bugData}) {
    const controls = this.controls;

    Object.assign(controls, {
      url: new Control(state, "url"),
      platforms: {
        windows: new CheckboxControl(state, "platform-windows"),
        mac: new CheckboxControl(state, "platform-mac"),
        linux: new CheckboxControl(state, "platform-linux"),
        android: new CheckboxControl(state, "platform-android"),
      },
      login: new SelectControl(state, "login"),
      impact: new SelectControl(state, "impact"),
      configuration: new SelectControl(state, "configuration"),
      affects: new SelectControl(state, "affects"),
      branch: new SelectControl(state, "branch"),
      status: new SelectControl(state, "status"),
      outreach: new SelectControl(state, "outreach"),
      diagnosisTeam: new SelectControl(state, "diagnosisTeam"),
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

    state.effect(() => {
      if (controls.diagnosisTeam.state === "diagnosisTeam-none" &&
        controls.status.value === "webcompat:needs-diagnosis") {
        controls.diagnosisTeam.state = "diagnosisTeam-webcompat";
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

    const updateButton = new Button(state, "update-bug", async () => {
      updateButton.disabled = true;
      const data = {
        priority: controls.priority.value,
        severity: controls.severity.value,
        url: controls.url.value,
        keywords: getKeywords(bugData.keywords, [controls.login,
                                                 controls.status,
                                                 controls.sitepatch,
                                                 controls.outreach,
                                                 controls.regression]),
        userStory: this.getUserStory(bugData.cf_user_story),
        dependsOn: getDependsOn(bugData.dependson, controls),
      };
      try {
        await browser.tabs.sendMessage(tab.id, { type: "set-bug-data", ...data });
        sections.serializeOnClose = false;
      } finally {
        window.close();
      }
    });

    controls.resetButton = new Button(state, "reset-triage-form", () => this.populate({bugData}));
  }

  async populate({bugData}) {
    const controls = this.controls;
    const optionsData = getOptionsData();
    const userStoryData = extractUserStoryData(optionsData, bugData.cf_user_story);
    const etpType = getEtpType(bugData.dependson);

    controls.url.state = bugData.url;

    controls.initialPriority.state = bugData.priority;
    controls.initialSeverity.state = bugData.severity;

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
    } else if (etpType === "strict") {
      controls.configuration.state = `configuration-common`;
    } else {
      controls.configuration.state = `configuration-general`;
    }
    if (userStoryData.affects) {
      controls.affects.state = `affects-${userStoryData.affects}`;
    } else {
      controls.affects.state = `affects-all`;
    }
    if (userStoryData.branch) {
      controls.branch.state = `branch-${userStoryData.branch}`;
    } else {
      controls.branch.state = `branch-release`;
    }
    if (userStoryData.diagnosisTeam) {
      controls.diagnosisTeam.state = `diagnosisTeam-${userStoryData.diagnosisTeam}`;
    } else if (etpType != "none") {
      controls.diagnosisTeam.state = "diagnosisTeam-privacy";
    } else {
      controls.diagnosisTeam.state = "diagnosisTeam-none";
    }

    const webcompatKeywords = getWebcompatKeywords(bugData.keywords);
    controls.login.state = selectStateFromKeywords("login", ["needs-login", "have-login"],
      webcompatKeywords, () => "login-none");

    controls.outreach.state = selectStateFromKeywords("outreach",
      ["needs-contact", "contact-ready",
        "contact-in-progress", "contact-complete",
        "sitewait"],
      webcompatKeywords, () => "outreach-none");

    controls.status.state = selectStateFromKeywords("status", ["needs-diagnosis", "platform-bug"], webcompatKeywords,
      () => {
        if (etpType != "none") {
          return "status-platform-bug";
        }
        if (controls.outreach.state != "outreach-none") {
          return "status-sitebug";
        }
        return "status-needs-diagnosis";
      });

    controls.sitepatch.state = selectStateFromKeywords("sitepatch", ["needs-sitepatch", "sitepatch-applied"],
      webcompatKeywords, () => "sitepatch-none");

    controls.regression.state = bugData.keywords.includes("regression");
  }

  getUserStory(userStory) {
    const controls = this.controls;
    const data = {
      platform: Array.from(Object.entries(controls.platforms))
        .filter(([_, control]) => control.state)
        .map(([name, _]) => name).join(","),
      impact: controls.impact.state.split("-").slice(1).join("-"),
      configuration: controls.configuration.state.split("-").slice(1).join("-"),
      affects: controls.affects.state.split("-").slice(1).join("-"),
      branch: controls.branch.state.split("-").slice(1).join("-")
    };
    if (controls.diagnosisTeam.value) {
      data["diagnosis-team"] = controls.diagnosisTeam.value;
    }
    return getUserStory(userStory, data);
  }
}

class OutreachSection extends Section {
  async create(state, {sections, tab, bugData}) {
    const controls = this.controls;

    Object.assign(controls, {
      status: new SelectControl(state, "outreachStatus"),
      assignee: new Control(state, "outreach-assignee"),
      lastContacted: new Control(state, "outreach-last-contacted"),
      haveResponse: new CheckboxControl(state, "outreach-have-response"),
      lastResponse: new Control(state, "outreach-last-response"),
      reference: new Control(state, "outreach-reference"),
    });

    controls.assignMeButton = new Button(state, "outreach-assign-me", () => {
      controls.assignee.value = parseUserName(bugData.user);
    }),

      controls.lastContactedToday = new Button(state, "outreach-last-contacted-today", () => {
        controls.lastContacted.value = todayString();
      });

    controls.lastResponseToday = new Button(state, "outreach-last-response-today", () => {
      controls.lastResponse.value = todayString();
    });

    state.effect(() => {
      if (controls.lastContacted.value) {
        if (["outreachStatus-none", "outreachStatus-needs-contact", "outreachStatus-have-contact"].includes(controls.status.state)) {
          controls.status.state = "outreachStatus-contact-in-progress";
        }
      }
    });

    state.effect(() => {
      let responseEnabled = controls.haveResponse.value === "on";
      if (responseEnabled) {
        controls.lastResponse.show();
        controls.lastResponseToday.show();
        if (!controls.lastResponse.value) {
          controls.lastResponse.value = todayString();
        }
        if (["outreachStatus-none", "outreachStatus-needs-contact", "outreachStatus-have-contact"].includes(controls.status.state)) {
          controls.status.state = "outreachStatus-contact-in-progress";
        }
      } else {
        controls.lastResponse.hide();
        controls.lastResponseToday.hide();
      }
    });

    const updateButton = new Button(state, "outreach-update-bug", async () => {
      updateButton.disabled = true;
      const data = {
        keywords: getKeywords(bugData.keywords, [controls.status]),
        userStory: this.getUserStory(bugData.cf_user_story),
      };
      try {
        await browser.tabs.sendMessage(tab.id, { type: "set-bug-data", ...data });
        sections.serializeOnClose = false;
      } finally {
        window.close();
      }
    });

    controls.resetButton = new Button(state, "outreach-reset",
                                      () => this.populate({bugData}));
  }

  async populate({bugData}) {
    const controls = this.controls;
    const optionsData = getOptionsData();
    const userStoryData = extractUserStoryData(optionsData, bugData.cf_user_story);

    if (userStoryData.outreachAssignee) {
      controls.assignee.value = userStoryData.outreachAssignee;
    }
    if (userStoryData.outreachContactDate) {
      controls.lastContacted.value = userStoryData.outreachContactDate;
    }
    if (userStoryData.outreachResponseDate) {
      controls.haveResponse.state = true;
      controls.lastResponse.value = userStoryData.outreachResponseDate;
    } else {
      controls.haveResponse.state = false;
    }
    if (userStoryData.outreachReference) {
      controls.reference.value = userStoryData.outreachResponseDate;
    }

    controls.status.state = selectStateFromKeywords("outreachStatus",
                                                    ["needs-contact", "contact-ready",
                                                     "contact-in-progress", "contact-complete",
                                                     "sitewait"],
                                                    getWebcompatKeywords(bugData.keywords),
                                                    () => "outreachStatus-none");
  }

  getUserStory(userStory) {
    const controls = this.controls;
    const data = {};
    if (controls.assignee.value.trim()) {
      data["outreach-assignee"] = controls.assignee.value.trim();
    }
    if (controls.lastContacted.value) {
      data["outreach-contact-date"] = controls.lastContacted.value;
    }
    if (controls.haveResponse.state && controls.lastResponse.value) {
      data["outreach-response-date"] = controls.lastResponse.value;
    }
    if (controls.reference.value.trim()) {
      data["outreach-reference"] = controls.reference.value.trim();
    }
    return getUserStory(userStory, data);
  }
}

async function init() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const tab = tabs[0];
  const url = new URL(tab.url);
  const params = new URLSearchParams(url.search);

  const sections = new Sections(`${url.pathname}?id=${params.get("id")}`);

  for (const [sectionId, cls] of [["triage-initial", Section],
                                  ["triage-form", TriageSection],
                                  ["outreach-form", OutreachSection],
                                  ["error", ReadOnlySection]]) {
    sections.add(sectionId, cls);
  }

  const state = new State();

  try {
    const bugData = await browser.tabs.sendMessage(tab.id, {type: "read-bug-data"});

    if (bugData === null) {
      throw new Error("Unable to fetch bug data. Are you logged in?");
    }
    for (const section of sections.sections.values()) {
      await section.create(state, {sections, tab, bugData});
    }

    const sectionChooser = new SelectControl(state, "section-chooser");
    state.effect(() => {
      sections.show(sectionChooser.value);
    });

    const loadedSection = await sections.load();
    if (!loadedSection) {
      const defaultSection = getDefaultSection(sections, bugData);
      await defaultSection.populate({bugData});
      sections.show(defaultSection.id);
    } else {
      sectionChooser.value = loadedSection.id;
    }
  } catch(e) {
    document.getElementById("error-message").textContent = e.message;
    sections.show("error");
    throw e;
  }
}

addEventListener("DOMContentLoaded", init);
