export class StoredState {
  constructor(key) {
    this.key = key;
  }

  async get() {
    console.log("Getting state", this.key);
    const result = await browser.storage.local.get(this.key);
    return result[this.key] ?? null;
  }

  async set(data) {
    console.log("Setting state", this.key);
    const state = {};
    state[this.key] = data;
    const result = await browser.storage.local.set(state);
  }

  async clear() {
    console.log("Clearing state", this.key);
    const result = await browser.storage.local.remove(this.key);
  }
}
