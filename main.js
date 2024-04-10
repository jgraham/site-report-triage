import {Sections, Control} from "./ui.js";
import * as Move from "./move-to-bugzilla.js";

async function init() {
  const tabs = await browser.tabs.query({ active: true, currentWindow: true });
  const url = new URL(tabs[0].url);

  const sections = new Sections();
  sections.add("initial");
  sections.add("move-to-bugzilla", Move.render);
  sections.add("triage-bug");

  sections.show(getSection(url));
}

function getSection(url) {
  if (Move.isActive(url)) {
    return "move-to-bugzilla";
  } else {
    return "initial";
  }
}

addEventListener("DOMContentLoaded", init);
