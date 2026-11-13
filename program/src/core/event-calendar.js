export const EventType = Object.freeze({
  ARRIVAL: 'ARRIVAL',
  SERVICE_COMPLETION: 'SERVICE_COMPLETION',
});

export class SimulationEvent {
  constructor({ time, type, sequence, sourceId = null, workerId = null, requestId = null }) {
    this.time = time;
    this.sequence = sequence;
    this.type = type;
    this.sourceId = sourceId;
    this.workerId = workerId;
    this.requestId = requestId;
  }

  compareTo(other) {
    if (this.time !== other.time) return this.time - other.time;
    return this.sequence - other.sequence;
  }
}

function compareEvents(a, b) { return a.compareTo(b); }

/** Минимальная двоичная куча: ближайшее событие извлекается за O(log n). */
export class EventCalendar {
  constructor() {
    this.heap = [];
    this.nextSequence = 1;
  }

  schedule(event) {
    if (!Number.isFinite(event.time) || event.time < 0) throw new RangeError('Время события должно быть конечным и неотрицательным');
    const item = new SimulationEvent({ ...event, sequence: this.nextSequence++ });
    this.heap.push(item);
    this.#siftUp(this.heap.length - 1);
    return item;
  }

  pollNext() {
    if (this.heap.length === 0) return null;
    const first = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this.#siftDown(0);
    }
    return first;
  }

  peekNextTime() {
    return this.heap.length ? this.heap[0].time : null;
  }

  isEmpty() { return this.heap.length === 0; }

  removeArrivals() {
    const kept = this.heap.filter(event => event.type !== EventType.ARRIVAL);
    this.heap = [];
    for (const event of kept) {
      this.heap.push(event);
      this.#siftUp(this.heap.length - 1);
    }
  }

  snapshot() {
    return this.heap.slice().sort(compareEvents).map(event => ({ ...event }));
  }

  #siftUp(index) {
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareEvents(this.heap[parent], this.heap[index]) <= 0) break;
      [this.heap[parent], this.heap[index]] = [this.heap[index], this.heap[parent]];
      index = parent;
    }
  }

  #siftDown(index) {
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < this.heap.length && compareEvents(this.heap[left], this.heap[smallest]) < 0) smallest = left;
      if (right < this.heap.length && compareEvents(this.heap[right], this.heap[smallest]) < 0) smallest = right;
      if (smallest === index) break;
      [this.heap[index], this.heap[smallest]] = [this.heap[smallest], this.heap[index]];
      index = smallest;
    }
  }
}
