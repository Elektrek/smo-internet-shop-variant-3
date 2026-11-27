import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from '../src/core/buffer.js';
import { Request, RequestStatus } from '../src/core/entities.js';
import { EventCalendar, EventType } from '../src/core/event-calendar.js';
import { DEFAULT_CONFIG } from '../src/core/config.js';
import { SimulationEngine } from '../src/core/simulation-engine.js';
import { estimateRequestCount } from '../src/core/statistics.js';
import { ResultsReporter } from '../src/core/results-reporter.js';
import { ConsoleView } from '../src/console/console-view.js';

function makeRequest(id, sequenceId, generatedAt) {
  return new Request({
    id: sequenceId,
    displayId: id,
    sequenceId,
    sourceId: 'S1',
    queryText: `query ${id}`,
    filters: {},
    generatedAt,
  });
}

test('Д1ОЗ1: размещение ищет место по кольцу и передвигает putPointer', () => {
  const buffer = new Buffer(3);
  const a = makeRequest('A', 1, 1);
  const b = makeRequest('B', 2, 2);
  const c = makeRequest('C', 3, 3);
  assert.equal(buffer.enqueueCircular(a, 1).slot, 0);
  assert.equal(buffer.putPointer, 1);
  assert.equal(buffer.enqueueCircular(b, 2).slot, 1);
  assert.equal(buffer.putPointer, 2);
  assert.equal(buffer.dequeueCircular().request, a);
  assert.equal(buffer.enqueueCircular(c, 3).slot, 2);
  assert.equal(buffer.putPointer, 0);
  const d = makeRequest('D', 4, 4);
  assert.equal(buffer.enqueueCircular(d, 4).slot, 0);
  assert.equal(buffer.putPointer, 1);
});

test('Д2Б3: извлечение ищет первую занятую ячейку от selectionPointer', () => {
  const buffer = new Buffer(4);
  const requests = [1, 2, 3].map(i => makeRequest(String(i), i, i));
  requests.forEach((request, i) => buffer.enqueueCircular(request, i + 1));
  assert.equal(buffer.dequeueCircular().request.displayId, '1');
  assert.equal(buffer.selectionPointer, 1);
  assert.equal(buffer.dequeueCircular().request.displayId, '2');
  assert.equal(buffer.selectionPointer, 2);
  assert.equal(buffer.dequeueCircular().request.displayId, '3');
  assert.equal(buffer.selectionPointer, 3);
  assert.equal(buffer.dequeueCircular(), null);
});

test('Д1ОО3: вытесняется самая ранняя по generatedAt, а не самая ранняя enqueuedAt', () => {
  const buffer = new Buffer(2);
  const oldGenerated = makeRequest('old-generated', 1, 1);
  const oldEnqueued = makeRequest('old-enqueued', 2, 2);
  oldGenerated.markBuffered(10);
  oldEnqueued.markBuffered(2);
  buffer.slots[0] = oldGenerated;
  buffer.slots[1] = oldEnqueued;
  const victim = buffer.evictOldest();
  assert.equal(victim.request.displayId, 'old-generated');
  assert.equal(victim.request.status, RequestStatus.EVICTED);
  assert.equal(buffer.size(), 1);
});

test('EventCalendar возвращает события по возрастанию времени, при равенстве — по sequence', () => {
  const calendar = new EventCalendar();
  calendar.schedule({ time: 5, type: EventType.ARRIVAL });
  calendar.schedule({ time: 2, type: EventType.ARRIVAL });
  calendar.schedule({ time: 2, type: EventType.SERVICE_COMPLETION });
  assert.equal(calendar.pollNext().time, 2);
  assert.equal(calendar.pollNext().type, EventType.SERVICE_COMPLETION);
  assert.equal(calendar.pollNext().time, 5);
  assert.equal(calendar.isEmpty(), true);
});

test('поступление заявки немедленно запускает её на свободный прибор через SelectionDispatcher', () => {
  const config = { ...DEFAULT_CONFIG, sourceCount: 1, lambda: 0.2, workerCount: 2, bufferCapacity: 3, requestLimit: 5, seed: 3 };
  const engine = new SimulationEngine(config);
  engine.initialize();
  const snapshot = engine.processNextEvent();
  assert.equal(snapshot.generated, 1);
  assert.equal(snapshot.completed, 0);
  assert.equal(snapshot.buffer.size, 0);
  assert.equal(snapshot.workers.filter(worker => worker.state === 'BUSY').length, 1);
  assert.ok(snapshot.calendar.some(event => event.type === EventType.SERVICE_COMPLETION));
});

test('автоматический прогон завершается после генерации N и полного обслуживания остатка', () => {
  const config = { ...DEFAULT_CONFIG, sourceCount: 3, lambda: 0.35, workerCount: 2, bufferCapacity: 3, serviceMin: 2, serviceMax: 4, requestLimit: 250, seed: 12345 };
  const engine = new SimulationEngine(config);
  const results = engine.runToEnd();
  assert.equal(results.generated, 250);
  assert.equal(results.completed + results.evicted, 250);
  assert.equal(engine.buffer.size(), 0);
  assert.equal(engine.devicePool.workers.every(worker => !worker.isBusy()), true);
  assert.equal(engine.eventCalendar.isEmpty(), true);
  assert.equal(engine.finished, true);
  assert.ok(results.duration > 0);
  assert.ok(results.perWorker.every(worker => worker.utilization >= 0 && worker.utilization <= 1));
});

test('одинаковый seed даёт воспроизводимые результаты', () => {
  const config = { ...DEFAULT_CONFIG, requestLimit: 120, seed: 9876 };
  const first = new SimulationEngine(config).runToEnd();
  const second = new SimulationEngine(config).runToEnd();
  assert.equal(first.generated, second.generated);
  assert.equal(first.evicted, second.evicted);
  assert.equal(first.completed, second.completed);
  assert.equal(first.duration, second.duration);
  assert.deepEqual(first.perSource.map(row => row.generated), second.perSource.map(row => row.generated));
});


test('Д1ОО3 в полном прогоне вытесняет ожидающие заявки и принимает новые', () => {
  const config = { ...DEFAULT_CONFIG, sourceCount: 1, lambda: 15, workerCount: 1, bufferCapacity: 1, serviceMin: 1, serviceMax: 1, requestLimit: 40, seed: 7 };
  const results = new SimulationEngine(config).runToEnd();
  assert.equal(results.generated, 40);
  assert.ok(results.evicted > 0);
  assert.ok(results.refusalProbability > 0);
  assert.equal(results.completed + results.evicted, 40);
});

test('формула методички возвращает конечное N только для 0 < p < 1', () => {
  assert.equal(estimateRequestCount(0), null);
  assert.equal(estimateRequestCount(1), null);
  assert.equal(estimateRequestCount(0.1), 2430);
});


test('ОР1: CSV-отчёт содержит ровно две итоговые таблицы — источники и приборы', () => {
  const results = new SimulationEngine({ ...DEFAULT_CONFIG, sourceCount: 2, workerCount: 2, requestLimit: 30, seed: 314 }).runToEnd();
  const csv = new ResultsReporter().exportTable(results);
  assert.equal((csv.match(/Таблица [12]\./g) ?? []).length, 2);
  assert.match(csv, /Таблица 1\. Характеристики источников/);
  assert.match(csv, /Таблица 2\. Коэффициенты использования приборов/);
  assert.equal(results.perSource.length, 2);
  assert.equal(results.perWorker.length, 2);
});


test('ОД3: пошаговый вывод содержит временные диаграммы и текущее состояние', () => {
  const config = { ...DEFAULT_CONFIG, sourceCount: 2, lambda: 0.2, workerCount: 2, bufferCapacity: 3, requestLimit: 5, seed: 33 };
  const engine = new SimulationEngine(config);
  const view = new ConsoleView();
  const output = [];
  const originalLog = console.log;
  console.log = (...args) => output.push(args.join(' '));
  try {
    let snapshot = engine.initialize();
    view.printStep(snapshot, 0);
    snapshot = engine.processNextEvent();
    view.printStep(snapshot, 1);
  } finally {
    console.log = originalLog;
  }
  const rendered = output.join('\n');
  assert.match(rendered, /ПОШАГОВОЕ МОДЕЛИРОВАНИЕ \(ОД3\)/);
  assert.match(rendered, /ВРЕМЕННЫЕ ДИАГРАММЫ \(ОД3\)/);
  assert.match(rendered, /ТЕКУЩЕЕ СОСТОЯНИЕ: ИСТОЧНИКИ/);
  assert.match(rendered, /ТЕКУЩЕЕ СОСТОЯНИЕ: БУФЕР/);
  assert.match(rendered, /ТЕКУЩЕЕ СОСТОЯНИЕ: ПРИБОРЫ/);
  assert.doesNotMatch(rendered, /ПОШАГОВОЕ МОДЕЛИРОВАНИЕ \(ОД1\)/);
});

test('ОД3: временная диаграмма отражает поступления, занятость приборов и состояние буфера', () => {
  const config = { ...DEFAULT_CONFIG, sourceCount: 1, lambda: 0.2, workerCount: 1, bufferCapacity: 2, requestLimit: 4, seed: 11 };
  const engine = new SimulationEngine(config);
  const view = new ConsoleView();
  const output = [];
  const originalLog = console.log;
  console.log = (...args) => output.push(args.join(' '));
  try {
    let snapshot = engine.initialize();
    view.printStep(snapshot, 0);
    snapshot = engine.processNextEvent();
    view.printStep(snapshot, 1);
  } finally {
    console.log = originalLog;
  }
  const rendered = output.join('\n');
  assert.match(rendered, /События/);
  assert.match(rendered, /S1/);
  assert.match(rendered, /Б1/);
  assert.match(rendered, /П1/);
  assert.match(rendered, /A/);
  assert.match(rendered, /█/);
});
