export class SimulationSnapshot {
  constructor(data) { Object.assign(this, data); }
}

export class ResultsSnapshot {
  constructor(data) { Object.assign(this, data); }
}

export class PointerSnapshot {
  constructor(putPointer, selectionPointer) {
    this.putPointer = putPointer;
    this.selectionPointer = selectionPointer;
  }
}

export class WorkerSnapshot {
  constructor(data) { Object.assign(this, data); }
}
