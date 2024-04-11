let user = null;

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
    case "get-issue-data": {
      return getIssueData(data);
      break;
    }

    case "move-to-bugzilla": {
      return moveToBugzilla(data);
      break;
    }
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
          milestone: "moved"
        },
      });
    } catch(e) {
      console.error("Failed to close GH issue", e);
    }
  }
  return { bugzillaId };

}
