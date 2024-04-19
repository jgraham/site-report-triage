import {StoredState} from "./state.js";

class UiElement {
  constructor(id, options = {}) {
    this.id = id;
    this.elem = document.getElementById(id);
    if (this.elem === null) {
      throw new Error(`Element ${id} not found`);
    }
  }

  show() {
    this.elem.hidden = false;
  }

  hide() {
    this.elem.hidden = true;
  }
}

export class Section extends UiElement {
  constructor(id, options = {}) {
    super(id, options);
    this.storage = null;
    this.storageListener = null;
    this.controls = {};
  }

  setupDataStorage(key) {
    this.storage = new StoredState(key);
    this.storageListener = () => storeControlsData(this.storage,
                                                   this.controls);
    addEventListener("blur", this.storageListener);
  }

  async loadDataFromStorage() {
    if (this.storage === null) {
      return false;
    }
    return await loadControlsData(this.storage, this.controls);
  };

  clearDataStorage() {
    this.storage.clear();
  }

  show() {
    super.show();
    if (this.storage !== null && this.storageListener === null) {
      this.storageListener = () => storeControlsData(this.storage,
                                                     this.controls);
      addEventListener("blur", this.storageListener);
    }
  }

  hide() {
    super.hide();
    if (this.storageListener) {
      removeEventListener("blur", this.storageListener);
      this.storageListener = null;
    }
  }
}

export class Sections {
  constructor() {
    this.sections = new Map();
  }

  add(id) {
    this.sections.set(id, new Section(id));
  }

  get(id) {
    return this.sections.get(id);
  }

  show(id) {
    if (!this.sections.has(id)) {
      throw new Error(`Unknown section ${id}`);
    }
    for (const [secId, section] of this.sections.entries()) {
      if (secId !== id) {
        section.hide();
      }
    }
    this.sections.get(id).show();
  }
}

export class Control extends UiElement {
  persist = true;

  constructor(state, id, options = {}) {
    super(id, options);
    const {persist = true} = options;
    this.persist = persist;
    this.elem = document.getElementById(id);
    this.signal = state.signal(this.getValueFromElement());
    this.elem.addEventListener("change", () => {
      console.log("Change", this.id, this.state);
      this.signal.value = this.getValueFromElement();
    });
  }

  getValueFromElement() {
    return this.elem.value;
  }

  get value() {
    console.log("get value", this.id, this.elem.value);
    return this.signal.value;
  }

  set value(value) {
    console.log("set value", this.id, value);
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
}

export class CheckboxControl extends Control {
  constructor(state, id, options = {}) {
    super(state, id, options);
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
}

export class OutputControl extends UiElement {
  persist = false;

  constructor(state, id, getValue, options = {}) {
    super(id, options);
    this.elem = document.getElementById(id);
    const control = this;
    state.effect(() => {
      console.log(`Updating ${id}`);
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

async function loadControlsData(storage, controls) {
  const data = await storage.get();
  if (data === null) {
    return false;
  }
  for (const [controlName, state] of Object.entries(data)) {
    const keyParts = controlName.split(".");
    let target = controls;
    for (const key of keyParts) {
      target = target[key];
      if (!target) {
        break;
      }
    }
    if (!target) {
      continue;
    }
    console.log(`Setting ${controlName} ${state}`);
    target.state = state;
  }
  return true;
};

function storeControlsData(storage, controls) {
  const data = {};
  function storeControlSet(prefix, obj) {
    for (let [name, control] of Object.entries(obj)) {
      const key = prefix.length > 0 ? `${prefix}.${name}` : name;
      if (control instanceof UiElement) {
        if (control.persist) {
          data[key] = control.state;
        }
      } else {
        storeControlSet(key, control);
      }
    }
  }
  storeControlSet("", controls);
  storage.set(data);
}
