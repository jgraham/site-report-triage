import {State} from "./signal.js";
import {Sections, Control} from "./ui.js";

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

class StoredState {
  constructor(issue) {
    self.key = `issueData-${issue.issueId}`;
  }

  async get() {
    const result = await browser.storage.local.get(self.key);
    return result[self.key] ?? null;
  }

  async set(controls) {
    const controlState = {};
    for (let [name, control] of Object.entries(controls)) {
        controlState[name] = control.value;
    }
    const state = {};
    state[self.key] = controlState;
    const result = await browser.storage.local.set(state);
  }

  async clear() {
    const result = await browser.storage.local.remove(self.key);
  }

}

async function populateFromIssue(controls, issue) {
  const issueData = await browser.runtime.sendMessage({
    type: "get-issue-data",
    ...issue
  });

  issueData.parsedBody = parseIssueBody(issueData);

  controls.summary.value = issueData.title;
  controls.description.value = issueData.parsedBody.url;
  controls.priority.value = getDiagnosisPriority(issueData);
  controls.keywords.value = getKeywords(issueData);
}

function populateFromState(controls, state) {
  for (const [controlName, value] of Object.entries(state)) {
    controls[controlName].value = value;
  }
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

  const state = new State();
  const controls = {
    summary: new Control(state, "summary"),
    description: new Control(state, "description"),
    url: new Control(state, "url"),
    priority: new Control(state, "priority"),
    severity: new Control(state, "severity"),
    keywords: new Control(state, "keywords"),
    userStory: new Control(state, "user-story"),
    dependsOn: new Control(state, "depends-on"),
  };

  const storedState = new StoredState(issue);

  addEventListener("blur", () => storedState.set(controls));

  const initialState = await storedState.get();
  if (initialState !== null) {
    populateFromState(controls, initialState);
  } else {
    populateFromIssue(controls, issue);
  }

  const moveButton = document.getElementById("move-commit");

  moveButton.addEventListener("click", async e => {
    moveButton.disabled = true;
    const bugData = {
      summary: controls.summary.value,
      description: controls.description.value,
      url: controls.url.value,
      priority: controls.priority.value,
      severity: controls.severity.value,
      keywords: controls.keywords.value.split(",").map(x => x.trim()),
      userStory: controls.userStory.value,
      dependsOn: controls.dependsOn.value.split(",").map(x => x.trim()),
    };
    let { bugzillaId } = await moveToBugzilla(bugData, issue);
    const bugLink = document.getElementById("bug-link");
    bugLink.href += bugzillaId;
    bugLink.textContent = `bug ${bugzillaId}`;
    sections.show("bug");
    storedState.clear();
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

async function render() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const url = new URL(tabs[0].url);

  const sections = new Sections();
  sections.add("move-initial");
  sections.add("move-form");
  sections.add("move-bug");

  populateMoveForm(sections, url.pathname);
}

addEventListener("DOMContentLoaded", render);
