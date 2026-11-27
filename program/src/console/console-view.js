const LINE = '─'.repeat(108);

function number(value, digits = 3) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(digits).replace('.', ',');
}

function percent(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits).replace('.', ',')}%`;
}

function table(headers, rows) {
  const values = [headers, ...rows].map(row => row.map(value => String(value ?? '—')));
  const widths = headers.map((header, index) => Math.max(
    String(header).length,
    ...values.slice(1).map(row => (row[index] ?? '').length),
  ));
  const format = row => `│ ${row.map((value, index) => String(value ?? '—').padEnd(widths[index])).join(' │ ')} │`;
  const top = `┌─${widths.map(width => '─'.repeat(width)).join('─┬─')}─┐`;
  const middle = `├─${widths.map(width => '─'.repeat(width)).join('─┼─')}─┤`;
  const bottom = `└─${widths.map(width => '─'.repeat(width)).join('─┴─')}─┘`;
  return [top, format(headers), middle, ...values.slice(1).map(format), bottom].join('\n');
}

function eventDescription(event) {
  if (!event) return 'Начальное состояние';
  if (event.type === 'ARRIVAL') return `Поступление заявки от ${event.sourceId}`;
  if (event.type === 'SERVICE_COMPLETION') return `Завершение обслуживания на приборе №${event.workerId}`;
  return event.type;
}

const TIMELINE_WIDTH = 64;
const TIMELINE_WINDOW = 30;
const MAX_BUFFER_SLOT_ROWS = 12;

function timelineColumn(time, start, end) {
  if (end <= start) return TIMELINE_WIDTH - 1;
  const ratio = Math.max(0, Math.min(1, (time - start) / (end - start)));
  return Math.round(ratio * (TIMELINE_WIDTH - 1));
}

function markAt(columns, index, marker) {
  columns[index] = columns[index] === '─' ? marker : '*';
}

export class ConsoleView {
  constructor() {
    this.timelineHistory = [];
    this.lastRecordedSequence = null;
    this.initialPointRecorded = false;
  }

  resetTimeline() {
    this.timelineHistory = [];
    this.lastRecordedSequence = null;
    this.initialPointRecorded = false;
  }

  recordTimelinePoint(snapshot, stepNumber) {
    if (stepNumber === 0) this.resetTimeline();
    const event = snapshot.lastEvent;
    if (event?.sequence !== undefined && event.sequence === this.lastRecordedSequence) return;
    if (!event && this.initialPointRecorded) return;

    this.timelineHistory.push({
      time: snapshot.modelTime,
      eventType: event?.type ?? 'INITIAL',
      sourceId: event?.sourceId ?? null,
      workerId: event?.workerId ?? null,
      bufferSize: snapshot.buffer.size,
      bufferSlots: snapshot.buffer.slots.map(slot => Boolean(slot.request)),
      workers: snapshot.workers.map(worker => worker.state === 'BUSY'),
    });

    if (event?.sequence !== undefined) this.lastRecordedSequence = event.sequence;
    else this.initialPointRecorded = true;

    const cutoff = snapshot.modelTime - TIMELINE_WINDOW;
    let firstVisibleIndex = 0;
    while (firstVisibleIndex + 1 < this.timelineHistory.length
      && this.timelineHistory[firstVisibleIndex + 1].time < cutoff) {
      firstVisibleIndex += 1;
    }
    if (firstVisibleIndex > 0) this.timelineHistory.splice(0, firstVisibleIndex);
  }

  renderTemporalDiagram(snapshot) {
    const history = this.timelineHistory;
    if (history.length === 0) return;

    const end = snapshot.modelTime;
    const firstTime = history[0].time;
    const start = Math.max(firstTime, end - TIMELINE_WINDOW);
    const axisEnd = end > start ? end : start + 1;
    const labelWidth = 8;
    const prefix = label => `${String(label).padEnd(labelWidth)} │ `;

    const axis = Array(TIMELINE_WIDTH).fill('─');
    const labels = Array(TIMELINE_WIDTH).fill(' ');
    const tickPositions = [0, Math.floor((TIMELINE_WIDTH - 1) / 2), TIMELINE_WIDTH - 1];
    const tickTimes = [start, start + (axisEnd - start) / 2, axisEnd];
    tickPositions.forEach((position, index) => {
      axis[position] = '┬';
      const label = number(tickTimes[index], 3);
      const from = Math.max(0, Math.min(TIMELINE_WIDTH - label.length, position - Math.floor(label.length / 2)));
      for (let offset = 0; offset < label.length; offset += 1) labels[from + offset] = label[offset];
    });

    const samples = [];
    let historyIndex = 0;
    for (let column = 0; column < TIMELINE_WIDTH; column += 1) {
      const time = start + ((axisEnd - start) * column) / (TIMELINE_WIDTH - 1);
      while (historyIndex + 1 < history.length && history[historyIndex + 1].time <= time) historyIndex += 1;
      samples.push(history[historyIndex]);
    }

    const eventColumns = Array(TIMELINE_WIDTH).fill('─');
    const sourceColumns = new Map(snapshot.sources.map(source => [source.id, Array(TIMELINE_WIDTH).fill('─')]));
    for (const point of history) {
      if (point.time < start || point.time > end) continue;
      const column = timelineColumn(point.time, start, axisEnd);
      if (point.eventType === 'ARRIVAL') {
        markAt(eventColumns, column, 'A');
        const sourceRow = sourceColumns.get(point.sourceId);
        if (sourceRow) markAt(sourceRow, column, 'A');
      } else if (point.eventType === 'SERVICE_COMPLETION') {
        markAt(eventColumns, column, 'C');
      }
    }

    console.log('\nВРЕМЕННЫЕ ДИАГРАММЫ (ОД3)');
    console.log(`Видимый интервал модельного времени: ${number(start, 3)} — ${number(axisEnd, 3)}; ширина окна — до ${TIMELINE_WINDOW} единиц времени.`);
    console.log('A — поступление заявки; C — завершение обслуживания; * — несколько событий в одном временном интервале.');
    console.log('Для буфера: # — занятая ячейка, · — свободная. Для прибора: █ — занят, · — свободен.');
    console.log(`${' '.repeat(labelWidth + 3)}${axis.join('')}`);
    console.log(`${' '.repeat(labelWidth + 3)}${labels.join('')}`);
    console.log(prefix('События') + eventColumns.join(''));

    for (const [sourceId, columns] of sourceColumns) {
      console.log(prefix(sourceId) + columns.join(''));
    }

    const bufferCapacity = snapshot.buffer.capacity;
    if (bufferCapacity <= MAX_BUFFER_SLOT_ROWS) {
      for (let slot = 0; slot < bufferCapacity; slot += 1) {
        const columns = samples.map(point => point.bufferSlots[slot] ? '#' : '·');
        console.log(prefix(`Б${slot + 1}`) + columns.join(''));
      }
    } else {
      const columns = samples.map(point => point.bufferSize < 10 ? String(point.bufferSize) : '+');
      console.log(prefix('Буфер') + columns.join(''));
    }

    snapshot.workers.forEach((worker, index) => {
      const columns = samples.map(point => point.workers[index] ? '█' : '·');
      console.log(prefix(`П${worker.id}`) + columns.join(''));
    });
  }

  printStep(snapshot, stepNumber) {
    this.recordTimelinePoint(snapshot, stepNumber);
    console.log('\n' + '='.repeat(108));
    console.log(`ПОШАГОВОЕ МОДЕЛИРОВАНИЕ (ОД3) · ШАГ ${stepNumber}`);
    console.log('='.repeat(108));
    console.log(`Модельное время: ${number(snapshot.modelTime, 4)}`);
    console.log(`Событие: ${eventDescription(snapshot.lastEvent)}`);
    console.log(`Заявки: создано ${snapshot.generated} · обслужено ${snapshot.completed} · вытеснено ${snapshot.evicted} · Pотк ${percent(snapshot.refusalProbability)}`);

    this.renderTemporalDiagram(snapshot);

    console.log('\nТЕКУЩЕЕ СОСТОЯНИЕ: ИСТОЧНИКИ');
    console.log(table(
      ['ID', 'Источник', 'λ', 'Создано', 'Следующее поступление'],
      snapshot.sources.map(source => [
        source.id,
        source.displayName,
        number(source.lambda, 4),
        source.generatedCount,
        number(source.nextArrivalTime, 4),
      ]),
    ));

    console.log('\nТЕКУЩЕЕ СОСТОЯНИЕ: БУФЕР');
    console.log(`Ёмкость: ${snapshot.buffer.capacity} · Занято: ${snapshot.buffer.size}/${snapshot.buffer.capacity}`);
    console.log('PUT — указатель постановки; SEL — указатель выбора.');
    console.log(table(
      ['Ячейка', 'Указатели', 'Заявка', 'Источник', 'Время генерации', 'Запрос'],
      snapshot.buffer.slots.map(slot => {
        const pointers = [slot.isPutPointer ? 'PUT' : '', slot.isSelectionPointer ? 'SEL' : ''].filter(Boolean).join('/');
        const request = slot.request;
        return [
          slot.index + 1,
          pointers || '—',
          request?.displayId ?? 'Свободно',
          request?.sourceId ?? '—',
          request ? number(request.generatedAt, 4) : '—',
          request?.queryText ?? '—',
        ];
      }),
    ));
    console.log(`PUT = ячейка ${snapshot.buffer.putPointer + 1}; SEL = ячейка ${snapshot.buffer.selectionPointer + 1}.`);

    console.log('\nТЕКУЩЕЕ СОСТОЯНИЕ: ПРИБОРЫ');
    console.log(table(
      ['Прибор', 'Состояние', 'Заявка', 'Начало', 'Завершение', 'Занято всего', 'Kисп сейчас'],
      snapshot.workers.map(worker => [
        `П${worker.id}`,
        worker.state === 'BUSY' ? 'Занят' : 'Свободен',
        worker.requestId ?? '—',
        number(worker.busySince, 4),
        number(worker.completionTime, 4),
        number(worker.accumulatedBusyTime, 4),
        snapshot.modelTime > 0 ? percent(worker.accumulatedBusyTime / snapshot.modelTime) : '—',
      ]),
    ));

    console.log('\nТЕКУЩИЕ ПОКАЗАТЕЛИ ПО ИСТОЧНИКАМ');
    console.log(table(
      ['Источник', 'N', 'Обслужено', 'Вытеснено', 'Pотк', 'Tож ср.', 'Tобсл ср.', 'Tпреб ср.'],
      snapshot.sourceMetrics.map(row => [
        row.sourceName,
        row.generated,
        row.completed,
        row.evicted,
        percent(row.refusalProbability),
        number(row.averageWait),
        number(row.averageService),
        number(row.averageSojourn),
      ]),
    ));

    if (snapshot.actions.length) {
      console.log('\nДЕЙСТВИЯ НА ТЕКУЩЕМ ШАГЕ');
      for (const action of snapshot.actions) console.log(`• ${action.message}`);
    }
    if (snapshot.finished) console.log('\nМоделирование завершено: буфер пуст, все приборы свободны.');
    console.log(LINE);
  }

  printFinalTables(results) {
    console.log('\nТАБЛИЦА 1. ХАРАКТЕРИСТИКИ ИСТОЧНИКОВ');
    console.log(table(
      ['Источник', 'N', 'Pотк', 'Tпреб', 'Tож', 'Dож', 'Tобсл', 'Dобсл'],
      results.perSource.map(row => [
        row.sourceName,
        row.generated,
        percent(row.refusalProbability),
        number(row.averageSojourn),
        number(row.averageWait),
        number(row.waitVariance),
        number(row.averageService),
        number(row.serviceVariance),
      ]),
    ));

    console.log('\nТАБЛИЦА 2. КОЭФФИЦИЕНТЫ ИСПОЛЬЗОВАНИЯ ПРИБОРОВ');
    console.log(table(
      ['Прибор', 'Kисп'],
      results.perWorker.map(row => [`П${row.workerId}`, percent(row.utilization)]),
    ));
  }
}
