const MESSAGES = new Map(Object.entries({
  "read-bug-data": readBugData,
  "set-bug-data": setBugData
}));

browser.runtime.onMessage.addListener(async data => {
  if (MESSAGES.has(data.type)) {
    const resp = await MESSAGES.get(data.type)(data);
    return resp;
  }
  throw new Error(`Unrecognised conent script message: ${data.type}`);
});

function readBugData(data) {
  if (document.getElementById("product") === null) {
    // If we aren't logged in none of the controls exist
    // We could handle that, but for now just return
    return null;
  }
  return {
    number: new URL(location.href).searchParams.get("id"),
    product: document.getElementById("product").value,
    component: document.getElementById("component").value,
    priority: document.getElementById("priority").value,
    severity: document.getElementById("bug_severity").value,
    url: document.getElementById("bug_file_loc").value,
    keywords: document.getElementById("keywords").value,
    cf_user_story: document.getElementById("cf_user_story").value || "",
  };
}

async function setBugData(data) {
  for (const id of ["mode-btn", "user-story-edit-btn"]) {
    const editButton = document.getElementById(id);
    const editable = elem => elem.disabled || getComputedStyle(elem).display === "none";
    if (!editable(editButton)) {
      editButton.click();
    }
    await checkElementState(editButton, editable, {attributes: true}, {timeout: 5000});
  }
  for (const id of ["priority", "bug_severity"]) {
    const select = document.getElementById(id);
    const selectLoaded = elem => elem.length > 1;
    await checkElementState(select, selectLoaded, {childList: true, subtree: true}, {timeout: 5000});
  }

  document.getElementById("priority").value = data.priority;
  document.getElementById("bug_severity").value = data.severity;
  document.getElementById("bug_file_loc").value = data.url;
  document.getElementById("keywords").value = data.keywords;
  document.getElementById("cf_user_story").value = data.userStory;
}

async function checkElementState(elem, cond, observerOptions, options) {
  if (cond(elem)) {
    return;
  }
  let changed = new Promise(resolve => {
    const observer = new MutationObserver(records => {
      for (const record of records) {
        if (cond(elem)) {
          observer.disconnect();
          resolve();
          return;
        }
      }
    });
    observer.observe(elem, observerOptions);
  });
  const { timeout } = options;
  let complete;
  let timeoutHandle;
  if (timeout) {
    let timeoutPromise = new Promise(resolve => {
      timeoutHandle = setTimeout(resolve, timeout);
    });
    complete = Promise.race([changed, timeoutPromise]);
  } else {
    complete = changed;
  }
  await complete;
  clearTimeout(timeoutHandle);
}
