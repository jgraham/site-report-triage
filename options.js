document.addEventListener("DOMContentLoaded", init);

async function init() {
  const github_key = document.querySelector('#github-key');
  const bugzilla_key = document.querySelector('#bugzilla-key');
  const data = await browser.storage.local.get();
  github_key.value = data.github_key || "";
  bugzilla_key.value = data.bugzilla_key || "";
  document.getElementById("save").addEventListener('click', e => {
    e.preventDefault();
    browser.storage.local.set({
      github_key: github_key.value,
      bugzilla_key: bugzilla_key.value,
    });
  });
}
