export class StopCondition {
  constructor(maxGenerated) {
    if (!Number.isInteger(maxGenerated) || maxGenerated < 1) throw new RangeError('Лимит генерации должен быть положительным целым числом');
    this.maxGenerated = maxGenerated;
  }

  isGenerationComplete(statistics) {
    return statistics.generatedCount >= this.maxGenerated;
  }
}
