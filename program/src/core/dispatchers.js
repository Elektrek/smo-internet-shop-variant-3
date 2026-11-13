import { EventType } from './event-calendar.js';

/** Диспетчер постановки работает только с Buffer и Statistics. Он не обращается к приборам. */
export class PlacementDispatcher {
  constructor(buffer, statistics) {
    this.buffer = buffer;
    this.statistics = statistics;
  }

  handleArrival(request, now, log) {
    const freeSlot = this.buffer.findFreeSlotCircular();
    if (freeSlot >= 0) {
      const result = this.buffer.enqueueCircular(request, now);
      log?.('REQUEST_BUFFERED', `Заявка ${request.displayId} помещена в буфер, ячейка ${result.slot + 1}.`);
      return { accepted: true, evicted: null, slot: result.slot };
    }

    const victim = this.buffer.evictOldest();
    if (!victim) throw new Error('Буфер сообщил о переполнении, но не содержит ожидающих заявок');
    this.statistics.recordEvicted(victim.request);
    log?.('REQUEST_EVICTED', `Заявка ${victim.request.displayId} вытеснена из ячейки ${victim.slot + 1} по Д1ОО3 (самое раннее время генерации).`);

    const result = this.buffer.enqueueCircular(request, now);
    if (!result.stored) throw new Error('После вытеснения старейшей заявки в буфере не освободилась ячейка');
    log?.('REQUEST_BUFFERED', `Новая заявка ${request.displayId} заняла ячейку ${result.slot + 1}; указатель постановки обновлён.`);
    return { accepted: true, evicted: victim.request, slot: result.slot };
  }
}

export const TriggerReason = Object.freeze({ REQUEST_ENQUEUED: 'REQUEST_ENQUEUED', SERVICE_COMPLETED: 'SERVICE_COMPLETED' });

/** Диспетчер выбора запускается по триггерам: новая заявка или освобождение прибора. */
export class SelectionDispatcher {
  constructor({ buffer, devicePool, eventCalendar, statistics, serviceMin, serviceMax }) {
    this.buffer = buffer;
    this.devicePool = devicePool;
    this.eventCalendar = eventCalendar;
    this.statistics = statistics;
  }

  onRequestEnqueued(now, log) {
    log?.('TRIGGER_REQUEST_ENQUEUED', 'Триггер выбора: заявка помещена в буфер.');
    return this.dispatchWhilePossible(now, log);
  }

  onDeviceAvailable(now, log) {
    log?.('TRIGGER_SERVICE_COMPLETED', 'Триггер выбора: прибор освободился после обслуживания.');
    return this.dispatchWhilePossible(now, log);
  }

  dispatchWhilePossible(now, log) {
    let dispatched = 0;
    while (!this.buffer.isEmpty()) {
      const worker = this.devicePool.findFirstFreeByIndex();
      if (!worker) break;

      const selected = this.buffer.dequeueCircular();
      if (!selected) break;
      log?.('REQUEST_SELECTED', `По Д2Б3 выбрана заявка ${selected.request.displayId} из ячейки ${selected.slot + 1}.`);
      this.startOnWorker(selected.request, worker, now, log);
      dispatched += 1;
    }
    return dispatched;
  }

  startOnWorker(request, worker, now, log) {
    const completionTime = worker.startService(request, now);
    log?.('SERVICE_STARTED', `Заявка ${request.displayId} отправлена на прибор №${worker.id}; началась обработка.`);
    this.eventCalendar.schedule({
      time: completionTime,
      type: EventType.SERVICE_COMPLETION,
      workerId: worker.id,
      requestId: request.id,
      sourceId: request.sourceId,
    });
    this.statistics.recordServiceStarted(request, worker, now);
    log?.('COMPLETION_SCHEDULED', `Запланировано завершение заявки ${request.displayId} в момент ${completionTime.toFixed(4)}.`);
  }
}
