export const DEFAULT_CONFIG = Object.freeze({
  sourceCount: 3,
  lambda: 0.22,
  workerCount: 3,
  bufferCapacity: 8,
  serviceMin: 3,
  serviceMax: 7,
  requestLimit: 500,
  seed: 42,
});

export const SOURCE_NAMES = [
  'Веб-приложение',
  'Мобильное приложение',
  'Внешняя интеграция',
];

export function validateConfig(input) {
  const config = {
    sourceCount: Number(input.sourceCount),
    lambda: Number(input.lambda),
    workerCount: Number(input.workerCount),
    bufferCapacity: Number(input.bufferCapacity),
    serviceMin: Number(input.serviceMin),
    serviceMax: Number(input.serviceMax),
    requestLimit: Number(input.requestLimit),
    seed: Math.trunc(Number(input.seed)),
  };

  const errors = [];
  if (!Number.isInteger(config.sourceCount) || config.sourceCount < 1 || config.sourceCount > 20) {
    errors.push('Количество источников должно быть целым числом от 1 до 20.');
  }
  if (!Number.isFinite(config.lambda) || config.lambda <= 0) {
    errors.push('Интенсивность λ должна быть больше нуля.');
  }
  if (!Number.isInteger(config.workerCount) || config.workerCount < 1 || config.workerCount > 100) {
    errors.push('Количество приборов должно быть целым числом от 1 до 100.');
  }
  if (!Number.isInteger(config.bufferCapacity) || config.bufferCapacity < 1 || config.bufferCapacity > 10000) {
    errors.push('Ёмкость буфера должна быть целым числом от 1 до 10000.');
  }
  if (!Number.isFinite(config.serviceMin) || config.serviceMin <= 0) {
    errors.push('Минимальное время обслуживания должно быть больше нуля.');
  }
  if (!Number.isFinite(config.serviceMax) || config.serviceMax < config.serviceMin) {
    errors.push('Максимальное время обслуживания должно быть не меньше минимального.');
  }
  if (!Number.isInteger(config.requestLimit) || config.requestLimit < 1 || config.requestLimit > 1000000) {
    errors.push('Количество генерируемых заявок должно быть целым числом от 1 до 1 000 000.');
  }
  if (!Number.isInteger(config.seed) || config.seed < 0 || config.seed > 0xFFFFFFFF) {
    errors.push('Seed должен быть целым числом от 0 до 4294967295.');
  }

  return { valid: errors.length === 0, errors, config };
}

export function createSourcesConfig(sourceCount, lambda) {
  return Array.from({ length: sourceCount }, (_, index) => ({
    id: `S${index + 1}`,
    displayName: SOURCE_NAMES[index] ?? `Источник ${index + 1}`,
    lambda,
  }));
}
