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
    keywords: document.getElementById("keywords").value.split(",").map(x => x.trim()),
    cf_user_story: document.getElementById("cf_user_story").value || "",
    dependson: document.getElementById("dependson").value || "",
    // This seems like an especially hacky approach to getting this data
    user: document.querySelector("#needinfo_role > option[value=user]").dataset["identity"],
  };
}

function setElementValue(id, value, options={}) {
  const {dispatchChange=false} = options;
  if (value !== undefined) {
    const elem = document.getElementById(id);
    elem.value = value;
    if (dispatchChange) {
      elem.dispatchEvent(new Event("change"));
    }
  }
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

  if (data.product) {
    const component = document.getElementById("component");
    const options = component.options;
    setElementValue("product", data.product, {dispatchChange: true});

    await checkElementState(component,
                            elem => Array.from(elem.options).map(item => item.value).includes(data.component),
                            {childList: true},
                            {timeout: 5000});
    setElementValue("component", data.component, {dispatchChange: true});
  }
  setElementValue("priority", data.priority);
  setElementValue("cf_webcompat_priority", data.webcompatPriority);
  setElementValue("cf_webcompat_score", data.webcompatScore);
  setElementValue("cf_performance_impact", data.performanceImpact);
  setElementValue("bug_severity", data.severity);
  setElementValue("bug_file_loc", data.url);
  setElementValue("keywords", data.keywords);
  setElementValue("cf_user_story", data.userStory);
  setElementValue("dependson", data.dependsOn);
}

async function checkElementState(elem, cond, observerOptions, options) {
  if (cond(elem)) {
    return;
  }
  let changed = new Promise(resolve => {
    const observer = new MutationObserver(records => {
      if (cond(elem)) {
        observer.disconnect();
        resolve();
        return;
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
