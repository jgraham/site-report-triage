export class StoredState {
  constructor(key) {
    self.key = key;
  }

  async get() {
    console.log("Getting state", self.key);
    const result = await browser.storage.local.get(self.key);
    return result[self.key] ?? null;
  }

  async set(data) {
    console.log("Setting state", self.key);
    const state = {};
    state[self.key] = data;
    const result = await browser.storage.local.set(state);
  }

  async clear() {
    console.log("Clearing state", self.key);
    const result = await browser.storage.local.remove(self.key);
  }
}
