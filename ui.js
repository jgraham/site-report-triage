class UiElement {
  constructor(id, options = {}) {
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

export class Section extends UiElement {}

export class Sections {
  constructor() {
    this.sections = new Map();
  }

  add(id) {
    this.sections.set(id, new Section(id));
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
  constructor(state, id, options = {}) {
    super(id, options);
    this.elem = document.getElementById(id);
    this.signal = state.signal(this.elem.value);
    this.elem.addEventListener("change", () => {
      this.signal.value = this.elem.value;
    });
  }

  get value() {
    return this.signal.value;
  }

  set value(value) {
    this.elem.value = value;
    this.signal.value = value;
  }
}

export class SelectControl extends Control {
  get selectedId() {
    let selectedIndex = this.elem.selectedIndex;
    if (selectedIndex === -1) {
      return null;
    }
    return this.elem[selectedIndex].id;
  }

  set selectedId(value) {
    let selectedIndex = this.elem.selectedIndex;
    for (const option of this.elem.options) {
      if (option.id === value) {
        option.selected = true;
        break;
      }
    }
  }
}

export class OutputControl {
  constructor(state, id, getValue, options = {}) {
    this.elem = document.getElementById(id);
    state.effect(() => {
      console.log(`Updating ${id}`);
      const newValue = getValue();
      if (newValue !== this.elem.value) {
        this.elem.value = newValue;
      }
    });
  }

  get value() {
    return this.elem.value;
  }
}
