// Extremely sketchy implementation of reactive primitives

export class State {
  constructor() {
    this.subscribers = new Map();
    this.queued = false;
    this.active = null;
    this.toUpdate = [];
  }

  signal(initialValue) {
    return new Signal(this, initialValue);
  }

  computed(valueFn) {
    return new ComputedSignal(this, valueFn);
  }

  effect(callback) {
    this.active = callback;
    callback();
    this.active = null;
  }

  addDependency(from) {
    if (this.active) {
      this.subscribe(from, this.active);
    }
  }

  subscribe(from, to) {
    if (!this.subscribers.has(from)) {
      this.subscribers.set(from, new Set());
    }
    this.subscribers.get(from).add(to);
  }

  enqueueUpdate(signal) {
    if (!this.subscribers.has(signal)) {
      return;
    }
    this.toUpdate.push(...this.subscribers.get(signal));
    if (!this.queued) {
      this.queued = true;
      queueMicrotask(() => {
        this.flush();
        this.queued = false;
      });
    }
  }

  flush() {
    while (this.toUpdate.length) {
      const effect = this.toUpdate.shift();
      this.active = effect;
      effect();
      this.active = null;
    }
    this.toUpdate = [];
  }
}

class Signal {
  constructor(state, initialValue) {
    this.state = state;
    this.currentValue = initialValue;
  }

  get value() {
    this.state.addDependency(this);
    return this.currentValue;
  }

  set value(newValue) {
    console.log("Set", newValue, this.currentValue);
    if (newValue !== this.currentValue) {
      this.currentValue = newValue;
      this.state.enqueueUpdate(this);
    }
  }
}

class ComputedSignal {
  constructor(state, valueFn) {
    this.state = state;
    this.valueFn = valueFn;
    this.currentValue = null;
    this.updating = false;
  }

  get value() {
    if (this.updating) {
      throw new Error("Cyclic update", this);
    }
    this.updating = true;
    this.state.addDependency(this);
    // TODO: don't update the value more than once per flush
    console.log("Computing", this.valueFn);
    const newValue = this.valueFn();
    if (newValue != this.currentValue) {
      this.currentValue = newValue;
    }
    this.updating = false;
    return this.currentValue;
  }
}
