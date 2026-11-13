import { Random } from './random.js';
import { Source } from './entities.js';
import { Buffer } from './buffer.js';
import { EventCalendar, EventType } from './event-calendar.js';
import { DevicePool } from './devices.js';
import { PlacementDispatcher, SelectionDispatcher, TriggerReason } from './dispatchers.js';
import { Statistics } from './statistics.js';
import { createSourcesConfig } from './config.js';
import { StopCondition } from './stop-condition.js';
import { SimulationSnapshot } from './snapshots.js';

export class SimulationEngine {
  constructor(config) {
    this.config = { ...config };
    this.stopCondition = new StopCondition(config.requestLimit);
    this.random = new Random(config.seed);
    const sourceDefinitions = createSourcesConfig(config.sourceCount, config.lambda);
    this.sources = sourceDefinitions.map(definition => new Source({ ...definition, random: this.random }));
    this.sourceById = new Map(this.sources.map(source => [source.id, source]));
    this.buffer = new Buffer(config.bufferCapacity);
    this.devicePool = new DevicePool(config.workerCount, config.serviceMin, config.serviceMax, this.random);
    this.eventCalendar = new EventCalendar();
    this.statistics = new Statistics(this.sources.map(source => source.id));
    this.placementDispatcher = new PlacementDispatcher(this.buffer, this.statistics);
    this.selectionDispatcher = new SelectionDispatcher({
      buffer: this.buffer,
      devicePool: this.devicePool,
      eventCalendar: this.eventCalendar,
      statistics: this.statistics,
      serviceMin: config.serviceMin,
      serviceMax: config.serviceMax,
    });
    this.modelTime = 0;
    this.requestSequence = 1;
    this.initialized = false;
    this.finished = false;
    this.lastEvent = null;
    this.recentActions = [];
    this.actionSequence = 1;
    this.duration = 0;
    this.arrivalsStopped = false;
  }

  initialize() {
    if (this.initialized) return this.getStateSnapshot();
    this.initialized = true;
    for (const source of this.sources) {
      const nextTime = source.sampleNextArrival(0);
      this.eventCalendar.schedule({ time: nextTime, type: EventType.ARRIVAL, sourceId: source.id });
    }
    this.#log('MODEL_INITIALIZED', `Модель запущена. Для каждого источника запланировано первое поступление заявки.`);
    return this.getStateSnapshot();
  }

  #log(type, message) {
    this.recentActions.push({ id: this.actionSequence++, time: this.modelTime, type, message });
    if (this.recentActions.length > 100) this.recentActions.shift();
  }

  processNextEvent() {
    if (!this.initialized) this.initialize();
    if (this.finished) return null;

    const event = this.eventCalendar.pollNext();
    if (!event) {
      this.finished = true;
      this.duration = Math.max(this.duration, this.modelTime);
      return null;
    }

    this.modelTime = event.time;
    this.lastEvent = event;
    this.recentActions = [];
    this.#log('EVENT', event.type === EventType.ARRIVAL
      ? `Наступило событие поступления заявки от источника ${event.sourceId}.`
      : `Наступило событие завершения обслуживания на приборе №${event.workerId}.`);

    if (event.type === EventType.ARRIVAL) this.#processArrival(event);
    else if (event.type === EventType.SERVICE_COMPLETION) this.#processServiceCompletion(event);
    else throw new Error(`Неизвестный тип события: ${event.type}`);

    if (this.stopCondition.isGenerationComplete(this.statistics) && !this.arrivalsStopped) {
      this.eventCalendar.removeArrivals();
      for (const source of this.sources) source.nextArrivalTime = null;
      this.arrivalsStopped = true;
      this.#log('ARRIVALS_STOPPED', `Достигнут лимит ${this.config.requestLimit} сгенерированных заявок. Оставшиеся заявки продолжают обслуживание.`);
    }

    if (this.stopCondition.isGenerationComplete(this.statistics)
      && this.buffer.isEmpty()
      && this.devicePool.workers.every(worker => !worker.isBusy())
      && !this.eventCalendar.snapshot().some(item => item.type === EventType.ARRIVAL)) {
      this.finished = true;
      this.duration = this.modelTime;
      this.#log('MODEL_FINISHED', 'Все сгенерированные заявки завершили обслуживание или получили отказ; система пуста.');
    }

    return this.getStateSnapshot();
  }

  #processArrival(event) {
    if (this.statistics.generatedCount >= this.config.requestLimit) return;
    const source = this.sourceById.get(event.sourceId);
    if (!source) throw new Error(`Источник ${event.sourceId} не найден`);

    const request = source.generateRequest(this.modelTime, this.requestSequence++);
    this.statistics.recordGenerated(request);
    this.#log('REQUEST_GENERATED', `Сгенерирована заявка ${request.displayId}: «${request.queryText}».`);

    if (this.statistics.generatedCount < this.config.requestLimit) {
      const nextTime = source.sampleNextArrival(this.modelTime);
      this.eventCalendar.schedule({ time: nextTime, type: EventType.ARRIVAL, sourceId: source.id });
      this.#log('NEXT_ARRIVAL_SCHEDULED', `Следующее поступление от ${source.displayName} запланировано на ${nextTime.toFixed(4)}.`);
    }

    this.placementDispatcher.handleArrival(request, this.modelTime, (type, message) => this.#log(type, message));
    this.triggerSelection(TriggerReason.REQUEST_ENQUEUED);
  }

  #processServiceCompletion(event) {
    const worker = this.devicePool.workers.find(item => item.id === event.workerId);
    if (!worker) throw new Error(`Прибор №${event.workerId} не найден`);
    const request = worker.completeService(this.modelTime, event.requestId);
    this.statistics.recordCompleted(request);
    this.#log('REQUEST_COMPLETED', `Заявка ${request.displayId} обработана и вышла из системы. Прибор №${worker.id} свободен.`);
    this.triggerSelection(TriggerReason.SERVICE_COMPLETED);
  }

  triggerSelection(reason) {
    const logger = (type, message) => this.#log(type, message);
    if (reason === TriggerReason.REQUEST_ENQUEUED) return this.selectionDispatcher.onRequestEnqueued(this.modelTime, logger);
    if (reason === TriggerReason.SERVICE_COMPLETED) return this.selectionDispatcher.onDeviceAvailable(this.modelTime, logger);
    throw new Error(`Неизвестная причина запуска диспетчера выбора: ${reason}`);
  }

  runToEnd() {
    if (!this.initialized) this.initialize();
    let guard = 0;
    const maxEvents = this.config.requestLimit * 20 + this.config.workerCount * 10 + 100;
    while (!this.finished && guard < maxEvents) {
      const result = this.processNextEvent();
      if (result === null && this.finished) break;
      guard += 1;
    }
    if (!this.finished) throw new Error('Превышен защитный лимит событий: возможна ошибка в логике завершения модели');
    return this.getResultsSnapshot();
  }

  runEvents(count = 1) {
    if (!Number.isInteger(count) || count < 1) throw new RangeError('Количество шагов должно быть положительным целым числом');
    const snapshots = [];
    for (let index = 0; index < count && !this.finished; index += 1) {
      const snapshot = this.processNextEvent();
      if (snapshot) snapshots.push(snapshot);
    }
    return snapshots;
  }

  getResultsSnapshot() {
    return this.statistics.resultsSnapshot(this.sources, this.devicePool.workers, this.duration || this.modelTime);
  }

  getStateSnapshot() {
    const time = this.modelTime;
    const duration = this.duration || time;
    return new SimulationSnapshot({
      modelTime: time,
      initialized: this.initialized,
      finished: this.finished,
      lastEvent: this.lastEvent ? { ...this.lastEvent } : null,
      generated: this.statistics.generatedCount,
      completed: this.statistics.completedCount,
      evicted: this.statistics.evictedCount,
      refusalProbability: this.statistics.refusalRate(),
      sources: this.sources.map(source => ({
        id: source.id,
        displayName: source.displayName,
        lambda: source.lambda,
        generatedCount: source.generatedCount,
        nextArrivalTime: source.nextArrivalTime,
      })),
      sourceMetrics: this.statistics.liveSourceSnapshot(this.sources),
      buffer: {
        capacity: this.buffer.capacity,
        size: this.buffer.size(),
        slots: this.buffer.snapshotSlots(),
        ...this.buffer.getPointers(),
      },
      workers: this.devicePool.snapshot(time),
      calendar: this.eventCalendar.snapshot(),
      actions: this.recentActions.slice(),
      liveMetrics: {
        averageWait: this.statistics.averageWaitTime(),
        averageService: this.statistics.averageServiceTime(),
        averageSojourn: this.statistics.averageSojournTime(),
        duration,
      },
    });
  }
}
