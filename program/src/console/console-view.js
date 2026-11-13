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

export class ConsoleView {
  printStep(snapshot, stepNumber) {
    console.log('\n' + '='.repeat(108));
    console.log(`ПОШАГОВОЕ МОДЕЛИРОВАНИЕ (ОД1) · ШАГ ${stepNumber}`);
    console.log('='.repeat(108));
    console.log(`Модельное время: ${number(snapshot.modelTime, 4)}`);
    console.log(`Событие: ${eventDescription(snapshot.lastEvent)}`);
    console.log(`Заявки: создано ${snapshot.generated} · обслужено ${snapshot.completed} · вытеснено ${snapshot.evicted} · Pотк ${percent(snapshot.refusalProbability)}`);

    console.log('\nИСТОЧНИКИ');
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

    console.log('\nБУФЕР');
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

    console.log('\nПРИБОРЫ');
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
