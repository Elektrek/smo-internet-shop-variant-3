import { WorkerSnapshot } from './snapshots.js';
import { UniformServiceDistribution } from './random.js';
import { RequestStatus } from './entities.js';

export const WorkerState = Object.freeze({ FREE: 'FREE', BUSY: 'BUSY' });

export class Worker {
  constructor(id, distribution) {
    this.id = id;
    this.state = WorkerState.FREE;
    this.currentRequest = null;
    this.serviceDistribution = distribution;
    this.accumulatedBusyTime = 0;
    this.busySince = null;
    this.completionTime = null;
  }

  isBusy() { return this.state === WorkerState.BUSY; }

  startService(request, now) {
    if (this.isBusy()) throw new Error(`Прибор ${this.id} уже занят`);
    if (request.status !== RequestStatus.BUFFERED) throw new Error(`Заявка ${request.id} не ожидает в буфере`);
    const serviceTime = this.serviceDistribution.sample();
    request.markInService(now);
    request.serviceTime = serviceTime;
    this.currentRequest = request;
    this.state = WorkerState.BUSY;
    this.busySince = now;
    this.completionTime = now + serviceTime;
    return this.completionTime;
  }

  completeService(now, requestId) {
    if (!this.isBusy() || !this.currentRequest) throw new Error(`Прибор ${this.id} не занят`);
    if (requestId && this.currentRequest.id !== requestId) {
      throw new Error(`Событие завершения не соответствует заявке прибора ${this.id}`);
    }
    const request = this.currentRequest;
    request.markCompleted(now);
    this.accumulatedBusyTime += now - this.busySince;
    this.currentRequest = null;
    this.state = WorkerState.FREE;
    this.busySince = null;
    this.completionTime = null;
    return request;
  }

  getSnapshot(now) {
    return new WorkerSnapshot({
      id: this.id,
      state: this.state,
      requestId: this.currentRequest?.displayId ?? null,
      sourceId: this.currentRequest?.sourceId ?? null,
      queryText: this.currentRequest?.queryText ?? null,
      busySince: this.busySince,
      completionTime: this.completionTime,
      accumulatedBusyTime: this.accumulatedBusyTime + (this.isBusy() ? now - this.busySince : 0),
    });
  }
}

export class DevicePool {
  constructor(workerCount, serviceMin, serviceMax, random) {
    this.workers = Array.from({ length: workerCount }, (_, index) => new Worker(
      index + 1,
      new UniformServiceDistribution(serviceMin, serviceMax, random),
    ));
  }

  findFirstFreeByIndex() {
    return this.workers.find(worker => !worker.isBusy()) ?? null;
  }

  hasFreeWorker() { return this.workers.some(worker => !worker.isBusy()); }
  allBusy() { return this.workers.every(worker => worker.isBusy()); }
  snapshot(now) { return this.workers.map(worker => worker.getSnapshot(now)); }
}
