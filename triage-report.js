import {State} from "./signal.js";
import {Section, ReadOnlySection, Sections, Button, Control, CheckboxControl, CheckboxListControl, DateControl, SelectControl, OutputControl} from "./ui.js";

class UserStory {
  constructor(userStory) {
    this.data = new Map();
    for (const [prefix, data] of this.parse(userStory)) {
      if (prefix && data !== null) {
        this.data.set(prefix, data);
      }
    }
  }

  *parse(userStory) {
    const lines = userStory.split(/\r?\n|\r|\n/g);
    for (const line of lines) {
      const [prefix, ...rest] = line.split(":");
      const data = rest.length > 0 ? rest.join(":").trim() : null;
      yield [prefix, data];
    }
  }

  fromUserStory(control, value) {
    if (control.constructor === CheckboxListControl) {
      return value.split(",").map(item => item.trim());
    }
    return value;
  }

  toUserStory(control) {
    if (control.constructor === CheckboxListControl) {
      return control.state.join(",");
    }
    if (control.constructor === OutputControl) {
      return control.value;
    }
    const serializeOptionsStr = control.datasetValue("serializeOptions") || "";
    const serializeOptions = new Set(serializeOptionsStr.split(",").map(item => item.trim()));
    if (!serializeOptions.has("no-default") || control.state !== control.defaultState)  {
      return control.state;
    }
    return null;
  }

  setControls(controlsData) {
    const controlsByName = new Map(controlsData.map(controlData => [controlData.control.name, controlData]));

    for (const [name, value] of this.data.entries()) {
      if (controlsByName.has(name)) {
        const {control, defaultFn} = controlsByName.get(name);
        const stateValue = this.fromUserStory(control, value);
        if (control.isValidState(stateValue)) {
          control.state = stateValue;
        } else if (defaultFn || control.defaultState) {
          control.state = defaultFn ? defaultFn(control) : control.defaultState;
        }
      }
    }

    for (const [name, {control, defaultFn}] of controlsByName.entries()) {
      if (!this.data.has(name)) {
        control.state = defaultFn ? defaultFn(control) : (control.defaultState ?? "");
      }
    }
  }

  getFromControls(controls, unsetControls) {
    const rv = [];
    const controlsByName = new Map(controls.map(control => [control.name, control]));
    const unsetNames = new Set(unsetControls ? unsetControls.map(control => control.name) : []);

    for (let [prefix, value] of this.data) {
      if (controlsByName.has(prefix)) {
        value = this.toUserStory(controlsByName.get(prefix));
        controlsByName.delete(prefix);
      }
      if (value !== null && !unsetNames.has(prefix)) {
        rv.push(`${prefix}:${value}`);
      }
    }
    for (let [name, control] of controlsByName.entries()) {
      const value = this.toUserStory(control);
      if (value !== null) {
        rv.push(`${name}:${value}`);
      }
    }
    return rv.join("\n");
  }
}

class Keywords {
  constructor(keywords) {
    this.data = new Set(keywords);
  }

  getPrefixKeywords(prefix) {
    return new Set(Array.from(this.data)
                   .filter(keyword => keyword.startsWith(prefix)));
  }

  setControls(controlsData) {
    for (const {control, defaultFn} of controlsData) {
      const keywords = control.datasetValues("keyword").intersection(this.data);
      let found = false;
      for (const elem of control.elem.options) {
        if (keywords.has(elem.dataset.keyword)) {
          elem.selected = true;
          found = true;
          break;
        }
      }
      if (!found) {
        control.state = defaultFn ? defaultFn(control) : control.defaultState;
      }
    }
  }

  getFromControls(controls, requiredKeywords) {
    const newKeywords = [];
    const settableKeywords = new Set(requiredKeywords);
    const wantKeywords = new Set(requiredKeywords);

    for (const control of controls) {
      for (const value of control.datasetValues("keyword")) {
        if (value != null) {
          settableKeywords.add(value);
        }
      }
      const value = control.currentDatasetValue("keyword");
      if (value) {
        wantKeywords.add(value);
      }
    }

    for (const keyword of this.data) {
      if (settableKeywords.has(keyword)) {
        if (wantKeywords.has(keyword)) {
          newKeywords.push(keyword);
          wantKeywords.delete(keyword);
        }
        // Otherwise the keyword should be removed
      } else {
        newKeywords.push(keyword);
      }
    }

    for (const keyword of wantKeywords) {
      if (keyword) {
        newKeywords.push(keyword);
      }
    }

    return newKeywords.join(", ");
  }
}

function todayString() {
    let date = new Date();
    return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, 0)}-${date.getDate().toString().padStart(2, 0)}`;

}

function getImpactScore(controls) {
  if (controls.impact.value !== "performance") {
    return parseInt(controls.impact.value);
  }

  let score = 0;
  for (const control of [controls.performanceImpactBrowser,
                         controls.performanceImpactContent,
                         controls.performanceImpactPageLoad,
                         controls.performanceImpactResources,
                         controls.performanceImpactAnimation]) {
    score += parseInt(control.value);
  }
  return score;
};

function getScore(rank, controls) {
  const impactScore = getImpactScore(controls);

  const configurationModifier = parseFloat(controls.configuration.value);

  const affectsModifier = parseFloat(controls.affects.value);

  const platformModifier = controls.platforms.value.map(x => parseFloat(x)).reduce((x, y) => x + y, 0);

  const severityScore = Math.round(impactScore * configurationModifier * affectsModifier * platformModifier);

  const interventionScore = parseFloat(controls.sitepatch.value);

  let rankScore = 1;
  if (rank !== null) {
    if (rank.globalRank != null && rank.globalRank <= 1000) {
      rankScore = 15;
    } else if (rank.localRank != null && rank.localRank <= 1000) {
      rankScore = 10;
    } else if (rank.globalRank != null && rank.globalRank <= 10000) {
      rankScore = 7.5;
    } else if (rank.localRank != null && rank.localRank <= 10000) {
      rankScore = 5;
    }
  }

  const totalScore = severityScore * interventionScore * rankScore;

  return {severityScore, totalScore};
}

function getSeverity(score) {
  const {severityScore} = score;

  let severity = "S4";
  if (severityScore > 50) {
    severity = "S2";
  } else if (severityScore > 25) {
    severity = "S3";
  }

  return severity;

}

function getPriority(score, regression) {
  let {totalScore} = score;

  let webcompatPriority = "P3";
  let performanceImpact = "low";
  if (totalScore > 750) {
    webcompatPriority = "P1";
    performanceImpact = "medium";
  } else if (totalScore > 100) {
    webcompatPriority = "P2";
    performanceImpact = "high";
  }

  let priority = webcompatPriority;
  if (regression) {
    priority = "P1";
  }

  return {priority, webcompatPriority, performanceImpact};
}

function getWebcompatScoreBucket(score) {
  score = parseInt(score);

  // This should be kept in sync with the logic in BigQuery
  const limits = [10, 20, 50, 100, 200, 500, 750, 1000, 2000];
  if (limits.length !== 9) {
    throw new Error("Need 9 boundaries between score buckets");
  }
  let bucket = 1;
  for (const upperLimit of limits) {
    if (score < upperLimit) {
      return bucket;
    }
    bucket += 1;
  }
  // This must be 10
  return bucket;
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

function getDependsOn(dependsOn, controls) {
  let addBug = null;
  if (controls.impact.state === "blocked") {
    addBug = "1886128";
  } else if (controls.impact.state === "unsupported-warning") {
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
  if (!url.trim()) {
    return null;
  }
  const urlRank = await browser.runtime.sendMessage({
    type: "get-crux-rank",
    yyyymm: "202409",
    url,
  });

  if (urlRank.globalRank === null || urlRank.globalRank <= 1000) {
    const trancoUrlRank = await browser.runtime.sendMessage({
      type: "get-tranco-rank",
      url,
      searchParentDomains: false,
    });
    if (trancoUrlRank !== null && trancoUrlRank.rank !== null) {
      urlRank.globalRank = trancoUrlRank.rank;
    }
  }

  return urlRank;
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
  if (bugData.component != "Web Compatibility" && bugData.keywords.includes("webcompat:platform-bug")) {
    id = "platform-form";
  }
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
      platforms: new CheckboxListControl(state, "platforms"),
      login: new SelectControl(state, "login"),
      impact: new SelectControl(state, "impact"),
      configuration: new SelectControl(state, "configuration"),
      affects: new SelectControl(state, "affects"),
      branch: new SelectControl(state, "branch"),
      status: new SelectControl(state, "status"),
      outreach: new SelectControl(state, "outreach"),
      diagnosisTeam: new SelectControl(state, "diagnosis-team"),
      regression: new CheckboxControl(state, "regression", { defaultValue: "" }),
      sitepatch: new SelectControl(state, "sitepatch"),
      initialSeverity: new Control(state, "severity-initial"),
      initialPriority: new Control(state, "priority-initial"),
      performanceImpactBrowser: new SelectControl(state, "performance-impact-browser"),
      performanceImpactContent: new SelectControl(state, "performance-impact-content"),
      performanceImpactPageLoad: new SelectControl(state, "performance-impact-page-load"),
      performanceImpactResources: new SelectControl(state, "performance-impact-resources"),
      performanceImpactAnimation: new SelectControl(state, "performance-impact-animation"),
    });

    this.performanceControls = [controls.performanceImpactBrowser,
                                controls.performanceImpactContent,
                                controls.performanceImpactPageLoad,
                                controls.performanceImpactResources,
                                controls.performanceImpactAnimation];

    const initialRank = await getRank(controls.url.value);
    const rank = state.signal(initialRank);
    state.effect(async () => {
      rank.value = await getRank(controls.url.value);
    });

    const score = state.computed(() => getScore(rank.value, controls));
    const severity = state.computed(() => getSeverity(score.value));
    const priority = state.computed(() => getPriority(score.value, controls.regression.value));

    state.effect(() => {
      // Weird mix of .value and .state is so this only depends on controls.status
      if (controls.status.value === "" && controls.outreach.state === controls.outreach.defaultState) {
        controls.outreach.state = "needs-contact";
      }
    });

    state.effect(() => {
      if (controls.diagnosisTeam.state === controls.diagnosisTeam.defaultState &&
        controls.status.value === "needs-diagnosis") {
        controls.diagnosisTeam.state = "webcompat";
      }
    });

    state.effect(() => {
      const performanceSubsection = document.getElementById("performance");
      const performanceImpactControl = document.getElementById("performance-impact-control");
      const webcompatPriorityControl = document.getElementById("webcompat-priority-control");
      if (controls.impact.value === "performance") {
        performanceSubsection.hidden = false;
        performanceImpactControl.hidden = false;
        webcompatPriorityControl.hidden = true;
        controls.diagnosisTeam.state = "performance";
      } else {
        performanceSubsection.hidden = true;
        performanceImpactControl.hidden = true;
        webcompatPriorityControl.hidden = false;
      }
    });

    controls.rank = new OutputControl(state, "rank", () => {
      const rankData = rank.value;
      console.log("Setting rank", rankData);
      const parts = [];
      if (!rankData) {
        return "Missing URL";
      }
      if (rankData.globalRank) {
        parts.push(`${rankData.globalRank} (global)`);
      }
      if (rankData.localRank && (rankData.globalRank === null || rankData.localRank < rankData.globalRank)) {
        parts.push(`${rankData.localRank} (local)`);
      }
      if (!parts.length) {
        parts.push("Unranked");
      }
      if (rankData.rankedDomain) {
        parts.push(`[${rankData.rankedDomain}]`);
      }
      return parts.join(" ");
    });

    controls.severity = new OutputControl(state, "severity", () => severity.value);
    controls.priority = new OutputControl(state, "priority", () => priority.value.priority);
    controls.webcompatPriority = new OutputControl(state, "webcompat-priority", () => priority.value.webcompatPriority);
    controls.performanceImpact = new OutputControl(state, "performance-impact", () => priority.value.performanceImpact);
    controls.score = new OutputControl(state, "user-impact-score", () => score.value.totalScore);

    const updateButton = new Button(state, "update-bug", async () => {
      updateButton.disabled = true;
      const userStory = new UserStory(bugData.cf_user_story);
      const keywords = new Keywords(bugData.keywords);
      const keywordControls = [controls.login,
                               controls.status,
                               controls.sitepatch,
                               controls.outreach,
                               controls.regression];
      const userStoryControls = [controls.platforms,
                                 controls.impact,
                                 controls.configuration,
                                 controls.affects,
                                 controls.branch,
                                 controls.diagnosisTeam,
                                 controls.score];
      const unsetUserStoryControls = [];

      // Only set this if we want to change the product / component
      let productComponent = null;
      if (controls.impact.value === "performance") {
        keywordControls.push(...[controls.performanceImpactBrowser,
                                 controls.performanceImpactContent,
                                 controls.performanceImpactAnimation]);
        userStoryControls.push(...this.performanceControls);
        if (bugData.product === "Web Compatibility") {
          productComponent = ["Core", "Performance"];
        }
      } else {
        unsetUserStoryControls.push(...this.performanceControls);
      }

      const data = {
        url: controls.url.value,
        keywords: keywords.getFromControls(keywordControls, ["webcompat:site-report"]),
        userStory: userStory.getFromControls(userStoryControls, unsetUserStoryControls),
        dependsOn: getDependsOn(bugData.dependson, controls),
      };
      if (bugData.product === "Web Compatibility") {
        data.priority = controls.priority.value;
        data.severity = controls.severity.value;
        data.webcompatPriority = controls.webcompatPriority.value;
        data.webcompatScore = getWebcompatScoreBucket(controls.score.value);
      } else if (bugData.product === "Core" && bugData.component === "Performance") {
        data.performanceImpact = controls.performanceImpact.value;
      } else {
        data.webcompatPriority = controls.webcompatPriority.value;
        data.webcompatScore = getWebcompatScoreBucket(controls.score.value);
      }

      if (productComponent !== null) {
        [data.product, data.component] = productComponent;
      }
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
    const userStory = new UserStory(bugData.cf_user_story);
    const keywords = new Keywords(bugData.keywords);
    const etpType = getEtpType(bugData.dependson);

    controls.url.state = bugData.url;
    controls.initialPriority.state = bugData.priority;
    controls.initialSeverity.state = bugData.severity;

    const perfKeywords = keywords.getPrefixKeywords("perf:");
    const isPerfBug = (bugData.product === "Core" && bugData.component == "Performance") || perfKeywords.length > 0;

    userStory.setControls([{control: controls.impact,
                            defaultFn: control => isPerfBug ? "performance" : control.defaultState},
                           {control: controls.platforms},
                           {control: controls.configuration,
                            defaultFn: control => {
                              if (etpType === "strict") {
                                return "common";
                              } else {
                                return control.defaultState;
                              }
                            }
                           },
                           {control: controls.affects},
                           {control: controls.branch},
                           {control: controls.diagnosisTeam},
                           {control: controls.performanceImpactBrowser},
                           {control: controls.performanceImpactContent},
                           {control: controls.performanceImpactPageLoad},
                           {control: controls.performanceImpactResources},
                           {control: controls.performanceImpactAnimation}]);

    keywords.setControls([{control: controls.login},
                          {control: controls.outreach},
                          {control: controls.status,
                           defaultFn: () => {
                             if (etpType != "none") {
                               return "platform-bug";
                             }
                             if (controls.outreach.state != "none") {
                               return "sitebug";
                             }
                             return "needs-diagnosis";
                           }},
                          {control: controls.sitepatch}]);

    controls.regression.state = bugData.keywords.includes("regression");
  }
}

class OutreachSection extends Section {
  async create(state, {sections, tab, bugData}) {
    const controls = this.controls;

    Object.assign(controls, {
      status: new SelectControl(state, "outreach-status"),
      assignee: new Control(state, "outreach-assignee"),
      lastContacted: new DateControl(state, "outreach-contact-date"),
      haveResponse: new CheckboxControl(state, "outreach-have-response"),
      lastResponse: new DateControl(state, "outreach-response-date"),
      reference: new Control(state, "outreach-reference"),
    });

    controls.assignMeButton = new Button(state, "outreach-assign-me", () => {
      controls.assignee.value = parseUserName(bugData.user);
    }),

      controls.lastContactedToday = new Button(state, "outreach-contact-date-today", () => {
        controls.lastContacted.value = todayString();
      });

    controls.lastResponseToday = new Button(state, "outreach-response-date-today", () => {
      controls.lastResponse.value = todayString();
    });

    state.effect(() => {
      if (controls.lastContacted.value) {
        if (["outreachStatus-none", "outreachStatus-needs-contact", "outreachStatus-contact-ready"].includes(controls.status.state)) {
          controls.status.state = "contact-in-progress";
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
          controls.status.state = "contact-in-progress";
        }
      } else {
        controls.lastResponse.state = controls.lastResponse.defaultState;
        controls.lastResponse.hide();
        controls.lastResponseToday.hide();
      }
    });

    const updateButton = new Button(state, "outreach-update-bug", async () => {
      updateButton.disabled = true;
      const userStory = new UserStory(bugData.cf_user_story);
      const keywords = new Keywords(bugData.keywords);
      const data = {
        keywords: keywords.getFromControls([controls.status], ["webcompat:site-report"]),
        userStory: userStory.getFromControls([controls.assignee,
                                              controls.lastContacted,
                                              controls.lastResponse,
                                              controls.reference]),
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
    const userStory = new UserStory(bugData.cf_user_story);
    const keywords = new Keywords(bugData.keywords);

    userStory.setControls([{control: controls.assignee},
                           {control: controls.lastContacted},
                           {control: controls.lastResponse},
                           {control: controls.reference}]);

    controls.haveResponse.state = userStory.data.has("outreach-response-date");

    keywords.setControls([{control: controls.status}]);
  }
}

class PlatformSection extends Section {
  async create(state, {sections, tab, bugData}) {
    const controls = this.controls;

    Object.assign(controls, {
      scheduledDate: new DateControl(state, "platform-scheduled"),
    });

    const updateButton = new Button(state, "platform-update-bug", async () => {
      updateButton.disabled = true;
      const userStory = new UserStory(bugData.cf_user_story);
      const data = {
        userStory: userStory.getFromControls([controls.scheduledDate]),
      };
      try {
        await browser.tabs.sendMessage(tab.id, { type: "set-bug-data", ...data });
        sections.serializeOnClose = false;
      } finally {
        window.close();
      }
    });

    controls.resetButton = new Button(state, "platform-reset",
                                      () => this.populate({bugData}));
  }

  async populate({bugData}) {
    const controls = this.controls;
    const userStory = new UserStory(bugData.cf_user_story);

    userStory.setControls([{control: controls.scheduledDate}]);
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
                                  ["platform-form", PlatformSection],
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
      await sections.populate({bugData});
      sections.show(defaultSection.id);
      sectionChooser.value = defaultSection.id;
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
