import { PointerSnapshot } from './snapshots.js';
import { RequestStatus } from './entities.js';

/** Общий ограниченный буфер с двумя независимыми кольцевыми указателями. */
export class Buffer {
  constructor(capacity) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('Ёмкость буфера должна быть положительным целым числом');
    this.capacity = capacity;
    this.slots = Array(capacity).fill(null);
    this.putPointer = 0;
    this.selectionPointer = 0;
  }

  isFull() { return this.size() === this.capacity; }
  isEmpty() { return this.size() === 0; }
  size() { return this.slots.reduce((count, item) => count + (item ? 1 : 0), 0); }

  findFreeSlotCircular() {
    for (let offset = 0; offset < this.capacity; offset += 1) {
      const index = (this.putPointer + offset) % this.capacity;
      if (this.slots[index] === null) return index;
    }
    return -1;
  }

  enqueueCircular(request, now) {
    if (request.status !== RequestStatus.GENERATED) throw new Error('В буфер можно поместить только новую заявку');
    const index = this.findFreeSlotCircular();
    if (index < 0) return { stored: false, slot: null };
    request.markBuffered(now);
    this.slots[index] = request;
    this.putPointer = (index + 1) % this.capacity;
    return { stored: true, slot: index };
  }

  dequeueCircular() {
    for (let offset = 0; offset < this.capacity; offset += 1) {
      const index = (this.selectionPointer + offset) % this.capacity;
      const request = this.slots[index];
      if (request !== null) {
        this.slots[index] = null;
        this.selectionPointer = (index + 1) % this.capacity;
        return { request, slot: index };
      }
    }
    return null;
  }

  /**
   * Д1ОО3 по методичке: старейшая заявка определяется по времени генерации,
   * при равенстве — по порядковому sequenceId для детерминированности.
   */
  findOldestWaiting() {
    let oldest = null;
    let oldestIndex = -1;
    for (let index = 0; index < this.capacity; index += 1) {
      const request = this.slots[index];
      if (!request) continue;
      if (!oldest
        || request.generatedAt < oldest.generatedAt
        || (request.generatedAt === oldest.generatedAt && request.sequenceId < oldest.sequenceId)) {
        oldest = request;
        oldestIndex = index;
      }
    }
    return oldest ? { request: oldest, slot: oldestIndex } : null;
  }

  evictOldest() {
    const found = this.findOldestWaiting();
    if (!found) return null;
    this.slots[found.slot] = null;
    found.request.markEvicted();
    return found;
  }

  snapshotSlots() {
    return this.slots.map((request, index) => ({
      index,
      request: request ? {
        id: request.id,
        displayId: request.displayId,
        sourceId: request.sourceId,
        queryText: request.queryText,
        generatedAt: request.generatedAt,
        enqueuedAt: request.enqueuedAt,
        status: request.status,
      } : null,
      isPutPointer: index === this.putPointer,
      isSelectionPointer: index === this.selectionPointer,
    }));
  }

  getPointers() {
    return new PointerSnapshot(this.putPointer, this.selectionPointer);
  }
}
