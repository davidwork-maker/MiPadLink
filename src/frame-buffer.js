export class LatestFrameBuffer {
  constructor({ maxHistory = 2 } = {}) {
    if (!Number.isInteger(maxHistory) || maxHistory < 1) {
      throw new Error("maxHistory must be a positive integer");
    }
    this.maxHistory = maxHistory;
    this._frames = [];
    this._dropped = 0;
  }

  push(frame) {
    this._frames.push(frame);
    while (this._frames.length > this.maxHistory) {
      this._frames.shift();
      this._dropped += 1;
    }
  }

  peekLatest() {
    return this._frames[this._frames.length - 1] ?? null;
  }

  drainLatest() {
    const latest = this.peekLatest();
    this._frames.length = 0;
    return latest;
  }

  snapshot() {
    return {
      length: this._frames.length,
      dropped: this._dropped,
      latest: this.peekLatest()
    };
  }
}
