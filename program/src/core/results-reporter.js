/** Формирует две итоговые таблицы ОР1 и экспортирует обе таблицы в CSV. */
export class ResultsReporter {
  buildSummary(results) {
    return {
      ...results,
      perSource: results.perSource.map(row => ({ ...row })),
      perWorker: results.perWorker.map(row => ({ ...row })),
    };
  }

  exportTable(results) {
    const sourceColumns = ['Источник', 'N поступило', 'Pотк', 'Tпреб', 'Tож', 'Dож', 'Tобсл', 'Dобсл'];
    const sourceRows = results.perSource.map(row => [row.sourceName, row.generated,
      row.refusalProbability, row.averageSojourn ?? '', row.averageWait ?? '', row.waitVariance ?? '',
      row.averageService ?? '', row.serviceVariance ?? '']);
    const workerColumns = ['Прибор', 'Kисп'];
    const workerRows = results.perWorker.map(row => [`П${row.workerId}`, row.utilization]);
    const encode = row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(';');
    return [
      'Таблица 1. Характеристики источников',
      encode(sourceColumns),
      ...sourceRows.map(encode),
      '',
      'Таблица 2. Коэффициенты использования приборов',
      encode(workerColumns),
      ...workerRows.map(encode),
    ].join('\n');
  }
}
