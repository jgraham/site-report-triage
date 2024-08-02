import {StoredState} from "./state.js";

function loadControls(controls, data) {
  for (const [controlName, control] of Object.entries(controls)) {
    if (data.hasOwnProperty(controlName)) {
      const controlData = data[controlName];
      if (control instanceof UiElement) {
        control.load(controlData);
      } else {
        loadControls(control, controlData);
      }
    }
  }
}

function serializeControls(controls) {
  if (controls instanceof UiElement) {
    if (controls.persist) {
      return controls.serialize();
    }
  } else {
    const rv = {};
    for (let [name, control] of Object.entries(controls)) {
      const serialized = serializeControls(control);
      if (serialized !== undefined) {
        rv[name] = serialized;
      }
    }
    return rv;
  }
  return undefined;
}

export class UiElement {
  constructor(idOrElem, options = {}) {
    if (typeof idOrElem === "string") {
      this.id = idOrElem;
      this.elem = document.getElementById(idOrElem);
      if (this.elem === null) {
        throw new Error(`Element ${idOrElem} not found`);
      }
    } else {
      this.id = null;
      this.elem = idOrElem;
    }
  }

  get textContent() {
    return this.elem.textContent;
  }

  set textContent(value) {
    this.elem.textContent = value;
  }

  show() {
    this.elem.hidden = false;
  }

  hide() {
    this.elem.hidden = true;
  }
}

export class Section extends UiElement {
  constructor(idOrElem, options = {}) {
    super(idOrElem, options);
    const {persist=true} = options;
    this.controls = {};
    this.persist = persist;
    this.localData = {};
  }

  serialize() {
    return {
      localData: this.localData,
      controls: serializeControls(this.controls)
    };
  }

  load(data) {
    this.localData = data.localData ?? {};
    loadControls(this.controls, data.controls ?? {});
  }

  async create(state, options) {
    // Create the initial state of the section
  }

  async populate(data) {
    // Populate the section from initial data
  }
}

export class ReadOnlySection extends Section {
  constructor(idOrElem, options = {}) {
    options.persist = false;
    super(idOrElem, options);
  }
}

export class Sections {
  constructor(storageKey) {
    this.sections = new Map();
    this.storage = new StoredState(storageKey);
    this.serializeOnClose = true;
    const storeData = () => {
      if (this.serializeOnClose) {
        this.storage.set(this.serialize());
      } else {
        this.storage.clear();
      }
    };
    addEventListener("blur", storeData);
  }

  add(id, cls = Section, options = {}) {
    const section = new cls(id, options);
    this.sections.set(id, section);
    return section;
  }

  get(id) {
    if (!this.sections.has(id)) {
      throw new Error(`Unknown section ${id}`);
    }
    return this.sections.get(id);
  }

  get current() {
    for (const section of this.sections.values()) {
      if (!section.elem.hidden) {
        return section;
      }
    }
    return null;
  };

  serialize() {
    const sections = {};
    for (const [secId, section] of this.sections.entries()) {
      const sectionData = section.serialize();
      if (sectionData) {
        sections[section.id] = sectionData;
      }
    }
    const currentSection = this.current.persist ? this.current.id : null;
    const data = {
      currentSection,
      sections
    };
    return data;
  }

  async load() {
    const data = await this.storage.get();
    if (!data || !data.currentSection) {
      return null;
    }

    let section = null;
    for (const [sectionId, storedData] of Object.entries(data.sections ?? {})) {
      try {
        section = this.get(sectionId);
      } catch(e) {
        console.warn(`Tried to load data for unknown section: ${sectionId}`);
        section = null;
        continue;
      }
      section.load(storedData);
    }

    let current = this.get(data.currentSection);
    if (current) {
      this.show(current.id);
    }
    return current;
  }

  show(id) {
    const target = this.get(id);

    for (const [secId, section] of this.sections.entries()) {
      if (section !== target) {
        section.hide();
      }
    }
    target.show();
  }
}

export class Control extends UiElement {
  persist = true;

  constructor(state, idOrElem, options = {}) {
    super(idOrElem, options);
    const {persist = true} = options;
    this.persist = persist;
    this.signal = state.signal(this.getValueFromElement());
    this.elem.addEventListener("change", () => {
      this.signal.value = this.getValueFromElement();
    });
  }

  getValueFromElement() {
    return this.elem.value;
  }

  get value() {
    return this.signal.value;
  }

  set value(value) {
    this.elem.value = value;
    this.signal.value = value;
  }

  /* State represents the actual state of the control.
   * For an input control this matches its value, but for other control types
   * it might not e.g. for a checkbox this is whether it's checked
   */
  get state() {
    return this.value;
  }

  set state(value) {
    this.value = value;
  }

  load(value) {
    this.state = value;
  }

  serialize() {
    return this.state;
  }
}

export class CheckboxControl extends Control {
  constructor(state, idOrElem, options = {}) {
    super(state, idOrElem, options);
    const { defaultValue = "0" } = options;
    this.defaultValue = defaultValue;
  }

  getValueFromElement() {
    return this.elem.checked ? this.elem.value : this.defaultValue;
  }

  get value() {
    return this.signal.value;
  }

  set value(value) {
    throw new Error("Can't set checkbox value");
  }

  get state() {
    return this.elem.checked;
  }

  set state(value) {
    this.elem.checked = value;
    this.signal.value = this.getValueFromElement();
  }

  values() {
    return new Set([this.elem.value, ""]);
  }
}

export class SelectControl extends Control {
  get state() {
    let selectedIndex = this.elem.selectedIndex;
    if (selectedIndex === -1) {
      return null;
    }
    return this.elem[selectedIndex].id;
  }

  set state(value) {
    let selectedIndex = this.elem.selectedIndex;
    for (const option of this.elem.options) {
      if (option.id === value) {
        option.selected = true;
        break;
      }
    }
    this.signal.value = this.elem.value;
  }

  values() {
    const values = new Set();
    for (const option of this.elem.options) {
      values.add(option.value);
    }
    return values;
  }
}

export class OutputControl extends UiElement {
  persist = false;

  constructor(state, idOrElem, getValue, options = {}) {
    super(idOrElem, options);
    const control = this;
    state.effect(() => {
      const newValue = getValue(control);
      if (newValue !== this.elem.value) {
        this.elem.value = newValue;
      }
    });
  }

  get value() {
    return this.elem.value;
  }
}

export class Button extends UiElement {
  persist = false;

  constructor(state, idOrElem, onClick, options = {}) {
    super(idOrElem, options);
    this.elem.addEventListener("click", onClick);
  }
}

export class Link extends UiElement {
  constructor(state, idOrElem, options = {}) {
    super(idOrElem, options);
    const { onClick } = options;
    if (onClick) {
      this.elem.addEventListener("click", onClick);
    }
  }

  get href() {
    return this.elem.href;
  }

  set href(value) {
    this.elem.href = value;
  }
}
