import { ResultsSnapshot } from './snapshots.js';
function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Выборочная дисперсия (деление на n - 1), для n < 2 не определена. */
function sampleVariance(values) {
  if (values.length < 2) return null;
  const average = mean(values);
  return values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
}

export class Statistics {
  constructor(sourceIds) {
    this.generatedCount = 0;
    this.completedCount = 0;
    this.evictedCount = 0;
    this.totalWaitTime = 0;
    this.totalSojournTime = 0;
    this.sourceStats = new Map(sourceIds.map(id => [id, {
      generated: 0,
      completed: 0,
      evicted: 0,
      waits: [],
      serviceTimes: [],
      sojournTimes: [],
    }]));
  }

  #forSource(sourceId) {
    if (!this.sourceStats.has(sourceId)) throw new Error(`Неизвестный источник ${sourceId}`);
    return this.sourceStats.get(sourceId);
  }

  recordGenerated(request) {
    this.generatedCount += 1;
    this.#forSource(request.sourceId).generated += 1;
  }

  recordEvicted(request) {
    this.evictedCount += 1;
    this.#forSource(request.sourceId).evicted += 1;
  }

  recordServiceStarted(request) {
    const wait = request.getWaitTime();
    if (wait === null || wait < -1e-10) throw new Error(`Некорректное время ожидания заявки ${request.id}`);
    this.#forSource(request.sourceId).waits.push(Math.max(0, wait));
    this.totalWaitTime += Math.max(0, wait);
  }

  recordCompleted(request) {
    const source = this.#forSource(request.sourceId);
    const service = request.getServiceTime();
    const sojourn = request.getSojournTime();
    if (service === null || sojourn === null) throw new Error(`Не рассчитано время заявки ${request.id}`);
    source.completed += 1;
    source.serviceTimes.push(service);
    source.sojournTimes.push(sojourn);
    this.completedCount += 1;
    this.totalSojournTime += sojourn;
  }

  refusalRate(sourceId = null) {
    if (sourceId) {
      const source = this.#forSource(sourceId);
      return source.generated ? source.evicted / source.generated : 0;
    }
    return this.generatedCount ? this.evictedCount / this.generatedCount : 0;
  }

  averageWaitTime(sourceId = null) {
    const values = sourceId ? this.#forSource(sourceId).waits : [...this.sourceStats.values()].flatMap(item => item.waits);
    return mean(values);
  }

  averageServiceTime(sourceId = null) {
    const values = sourceId ? this.#forSource(sourceId).serviceTimes : [...this.sourceStats.values()].flatMap(item => item.serviceTimes);
    return mean(values);
  }

  averageSojournTime(sourceId = null) {
    const values = sourceId ? this.#forSource(sourceId).sojournTimes : [...this.sourceStats.values()].flatMap(item => item.sojournTimes);
    return mean(values);
  }

  liveSourceSnapshot(sources) {
    return sources.map(source => {
      const values = this.#forSource(source.id);
      return {
        sourceId: source.id,
        sourceName: source.displayName,
        generated: values.generated,
        completed: values.completed,
        evicted: values.evicted,
        refusalProbability: values.generated ? values.evicted / values.generated : 0,
        averageWait: mean(values.waits),
        averageService: mean(values.serviceTimes),
        averageSojourn: mean(values.sojournTimes),
      };
    });
  }

  utilization(worker, duration, now = duration) {
    if (!(duration > 0)) return 0;
    const busy = worker.accumulatedBusyTime + (worker.isBusy() ? Math.max(0, now - worker.busySince) : 0);
    return Math.min(1, busy / duration);
  }

  resultsSnapshot(sources, workers, duration) {
    const perSource = sources.map(source => {
      const values = this.#forSource(source.id);
      return {
        sourceId: source.id,
        sourceName: source.displayName,
        generated: values.generated,
        completed: values.completed,
        evicted: values.evicted,
        refusalProbability: values.generated ? values.evicted / values.generated : 0,
        averageWait: mean(values.waits),
        waitVariance: sampleVariance(values.waits),
        averageService: mean(values.serviceTimes),
        serviceVariance: sampleVariance(values.serviceTimes),
        averageSojourn: mean(values.sojournTimes),
      };
    });
    const perWorker = workers.map(worker => ({
      workerId: worker.id,
      busyTime: worker.accumulatedBusyTime,
      utilization: duration > 0 ? worker.accumulatedBusyTime / duration : 0,
    }));
    return new ResultsSnapshot({
      duration,
      generated: this.generatedCount,
      completed: this.completedCount,
      evicted: this.evictedCount,
      refusalProbability: this.refusalRate(),
      averageWait: this.averageWaitTime(),
      averageService: this.averageServiceTime(),
      averageSojourn: this.averageSojournTime(),
      perSource,
      perWorker,
    });
  }
}

export function estimateRequestCount(refusalProbability, { t = 1.643, relativePrecision = 0.1 } = {}) {
  if (!(refusalProbability > 0 && refusalProbability < 1)) return null;
  return Math.ceil((t ** 2 * (1 - refusalProbability)) / (refusalProbability * relativePrecision ** 2));
}
