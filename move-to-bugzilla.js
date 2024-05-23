import {State} from "./signal.js";
import {Section, Sections, Button, CheckboxControl, Control, Link, OutputControl, SelectControl, UiElement} from "./ui.js";

function issueInfo(pathname) {
  // Expected pathname is like
  // /{owner}/{repo}/issues/{issueId}
  const pieces = pathname.split('/');

  if (pieces[3] != "issues") {
    // Not an issue page
    return null;
  }

  const owner = pieces[1];
  const repo = pieces[2];
  const issueId = pieces[4];

  if (!owner || !repo || !issueId) {
    return null;
  }

  return {
    owner, repo, issueId
  };
}

function parseIssueBody(issueData) {
  const bodyLines = issueData.body.split("\n");
  const fields = {
    url: "",
    browser_version: "",
    operating_system: "",
    problem_type: "",
    description: "",
    steps_to_reproduce: ""
  };
  const fieldRegexp = /\*\*([^\*]+)\*\*:(.*)/;
  const detailsRegexp = /\s*<details>/;
  let idx = -1;
  for (const line of bodyLines) {
    idx++;
    const found = line.match(fieldRegexp);
    if (!found) {
      continue;
    }
    let [_, fieldName, fieldValue] = found;
    fieldName = fieldName.toLowerCase().trim().replace("/", "").replaceAll(/\s+/g, "_");
    if (fieldName === "steps_to_reproduce") {
      break;
    }
    fields[fieldName] = fieldValue.trim();
  }

  for (const line of bodyLines.slice(idx + 1)) {
    if (line.match(detailsRegexp)) {
      break;
    }
    fields.steps_to_reproduce += line + "\n";
  }

  return fields;
}

function getDiagnosisPriority(issueData, isRegression) {
  if (isRegression) {
    return "P1";
  }

  const label = issueData.labels.find(label => label.name.startsWith("diagnosis-priority"));
  if (!label) {
    return "--";
  }
  switch(label.name.slice(-2)) {
  case "p1": {
    return "P1";
    break;
  }
  case "p2": {
    return "P2";
    break;
  }
  case "p3": {
    return "P3";
    break;
  }
  default: {
    return "--";
    break;
  }
  }
}

function joinListStr(list) {
  if (list.length === 1) {
    return list[0];
  }
  return `${list.slice(0, list.length - 1).join(", ")}, and ${list[list.length - 1]}`;
}

function getOS(osString) {
  if (/Windows/i.test(osString)) {
    const version = /Windows (7|8|(?:10)|(?:11))/i.exec(osString);
    if (version !== null) {
      return `Windows ${version[1]}`;
    }
    return "Windows";
  }
  if (/Mac OS/i.test(osString) || /macOS/i.test(osString)) {
    return "macOS";
  }
  if (/Linux/i.test(osString)) {
    return "Linux";
  }
  if (/Android/i.test(osString)) {
    return "Android";
  }
  return "Unspecified";
}

function getBugData(issueData, controls) {
  let preconditionsText = "";
  if (controls.preconditions.value.trim()) {
    preconditionsText = `**Preconditions:**
${controls.preconditions.value.trim()}`;
  }

  let strText = "";
  if (controls.str.value.trim()) {
    strText = `**Steps to reproduce:**
${controls.str.value.trim()}`;
  }

  let expectedText = "";
  if (controls.expectedBehavior.value.trim()) {
    expectedText = `**Expected Behavior:**
${controls.expectedBehavior.value.trim()}`;
  }

  let actualText = "";
  if (controls.actualBehavior.value.trim()) {
    actualText = `**Actual Behavior:**
${controls.actualBehavior.value.trim()}`;
  }
  const sectionsText = [preconditionsText,
                        strText,
                        expectedText,
                        actualText].filter(x => x.length).join("\n\n");

  const os = getOS(controls.operatingSystem.value);
  const platform = os === "Android" ? "ARM" : (os === "Unspecified" ? "Unspecified" : "Desktop");

  let notes = [];
  if (controls.etp.state !== "other") {
    notes.push(controls.etp.value);
  }
  const reproducesIn = [];
  const doesNotReproduceIn = [];
  for (const ctrl of Object.values(controls.reproduces)) {
    const target = ctrl.state ? reproducesIn : doesNotReproduceIn;
    // Want the value even if the checkbox is unticked
    target.push(ctrl.elem.value);
  }
  if (reproducesIn.length) {
    notes.push(`Reproduces in ${joinListStr(reproducesIn)}`);
  }
  if (doesNotReproduceIn.length) {
    notes.push(`Does not reproduce in ${joinListStr(doesNotReproduceIn)}`);
  }
  let extraNotesText = "";
  if (controls.extraNotes.value.trim().length) {
    extraNotesText = `\n${controls.extraNotes.value}`;
  }
  const notesText = notes.map(item => `- ${item}`).join("\n") + extraNotesText;

  const etpState = controls.etp.state;
  const type = ["etp-strict", "etp-strict-standard"].includes(etpState) ? "ETP" : "webcompat";
  const blocks = [];

  let closeMessage;
  if (etpState === "etp-strict") {
    blocks.push("1101005");
    closeMessage = `Thanks for the report. I was able to reproduce the issue with Enhanced Tracking Protection set to Strict, but not with it set to Standard.

Until the issue is resolved, you can work around it by setting Enhanced Tracking Protection to Standard.`;

  } else if (etpState === "etp-strict-standard") {
    closeMessage = `Thanks for the report. I was able to reproduce the issue with Enhanced Tracking Protection set to Strict and Standard, but not with it disabled.

Until the issue is resolved, you can work around it by disabling Enhanced Tracking Protection.`;
    blocks.push("1480137");
  } else {
    let reproducesMessage = "";
    if (reproducesIn.length) {
      reproducesMessage += (`I was able to reproduce in ${joinListStr(reproducesIn)}`);
    }
    if (doesNotReproduceIn.length && reproducesMessage.length) {
      notes.push(`, but not in ${joinListStr(doesNotReproduceIn)}`);
    }
    reproducesMessage += ".";
    closeMessage = `Thanks for the report. ${reproducesMessage}`;
  }
  closeMessage += "\n\nReproducable issues are moved to our Bugzilla component; please see: ";

  const description = `**Environment:**
Operating system: ${controls.operatingSystem.value}
Firefox version: ${controls.firefoxVersion.value}

${sectionsText}

**Notes:**
${notesText}

Created from ${issueData.html_url}
`;

  const keywords = [];
  if (controls.reproduces.firefoxNightly.state && !controls.reproduces.firefoxRelease.state) {
    keywords.push("regression");
  }
  if (issueData.milestone.title === "needsdiagnosis") {
    keywords.push("webcompat:needs-diagnosis");
  }
  if (issueData.labels.find(label => label.name == ("action-needssitepatch"))) {
    keywords.push("webcompat:needs-sitepatch");
  }

  return {
    summary: controls.summary.value,
    url: controls.url.value,
    type,
    priority: getDiagnosisPriority(issueData, keywords.includes("regression")),
    platform,
    os,
    keywords,
    description,
    seeAlso: [issueData.html_url],
    blocks,
    closeMessage,
  };
}

function createIssueForm(sections, state, issue, issueData) {
  const section = sections.get("issue-form");
  const controls = section.controls;
  Object.assign(controls, {
    summary: new Control(state, "summary"),
    url: new Control(state, "url"),
    operatingSystem: new Control(state, "operating-system"),
    firefoxVersion: new Control(state, "firefox-version"),
    preconditions: new Control(state, "preconditions"),
    str: new Control(state, "str"),
    expectedBehavior: new Control(state, "expected-behavior"),
    actualBehavior: new Control(state, "actual-behavior"),
    etp: new SelectControl(state, "etp"),
    reproduces: {
      firefoxNightly: new CheckboxControl(state, "reproduces-firefox-nightly"),
      firefoxRelease: new CheckboxControl(state, "reproduces-firefox-release"),
      chrome: new CheckboxControl(state, "reproduces-chrome"),
    },
    extraNotes: new Control(state, "extra-notes"),
    reset: new Button(state, "issue-form-reset", () => populateIssueForm(section, issue)),
    next: new Button(state, "issue-form-next", () => {
      const bugFormSection = sections.get("bug-form");
      const bugData = getBugData(issueData, controls);
      populateBugForm(bugFormSection, bugData);
      sections.show("bug-form");
    })
  });
}

function populateIssueForm(section, issueData) {
  if (!issueData.parsedBody) {
    issueData.parsedBody = parseIssueBody(issueData);
  }
  const controls = section.controls;

  controls.summary.state = issueData.title;
  controls.url.state = issueData.parsedBody.url;
  controls.operatingSystem.state = issueData.parsedBody.operating_system;
  controls.firefoxVersion.state = issueData.parsedBody.browser_version;
  controls.actualBehavior.state = issueData.parsedBody.description.trim();
  controls.str.state = issueData.parsedBody.steps_to_reproduce.trim();
}

function createBugForm(sections, state, issue) {
  const section = sections.get("bug-form");
  const controls = section.controls;
  Object.assign(controls, {
    summary: new Control(state, "bug-summary"),
    url: new Control(state, "bug-url"),
    description: new Control(state, "description"),
    type: new SelectControl(state, "type"),
    priority: new Control(state, "priority"),
    severity: new Control(state, "severity"),
    platform: new Control(state, "platform"),
    os: new Control(state, "os"),
    keywords: new Control(state, "keywords"),
    blocks: new Control(state, "blocks"),
    dependsOn: new Control(state, "depends-on"),
    seeAlso: new Control(state, "see-also"),
    closeMessage: new Control(state, "close-message"),
    back: new Button(state, "bug-form-back", () => sections.show("issue-form"))
  });
  controls.product = new OutputControl(state, "product",
                                       () => controls.type.value == "webcompat" ? "Web Compatibility": "Core");
  controls.component = new OutputControl(state, "component",
                                         () => controls.type.value == "webcompat" ? "Site Reports": "Privacy: Anti-Tracking");

  controls.moveButton = new Button(state, "move-commit", async e => {
    controls.moveButton.elem.disabled = true;
    const bugData = {
      summary: controls.summary.value,
      description: controls.description.value,
      url: controls.url.value,
      product: controls.product.value,
      component: controls.component.value,
      opSys: controls.os.value,
      platform: controls.platform.value,
      priority: controls.priority.value,
      severity: controls.severity.value,
      keywords: controls.keywords.value.split(",").map(x => x.trim()),
      whiteboard: "[webcompat-source:web-bugs]",
      blocks: controls.blocks.value.split(",").map(x => x.trim()),
      dependsOn: controls.dependsOn.value.split(",").map(x => x.trim()),
      seeAlso: controls.seeAlso.value.split(",").map(x => x.trim()),
      closeMessage: controls.closeMessage.value,
    };
    const moveResp = await moveToBugzilla(bugData, issue);
    let bugCreatedSection = sections.get("bug-created");
    populateBugCreated(section, moveResp);
    sections.show("bug-created");
    sections.serializeOnClose = false;
  });
  controls.moveButton.elem.disabled = false;
}

function populateBugForm(section, bugData) {
  const controls = section.controls;

  controls.summary.value = bugData.summary;
  controls.description.value = bugData.description;
  controls.url.value = bugData.url;
  controls.priority.value = bugData.priority;
  controls.platform.value = bugData.platform;
  controls.os.value = bugData.os;
  controls.keywords.value = bugData.keywords.join(",");
  controls.seeAlso.value = bugData.seeAlso.join(",");
  controls.type.value = bugData.type;
  controls.blocks.value = bugData.blocks.join(",");
  controls.closeMessage.value = bugData.closeMessage;
}

function createBugCreated(sections, state) {
 const section = sections.get("bug-form");
  const controls = section.controls;
  Object.assign(controls, {
    bugLink: new Link(state, "bug-link"),
    githubError: new UiElement("github-error"),
    githubErrorMsg: new UiElement("github-error-msg")
  });
}

function populateBugCreated(section, moveResp) {
  section.controls.bugLink.href += moveResp.bugzillaId;
  section.controls.bugLink.textContent = `bug ${moveResp.bugzillaId}`;

  if (moveResp.githubError) {
    section.controls.githubErrorMsg.textContent = moveResp.githubError.message;
    section.controls.githubError.show();
  }
}

async function moveToBugzilla(bugData, githubData) {
  const msg = {
    type: "move-to-bugzilla",
    bugData: {
      bugType: "defect",
      ...bugData
    },
    githubData: {
      ...githubData,
     close: true
    }
  };
  return browser.runtime.sendMessage(msg);
}

async function init() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const url = new URL(tabs[0].url);

  const issue = issueInfo(url.pathname);
  if (!issue) {
    // Not an issue page
    return;
  }
  if (issue.owner !== "webcompat" || issue.repo != "web-bugs") {
    return;
  }

  const issueData = await browser.runtime.sendMessage({
    type: "get-issue-data",
    ...issue
  });

  const state = new State();
  const sections = new Sections(`${url.pathname}`);
  sections.add("initial", {"persist": false});
  sections.add("issue-form");
  sections.add("bug-form");
  sections.add("bug-created");

  createIssueForm(sections, state, issue, issueData);
  createBugForm(sections, state, issue);
  createBugCreated(sections, state);

  if (!await sections.load()) {
    const section = sections.get("issue-form");
    populateIssueForm(section, issueData);
    sections.show(section.id);
  }
}

addEventListener("DOMContentLoaded", init);
