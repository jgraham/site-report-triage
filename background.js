let user = null;

const pages = [
  {
    page: "move.html",
    show_matches: ["^https://github\.com/webcompat/web-bugs/issues/.*"]
  },
   {
    page: "triage-report.html",
    show_matches: ["^https://bugzilla\.mozilla.org/show_bug\.cgi\?"]
   },
];

function pageActionClicked(tab) {
  const url = new URL(tab.url);
  const path = getPopupPath(url);
  console.log(path);
  browser.pageAction.setPopup({tabId: tab.id, popup:path});
  browser.pageAction.openPopup();
}

function getPopupPath(url) {
  for (const page of pages) {
    const matchUrls = page.show_matches ?? [];
    for (const matchUrl of matchUrls) {
      if ((new RegExp(matchUrl)).test(url.href)) {
        return page.page;
      }
    }
  }
  console.error(`Missing popup handler for ${url.href}`);
  return "about:blank";
}

browser.pageAction.onClicked.addListener(pageActionClicked);


async function ensureUser() {
  if (user) {
    return user;
  }

  const { github_key, bugzilla_key } = await browser.storage.local.get();

  if (!github_key || !bugzilla_key) {
    browser.runtime.openOptionsPage();
    throw new Error("Missing keys.");
  }

  user = {
    bugzilla_key,
    github_key,
  };

  return user;
}

browser.runtime.onMessage.addListener((data, sender) => {
  switch (data.type) {
    case "get-issue-data":
      return getIssueData(data);
    case "move-to-bugzilla":
      return moveToBugzilla(data);
    case "get-tranco-rank":
      return trancoRank(data);
    default:
      throw new Error(`Unrecognised conent background script message: ${data.type}`);
  }
});


async function githubIssueApi({ issue, path = '', data, method = 'GET' }) {
  const body = {
    owner: issue.owner,
    repo: issue.repo,
    issue_number: issue.issueId,
    ... data,
  };

  if (method !== "GET") {
    const user = await ensureUser();
  }

  const request = {
    method,
    headers: {}
  };

  if (user !== null) {
    request.headers.Authorization = `token ${user.github_key}`;
  }

  if (method === 'POST') {
    request.body = JSON.stringify(body);
  }

  const response = await fetch(
    `https://api.github.com/repos/${issue.owner}/${issue.repo}`
    + `/issues/${issue.issueId}${path}`,
    request
  );

  if (!response.ok) {
    throw new Error(`Github request failed: ${await response.text()}`);
  }

  const result = await response.json();

  return result;
}

async function getIssueData(data) {
  return await githubIssueApi({
    issue: data
  });
}

async function addGitHubComment(issue, comment) {
  return await githubIssueApi({
    issue,
    method: 'POST',
    path: '/comments',
    data: {
      body: comment
    }
  });
}

async function createBugzillaBug(data) {
  const { component, product, opSys, severity, priority, bugType, summary, description, keywords, url, dependsOn = [], userStory = "" } = data;

  const user = await ensureUser();

  const bugzillaRequest = {
    api_key: user.bugzilla_key,
    product,
    component,
    type: bugType,
    version: "unspecified",
    op_sys: opSys,
    platform: "unspecified",
    severity,
    priority,
    summary,
    description,
    url,
    depends_on: dependsOn,
    cf_user_story: userStory,
  };

  if (keywords) {
    bugzillaRequest.keywords = keywords;
  }

  // Create bug in Bugzilla first
  const bugzillaResponse = await fetch('https://bugzilla.mozilla.org/rest/bug', {
    method: 'POST',
    body: JSON.stringify(bugzillaRequest),
  });

  const response = await bugzillaResponse.json();
  const bugzillaId = response.id;

  if (!bugzillaId) {
    console.error("Could not create bugzilla bug", response);
    throw new Error(`Could not create bugzilla bug: ${JSON.stringify(response)}`);
  }
  return bugzillaId;
}

async function moveToBugzilla(data) {
  const { bugData, githubData } = data;
  const bugzillaId = await createBugzillaBug(bugData);
  const comment = `Moved to bugzilla: `
        + `https://bugzilla.mozilla.org/show_bug.cgi?id=${bugzillaId}\n`;
  await addGitHubComment(githubData, comment);
  if (githubData.close) {
    // Close issue
    try {
      await githubIssueApi({
        issue: githubData,
        method: 'POST',
        data: {
          state: "closed",
          milestone: 13  // The id of the "moved" milestone
        },
      });
    } catch(e) {
      console.error("Failed to close GH issue", e);
    }
  }
  return { bugzillaId };

}

async function trancoRank(data) {
  const {url} = data;

  if (!url) {
    return null;
  }

  if (!url.includes("://")) {
    url = `https://${url}`;
  }
  const parsedUrl = new URL(url);
  let targetDomain = parsedUrl.host;
  let rank = null;
  const tried = [];
  while (targetDomain.includes(".")) {
    tried.push(targetDomain);
    const domainRankUrl = await getTrancoUrl(targetDomain);
    const resp = await fetch(domainRankUrl);
    if (resp.status === 200) {
      const data = await resp.json();
      // TODO: check if this is actually correct for the latest date
      if (data && data.ranks.length) {
        rank = data.ranks[0].rank;
        break;
      }
    } else if (resp.status !== 404) {
      console.error(`Failed to load ${domainRankUrl}`, resp);
      throw new Error(resp);
    }
    const [first, ...rest] = targetDomain.split(".");
    targetDomain = rest.join(".");
  }
  if (rank === null) {
    console.log(`Failed to get domain rank; tried domains ${tried.join(", ")}`);
  }
  return {rank, rankedDomain: rank ? targetDomain : parsedUrl.host};
}


async function getTrancoUrl(domain) {
  const msg = new TextEncoder().encode(domain);
  const hashBuffer = await crypto.subtle.digest("SHA-1", msg);
  const sha1 = Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `https://jgraham.github.io/tranco-subdomains/ranks/domains/${sha1.slice(0,2)}/${sha1.slice(2,4)}/${sha1.slice(4)}.json`;
}
