import {State} from "./signal.js";
import {Section, ReadOnlySection, Sections, Button, CheckboxListControl, Control, Link, OutputControl, SelectControl, UiElement} from "./ui.js";

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
  }
  case "p2": {
    return "P2";
  }
  case "p3": {
    return "P3";
  }
  default: {
    return "--";
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

class IssueForm extends Section {
  async create(state, {sections, issue, issueData}) {
    const controls = this.controls;
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
      reproduces: new CheckboxListControl(state, "reproduces"),
      extraNotes: new Control(state, "extra-notes"),
      reset: new Button(state, "issue-form-reset", () => this.populate({issue})),
      next: new Button(state, "issue-form-next", () => {
        const bugFormSection = sections.get("bug-form");
        const bugData = this.getBugData(issueData);
        bugFormSection.populate({bugData});
        sections.show("bug-form");
      })
    });
  }

  async populate({issueData}) {
    if (!issueData.parsedBody) {
      issueData.parsedBody = parseIssueBody(issueData);
    }
    const controls = this.controls;

    controls.summary.state = issueData.title;
    controls.url.state = issueData.parsedBody.url;
    controls.operatingSystem.state = issueData.parsedBody.operating_system;
    controls.firefoxVersion.state = issueData.parsedBody.browser_version;
    controls.actualBehavior.state = issueData.parsedBody.description.trim();
    controls.str.state = issueData.parsedBody.steps_to_reproduce.trim();
  }

  getBugData(issueData) {
    const controls = this.controls;
    const sections = {
      preconditions: ["Preconditions", controls.preconditions.value.trim()],
      str: ["Steps to reproduce", controls.str.value.trim()],
      expected: ["Expected Behavior", controls.expectedBehavior.value.trim()],
      actual: ["Actual Behavior:", controls.actualBehavior.value.trim()],
    };

    const os = getOS(controls.operatingSystem.value);
    const platform = os === "Android" ? "Arm" : (os === "Unspecified" ? "Unspecified" : "Desktop");

    let notes = [];
    if (controls.etp.state !== "other") {
      notes.push(controls.etp.value);
    }
    const reproducesIn = [];
    const doesNotReproduceIn = [];
    for (const control of controls.reproduces.checkboxes) {
      const target = control.state ? reproducesIn : doesNotReproduceIn;
      target.push(control.name);
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
    const bugType = ["strict", "strict-standard"].includes(etpState) ? "ETP" : "webcompat";
    const blocks = [];
    const dependsOn = [];
    const keywords = ["webcompat:site-report"];

    let closeMessage;
    const preconditionsHasETP = /\bETP\b/gim.test(sections.preconditions[1]);
    if (etpState === "strict") {
      dependsOn.push("1101005");
      closeMessage = `Thanks for the report. I was able to reproduce the issue with Enhanced Tracking Protection set to Strict, but not with it set to Standard.

Until the issue is resolved, you can work around it by setting Enhanced Tracking Protection to Standard.`;
      if (!preconditionsHasETP) {
        sections.preconditions[1] += `\n* ETP set to Strict`;
      }
    } else if (etpState === "strict-standard") {
      dependsOn.push("1480137");
      closeMessage = `Thanks for the report. I was able to reproduce the issue with Enhanced Tracking Protection set to Strict and Standard, but not with it disabled.

Until the issue is resolved, you can work around it by disabling Enhanced Tracking Protection.`;
      if (!preconditionsHasETP) {
        sections.preconditions[1] += `\n* ETP set to Standard or Strict`;
      }
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
    closeMessage += "\n\nReproducible issues are moved to our Bugzilla component; please see: ";

    const sectionsText = [sections.preconditions,
                          sections.str,
                          sections.expected,
                          sections.actual]
          .map(([title, text]) => [title, text.trim()])
          .filter(([_, text]) => text.length > 0)
          .map(([title, text]) => `**${title}:**\n${text}`).join("\n\n");

    const description = `**Environment:**
Operating system: ${controls.operatingSystem.value}
Firefox version: ${controls.firefoxVersion.value}

${sectionsText}

**Notes:**
${notesText}

Created from ${issueData.html_url}
`;

    if (reproducesIn.includes("firefox-nightly") && !reproducesIn.includes("firefox-release")) {
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
      bugType,
      priority: getDiagnosisPriority(issueData, keywords.includes("regression")),
      platform,
      os,
      keywords,
      description,
      seeAlso: [issueData.html_url],
      blocks,
      closeMessage,
      dependsOn,
    };
  }
}

class BugForm extends Section {
  async create(state, { sections, issue }) {
    const controls = this.controls;
    Object.assign(controls, {
      summary: new Control(state, "bug-summary"),
      url: new Control(state, "bug-url"),
      description: new Control(state, "description"),
      bugType: new SelectControl(state, "bug-type"),
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

    controls.product = new OutputControl(state, "product", () => {
      const bugType = controls.bugType.value;
      if (bugType === "Performance") {
        return "Core";
      }
      return "Web Compatibility";
    });
    controls.component = new OutputControl(state, "component", () => {
      const bugType = controls.bugType.value;
      if (bugType === "ETP") {
        return "Privacy: Site Reports";
      }
      if (bugType === "Performance") {
        return "Performance";
      }
      return "Site Reports";
    });

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
        blocks: controls.blocks.value.split(",").map(x => parseInt(x.trim())),
        dependsOn: controls.dependsOn.value.split(",").map(x => parseInt(x.trim())),
        seeAlso: controls.seeAlso.value.split(",").map(x => x.trim()),
        closeMessage: controls.closeMessage.value,
      };
      const moveResp = await moveToBugzilla(bugData, issue);
      let bugCreatedSection = sections.get("bug-created");
      bugCreatedSection.populate({moveResp});
      sections.show("bug-created");
      sections.serializeOnClose = false;
    });
    controls.moveButton.elem.disabled = false;
  }

  async populate({bugData}) {
    const controls = this.controls;

    controls.summary.value = bugData.summary;
    controls.description.value = bugData.description;
    controls.url.value = bugData.url;
    controls.priority.value = bugData.priority;
    controls.platform.value = bugData.platform;
    controls.os.value = bugData.os;
    controls.keywords.value = bugData.keywords.join(",");
    controls.seeAlso.value = bugData.seeAlso.join(",");
    controls.bugType.value = bugData.bugType;
    controls.blocks.value = bugData.blocks.join(",");
    controls.closeMessage.value = bugData.closeMessage;
    controls.dependsOn.value = bugData.dependsOn.join(",");
  }
}

class BugCreatedSection extends Section {
  async create(state) {

    const controls = this.controls;
    Object.assign(controls, {
      bugLink: new Link(state, "bug-link"),
      githubError: new UiElement("github-error"),
      githubErrorMsg: new UiElement("github-error-msg")
    });
  }

  async populate({moveResp}) {
    this.controls.bugLink.href += moveResp.bugzillaId;
    this.controls.bugLink.textContent = `bug ${moveResp.bugzillaId}`;

    if (moveResp.githubError) {
      this.controls.githubErrorMsg.textContent = moveResp.githubError.message;
      this.controls.githubError.show();
    }
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
  for (const [sectionId, cls] of [["initial", ReadOnlySection],
                                  ["issue-form", IssueForm],
                                  ["bug-form", BugForm],
                                  ["bug-created", BugCreatedSection]]) {
    const section = sections.add(sectionId, cls);
    await section.create(state, {sections, issue, issueData});
  }

  const loadedSection = await sections.load();
  if (!loadedSection) {
    const section = sections.get("issue-form");
    section.populate({issueData});
    sections.show(section.id);
  }
}

addEventListener("DOMContentLoaded", init);
