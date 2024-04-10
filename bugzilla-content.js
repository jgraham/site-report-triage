const MESSAGES = new Map(Object.entries({
  "read-bug-data": readBugData,
  "set-bug-data": setBugData
}));

browser.runtime.onMessage.addListener(async data => {
  if (MESSAGES.has(data.type)) {
    const resp = await MESSAGES.get(data.type)(data);
    console.log(data, resp);
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
    const editable = editButton.disabled || getComputedStyle(editButton).display == "none";
    console.log(editButton, editable);
    if (!editable) {
      let changed = new Promise(resolve => {
        const observer = new MutationObserver(records => {
          for (const record of records) {
            if (record.target === editButton && editButton.disabled) {
              observer.disconnect();
              resolve();
            }
          }
        });
        observer.observe(editButton, {attributes: true});
      });
      editButton.click();
      console.log("Awaiting change");
      await changed;
    }
  }

  document.getElementById("priority").value = data.priority;
  document.getElementById("bug_severity").value = data.severity;
  document.getElementById("bug_file_loc").value = data.url;
  document.getElementById("keywords").value = data.keywords;
  document.getElementById("cf_user_story").value = data.userStory;
}
