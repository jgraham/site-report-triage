class Section {
  constructor(id) {
    this.elem = document.getElementById(id);
  }

  show() {
    this.elem.hidden = false;
  }

  hide() {
    this.elem.hidden = true;
  }
}

class Sections {
  constructor() {
    this.sections = new Map();
  }

  add(name, id = null) {
    const sectionId = id === null ? name : id;
    this.sections.set(name, new Section(sectionId));
  }

  show(name) {
    if (!this.sections.has(name)) {
      throw new Error(`Unknown section ${name}`);
    }
    for (const [secName, section] of this.sections.entries()) {
      if (secName !== name) {
        section.hide();
      }
    }
    this.sections.get(name).show();
  }

}

class Control {
  constructor(id, getDefaultValue) {
    this.elem = document.getElementById(id);
    this.getDefaultValue = getDefaultValue.bind(this);
  }

  get value() {
    return this.elem.value;
  }

  set value(value) {
    this.elem.value = value;
  }
}

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
    browser: "",
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

function bugzillaDescription(issueData) {
  return `${issueData.parsedBody.description}

Steps to reproduce:
${issueData.parsedBody.steps_to_reproduce}
Created from ${issueData.html_url}
`;
}

function getDiagnosisPriority(issueData) {
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

function getKeywords(issueData) {
  const keywords = [];
  if (issueData.milestone.title === "needsdiagnosis") {
    keywords.push("webcompat:needs-diagnosis");
  }
  if (issueData.labels.find(label => label.name == ("action-needssitepatch"))) {
    keywords.push("webcompat:needs-sitepatch");
  }
  return keywords.join(",");
};

async function populateMoveForm(sections, pathname) {
  const issue = issueInfo(pathname);
  if (!issue) {
    // Not an issue page
    return;
  }
  if (issue.owner !== "webcompat" || issue.repo != "web-bugs") {
    return;
  }

  const controls = {
    summary: new Control("summary", issueData => issueData.title),
    description: new Control("description", bugzillaDescription),
    url: new Control("url", issueData => issueData.parsedBody.url),
    priority: new Control("priority", getDiagnosisPriority),
    keywords: new Control("keywords", getKeywords),
  };

  const issueData = await browser.runtime.sendMessage({
    type: "get-issue-data",
    ...issue
  });

  issueData.parsedBody = parseIssueBody(issueData);

  for (let control of Object.values(controls)) {
    control.value = control.getDefaultValue(issueData);
  };

  const moveButton = document.getElementById("move");

  moveButton.addEventListener("click", async e => {
    moveButton.disabled = true;
   const bugData = {
     summary: controls.summary.value,
     description: controls.description.value,
     url: controls.url.value,
     priority: controls.priority.value,
     keywords: controls.keywords.value.split(",").map(x => x.trim()),
   };
    let { bugzillaId } = await moveToBugzilla(bugData, issue);
    const bugLink = document.getElementById("bug-link");
    bugLink.href += bugzillaId;
    bugLink.textContent = `bug ${bugzillaId}`;
    sections.show("bug");
  });
  moveButton.disabled = false;

  sections.show("move-form");
}

async function moveToBugzilla(bugData, githubData) {
  const msg = {
    type: "move-to-bugzilla",
    bugData: {
      component: "Site Reports",
      product: "Web Compatibility",
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

  const sections = new Sections();
  sections.add("initial");
  sections.add("move-form");
  sections.add("bug");

  populateMoveForm(sections, url.pathname);
}

addEventListener("DOMContentLoaded", init);
